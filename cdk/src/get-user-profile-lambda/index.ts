import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import fetch from 'node-fetch';
import { getSession, getSsmParameter, upsertUser, createCorsHeaders, extractSteamIdFromOpenId } from '@squidcup/shared-lambda-utils';
import { SteamUserResponse, SteamPlayer } from '@squidcup/types';

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

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get user profile event received');
  console.log('Headers:', JSON.stringify(event.headers, null, 2));

  const corsHeaders = createCorsHeaders();

  try {
    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Get session token from Authorization header
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Get user session
    const session = await getSession(sessionToken);
    if (!session) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Extract numeric Steam ID from the session userId
    const numericSteamId = extractSteamIdFromOpenId(session.steamId);
    console.log('Session steamId:', session.steamId, 'Extracted Steam ID:', numericSteamId);

    // Get Steam API key from SSM Parameter Store
    const steamApiKey = await getSsmParameter('/unencrypted/SteamApiKey');
    
    // Get Steam user profile using the numeric Steam ID
    const steamProfile = await getSteamUserProfile(steamApiKey, numericSteamId);
    
    if (!steamProfile) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to fetch Steam profile' }),
      };
    }

    // Store/update the player profile in the database
    try {
      await upsertUser({
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
      headers: corsHeaders,
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
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      }),
    };
  }
}
