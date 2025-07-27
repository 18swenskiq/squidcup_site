import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import { 
  getSession, 
  getUserActiveQueue, 
  storeQueueHistoryEvent, 
  deleteQueue, 
  removePlayerFromQueue, 
  updateQueue,
  createCorsHeaders,
} from '@squidcup/shared-lambda-utils';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Leave queue handler started');
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

    // Get session token from headers
    console.log('Getting session token from headers');
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('No authorization header found');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7);
    console.log('Extracted session token:', sessionToken.substring(0, 10) + '...');
    
    // Validate session using shared utilities
    const session = await getSession(sessionToken);
    console.log('Session result:', session);
    
    if (!session) {
      console.log('Invalid or expired session');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    const userSteamId = session.steamId;
    console.log('User Steam ID:', userSteamId);

    // Find the user's active queue using shared utilities
    const userQueue = await getUserActiveQueue(userSteamId);
    if (!userQueue) {
      console.log('User is not in any queue');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'User is not in any queue' }),
      };
    }

    console.log('Found user queue:', userQueue.id);
    const isHost = userQueue.isHost || userQueue.host_steam_id === userSteamId;
    console.log('User is host:', isHost);

    if (isHost) {
      // User is the host - disband the entire queue
      console.log('Disbanding queue as host');
      
      // Store disband event for the host
      const hostEventId = crypto.randomUUID();
      await storeQueueHistoryEvent({
        id: hostEventId,
        queueId: userQueue.id,
        playerSteamId: userSteamId,
        eventType: 'disband',
        eventData: {
          gameMode: userQueue.game_mode,
          mapSelectionMode: userQueue.map_selection_mode,
          joinerCount: userQueue.players ? userQueue.players.length : 0,
        }
      });

      // Store disband events for all players in the queue
      if (userQueue.players && userQueue.players.length > 0) {
        for (const player of userQueue.players) {
          if (player.player_steam_id !== userSteamId) { // Don't duplicate for host
            const playerEventId = crypto.randomUUID();
            await storeQueueHistoryEvent({
              id: playerEventId,
              queueId: userQueue.id,
              playerSteamId: player.player_steam_id,
              eventType: 'disband',
              eventData: {
                gameMode: userQueue.game_mode,
                mapSelectionMode: userQueue.map_selection_mode,
                disbandedByHost: userSteamId,
              }
            });
          }
        }
      }
      
      // Mark the queue as cancelled instead of deleting it
      await updateQueue(userQueue.id, { status: 'cancelled' });

      console.log('Queue disbanded successfully');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          action: 'disbanded',
          message: 'Queue disbanded successfully',
          wasHost: true,
        }),
      };
    } else {
      // User is a joiner - remove them from the queue
      console.log('Removing user from queue as joiner');
      
      // Store leave event
      const eventId = crypto.randomUUID();
      await storeQueueHistoryEvent({
        id: eventId,
        queueId: userQueue.id,
        playerSteamId: userSteamId,
        eventType: 'leave',
        eventData: {
          gameMode: userQueue.game_mode,
          mapSelectionMode: userQueue.map_selection_mode,
          hostSteamId: userQueue.host_steam_id,
        }
      });
      
      // Remove player from queue using shared utilities
      await removePlayerFromQueue(userQueue.id, userSteamId);

      // Update queue current_players count
      const newPlayerCount = Math.max(0, (userQueue.current_players || 1) - 1);
      await updateQueue(userQueue.id, {
        currentPlayers: newPlayerCount
      });

      console.log('User removed from queue successfully');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          action: 'left',
          message: 'Successfully left the queue',
          wasHost: false,
        }),
      };
    }

  } catch (error) {
    console.error('Error in leave queue handler:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Error name:', error instanceof Error ? error.name : 'Unknown');
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    
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
