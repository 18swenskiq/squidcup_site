import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
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

interface LobbyPlayer {
  steamId: string;
  team?: number;
  mapSelection?: string;
  hasSelectedMap?: boolean;
}

interface LobbyData {
  pk: string;
  sk: string;
  id: string;
  hostSteamId: string;
  gameMode: string;
  mapSelectionMode: string;
  serverId: string;
  password?: string;
  ranked: boolean;
  players: LobbyPlayer[];
  mapSelectionComplete: boolean;
  selectedMap?: string;
  createdAt: string;
  updatedAt: string;
}

// Function to extract numeric Steam ID from OpenID URL
function extractSteamIdFromOpenId(steamId: string): string {
  if (!steamId) {
    console.error('steamId is null or undefined');
    return '';
  }
  
  if (/^\d+$/.test(steamId)) {
    return steamId;
  }
  
  const match = steamId.match(/\/id\/(\d+)$/);
  if (match && match[1]) {
    return match[1];
  }
  
  console.warn('Could not extract Steam ID from:', steamId);
  return steamId;
}

// Function to get user session from DynamoDB
async function getUserSession(sessionToken: string): Promise<{ userId: string; expiresAt: string } | null> {
  try {
    const sessionQuery = new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `SESSION#${sessionToken}` },
      },
    });

    const result = await dynamoClient.send(sessionQuery);
    
    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    const sessionData = unmarshall(result.Items[0]) as SessionData;
    
    // Check if session is expired
    const expiresAtTime = new Date(sessionData.expiresAt).getTime();
    if (expiresAtTime < Date.now()) {
      return null;
    }

    return {
      userId: sessionData.userId,
      expiresAt: sessionData.expiresAt
    };
  } catch (error) {
    console.error('Error getting user session:', error);
    return null;
  }
}

// Function to store lobby history event
async function storeLobbyHistoryEvent(
  lobbyId: string,
  userSteamId: string,
  eventType: 'created' | 'joined' | 'left' | 'disbanded' | 'map_selected' | 'game_started',
  eventData?: any
): Promise<void> {
  try {
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();

    await docClient.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        pk: `LOBBYHISTORY#${userSteamId}`,
        sk: `${now}#${eventId}`,
        GSI1PK: `LOBBYEVENT#${lobbyId}`,
        GSI1SK: `${now}#${eventType}`,
        lobbyId,
        userSteamId,
        eventType,
        eventData: eventData || {},
        timestamp: now,
        createdAt: now,
      }
    }));

    console.log(`Stored lobby history event: ${eventType} for user ${userSteamId} in lobby ${lobbyId}`);
  } catch (error) {
    console.error('Error storing lobby history event:', error);
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Leave lobby handler started');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
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
    const { lobbyId } = JSON.parse(event.body || '{}');
    
    if (!lobbyId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Lobby ID is required' }),
      };
    }

    // Get the lobby from DynamoDB
    const lobbyResult = await docClient.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `LOBBY#${lobbyId}`,
        sk: 'METADATA',
      },
    }));

    if (!lobbyResult.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Lobby not found' }),
      };
    }

    const lobbyData = lobbyResult.Item as LobbyData;
    console.log('Found lobby:', lobbyData.pk);

    // Check if user is in the lobby
    const isInLobby = lobbyData.players.some(player => player.steamId === userSteamId);
    if (!isInLobby) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'You are not in this lobby' }),
      };
    }

    const isHost = lobbyData.hostSteamId === userSteamId;
    console.log('User is host:', isHost);

    // Since leaving a lobby always disbands it (unlike queues), we always delete the entire lobby
    console.log('Disbanding lobby as any player leaving disbands the entire lobby');
    
    // Store disband events for all players
    for (const player of lobbyData.players) {
      await storeLobbyHistoryEvent(lobbyId, player.steamId, 'disbanded', {
        gameMode: lobbyData.gameMode,
        mapSelectionMode: lobbyData.mapSelectionMode,
        disbandedBy: userSteamId,
        isHost: player.steamId === lobbyData.hostSteamId,
      });
    }
    
    // Delete the lobby
    await dynamoClient.send(new DeleteItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: { S: lobbyData.pk },
        sk: { S: lobbyData.sk },
      },
    }));

    console.log('Lobby disbanded successfully');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        action: 'disbanded',
        message: 'Lobby disbanded successfully',
        wasHost: isHost,
      }),
    };

  } catch (error) {
    console.error('Error in leave lobby handler:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
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
