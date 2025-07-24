import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import * as crypto from 'crypto';

const lambdaClient = new LambdaClient({ region: process.env.REGION });

async function callDatabaseService(operation: string, params: any = {}) {
  const command = new InvokeCommand({
    FunctionName: process.env.DATABASE_SERVICE_FUNCTION_NAME,
    Payload: new TextEncoder().encode(JSON.stringify({ operation, params })),
  });

  const response = await lambdaClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  
  if (result.errorMessage) {
    throw new Error(result.errorMessage);
  }
  
  return result;
}

export interface ActiveQueue {
  id: string;
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

export async function handler(event: any): Promise<any> {
  console.log('Start queue event received');
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
    
    // Validate session via database service
    const sessionResult = await callDatabaseService('getSession', {
      sessionToken: sessionToken,
    });
    console.log('Session result:', sessionResult);
    
    if (!sessionResult.session || !sessionResult.session.userId) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Extract Steam ID from session
    const hostSteamId = extractSteamIdFromOpenId(sessionResult.session.userId);
    console.log('Host Steam ID:', hostSteamId);

    // Parse request body
    const queueData = JSON.parse(event.body);
    const { gameMode, mapSelectionMode, server, password, ranked } = queueData;
    
    // Validate required fields
    if (!gameMode || !mapSelectionMode || !server) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing required fields: gameMode, mapSelectionMode, server' }),
      };
    }

    // Generate queue ID
    const queueId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create the active queue object
    const activeQueue: ActiveQueue = {
      id: queueId,
      hostSteamId,
      gameMode,
      mapSelectionMode,
      serverId: server, // This is the server ID from the form
      password: password || undefined, // Only include if provided
      ranked: ranked === true,
      startTime: now,
      joiners: [], // Empty array initially
      createdAt: now,
      updatedAt: now
    };

    // Create queue via database service
    const queueResult = await callDatabaseService('createQueue', {
      queueId: queueId,
      hostSteamId: hostSteamId,
      gameMode: gameMode,
      mapSelectionMode: mapSelectionMode,
      serverId: server,
      password: password || null,
      ranked: ranked === true,
      startTime: now,
    });

    // Store queue history event
    await callDatabaseService('storeQueueHistoryEvent', {
      queueId: queueId,
      steamId: hostSteamId,
      action: 'start',
      details: {
        gameMode,
        mapSelectionMode,
        serverId: server,
        ranked,
      }
    });

    console.log('Queue created successfully:', queueResult);

    return {
      statusCode: 201,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify(queueResult.queue || activeQueue),
    };
  } catch (error) {
    console.error('Error starting queue:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to start queue' }),
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;