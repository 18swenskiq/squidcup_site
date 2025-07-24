import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.REGION });

interface QueueHistoryResponse {
  id: string;
  gameMode: string;
  mapSelectionMode: string;
  ranked: boolean;
  startTime: string;
  endTime: string;
  status: 'active' | 'completed' | 'cancelled' | 'disbanded' | 'timeout' | 'error';
  statusDescription: string;
  wasHost: boolean;
  finalPlayerCount: number;
  duration: string; // formatted duration
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

// Function to extract numeric Steam ID from OpenID URL
function extractSteamIdFromOpenId(steamId: string): string {
  console.log('extractSteamIdFromOpenId called with:', steamId);
  
  // Handle null/undefined steamId
  if (!steamId) {
    console.error('steamId is null or undefined');
    return '';
  }
  
  // If it's already a numeric Steam ID, return as is
  if (/^\d+$/.test(steamId)) {
    console.log('Already numeric, returning as is');
    return steamId;
  }
  
  // Extract from OpenID URL format: https://steamcommunity.com/openid/id/76561198041569692
  const match = steamId.match(/\/id\/(\d+)$/);
  if (match && match[1]) {
    console.log('Extracted from OpenID URL:', match[1]);
    return match[1];
  }
  
  // If no match found, return the original value
  console.warn('Could not extract Steam ID from:', steamId);
  return steamId;
}

// Function to format duration from milliseconds to human readable string
function formatDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return '< 1m';
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Get queue history handler started');
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
    
    // Validate session using database service
    const sessionData = await callDatabaseService('getSession', [sessionToken]);
    
    if (!sessionData) {
      console.log('Invalid or expired session');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Extract Steam ID from session
    const userSteamId = extractSteamIdFromOpenId(sessionData.steamId);
    console.log('User Steam ID:', userSteamId);

    // Get queue history from database service
    console.log('Getting queue history for user:', userSteamId);
    const queueHistoryData = await callDatabaseService('getUserQueueHistory', undefined, { 
      steamId: userSteamId, 
      limit: 20 
    });

    // Transform the data to match the expected response format
    const queueHistory: QueueHistoryResponse[] = (queueHistoryData || []).map((item: any) => {
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
