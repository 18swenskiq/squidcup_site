import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.REGION });

interface QueueWithUserInfo {
  id: string;
  hostSteamId: string;
  hostName: string;
  gameMode: string;
  mapSelectionMode: string;
  serverId: string;
  serverName: string;
  hasPassword: boolean;
  ranked: boolean;
  startTime: string;
  joiners: Array<{
    steamId: string;
    name: string;
    joinTime: string;
  }>;
  createdAt: string;
  updatedAt: string;
  players: number;
  maxPlayers: number;
}

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

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Get all queues handler started');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
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

    // Get session token from headers
    console.log('Getting session token from headers');
    const authHeader = event.headers.Authorization || event.headers.authorization;
    console.log('Auth header:', authHeader ? 'Present' : 'Missing');
    
    if (!authHeader) {
      console.log('No authorization header found');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No session token provided' }),
      };
    }

    // Extract token from Bearer format
    const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    console.log('Session token extracted:', sessionToken.substring(0, 10) + '...');

    // Validate session using database service
    console.log('Validating session token');
    const sessionData = await callDatabaseService('getSession', [sessionToken]);
    
    if (!sessionData) {
      console.log('Invalid session token - no session found');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session token' }),
      };
    }

    console.log('Session data:', {
      steamId: sessionData.steamId,
      expiresAt: sessionData.expiresAt,
      currentTime: new Date().toISOString(),
    });
    
    // Check if session is expired
    const expiresAtTime = new Date(sessionData.expiresAt).getTime();
    if (expiresAtTime < Date.now()) {
      console.log('Session expired');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Session expired' }),
      };
    }

    // Get user data to check admin status
    console.log('Checking admin status for Steam ID:', sessionData.steamId);
    const userData = await callDatabaseService('getUser', [sessionData.steamId]);
    
    if (!userData || !userData.is_admin) {
      console.log('User is not admin, access denied');
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    // Get all active queues with details using the database service
    console.log('Getting all active queues with details');
    const activeQueues = await callDatabaseService('getActiveQueuesWithDetails');
    
    console.log('Retrieved', activeQueues.length, 'active queues');

    // Convert to the format expected by the admin interface
    const queuesWithUserInfo: QueueWithUserInfo[] = activeQueues.map((queue: any) => ({
      id: queue.queueId,
      hostSteamId: queue.hostSteamId,
      hostName: queue.hostName,
      gameMode: queue.gameMode,
      mapSelectionMode: queue.mapSelectionMode,
      serverId: queue.serverId,
      serverName: queue.serverName,
      hasPassword: queue.hasPassword,
      ranked: queue.ranked,
      startTime: queue.startTime,
      joiners: queue.joiners,
      createdAt: queue.createdAt,
      updatedAt: queue.lastActivity,
      players: queue.players,
      maxPlayers: queue.maxPlayers,
    }));

    // Sort by creation time (newest first)
    queuesWithUserInfo.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    console.log('Returning successful response with', queuesWithUserInfo.length, 'queues');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        queues: queuesWithUserInfo,
        total: queuesWithUserInfo.length,
      }),
    };

  } catch (error) {
    console.error('Error getting all queues:', error);
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
