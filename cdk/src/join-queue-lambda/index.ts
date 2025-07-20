import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import * as crypto from 'crypto';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({ region: process.env.REGION });

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

// Function to get the maximum players for a gamemode
function getMaxPlayersForGamemode(gameMode: string): number {
  switch (gameMode) {
    case '5v5':
      return 10;
    case 'wingman':
      return 4;
    case '3v3':
      return 6;
    case '1v1':
      return 2;
    default:
      return 10;
  }
}

// Function to store queue history event
async function storeQueueHistoryEvent(
  queueId: string,
  userSteamId: string,
  eventType: 'join' | 'leave' | 'disband' | 'timeout' | 'complete',
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

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Join queue event received');
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  console.log('Body:', event.body);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

  try {
    // Get session token from Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: corsHeaders,
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
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Extract Steam ID from session
    const userSteamId = extractSteamIdFromOpenId(session.userId);
    console.log('User Steam ID:', userSteamId);

    // Parse request body
    const { queueId, password } = JSON.parse(event.body || '{}');
    
    if (!queueId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Queue ID is required' }),
      };
    }

    // Get the queue from DynamoDB
    const queueResult = await docClient.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `ACTIVEQUEUE#${queueId}`,
        sk: 'METADATA',
      },
    }));

    if (!queueResult.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Queue not found' }),
      };
    }

    const queueData = queueResult.Item;
    console.log('Found queue:', queueData);

    // Check if queue has a password and validate it
    if (queueData.password) {
      if (!password) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Password is required for this queue' }),
        };
      }
      
      if (queueData.password !== password) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Incorrect password' }),
        };
      }
    }

    // Check if user is already the host
    if (queueData.hostSteamId === userSteamId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'You are already the host of this queue' }),
      };
    }

    // Check if user is already a joiner
    const isAlreadyJoiner = queueData.joiners.some((joiner: any) => joiner.steamId === userSteamId);
    if (isAlreadyJoiner) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'You are already in this queue' }),
      };
    }

    // Add user to the joiners array
    const now = new Date().toISOString();
    const newJoiner = {
      steamId: userSteamId,
      joinTime: now,
    };

    const updatedJoiners = [...queueData.joiners, newJoiner];

    // Update the queue in DynamoDB
    await docClient.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `ACTIVEQUEUE#${queueId}`,
        sk: 'METADATA',
      },
      UpdateExpression: 'SET joiners = :joiners, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':joiners': updatedJoiners,
        ':updatedAt': now,
      },
    }));

    // Store queue history event
    await storeQueueHistoryEvent(queueId, userSteamId, 'join', {
      gameMode: queueData.gameMode,
      mapSelectionMode: queueData.mapSelectionMode,
      hostSteamId: queueData.hostSteamId,
    });

    // Check if queue is now full and should be converted to lobby
    const maxPlayers = getMaxPlayersForGamemode(queueData.gameMode);
    const currentPlayers = 1 + updatedJoiners.length; // host + joiners
    
    if (currentPlayers >= maxPlayers) {
      console.log('Queue is full, creating lobby...');
      try {
        // Invoke create-lobby lambda
        const createLobbyPayload = {
          body: JSON.stringify({ queueId })
        };
        
        await lambdaClient.send(new InvokeCommand({
          FunctionName: process.env.CREATE_LOBBY_FUNCTION_NAME,
          Payload: JSON.stringify(createLobbyPayload),
          InvocationType: 'Event' // Async invocation
        }));
        
        console.log('Lobby creation triggered successfully');
      } catch (error) {
        console.error('Error triggering lobby creation:', error);
        // Don't fail the join operation if lobby creation fails
      }
    }

    console.log('User joined queue successfully');

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Successfully joined queue',
        queue: {
          id: queueId,
          hostSteamId: queueData.hostSteamId,
          gameMode: queueData.gameMode,
          mapSelectionMode: queueData.mapSelectionMode,
          serverId: queueData.serverId,
          hasPassword: !!queueData.password,
          ranked: queueData.ranked,
          startTime: queueData.startTime,
          joiners: updatedJoiners,
          createdAt: queueData.createdAt,
          updatedAt: now,
        }
      }),
    };

  } catch (error) {
    console.error('Error joining queue:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to join queue' }),
    };
  }
}

// Export using CommonJS for maximum compatibility
exports.handler = handler;
