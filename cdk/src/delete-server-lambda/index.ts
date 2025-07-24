import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

// Initialize Lambda client
const lambdaClient = new LambdaClient({ region: process.env.REGION });

export interface DatabaseRequest {
  operation: string;
  data?: any;
  params?: any[];
}

export interface DatabaseResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// Function to call database service
async function callDatabaseService(request: DatabaseRequest): Promise<DatabaseResponse> {
  try {
    const command = new InvokeCommand({
      FunctionName: process.env.DATABASE_SERVICE_FUNCTION_NAME,
      Payload: JSON.stringify(request)
    });

    const response = await lambdaClient.send(command);
    
    if (!response.Payload) {
      throw new Error('No response from database service');
    }

    const responseData = JSON.parse(Buffer.from(response.Payload).toString());
    return responseData;
  } catch (error) {
    console.error('Error calling database service:', error);
    throw error;
  }
}

// Function to extract numeric Steam ID from OpenID URL
function extractSteamIdFromOpenId(steamId: string): string {
  if (steamId.includes('steamcommunity.com/openid/id/')) {
    return steamId.split('/').pop() || steamId;
  }
  return steamId;
}

// Function to check if user is admin
async function isAdmin(steamId: string): Promise<boolean> {
  const numericSteamId = extractSteamIdFromOpenId(steamId);
  const adminSteamId = '76561198041569692';
  return numericSteamId === adminSteamId;
}

export async function handler(event: any): Promise<any> {
  console.log('Delete server event received');
  console.log('Path parameters:', event.pathParameters);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));

  try {
    // Get server ID from path parameters
    const serverId = event.pathParameters?.id;
    if (!serverId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Server ID is required' }),
      };
    }

    // Get session token from Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7);
    console.log('Extracted session token:', sessionToken);
    
    // Get session from database service
    const sessionResponse = await callDatabaseService({
      operation: 'getSession',
      params: [sessionToken]
    });

    if (!sessionResponse.success || !sessionResponse.data) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    const session = sessionResponse.data;
    console.log('Session found:', session);

    // Check if user is admin
    const userIsAdmin = await isAdmin(session.steamId);
    if (!userIsAdmin) {
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    // Check if server exists and delete it using database service
    const deleteServerResponse = await callDatabaseService({
      operation: 'deleteServer',
      params: [serverId]
    });

    if (!deleteServerResponse.success) {
      // Check if it's a server not found error
      if (deleteServerResponse.error?.includes('not found')) {
        return {
          statusCode: 404,
          headers: {
            'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          },
          body: JSON.stringify({ error: 'Server not found' }),
        };
      }
      
      throw new Error(deleteServerResponse.error || 'Failed to delete server');
    }

    console.log('Server deleted successfully:', serverId);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
      },
      body: JSON.stringify({ message: 'Server deleted successfully', serverId }),
    };
  } catch (error) {
    console.error('Error deleting server:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
      },
      body: JSON.stringify({ error: 'Failed to delete server' }),
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
