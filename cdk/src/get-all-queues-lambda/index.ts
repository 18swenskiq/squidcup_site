import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSession, getUser, getActiveQueuesWithDetails, ActiveQueueWithDetails, Session, User, QueueWithUserInfo } from '@squidcup/shared-lambda-utils';

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

    // Validate session using shared utilities
    console.log('Validating session token');
    const sessionData: Session | null = await getSession(sessionToken);
    
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
    const userData: User | null = await getUser(sessionData.steamId);
    
    if (!userData || !(userData.is_admin === true || userData.is_admin === 1)) {
      console.log('User is not admin, access denied');
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    // Get all active queues with details using shared utilities
    console.log('Getting all active queues with details');
    const activeQueues: ActiveQueueWithDetails[] = await getActiveQueuesWithDetails();
    
    console.log('Retrieved', activeQueues.length, 'active queues');

    // Convert to the format expected by the admin interface
    const queuesWithUserInfo: QueueWithUserInfo[] = activeQueues.map((queue: ActiveQueueWithDetails) => ({
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
