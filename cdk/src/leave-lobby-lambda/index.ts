import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import * as crypto from 'crypto';

const lambdaClient = new LambdaClient({ region: process.env.REGION });

interface LobbyPlayer {
  player_steam_id: string;
  team?: number;
  joined_at?: string;
}

interface LobbyData {
  id: string;
  host_steam_id: string;
  game_mode: string;
  map_selection_mode: string;
  server_id: string;
  password?: string;
  ranked: boolean;
  players: LobbyPlayer[];
  created_at: string;
  updated_at: string;
}

// Function to call database service
async function callDatabaseService(operation: string, params?: any[], data?: any): Promise<any> {
  const payload = {
    operation,
    params,
    data
  };

  const command = new InvokeCommand({
    FunctionName: process.env.DATABASE_SERVICE_FUNCTION_NAME,
    Payload: new TextEncoder().encode(JSON.stringify(payload)),
  });

  const response = await lambdaClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.Payload));

  if (!result.success) {
    throw new Error(result.error || 'Database operation failed');
  }

  return result.data;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Leave lobby handler started');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
  };

  try {
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
      console.log('Handling OPTIONS request');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

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
    const session = await callDatabaseService('getSession', [sessionToken]);
    console.log('Session result:', session);
    
    if (!session) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    const userSteamId = session.steamId;
    console.log('User Steam ID:', userSteamId);

    // Parse request body
    const { lobbyId } = JSON.parse(event.body || '{}');
    
    if (!lobbyId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Lobby ID is required' }),
      };
    }

    // Get the lobby with players from database service
    const lobbyData: LobbyData = await callDatabaseService('getLobbyWithPlayers', [lobbyId]);

    if (!lobbyData) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Lobby not found' }),
      };
    }

    console.log('Found lobby:', lobbyData.id);

    // Check if user is in the lobby
    const isInLobby = lobbyData.players.some(player => player.player_steam_id === userSteamId);
    if (!isInLobby) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'You are not in this lobby' }),
      };
    }

    const isHost = lobbyData.host_steam_id === userSteamId;
    console.log('User is host:', isHost);

    // Since leaving a lobby always disbands it (unlike queues), we always delete the entire lobby
    console.log('Disbanding lobby as any player leaving disbands the entire lobby');
    
    // Store disband events for all players
    for (const player of lobbyData.players) {
      const eventId = crypto.randomUUID();
      await callDatabaseService('storeLobbyHistoryEvent', [], {
        id: eventId,
        lobbyId: lobbyData.id,
        playerSteamId: player.player_steam_id,
        eventType: 'disbanded',
        eventData: {
          gameMode: lobbyData.game_mode,
          mapSelectionMode: lobbyData.map_selection_mode,
          disbandedBy: userSteamId,
          isHost: player.player_steam_id === lobbyData.host_steam_id,
        }
      });
    }
    
    // Delete the lobby using database service
    await callDatabaseService('deleteLobby', [lobbyData.id]);

    console.log('Lobby disbanded successfully');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        action: 'disbanded',
        message: 'Lobby disbanded successfully',
        wasHost: isHost,
      }),
    };

  } catch (error) {
    console.error('Error in leave lobby handler:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      }),
    };
  }
};
