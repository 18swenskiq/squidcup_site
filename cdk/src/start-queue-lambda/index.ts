import * as crypto from 'crypto';
import { 
  getSession,
  createQueue,
  storeQueueHistoryEvent,
  createCorsHeaders,
  getMaxPlayersForGamemode,
  extractSteamIdFromOpenId
} from '@squidcup/shared-lambda-utils';

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

export async function handler(event: any): Promise<any> {
  console.log('Start queue event received');
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  console.log('Body:', event.body);

  const corsHeaders = createCorsHeaders();

  try {
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Get session token from Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7);
    console.log('Extracted session token:', sessionToken);
    
    // Validate session using shared utilities
    const session = await getSession(sessionToken);
    console.log('Session result:', session);
    
    if (!session) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    // Extract Steam ID from session
    const hostSteamId = extractSteamIdFromOpenId(session.steamId);
    console.log('Host Steam ID:', hostSteamId);

    // Parse request body
    const queueData = JSON.parse(event.body);
    const { gameMode, mapSelectionMode, server, password, ranked } = queueData;
    
    // Validate required fields
    if (!gameMode || !mapSelectionMode || !server) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required fields: gameMode, mapSelectionMode, server' }),
      };
    }

    // Generate game ID (in unified architecture, queues are games with status='queue')
    const gameId = crypto.randomUUID();
    const now = new Date();

    // Create the active queue object
    const activeQueue: ActiveQueue = {
      id: gameId,
      hostSteamId,
      gameMode,
      mapSelectionMode,
      serverId: server, // This is the server ID from the form
      password: password || undefined, // Only include if provided
      ranked: ranked === true,
      startTime: now.toISOString(),
      joiners: [], // Empty array initially
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    // Create queue using shared utilities
    await createQueue({
      id: gameId,
      gameMode: gameMode,
      mapSelectionMode: mapSelectionMode,
      hostSteamId: hostSteamId,
      serverId: server,
      password: password || null,
      ranked: ranked === true,
      startTime: now,
      maxPlayers: getMaxPlayersForGamemode(gameMode)
    });

    // Store queue history event using shared utilities
    await storeQueueHistoryEvent({
      id: crypto.randomUUID(),
      gameId: gameId,
      playerSteamId: hostSteamId,
      eventType: 'join', // Host joining their own queue
      eventData: {
        gameMode,
        mapSelectionMode,
        serverId: server,
        ranked,
        isHost: true
      }
    });

    console.log('Queue created successfully:', activeQueue);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify(activeQueue),
    };
  } catch (error) {
    console.error('Error starting queue:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to start queue' }),
    };
  }
}
