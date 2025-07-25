import { getSession, getUser, deleteServer } from '@squidcup/shared-lambda-utils';
import { Session, User } from '@squidcup/types-squidcup';

// Function to extract numeric Steam ID from OpenID URL
function extractSteamIdFromOpenId(steamId: string): string {
  if (steamId.includes('steamcommunity.com/openid/id/')) {
    return steamId.split('/').pop() || steamId;
  }
  return steamId;
}

// Function to check if user is admin
async function isAdmin(steamId: string): Promise<boolean> {
  const numericSteamId = extractSteamIdFromOpenId(steamId);
  const user = await getUser(numericSteamId);
  
  if (!user) {
    return false;
  }
  
  // Handle MySQL boolean compatibility (could be 0/1 or true/false)
  return user.is_admin === true || user.is_admin === 1;
}

export async function handler(event: any): Promise<any> {
  console.log('Delete server event received');
  console.log('Path parameters:', event.pathParameters);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));

  try {
    // Get server ID from path parameters
    const serverId = event.pathParameters?.id;
    if (!serverId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Server ID is required' }),
      };
    }

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
    
    // Get session from database
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

    console.log('Session found:', session);

    // Check if user is admin
    const userIsAdmin = await isAdmin(session.steamId);
    if (!userIsAdmin) {
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    // Delete the server
    try {
      await deleteServer(serverId);
      console.log('Server deleted successfully:', serverId);
    } catch (error: any) {
      // Check if it's a server not found error
      if (error.message?.includes('not found')) {
        return {
          statusCode: 404,
          headers: {
            'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          },
          body: JSON.stringify({ error: 'Server not found' }),
        };
      }
      
      throw error;
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
      },
      body: JSON.stringify({ message: 'Server deleted successfully', serverId }),
    };
  } catch (error) {
    console.error('Error deleting server:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
      },
      body: JSON.stringify({ error: 'Failed to delete server' }),
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
