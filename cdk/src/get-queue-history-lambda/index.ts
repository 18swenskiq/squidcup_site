import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface SessionData {
  userId: string;
  expiresAt: string;
  createdAt: string;
}

interface QueueHistoryData {
  pk: string;
  sk: string;
  userId: string;
  queueId: string;
  gameMode: string;
  mapSelectionMode: string;
  ranked: boolean;
  startTime: string;
  endTime: string;
  status: 'completed' | 'cancelled' | 'disbanded' | 'timeout' | 'error';
  statusDescription: string;
  wasHost: boolean;
  finalPlayerCount: number;
  duration: number; // in milliseconds
  createdAt: string;
}

interface QueueHistoryResponse {
  id: string;
  gameMode: string;
  mapSelectionMode: string;
  ranked: boolean;
  startTime: string;
  endTime: string;
  status: 'completed' | 'cancelled' | 'disbanded' | 'timeout' | 'error';
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
  } else {
    return `${minutes}m`;
  }
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

    // Get queue history for this user
    console.log('Getting queue history for user:', userSteamId);
    const scanCommand = new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(pk, :pkPrefix) AND userId = :userId',
      ExpressionAttributeValues: {
        ':pkPrefix': { S: 'QUEUEHISTORY#' },
        ':userId': { S: userSteamId },
      },
    });

    const scanResult = await dynamoClient.send(scanCommand);
    console.log('Queue history scan result:', scanResult.Items?.length || 0, 'items found');

    const queueHistory: QueueHistoryResponse[] = [];
    
    if (scanResult.Items) {
      for (const item of scanResult.Items) {
        try {
          const historyData = unmarshall(item) as QueueHistoryData;
          console.log('Processing queue history item:', historyData.pk);
          
          const queueHistoryItem: QueueHistoryResponse = {
            id: historyData.queueId,
            gameMode: historyData.gameMode,
            mapSelectionMode: historyData.mapSelectionMode,
            ranked: historyData.ranked,
            startTime: historyData.startTime,
            endTime: historyData.endTime,
            status: historyData.status,
            statusDescription: historyData.statusDescription,
            wasHost: historyData.wasHost,
            finalPlayerCount: historyData.finalPlayerCount,
            duration: formatDuration(historyData.duration),
          };
          
          queueHistory.push(queueHistoryItem);
        } catch (error) {
          console.error('Error processing queue history item:', error, item);
        }
      }
    }

    // Sort by end time (newest first)
    queueHistory.sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());

    // Limit to last 20 entries
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
