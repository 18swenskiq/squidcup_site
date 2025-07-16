import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const ssmClient = new SSMClient({ region: process.env.REGION });

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

interface UserProfile {
  steamId: string;
  personaname: string;
  avatarfull: string;
  role: string;
  isActive: boolean;
  lastLogin: string;
  createdAt: string;
  updatedAt: string;
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

interface QueueWithUserInfo {
  id: string;
  hostSteamId: string;
  hostName: string;
  gameMode: string;
  mapSelectionMode: string;
  serverId: string;
  hasPassword: boolean;
  ranked: boolean;
  startTime: string;
  joiners: Array<{
    steamId: string;
    name: string;
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

    // Get user profile to check admin status
    const userQuery = new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${sessionData.steamId}` },
      },
    });

    const userResult = await dynamoClient.send(userQuery);
    if (!userResult.Items || userResult.Items.length === 0) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'User not found' }),
      };
    }

    const userProfile = unmarshall(userResult.Items[0]) as UserProfile;
    
    // Check if user is admin
    if (userProfile.role !== 'admin') {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    // Get all active queues
    let allQueuesResult;
    try {
      // Try to use GSI1 first
      const gsiQuery = new QueryCommand({
        TableName: process.env.TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': { S: 'ACTIVEQUEUE' },
        },
      });

      allQueuesResult = await dynamoClient.send(gsiQuery);
    } catch (error: any) {
      console.error('Error querying GSI1 (might be backfilling):', error);
      
      // Fall back to scanning the main table
      const scanCommand = new ScanCommand({
        TableName: process.env.TABLE_NAME,
        FilterExpression: 'begins_with(pk, :pkPrefix)',
        ExpressionAttributeValues: {
          ':pkPrefix': { S: 'ACTIVEQUEUE#' },
        },
      });

      allQueuesResult = await dynamoClient.send(scanCommand);
    }

    if (!allQueuesResult.Items || allQueuesResult.Items.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          queues: [],
          total: 0,
        }),
      };
    }

    // Get all user profiles for name lookups
    const userScanCommand = new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(pk, :pkPrefix)',
      ExpressionAttributeValues: {
        ':pkPrefix': { S: 'USER#' },
      },
    });

    const usersResult = await dynamoClient.send(userScanCommand);
    const usersMap = new Map<string, string>();
    
    if (usersResult.Items) {
      for (const item of usersResult.Items) {
        const user = unmarshall(item) as UserProfile;
        usersMap.set(user.steamId, user.personaname);
      }
    }

    // Process queue data and add user names
    const queuesWithUserInfo: QueueWithUserInfo[] = [];
    
    for (const item of allQueuesResult.Items) {
      const queueData = unmarshall(item) as ActiveQueueData;
      
      const queueWithUserInfo: QueueWithUserInfo = {
        id: queueData.pk.replace('ACTIVEQUEUE#', ''),
        hostSteamId: queueData.hostSteamId,
        hostName: usersMap.get(queueData.hostSteamId) || 'Unknown',
        gameMode: queueData.gameMode,
        mapSelectionMode: queueData.mapSelectionMode,
        serverId: queueData.serverId,
        hasPassword: !!queueData.password,
        ranked: queueData.ranked,
        startTime: queueData.startTime,
        joiners: queueData.joiners.map(joiner => ({
          steamId: joiner.steamId,
          name: usersMap.get(joiner.steamId) || 'Unknown',
          joinTime: joiner.joinTime,
        })),
        createdAt: queueData.createdAt,
        updatedAt: queueData.updatedAt,
      };
      
      queuesWithUserInfo.push(queueWithUserInfo);
    }

    // Sort by creation time (newest first)
    queuesWithUserInfo.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
