import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import { 
  getSession, 
  getLobbyWithPlayers, 
  storeLobbyHistoryEvent, 
  deleteLobby,
  deleteQueue,
  createCorsHeaders,
} from '@squidcup/shared-lambda-utils';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Leave lobby handler started');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const corsHeaders = createCorsHeaders();

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
    
    // Validate session using shared utilities
    const session = await getSession(sessionToken);
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
    const { gameId } = JSON.parse(event.body || '{}');
    
    if (!gameId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Game ID is required' }),
      };
    }

    // Get the lobby with players from shared utilities
    const lobbyData = await getLobbyWithPlayers(gameId);

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
      await storeLobbyHistoryEvent({
        id: eventId,
        gameId: lobbyData.id,
        playerSteamId: player.player_steam_id,
        eventType: 'disband',
        eventData: {
          gameMode: lobbyData.game_mode,
          mapSelectionMode: lobbyData.map_selection_mode || 'host-pick',
          disbandedBy: userSteamId,
          isHost: player.player_steam_id === lobbyData.host_steam_id,
        }
      });
    }
    
    // Delete the lobby using shared utilities
    await deleteLobby(lobbyData.id);

    // Note: In unified architecture, there's no separate queue to delete
    // The game record itself handles both queue and lobby states

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
