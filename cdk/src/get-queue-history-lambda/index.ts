import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface SessionData {
  userId: string;
  expiresAt: string;
  createdAt: string;
}

interface QueueHistoryEvent {
  pk: string;
  sk: string;
  queueId: string;
  userSteamId: string;
  eventType: 'start' | 'join' | 'leave' | 'disband' | 'timeout' | 'complete';
  eventData: any;
  timestamp: string;
  createdAt: string;
}

interface QueueSummary {
  queueId: string;
  gameMode: string;
  mapSelectionMode: string;
  ranked: boolean;
  startTime: string;
  endTime: string | null;
  status: 'active' | 'completed' | 'cancelled' | 'disbanded' | 'timeout' | 'error';
  statusDescription: string;
  wasHost: boolean;
  finalPlayerCount: number;
  events: QueueHistoryEvent[];
}

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

// Function to get user session from DynamoDB
async function getUserSession(sessionToken: string): Promise<{ userId: string; expiresAt: string } | null> {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `SESSION#${sessionToken}`,
        sk: 'METADATA',
      },
    }));

    if (!result.Item || result.Item.deleted) {
      return null;
    }

    // Check if session is expired
    const expiresAt = new Date(result.Item.expiresAt);
    if (expiresAt < new Date()) {
      return null;
    }

    return {
      userId: result.Item.userId,
      expiresAt: result.Item.expiresAt,
    };
  } catch (error) {
    console.error('Error getting user session:', error);
    return null;
  }
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

// Function to get status description based on event type
function getStatusDescription(eventType: string, eventData: any, wasHost: boolean): string {
  switch (eventType) {
    case 'start':
      return wasHost ? 'Started a new queue' : 'Unknown';
    case 'join':
      return 'Joined a queue';
    case 'leave':
      return 'Left the queue';
    case 'disband':
      if (eventData.disbandedByHost && !wasHost) {
        return 'Queue was disbanded by host';
      }
      return wasHost ? 'Disbanded the queue' : 'Queue was disbanded';
    case 'timeout':
      return 'Queue timed out';
    case 'complete':
      return 'Queue completed successfully';
    default:
      return 'Unknown event';
  }
}

// Function to process events into queue summaries
function processEventsIntoQueues(events: QueueHistoryEvent[]): QueueSummary[] {
  const queueMap = new Map<string, QueueSummary>();

  // Sort events by timestamp
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const event of events) {
    const queueId = event.queueId;
    
    if (!queueMap.has(queueId)) {
      // Initialize queue summary with data from the first event (usually 'start')
      queueMap.set(queueId, {
        queueId,
        gameMode: event.eventData.gameMode || 'Unknown',
        mapSelectionMode: event.eventData.mapSelectionMode || 'Unknown',
        ranked: event.eventData.ranked || false,
        startTime: event.timestamp,
        endTime: null,
        status: 'active',
        statusDescription: '',
        wasHost: event.eventType === 'start',
        finalPlayerCount: 0,
        events: [],
      });
    }

    const queue = queueMap.get(queueId)!;
    queue.events.push(event);

    // Update queue based on event type
    if (event.eventType === 'start') {
      queue.wasHost = true;
      queue.startTime = event.timestamp;
    } else if (['leave', 'disband', 'timeout', 'complete'].includes(event.eventType)) {
      queue.endTime = event.timestamp;
      queue.status = event.eventType as any;
      queue.statusDescription = getStatusDescription(event.eventType, event.eventData, queue.wasHost);
      
      // Set final player count
      if (event.eventData.joinerCount !== undefined) {
        queue.finalPlayerCount = event.eventData.joinerCount + 1; // +1 for host
      }
    }
  }

  return Array.from(queueMap.values());
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Get queue history handler started');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
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
    
    const session = await getUserSession(sessionToken);
    console.log('Session result:', session);
    
    if (!session) {
      console.log('Invalid or expired session');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Extract Steam ID from session
    const userSteamId = extractSteamIdFromOpenId(session.userId);
    console.log('User Steam ID:', userSteamId);

    // Query queue history events for this user
    console.log('Getting queue history events for user:', userSteamId);
    const queryCommand = new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `QUEUEHISTORY#${userSteamId}` },
      },
      ScanIndexForward: false, // Sort by sk descending (newest first)
      Limit: 100, // Limit to prevent large queries
    });

    const queryResult = await dynamoClient.send(queryCommand);
    console.log('Queue history query result:', queryResult.Items?.length || 0, 'events found');

    const events: QueueHistoryEvent[] = [];
    
    if (queryResult.Items) {
      for (const item of queryResult.Items) {
        try {
          const eventData = unmarshall(item) as QueueHistoryEvent;
          console.log('Processing queue history event:', eventData.eventType, 'for queue', eventData.queueId);
          events.push(eventData);
        } catch (error) {
          console.error('Error processing queue history event:', error, item);
        }
      }
    }

    // Process events into queue summaries
    const queueSummaries = processEventsIntoQueues(events);
    console.log('Processed', events.length, 'events into', queueSummaries.length, 'queue summaries');

    // Convert to response format
    const queueHistory: QueueHistoryResponse[] = queueSummaries.map(queue => {
      const startTime = new Date(queue.startTime);
      const endTime = queue.endTime ? new Date(queue.endTime) : new Date();
      const duration = endTime.getTime() - startTime.getTime();

      return {
        id: queue.queueId,
        gameMode: queue.gameMode,
        mapSelectionMode: queue.mapSelectionMode,
        ranked: queue.ranked,
        startTime: queue.startTime,
        endTime: queue.endTime || new Date().toISOString(),
        status: queue.status,
        statusDescription: queue.statusDescription,
        wasHost: queue.wasHost,
        finalPlayerCount: queue.finalPlayerCount,
        duration: formatDuration(duration),
      };
    });

    // Sort by start time (newest first) and limit to last 20 entries
    queueHistory.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    const limitedHistory = queueHistory.slice(0, 20);

    console.log('Returning queue history with', limitedHistory.length, 'entries');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        queueHistory: limitedHistory,
        total: limitedHistory.length,
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
