import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import fetch from 'node-fetch';

// Initialize clients
const ssmClient = new SSMClient({ region: process.env.REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

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

// Function to get parameter from SSM Parameter Store
async function getParameterValue(parameterName: string): Promise<string> {
  try {
    const command = new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true, // In case it's a SecureString
    });
    
    const response = await ssmClient.send(command);
    return response.Parameter?.Value || '';
  } catch (error) {
    console.error(`Error getting parameter ${parameterName}:`, error);
    throw error;
  }
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
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Get user session
    const session = await getUserSession(sessionToken);
    if (!session) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Extract numeric Steam ID from the session userId
    const numericSteamId = extractSteamIdFromOpenId(session.userId);
    console.log('Session userId:', session.userId, 'Extracted Steam ID:', numericSteamId);

    // Get Steam API key from Parameter Store
    const steamApiKey = await getParameterValue('/unencrypted/SteamApiKey');
    
    // Get Steam user profile using the numeric Steam ID
    const steamProfile = await getSteamUserProfile(steamApiKey, numericSteamId);
    
    if (!steamProfile) {
      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Failed to fetch Steam profile' }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
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
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}
