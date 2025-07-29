import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  getSession,
  getGameWithPlayers,
  updateGame,
  createCorsHeaders,
  SelectMapRequest
} from '@squidcup/shared-lambda-utils';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = createCorsHeaders();

  try {
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Validate HTTP method
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // Validate authorization header
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing or invalid authorization token' }),
      };
    }

    // Extract session token
    const sessionToken = authHeader.substring(7);

    // Validate session using shared utilities
    const session = await getSession(sessionToken);

    if (!session) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    const steamId = session.steamId;

    // Parse request body
    let requestBody: SelectMapRequest;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch (error) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid JSON in request body' }),
      };
    }

    const { gameId, mapId } = requestBody;

    if (!gameId || !mapId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required fields: gameId, mapId' }),
      };
    }

    // Get the game to verify user is the host using shared utilities
    const game = await getGameWithPlayers(gameId);
    
    if (!game) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Game not found' }),
      };
    }

    // Check if user is the host (only host can select map)
    if (game.host_steam_id !== steamId) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Only the game host can select the map' }),
      };
    }

    // Check if the game is in lobby status (maps can only be selected in lobby)
    if (game.status !== 'lobby') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Maps can only be selected when the game is in lobby status' }),
      };
    }

    // Check if map selection mode allows host to pick
    if (game.map_selection_mode === 'all-pick') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Map selection mode does not allow host to pick maps' }),
      };
    }

    // Update the game with the selected map using shared utilities
    await updateGame(gameId, {
      map: mapId
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Map selected successfully',
        game: {
          ...game,
          map: mapId,
          updatedAt: new Date().toISOString()
        }
      }),
    };

  } catch (error) {
    console.error('Error selecting map:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};