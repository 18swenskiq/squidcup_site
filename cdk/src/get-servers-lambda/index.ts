import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import * as crypto from 'crypto';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export interface GameServer {
  id: string;
  ip: string;
  port: number;
  location: string;
  rconPassword: string;
  defaultPassword: string;
  maxPlayers: number;
  nickname: string;
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

// Function to check if user is admin
function isAdmin(userId: string): boolean {
  return userId === '76561198041569692';
}

export async function handler(event: any): Promise<any> {
  console.log('Get servers event received');
  console.log('Path:', event.path);
  console.log('Method:', event.httpMethod);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));

  const path = event.path;
  const method = event.httpMethod;

  try {
    // Handle GET /servers - Get all servers
    if (method === 'GET' && path === '/servers') {
      return await handleGetServers(event);
    }

    // Handle PUT /servers/{id} - Update server (admin only)
    if (method === 'PUT' && path.startsWith('/servers/')) {
      const serverId = path.split('/')[2];
      return await handleUpdateServer(event, serverId);
    }

    return {
      statusCode: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      },
      body: JSON.stringify({ error: 'Endpoint not found' }),
    };
  } catch (error) {
    console.error('Error in servers handler:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

async function handleGetServers(event?: any): Promise<any> {
  try {
    // Get gamemode from query parameters
    const gamemode = event?.queryStringParameters?.gamemode;
    
    // Determine minimum players required based on gamemode
    const getMinPlayersForGamemode = (gamemode: string): number => {
      switch (gamemode) {
        case '1v1':
          return 2; // 1v1
        case 'wingman':
          return 4; // 2v2
        case '3v3':
          return 6; // 3v3
        case '5v5':
          return 10; // 5v5
        default:
          return 0; // No filtering if gamemode not specified or invalid
      }
    };

    const minPlayers = getMinPlayersForGamemode(gamemode);
    
    // Build the filter expression
    let filterExpression = 'begins_with(pk, :pk)';
    const expressionAttributeValues: any = {
      ':pk': 'SERVER#'
    };
    
    // Add player count filter if gamemode is specified
    if (minPlayers > 0) {
      filterExpression += ' AND maxPlayers >= :minPlayers';
      expressionAttributeValues[':minPlayers'] = minPlayers;
    }

    const result = await docClient.send(new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues
    }));

    const servers: Omit<GameServer, 'rconPassword'>[] = result.Items?.map((item: any) => ({
      id: item.pk.replace('SERVER#', ''),
      ip: item.ip,
      port: item.port,
      location: item.location,
      defaultPassword: item.defaultPassword || '', // Handle existing servers without defaultPassword
      maxPlayers: item.maxPlayers,
      nickname: item.nickname,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    })) || [];

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      },
      body: JSON.stringify(servers),
    };
  } catch (error) {
    console.error('Error getting servers:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to get servers' }),
    };
  }
}

async function handleUpdateServer(event: any, serverId: string): Promise<any> {
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
    const session = await getUserSession(sessionToken);
    
    if (!session || !isAdmin(session.userId)) {
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    const { ip, port, location, rconPassword, defaultPassword, maxPlayers, nickname } = JSON.parse(event.body);
    
    if (!ip || !port || !location || !rconPassword || !maxPlayers || !nickname) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }

    const updatedServer = {
      id: serverId,
      ip,
      port: Number(port),
      location,
      rconPassword,
      defaultPassword: defaultPassword || '', // Optional field, default to empty string
      maxPlayers: Number(maxPlayers),
      nickname,
      updatedAt: new Date().toISOString(),
    };

    // First, get the existing server to preserve createdAt
    const existingServer = await docClient.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `SERVER#${serverId}`,
        sk: 'METADATA'
      }
    }));

    if (!existingServer.Item) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Server not found' }),
      };
    }

    // Update the server, preserving createdAt
    await docClient.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        pk: `SERVER#${serverId}`,
        sk: 'METADATA',
        ...updatedServer,
        createdAt: existingServer.Item.createdAt, // Preserve original creation time
      },
    }));

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      },
      body: JSON.stringify(updatedServer),
    };
  } catch (error) {
    console.error('Error updating server:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to update server' }),
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
