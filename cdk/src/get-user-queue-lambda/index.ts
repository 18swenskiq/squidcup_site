import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });

interface SessionData {
  steamId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  steamProfile: {
    steamid: string;
    personaname: string;
    avatarfull: string;
  };
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

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };

  try {
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Get session token from headers
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No session token provided' }),
      };
    }

    // Extract token from Bearer format
    const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    // Validate session
    const sessionQuery = new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `SESSION#${sessionToken}` },
      },
    });

    const sessionResult = await dynamoClient.send(sessionQuery);
    if (!sessionResult.Items || sessionResult.Items.length === 0) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session token' }),
      };
    }

    const sessionData = unmarshall(sessionResult.Items[0]) as SessionData;
    
    // Check if session is expired
    if (sessionData.expiresAt < Date.now()) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Session expired' }),
      };
    }

    const userSteamId = sessionData.steamId;

    // Query for active queues where the user is the host
    const hostQuery = new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `ACTIVEQUEUE#${userSteamId}` },
      },
    });

    const hostResult = await dynamoClient.send(hostQuery);
    
    if (hostResult.Items && hostResult.Items.length > 0) {
      const queueData = unmarshall(hostResult.Items[0]) as ActiveQueueData;
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          inQueue: true,
          isHost: true,
          queue: {
            id: queueData.pk.replace('ACTIVEQUEUE#', ''),
            hostSteamId: queueData.hostSteamId,
            gameMode: queueData.gameMode,
            mapSelectionMode: queueData.mapSelectionMode,
            serverId: queueData.serverId,
            hasPassword: !!queueData.password,
            ranked: queueData.ranked,
            startTime: queueData.startTime,
            joiners: queueData.joiners,
            createdAt: queueData.createdAt,
            updatedAt: queueData.updatedAt,
          }
        }),
      };
    }

    // If not a host, query all active queues to see if user is a joiner
    const allQueuesQuery = new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': { S: 'ACTIVEQUEUE' },
      },
    });

    const allQueuesResult = await dynamoClient.send(allQueuesQuery);
    
    if (allQueuesResult.Items) {
      for (const item of allQueuesResult.Items) {
        const queueData = unmarshall(item) as ActiveQueueData;
        
        // Check if user is in the joiners array
        const isJoiner = queueData.joiners.some(joiner => joiner.steamId === userSteamId);
        
        if (isJoiner) {
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              inQueue: true,
              isHost: false,
              queue: {
                id: queueData.pk.replace('ACTIVEQUEUE#', ''),
                hostSteamId: queueData.hostSteamId,
                gameMode: queueData.gameMode,
                mapSelectionMode: queueData.mapSelectionMode,
                serverId: queueData.serverId,
                hasPassword: !!queueData.password,
                ranked: queueData.ranked,
                startTime: queueData.startTime,
                joiners: queueData.joiners,
                createdAt: queueData.createdAt,
                updatedAt: queueData.updatedAt,
              }
            }),
          };
        }
      }
    }

    // User is not in any queue
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        inQueue: false,
        isHost: false,
        queue: null,
      }),
    };

  } catch (error) {
    console.error('Error checking user queue status:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
