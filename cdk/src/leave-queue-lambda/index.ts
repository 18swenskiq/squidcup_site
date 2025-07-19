import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, ScanCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import * as crypto from 'crypto';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface SessionData {
  userId: string;
  expiresAt: string;
  createdAt: string;
}

interface ActiveQueueData {
  pk: string;
  sk: string;
  hostSteamId: string;
  gameMode: string;
  mapSelectionMode: string;
  serverId: string;
  password?: string;
  ranked: boolean;
  startTime: string;
  joiners: Array<{
    steamId: string;
    joinTime: string;
  }>;
  createdAt: string;
  updatedAt: string;
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

// Function to store queue history event
async function storeQueueHistoryEvent(
  queueId: string,
  userSteamId: string,
  eventType: 'start' | 'join' | 'leave' | 'disband' | 'timeout' | 'complete',
  eventData?: any
): Promise<void> {
  try {
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();

    await docClient.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        pk: `QUEUEHISTORY#${userSteamId}`,
        sk: `${now}#${eventId}`,
        GSI1PK: `QUEUEEVENT#${queueId}`,
        GSI1SK: `${now}#${eventType}`,
        queueId,
        userSteamId,
        eventType,
        eventData: eventData || {},
        timestamp: now,
        createdAt: now,
      }
    }));

    console.log(`Stored queue history event: ${eventType} for user ${userSteamId} in queue ${queueId}`);
  } catch (error) {
    console.error('Error storing queue history event:', error);
    // Don't fail the main operation if history storage fails
  }
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

// Function to find user's queue (either as host or joiner)
async function findUserQueue(userSteamId: string): Promise<ActiveQueueData | null> {
  console.log('Looking for queue for user:', userSteamId);
  
  try {
    // First check if user is hosting a queue
    const hostScanCommand = new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(pk, :pkPrefix) AND hostSteamId = :hostSteamId',
      ExpressionAttributeValues: {
        ':pkPrefix': { S: 'ACTIVEQUEUE#' },
        ':hostSteamId': { S: userSteamId },
      },
    });

    const hostResult = await dynamoClient.send(hostScanCommand);
    if (hostResult.Items && hostResult.Items.length > 0) {
      console.log('User is hosting a queue');
      return unmarshall(hostResult.Items[0]) as ActiveQueueData;
    }

    // If not hosting, scan all queues to see if user is a joiner
    const allQueuesScanCommand = new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(pk, :pkPrefix)',
      ExpressionAttributeValues: {
        ':pkPrefix': { S: 'ACTIVEQUEUE#' },
      },
    });

    const allQueuesResult = await dynamoClient.send(allQueuesScanCommand);
    if (allQueuesResult.Items) {
      for (const item of allQueuesResult.Items) {
        const queueData = unmarshall(item) as ActiveQueueData;
        const isJoiner = queueData.joiners.some(joiner => joiner.steamId === userSteamId);
        if (isJoiner) {
          console.log('User is a joiner in queue:', queueData.pk);
          return queueData;
        }
      }
    }

    console.log('User is not in any queue');
    return null;
  } catch (error) {
    console.error('Error finding user queue:', error);
    return null;
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Leave queue handler started');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
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

    // Find the user's queue
    const userQueue = await findUserQueue(userSteamId);
    if (!userQueue) {
      console.log('User is not in any queue');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'User is not in any queue' }),
      };
    }

    console.log('Found user queue:', userQueue.pk);
    const isHost = userQueue.hostSteamId === userSteamId;
    console.log('User is host:', isHost);

    if (isHost) {
      // User is the host - disband the entire queue
      console.log('Disbanding queue as host');
      
      // Store history events for host and all joiners
      await storeQueueHistoryEvent(userQueue.pk.replace('ACTIVEQUEUE#', ''), userSteamId, 'disband', {
        gameMode: userQueue.gameMode,
        mapSelectionMode: userQueue.mapSelectionMode,
        joinerCount: userQueue.joiners.length,
      });

      // Store disband events for all joiners too
      for (const joiner of userQueue.joiners) {
        await storeQueueHistoryEvent(userQueue.pk.replace('ACTIVEQUEUE#', ''), joiner.steamId, 'disband', {
          gameMode: userQueue.gameMode,
          mapSelectionMode: userQueue.mapSelectionMode,
          disbandedByHost: userSteamId,
        });
      }
      
      await dynamoClient.send(new DeleteItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: {
          pk: { S: userQueue.pk },
          sk: { S: userQueue.sk },
        },
      }));

      console.log('Queue disbanded successfully');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          action: 'disbanded',
          message: 'Queue disbanded successfully',
          wasHost: true,
        }),
      };
    } else {
      // User is a joiner - remove them from the queue
      console.log('Removing user from queue as joiner');
      
      const updatedJoiners = userQueue.joiners.filter(joiner => joiner.steamId !== userSteamId);
      console.log('Updated joiners:', updatedJoiners);
      
      // Store leave event
      await storeQueueHistoryEvent(userQueue.pk.replace('ACTIVEQUEUE#', ''), userSteamId, 'leave', {
        gameMode: userQueue.gameMode,
        mapSelectionMode: userQueue.mapSelectionMode,
        hostSteamId: userQueue.hostSteamId,
      });
      
      const updatedQueue = {
        ...userQueue,
        joiners: updatedJoiners,
        updatedAt: new Date().toISOString(),
      };

      await docClient.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: updatedQueue,
      }));

      console.log('User removed from queue successfully');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          action: 'left',
          message: 'Successfully left the queue',
          wasHost: false,
        }),
      };
    }

  } catch (error) {
    console.error('Error in leave queue handler:', error);
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
