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

// Function to extract numeric Steam ID from OpenID URL
function extractSteamIdFromOpenId(steamId: string): string {
  console.log('extractSteamIdFromOpenId called with:', steamId);
  
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

// Function to check if user is admin
function isAdmin(userId: string): boolean {
  console.log('isAdmin called with userId:', userId);
  const numericSteamId = extractSteamIdFromOpenId(userId);
  console.log('Extracted numeric Steam ID:', numericSteamId);
  const adminSteamId = '76561198041569692';
  const isAdminResult = numericSteamId === adminSteamId;
  console.log('Admin check:', numericSteamId, '===', adminSteamId, '?', isAdminResult);
  return isAdminResult;
}

interface UserData {
  steamId: string;
  personaname?: string;
  lastLogin?: string;
  createdAt?: string;
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
  console.log('Get all queues handler started');
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
    console.log('Auth header:', authHeader ? 'Present' : 'Missing');
    
    if (!authHeader) {
      console.log('No authorization header found');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No session token provided' }),
      };
    }

    // Extract token from Bearer format
    const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    console.log('Session token extracted:', sessionToken.substring(0, 10) + '...');

    // Validate session
    console.log('Validating session token');
    const sessionQuery = new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `SESSION#${sessionToken}` },
      },
    });

    const sessionResult = await dynamoClient.send(sessionQuery);
    console.log('Session query result:', sessionResult.Items ? `Found ${sessionResult.Items.length} items` : 'No items found');
    
    if (!sessionResult.Items || sessionResult.Items.length === 0) {
      console.log('Invalid session token - no session found');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session token' }),
      };
    }

    const sessionData = unmarshall(sessionResult.Items[0]) as SessionData;
    console.log('Session data:', {
      steamId: sessionData.steamId,
      expiresAt: sessionData.expiresAt,
      currentTime: Date.now(),
    });
    
    // Check if session is expired
    if (sessionData.expiresAt < Date.now()) {
      console.log('Session expired');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Session expired' }),
      };
    }

    // Check if user is admin
    console.log('Checking admin status for Steam ID:', sessionData.steamId);
    const adminCheck = isAdmin(sessionData.steamId);
    console.log('Admin check result:', adminCheck);
    
    if (!adminCheck) {
      console.log('User is not admin, access denied');
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    // Get all active queues
    console.log('Getting all active queues');
    let allQueuesResult;
    try {
      // Try to use GSI1 first
      console.log('Attempting to query GSI1');
      const gsiQuery = new QueryCommand({
        TableName: process.env.TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': { S: 'ACTIVEQUEUE' },
        },
      });

      allQueuesResult = await dynamoClient.send(gsiQuery);
      console.log('GSI1 query successful, found', allQueuesResult.Items?.length || 0, 'items');
    } catch (error: any) {
      console.error('Error querying GSI1 (might be backfilling):', error);
      
      // Fall back to scanning the main table
      console.log('Falling back to main table scan');
      const scanCommand = new ScanCommand({
        TableName: process.env.TABLE_NAME,
        FilterExpression: 'begins_with(pk, :pkPrefix)',
        ExpressionAttributeValues: {
          ':pkPrefix': { S: 'ACTIVEQUEUE#' },
        },
      });

      allQueuesResult = await dynamoClient.send(scanCommand);
      console.log('Main table scan completed, found', allQueuesResult.Items?.length || 0, 'items');
    }

    if (!allQueuesResult.Items || allQueuesResult.Items.length === 0) {
      console.log('No queues found, returning empty result');
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
    console.log('Getting user profiles for name lookups');
    const userScanCommand = new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(pk, :pkPrefix)',
      ExpressionAttributeValues: {
        ':pkPrefix': { S: 'USER#' },
      },
    });

    const usersResult = await dynamoClient.send(userScanCommand);
    console.log('User scan completed, found', usersResult.Items?.length || 0, 'user profiles');
    
    const usersMap = new Map<string, string>();
    
    if (usersResult.Items) {
      for (const item of usersResult.Items) {
        try {
          const user = unmarshall(item) as UserData;
          usersMap.set(user.steamId, user.personaname || 'Unknown');
        } catch (error) {
          console.error('Error unmarshalling user item:', error, item);
        }
      }
    }
    console.log('Users map populated with', usersMap.size, 'entries');

    // Process queue data and add user names
    console.log('Processing queue data');
    const queuesWithUserInfo: QueueWithUserInfo[] = [];
    
    for (const item of allQueuesResult.Items) {
      try {
        const queueData = unmarshall(item) as ActiveQueueData;
        console.log('Processing queue:', queueData.pk);
        
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
      } catch (error) {
        console.error('Error processing queue item:', error, item);
      }
    }
    
    console.log('Processed', queuesWithUserInfo.length, 'queues successfully');

    // Sort by creation time (newest first)
    queuesWithUserInfo.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    console.log('Returning successful response with', queuesWithUserInfo.length, 'queues');
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
