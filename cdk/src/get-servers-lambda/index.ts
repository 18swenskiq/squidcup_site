import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSession, getUser, getServers, updateServer, createCorsHeaders, extractSteamIdFromOpenId, getMaxPlayersForGamemode, GameServer } from '@squidcup/shared-lambda-utils';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get servers event received');
  console.log('Path:', event.path);
  console.log('Method:', event.httpMethod);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));

  const corsHeaders = createCorsHeaders();
  const path = event.path;
  const method = event.httpMethod;

  try {
    // Handle preflight requests
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

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
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Endpoint not found' }),
    };
  } catch (error) {
    console.error('Error in servers handler:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      }),
    };
  }
}

async function handleGetServers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = createCorsHeaders();
  
  try {
    // Get gamemode from query parameters
    const gamemode = event?.queryStringParameters?.gamemode;
    const minPlayers = getMaxPlayersForGamemode(gamemode || '');
    
    // Get servers from database
    const servers = await getServers(minPlayers);

    // Transform the data to match the expected response format (exclude rcon_password)
    const serversResponse: Omit<GameServer, 'rcon_password'>[] = servers.map((server: any) => ({
      id: server.id,
      ip: server.ip,
      port: server.port,
      location: server.location,
      default_password: server.default_password || '',
      max_players: server.max_players,
      nickname: server.nickname,
      created_at: server.created_at,
      updated_at: server.updated_at
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(serversResponse),
    };
  } catch (error) {
    console.error('Error getting servers:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Failed to get servers',
        details: error instanceof Error ? error.message : String(error)
      }),
    };
  }
}

async function handleUpdateServer(event: APIGatewayProxyEvent, serverId: string): Promise<APIGatewayProxyResult> {
  const corsHeaders = createCorsHeaders();
  
  try {
    // Get session token from Authorization header
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7);
    
    // Validate session
    const session = await getSession(sessionToken);
    if (!session) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Get user data to check admin status
    const userSteamId = extractSteamIdFromOpenId(session.steamId);
    const user = await getUser(userSteamId);
    
    if (!user || !user.is_admin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    const { ip, port, location, rconPassword, defaultPassword, maxPlayers, nickname } = JSON.parse(event.body || '{}');
    
    if (!ip || !port || !location || !rconPassword || !maxPlayers || !nickname) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }

    const serverData = {
      ip,
      port: Number(port),
      location,
      rcon_password: rconPassword,
      default_password: defaultPassword || '',
      max_players: Number(maxPlayers),
      nickname,
    };

    // Update server using shared database function
    await updateServer(serverId, serverData);

    const updatedServer = {
      id: serverId,
      ip,
      port: Number(port),
      location,
      rcon_password: rconPassword,
      default_password: defaultPassword || '',
      max_players: Number(maxPlayers),
      nickname,
      updated_at: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(updatedServer),
    };
  } catch (error) {
    console.error('Error updating server:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Failed to update server',
        details: error instanceof Error ? error.message : String(error)
      }),
    };
  }
}