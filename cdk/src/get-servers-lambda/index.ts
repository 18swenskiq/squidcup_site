import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.REGION });

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

// Function to call the database service
async function callDatabaseService(operation: string, params?: any[], data?: any): Promise<any> {
  const payload = {
    operation,
    params,
    data
  };

  const command = new InvokeCommand({
    FunctionName: process.env.DATABASE_SERVICE_FUNCTION_NAME!,
    Payload: JSON.stringify(payload),
  });

  const response = await lambdaClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  
  if (!result.success) {
    throw new Error(result.error || 'Database service call failed');
  }
  
  return result.data;
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
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
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
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
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
    
    // Get servers from database service
    const servers = await callDatabaseService('getServers', undefined, { minPlayers });

    // Transform the data to match the expected response format (exclude rconPassword)
    const serversResponse: Omit<GameServer, 'rconPassword'>[] = servers.map((server: any) => ({
      id: server.id,
      ip: server.ip,
      port: server.port,
      location: server.location,
      defaultPassword: server.default_password || '',
      maxPlayers: server.max_players,
      nickname: server.nickname,
      createdAt: server.created_at,
      updatedAt: server.updated_at
    }));

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      },
      body: JSON.stringify(serversResponse),
    };
  } catch (error) {
    console.error('Error getting servers:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
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
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7);
    
    // Validate session using database service
    const sessionData = await callDatabaseService('getSession', [sessionToken]);
    
    if (!sessionData) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Check if user is admin
    if (!isAdmin(sessionData.steamId)) {
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    const { ip, port, location, rconPassword, defaultPassword, maxPlayers, nickname } = JSON.parse(event.body);
    
    if (!ip || !port || !location || !rconPassword || !maxPlayers || !nickname) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }

    const serverData = {
      ip,
      port: Number(port),
      location,
      rconPassword,
      defaultPassword: defaultPassword || '',
      maxPlayers: Number(maxPlayers),
      nickname,
    };

    // Update server using database service
    await callDatabaseService('updateServer', [serverId], serverData);

    const updatedServer = {
      id: serverId,
      ip,
      port: Number(port),
      location,
      rconPassword,
      defaultPassword: defaultPassword || '',
      maxPlayers: Number(maxPlayers),
      nickname,
      updatedAt: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
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
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
      },
      body: JSON.stringify({ error: 'Failed to update server' }),
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
