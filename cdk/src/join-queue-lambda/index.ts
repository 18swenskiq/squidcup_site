import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import * as crypto from 'crypto';
import { 
  getSession, 
  getQueueWithPlayers, 
  addPlayerToQueue, 
  storeQueueHistoryEvent,
  createCorsHeaders,
  extractSteamIdFromOpenId,
  getMaxPlayersForGamemode
} from '@squidcup/shared-lambda-utils';

const lambdaClient = new LambdaClient({ region: process.env.REGION });

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Join queue event received');
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  console.log('Body:', event.body);

  const corsHeaders = createCorsHeaders();

  try {
    // Get session token from Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7);
    console.log('Extracted session token:', sessionToken);
    
    // Validate session using shared utilities
    const sessionData = await getSession(sessionToken);
    
    if (!sessionData) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Extract Steam ID from session
    const userSteamId = extractSteamIdFromOpenId(sessionData.steamId);
    console.log('User Steam ID:', userSteamId);

    // Parse request body
    const { queueId, password } = JSON.parse(event.body || '{}');
    
    if (!queueId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Queue ID is required' }),
      };
    }

    // Get the queue with players from shared utilities
    const queueData = await getQueueWithPlayers(queueId);
    
    if (!queueData) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Queue not found' }),
      };
    }

    console.log('Found queue:', queueData);

    // Check if queue has a password and validate it
    if (queueData.password) {
      if (!password) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Password is required for this queue' }),
        };
      }
      
      if (queueData.password !== password) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Incorrect password' }),
        };
      }
    }

    // Check if user is already the host
    if (queueData.host_steam_id === userSteamId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'You are already the host of this queue' }),
      };
    }

    // Check if user is already a player in the queue
    const isAlreadyInQueue = queueData.players && queueData.players.some((player: any) => player.player_steam_id === userSteamId);
    if (isAlreadyInQueue) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'You are already in this queue' }),
      };
    }

    // Add user to the queue using shared utilities
    const now = new Date();
    const playerData = {
      steamId: userSteamId,
      joinTime: now,
      isHost: false
    };

    await addPlayerToQueue(queueId, playerData);

    // Store queue history event using shared utilities
    const historyEventData = {
      id: crypto.randomUUID(),
      queueId,
      playerSteamId: userSteamId,
      eventType: 'join' as const,
      eventData: {
        gameMode: queueData.game_mode,
        mapSelectionMode: queueData.map_selection_mode,
        hostSteamId: queueData.host_steam_id,
      }
    };

    await storeQueueHistoryEvent(historyEventData);

    // Get updated queue data to check if it's full
    const updatedQueueData = await getQueueWithPlayers(queueId);
    
    if (!updatedQueueData) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Queue not found after joining' }),
      };
    }
    
    // Check if queue is now full and should be converted to lobby
    const maxPlayers = getMaxPlayersForGamemode(queueData.game_mode);
    const currentPlayers = updatedQueueData.current_players;
    
    if (currentPlayers >= maxPlayers) {
      console.log('Queue is full, creating lobby...');
      console.log(`Current players: ${currentPlayers}, Max players: ${maxPlayers}`);
      console.log('CREATE_LOBBY_FUNCTION_NAME environment variable:', process.env.CREATE_LOBBY_FUNCTION_NAME);
      
      try {
        // Invoke create-lobby lambda
        const createLobbyPayload = {
          body: JSON.stringify({ queueId })
        };
        
        console.log('Invoking create-lobby lambda with function name:', process.env.CREATE_LOBBY_FUNCTION_NAME);
        
        await lambdaClient.send(new InvokeCommand({
          FunctionName: process.env.CREATE_LOBBY_FUNCTION_NAME,
          Payload: JSON.stringify(createLobbyPayload),
          InvocationType: 'Event' // Async invocation
        }));
        
        console.log('Lobby creation triggered successfully');
      } catch (error) {
        console.error('Error triggering lobby creation:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        // Don't fail the join operation if lobby creation fails
      }
    }

    console.log('User joined queue successfully');

    // Transform the data to match the expected response format
    const joiners = updatedQueueData.players 
      ? updatedQueueData.players
          .filter((player: any) => !player.is_host)
          .map((player: any) => ({
            steamId: player.steam_id,
            joinTime: player.join_time,
          }))
      : [];

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Successfully joined queue',
        queue: {
          id: queueId,
          hostSteamId: updatedQueueData.host_steam_id,
          gameMode: updatedQueueData.game_mode,
          mapSelectionMode: updatedQueueData.map_selection_mode,
          serverId: updatedQueueData.server_id,
          hasPassword: !!updatedQueueData.password,
          ranked: updatedQueueData.ranked,
          startTime: updatedQueueData.start_time,
          joiners: joiners,
          createdAt: updatedQueueData.created_at,
          updatedAt: updatedQueueData.updated_at,
        }
      }),
    };

  } catch (error) {
    console.error('Error joining queue:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to join queue' }),
    };
  }
}

// Export using CommonJS for maximum compatibility
exports.handler = handler;
