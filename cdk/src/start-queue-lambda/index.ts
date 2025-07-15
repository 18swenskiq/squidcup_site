import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import * as crypto from 'crypto';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export interface ActiveQueue {
  id: string;
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

// Function to extract numeric Steam ID from OpenID URL
function extractSteamIdFromOpenId(steamId: string): string {
  // If it's already a numeric Steam ID, return as is
  if (/^\d+$/.test(steamId)) {
    return steamId;
  }
  
  // Extract from OpenID URL format: https://steamcommunity.com/openid/id/76561198041569692
  const match = steamId.match(/\/id\/(\d+)$/);
  if (match && match[1]) {
    return match[1];
  }
  
  // If no match found, return the original value
  console.warn('Could not extract Steam ID from:', steamId);
  return steamId;
}

export async function handler(event: any): Promise<any> {
  console.log('Start queue event received');
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  console.log('Body:', event.body);

  try {
    // Get session token from Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7);
    console.log('Extracted session token:', sessionToken);
    
    const session = await getUserSession(sessionToken);
    console.log('Session result:', session);
    
    if (!session) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Extract Steam ID from session
    const hostSteamId = extractSteamIdFromOpenId(session.userId);
    console.log('Host Steam ID:', hostSteamId);

    // Parse request body
    const queueData = JSON.parse(event.body);
    const { gameMode, mapSelectionMode, server, password, ranked } = queueData;
    
    // Validate required fields
    if (!gameMode || !mapSelectionMode || !server) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing required fields: gameMode, mapSelectionMode, server' }),
      };
    }

    // Generate queue ID
    const queueId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create the active queue object
    const activeQueue: ActiveQueue = {
      id: queueId,
      hostSteamId,
      gameMode,
      mapSelectionMode,
      serverId: server, // This is the server ID from the form
      password: password || undefined, // Only include if provided
      ranked: ranked === true,
      startTime: now,
      joiners: [], // Empty array initially
      createdAt: now,
      updatedAt: now
    };

    // Store in DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        pk: `ACTIVEQUEUE#${hostSteamId}`,
        sk: 'METADATA',
        GSI1PK: 'ACTIVEQUEUE',
        GSI1SK: queueId,
        ...activeQueue
      }
    }));

    console.log('Queue created successfully:', activeQueue);

    return {
      statusCode: 201,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify(activeQueue),
    };
  } catch (error) {
    console.error('Error starting queue:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to start queue' }),
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
