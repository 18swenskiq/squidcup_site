import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import * as crypto from 'crypto';

// Initialize Lambda client
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

export interface DatabaseRequest {
  operation: string;
  data?: any;
  params?: any[];
}

export interface DatabaseResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// Function to call database service
async function callDatabaseService(request: DatabaseRequest): Promise<DatabaseResponse> {
  try {
    const command = new InvokeCommand({
      FunctionName: process.env.DATABASE_SERVICE_FUNCTION_NAME,
      Payload: JSON.stringify(request)
    });

    const response = await lambdaClient.send(command);
    
    if (!response.Payload) {
      throw new Error('No response from database service');
    }

    const responseData = JSON.parse(Buffer.from(response.Payload).toString());
    return responseData;
  } catch (error) {
    console.error('Error calling database service:', error);
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

// Function to check if user is admin
async function isAdmin(steamId: string): Promise<boolean> {
  try {
    const numericSteamId = extractSteamIdFromOpenId(steamId);
    
    const response = await callDatabaseService({
      operation: 'getUser',
      params: [numericSteamId]
    });

    if (!response.success) {
      // Fallback to hardcoded admin check for initial setup
      return numericSteamId === '76561198041569692';
    }

    if (!response.data) {
      // User doesn't exist, fallback to hardcoded admin check
      return numericSteamId === '76561198041569692';
    }

    return response.data.is_admin === 1;
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
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7);
    console.log('Extracted session token:', sessionToken);
    
    // Get session from database service
    const sessionResponse = await callDatabaseService({
      operation: 'getSession',
      params: [sessionToken]
    });

    if (!sessionResponse.success || !sessionResponse.data) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    const session = sessionResponse.data;
    console.log('Session result:', session);
    
    if (!(await isAdmin(session.steamId))) {
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    const serverData = JSON.parse(event.body);
    const { ip, port, location, rconPassword, defaultPassword, maxPlayers, nickname } = serverData;
    
    if (!ip || !port || !location || !rconPassword || !maxPlayers || !nickname) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing required fields: ip, port, location, rconPassword, maxPlayers, nickname' }),
      };
    }

    const serverId = crypto.randomUUID();
    const now = new Date().toISOString();

    const server: GameServer = {
      id: serverId,
      ip,
      port: Number(port),
      location,
      rconPassword,
      defaultPassword: defaultPassword || '',
      maxPlayers: Number(maxPlayers),
      nickname,
      createdAt: now,
      updatedAt: now
    };

    // Add server using database service
    const addServerResponse = await callDatabaseService({
      operation: 'addServer',
      data: server
    });

    if (!addServerResponse.success) {
      // Check if it's a duplicate entry error
      if (addServerResponse.error?.includes('Duplicate entry') || addServerResponse.error?.includes('unique_ip_port')) {
        return {
          statusCode: 409,
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ error: 'Server with this IP and port already exists' }),
        };
      }
      
      throw new Error(addServerResponse.error || 'Failed to add server');
    }

    console.log('Server added successfully:', server);

    return {
      statusCode: 201,
      headers: {
        'Access-Control-Allow-Origin': '*',
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
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to add server' }),
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
