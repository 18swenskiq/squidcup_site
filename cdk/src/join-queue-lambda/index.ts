import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.REGION });

// Function to call the database service
async function callDatabaseService(operation: string, params?: any[], data?: any): Promise<any> {
  const payload = {
    operation,
    params,
    data
  };

  const command = new InvokeCommand({
    FunctionName: process.env.DATABASE_SERVICE_FUNCTION_NAME!,
    Payload: JSON.stringify(payload),
  });

  const response = await lambdaClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  
  if (!result.success) {
    throw new Error(result.error || 'Database service call failed');
  }
  
  return result.data;
}

// Function to extract numeric Steam ID from OpenID URL
function extractSteamIdFromOpenId(steamId: string): string {
  // If it's already a numeric Steam ID, return as is
  if (/^\d+$/.test(steamId)) {
    return steamId;
  }
  
  // Extract from OpenID URL format: https://steamcommunity.com/openid/id/76561198041569692
  const match = steamId.match(/\/id\/(\d+)$/);
  if (match && match[1]) {
    return match[1];
  }
  
  // If no match found, return the original value
  console.warn('Could not extract Steam ID from:', steamId);
  return steamId;
}

// Function to get the maximum players for a gamemode
function getMaxPlayersForGamemode(gameMode: string): number {
  switch (gameMode) {
    case '5v5':
      return 10;
    case 'wingman':
      return 4;
    case '3v3':
      return 6;
    case '1v1':
      return 2;
    default:
      return 10;
  }
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Join queue event received');
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  console.log('Body:', event.body);

  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

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
    
    // Validate session using database service
    const sessionData = await callDatabaseService('getSession', [sessionToken]);
    
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

    // Get the queue with players from database service
    const queueData = await callDatabaseService('getQueueWithPlayers', [queueId]);
    
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

    // Add user to the queue using database service
    const now = new Date().toISOString();
    const playerData = {
      steamId: userSteamId,
      joinTime: now,
      isHost: false
    };

    await callDatabaseService('addPlayerToQueue', [queueId], playerData);

    // Store queue history event using database service
    const historyEventData = {
      queueId,
      userSteamId,
      eventType: 'join',
      eventData: {
        gameMode: queueData.game_mode,
        mapSelectionMode: queueData.map_selection_mode,
        hostSteamId: queueData.host_steam_id,
      }
    };

    await callDatabaseService('storeQueueHistoryEvent', undefined, historyEventData);

    // Get updated queue data to check if it's full
    const updatedQueueData = await callDatabaseService('getQueueWithPlayers', [queueId]);
    
    // Check if queue is now full and should be converted to lobby
    const maxPlayers = getMaxPlayersForGamemode(queueData.game_mode);
    const currentPlayers = updatedQueueData.players ? updatedQueueData.players.length : 0;
    
    if (currentPlayers >= maxPlayers) {
      console.log('Queue is full, creating lobby...');
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
