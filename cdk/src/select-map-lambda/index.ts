import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.REGION });

async function callDatabaseService(operation: string, params: any = {}) {
  const command = new InvokeCommand({
    FunctionName: process.env.DATABASE_SERVICE_FUNCTION_NAME,
    Payload: new TextEncoder().encode(JSON.stringify({ operation, params })),
  });

  const response = await lambdaClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  
  if (result.errorMessage) {
    throw new Error(result.errorMessage);
  }
  
  return result;
}

interface SelectMapRequest {
  lobbyId: string;
  mapName: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

  try {
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

    // Validate session via database service
    const sessionResult = await callDatabaseService('getSession', {
      sessionToken: sessionToken,
    });

    if (!sessionResult.session || !sessionResult.session.userId) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    const steamId = sessionResult.session.userId;

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

    // Get the lobby to verify user is the host via database service
    const lobbyResult = await callDatabaseService('getLobbyWithPlayers', {
      lobbyId: lobbyId,
    });
    
    if (!lobbyResult.lobby) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Lobby not found' }),
      };
    }

    // Check if user is the host (only host can select map)
    if (lobbyResult.lobby.hostSteamId !== steamId) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Only the lobby host can select the map' }),
      };
    }

    // Check if lobby allows host to pick maps
    if (lobbyResult.lobby.mapSelectionMode !== 'Host Pick') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Map selection is not allowed in this lobby mode' }),
      };
    }

    // Update the lobby with the selected map via database service
    const updateResult = await callDatabaseService('updateLobby', {
      lobbyId: lobbyId,
      updates: {
        selectedMap: mapName,
        updatedAt: new Date().toISOString()
      }
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Map selected successfully',
        lobby: updateResult.lobby
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