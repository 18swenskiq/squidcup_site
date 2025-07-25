import { getSession, getUser, addServer, GameServer, User, Session } from '@squidcup/shared-lambda-utils';
import * as crypto from 'crypto';

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

// Function to check if user is admin
async function isAdmin(steamId: string): Promise<boolean> {
  try {
    const numericSteamId = extractSteamIdFromOpenId(steamId);
    
    const user = await getUser(numericSteamId);

    if (!user) {
      // User doesn't exist, fallback to hardcoded admin check
      return numericSteamId === '76561198041569692';
    }

    return user.is_admin === true || user.is_admin === 1;
  } catch (error) {
    console.error('Error checking admin status:', error);
    // Fallback to hardcoded admin check
    const numericSteamId = extractSteamIdFromOpenId(steamId);
    return numericSteamId === '76561198041569692';
  }
}

export async function handler(event: any): Promise<any> {
  console.log('Add server event received');
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  console.log('Body:', event.body);

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
    console.log('Extracted session token:', sessionToken);
    
    // Get session from database service
    const session = await getSession(sessionToken);

    if (!session) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    console.log('Session result:', session);
    
    if (!(await isAdmin(session.steamId))) {
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    const serverData = JSON.parse(event.body);
    const { 
      ip, 
      port, 
      location, 
      rconPassword, 
      rcon_password = rconPassword, // Support both camelCase and snake_case
      defaultPassword, 
      default_password = defaultPassword, // Support both camelCase and snake_case
      maxPlayers, 
      max_players = maxPlayers, // Support both camelCase and snake_case
      nickname 
    } = serverData;
    
    // Use the resolved values (prefer snake_case from database schema)
    const finalRconPassword = rcon_password || rconPassword;
    const finalDefaultPassword = default_password || defaultPassword;
    const finalMaxPlayers = max_players || maxPlayers;
    
    if (!ip || !port || !location || !finalRconPassword || !finalMaxPlayers || !nickname) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Missing required fields: ip, port, location, rcon_password, max_players, nickname' }),
      };
    }

    const serverId = crypto.randomUUID();
    const now = new Date().toISOString();

    const server: GameServer = {
      id: serverId,
      ip,
      port: Number(port),
      location,
      rcon_password: finalRconPassword,
      default_password: finalDefaultPassword || '',
      max_players: Number(finalMaxPlayers),
      nickname,
      created_at: now,
      updated_at: now
    };

    // Add server using database service
    try {
      await addServer(server);
      console.log('Server added successfully:', server);
    } catch (error: any) {
      // Check if it's a duplicate entry error
      if (error.message?.includes('Duplicate entry') || error.code === 'ER_DUP_ENTRY') {
        return {
          statusCode: 409,
          headers: {
            'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          },
          body: JSON.stringify({ error: 'Server with this IP and port already exists' }),
        };
      }
      
      throw error;
    }

    return {
      statusCode: 201,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify(server),
    };
  } catch (error) {
    console.error('Error adding server:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
      },
      body: JSON.stringify({ error: 'Failed to add server' }),
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
