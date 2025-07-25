import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  getSession,
  getLobbyWithPlayers,
  updateLobby,
  createCorsHeaders
} from '@squidcup/shared-lambda-utils';

interface SelectMapRequest {
  lobbyId: string;
  mapName: string;
}

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

    const { lobbyId, mapName } = requestBody;

    if (!lobbyId || !mapName) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required fields: lobbyId, mapName' }),
      };
    }

    // Get the lobby to verify user is the host using shared utilities
    const lobby = await getLobbyWithPlayers(lobbyId);
    
    if (!lobby) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Lobby not found' }),
      };
    }

    // Check if user is the host (only host can select map)
    if (lobby.hostSteamId !== steamId) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Only the lobby host can select the map' }),
      };
    }

    // Check if lobby allows host to pick maps
    if (lobby.mapSelectionMode !== 'Host Pick') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Map selection is not allowed in this lobby mode' }),
      };
    }

    // Update the lobby with the selected map using shared utilities
    await updateLobby(lobbyId, {
      map: mapName,
      updatedAt: new Date().toISOString()
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Map selected successfully',
        lobby: {
          ...lobby,
          map: mapName,
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