import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import fetch from 'node-fetch';

const lambdaClient = new LambdaClient({ region: process.env.REGION });

type SteamPlayer = {
  steamid: string;
  communityvisibilitystate: number;
  profilestate: number;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  avatarhash: string;
  lastlogoff: number;
  personastate: number;
  realname?: string;
  primaryclanid?: string;
  timecreated?: number;
  personastateflags?: number;
  loccountrycode?: string;
  locstatecode?: string;
  loccityid?: number;
};

type SteamUserResponse = {
  response: {
    players: SteamPlayer[];
  };
};

// Function to call database service
async function callDatabaseService(operation: string, params?: any[], data?: any): Promise<any> {
  const payload = {
    operation,
    params,
    data
  };

  const command = new InvokeCommand({
    FunctionName: process.env.DATABASE_SERVICE_FUNCTION_NAME,
    Payload: new TextEncoder().encode(JSON.stringify(payload)),
  });

  const response = await lambdaClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.Payload));

  if (!result.success) {
    throw new Error(result.error || 'Database operation failed');
  }

  return result.data;
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

// Function to get Steam user profile
async function getSteamUserProfile(steamApiKey: string, steamId: string): Promise<SteamPlayer | null> {
  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamApiKey}&steamids=${steamId}`;
    
    console.log('Fetching Steam user profile for Steam ID:', steamId);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error('Steam API request failed:', response.status, response.statusText);
      return null;
    }

    const data = await response.json() as SteamUserResponse;
    
    if (!data.response || !data.response.players || data.response.players.length === 0) {
      console.error('No player data found in Steam API response');
      return null;
    }

    return data.response.players[0];
  } catch (error) {
    console.error('Error fetching Steam user profile:', error);
    return null;
  }
}

export async function handler(event: any): Promise<any> {
  console.log('Get user profile event received');
  console.log('Headers:', JSON.stringify(event.headers, null, 2));

  try {
    // Get session token from Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Get user session from database service
    const session = await callDatabaseService('getSession', [sessionToken]);
    if (!session) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Extract numeric Steam ID from the session userId
    const numericSteamId = extractSteamIdFromOpenId(session.steamId);
    console.log('Session steamId:', session.steamId, 'Extracted Steam ID:', numericSteamId);

    // Get Steam API key from database service (SSM Parameter Store)
    const steamApiKey = await callDatabaseService('getSsmParameter', undefined, { parameterName: '/unencrypted/SteamApiKey' });
    
    // Get Steam user profile using the numeric Steam ID
    const steamProfile = await getSteamUserProfile(steamApiKey, numericSteamId);
    
    if (!steamProfile) {
      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Failed to fetch Steam profile' }),
      };
    }

    // Store/update the player profile in the database via database service
    try {
      await callDatabaseService('upsertUser', undefined, {
        steamId: numericSteamId,
        username: steamProfile.personaname,
        avatar: steamProfile.avatar,
        avatarMedium: steamProfile.avatarmedium,
        avatarFull: steamProfile.avatarfull,
        countryCode: steamProfile.loccountrycode,
        stateCode: steamProfile.locstatecode,
        isAdmin: false // Default value, admin status set elsewhere
      });
    } catch (error) {
      console.error('Failed to store player profile, but continuing with response:', error);
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: JSON.stringify({
        steamId: numericSteamId, // Use the extracted numeric Steam ID
        name: steamProfile.personaname,
        avatar: steamProfile.avatar,
        loccountrycode: steamProfile.loccountrycode,
        locstatecode: steamProfile.locstatecode,
      }),
    };
  } catch (error) {
    console.error('Error in get user profile handler:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}
