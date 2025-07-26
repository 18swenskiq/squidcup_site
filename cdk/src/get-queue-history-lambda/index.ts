import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSession, getUserQueueHistory, createCorsHeaders, extractSteamIdFromOpenId, formatDuration, QueueHistoryEntry } from '@squidcup/shared-lambda-utils';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Get queue history handler invoked');
  console.log('Event:', JSON.stringify(event, null, 2));

  const corsHeaders = createCorsHeaders();

  try {
    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Get session token from Authorization header
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    if (!authHeader) {
      console.log('No authorization header found');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Authorization header required' }),
      };
    }

    const sessionToken = authHeader.replace('Bearer ', '');
    console.log('Session token extracted:', sessionToken ? 'Present' : 'Missing');

    // Validate session
    console.log('Validating session...');
    const session = await getSession(sessionToken);
    if (!session) {
      console.log('Invalid session token');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session token' }),
      };
    }

    console.log('Session valid for steam ID:', session.steamId);
    const userSteamId = extractSteamIdFromOpenId(session.steamId);

    // Get queue history from database
    console.log('Getting queue history for user:', userSteamId);
    console.log('Calling getUserQueueHistory with params:', JSON.stringify({ steamId: userSteamId, limit: 20 }));
    const queueHistoryData = await getUserQueueHistory(userSteamId, 20);
    console.log('Received queue history data:', queueHistoryData ? queueHistoryData.length : 0, 'entries');

    // Transform the data to match the expected response format
    const queueHistory: QueueHistoryEntry[] = (queueHistoryData || []).map((item: any) => {
      // Calculate duration if we have created_at timestamp
      let duration = '< 1m';
      if (item.created_at) {
        const createdTime = new Date(item.created_at);
        const now = new Date();
        const durationMs = now.getTime() - createdTime.getTime();
        duration = formatDuration(durationMs);
      }

      return {
        id: item.id || item.queue_id || 'unknown',
        gameMode: item.game_mode || 'Unknown',
        mapSelectionMode: item.map_selection_mode || 'Unknown', 
        ranked: false, // Default for now
        startTime: item.created_at || new Date().toISOString(),
        endTime: item.created_at || new Date().toISOString(), // For now, use same as start
        status: item.event_type === 'join' ? 'completed' : 'active' as any,
        statusDescription: item.event_type === 'join' ? 'Joined a queue' : 'Unknown event',
        wasHost: false, // Default for now
        finalPlayerCount: 0, // Default for now
        duration: duration,
      };
    });

    console.log('Returning queue history with', queueHistory.length, 'entries');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        queueHistory: queueHistory,
        total: queueHistory.length,
      }),
    };

  } catch (error) {
    console.error('Error in get queue history handler:', error);
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