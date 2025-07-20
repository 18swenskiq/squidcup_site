import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ddbClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const ssmClient = new SSMClient({ region: process.env.REGION });

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

    // Get session secret from SSM
    const ssmCommand = new GetParameterCommand({
      Name: '/squidcup/session-secret',
      WithDecryption: true,
    });
    const ssmResponse = await ssmClient.send(ssmCommand);
    const sessionSecret = ssmResponse.Parameter?.Value;

    if (!sessionSecret) {
      console.error('Failed to retrieve session secret from SSM');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Internal server error' }),
      };
    }

    // Simple session validation (you should implement proper JWT validation)
    const sessionParts = sessionToken.split('.');
    if (sessionParts.length !== 3) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session token format' }),
      };
    }

    // Decode the session to get user info
    let steamId: string;
    try {
      const payload = JSON.parse(Buffer.from(sessionParts[1], 'base64').toString());
      steamId = payload.steamId;
      
      if (!steamId) {
        throw new Error('No steamId in token');
      }
    } catch (error) {
      console.error('Failed to decode session token:', error);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session token' }),
      };
    }

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

    // Get the lobby to verify user is the host
    const getLobbyCommand = new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `LOBBY#${lobbyId}`,
        sk: 'LOBBY'
      }
    });

    const lobbyResult = await docClient.send(getLobbyCommand);
    
    if (!lobbyResult.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Lobby not found' }),
      };
    }

    // Check if user is the host (only host can select map)
    if (lobbyResult.Item.hostSteamId !== steamId) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Only the lobby host can select the map' }),
      };
    }

    // Check if lobby allows host to pick maps
    if (lobbyResult.Item.mapSelectionMode !== 'Host Pick') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Map selection is not allowed in this lobby mode' }),
      };
    }

    // Update the lobby with the selected map
    const updateCommand = new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `LOBBY#${lobbyId}`,
        sk: 'LOBBY'
      },
      UpdateExpression: 'SET selectedMap = :mapName, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':mapName': mapName,
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    });

    const updateResult = await docClient.send(updateCommand);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Map selected successfully',
        lobby: updateResult.Attributes
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
