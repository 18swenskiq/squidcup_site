import * as crypto from 'crypto';
import { 
  getSession,
  createQueue,
  addPlayerToGame,
  createGameTeam,
  storeQueueHistoryEvent,
  createCorsHeaders,
  getMaxPlayersForGamemode,
  extractSteamIdFromOpenId,
  isUserBanned,
  getSsmParameter
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

async function sendDiscordWebhook(gameMode: string, maxPlayers: number): Promise<void> {
  try {
    const webhookUrl = await getSsmParameter('/squidcup/webhook_url');
    
    const playersNeeded = maxPlayers - 1; // Subtract 1 for the host
    
    const embed = {
      title: "New Squidcup Queue Started",
      url: "https://squidcup.spkymnr.xyz/play",
      description: `A new **${gameMode}** queue has been created!`,
      fields: [
        {
          name: "Game Mode",
          value: gameMode,
          inline: true
        },
        {
          name: "Players Needed",
          value: `${playersNeeded} more players`,
          inline: true
        }
      ],
      color: 0x2196F3, // Blue color
      timestamp: new Date().toISOString(),
      footer: {
        text: "Click the title to join!"
      }
    };

    const payload = {
      embeds: [embed]
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('Discord webhook failed:', response.status, response.statusText);
    } else {
      console.log('Discord webhook sent successfully');
    }
  } catch (error) {
    console.error('Error sending Discord webhook:', error);
    // Don't throw the error - webhook failure shouldn't break queue creation
  }
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

    // Check if user is banned
    const isBanned = await isUserBanned(hostSteamId);
    if (isBanned) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'You are temporarily banned from creating queues' }),
      };
    }

    // Parse request body
    const queueData = JSON.parse(event.body);
    const { gameMode, mapSelectionMode, server, password, ranked, sendWebhook } = queueData;
    
    console.log('Queue data received:', queueData);
    console.log('Ranked value:', ranked, 'Type:', typeof ranked);
    console.log('Send webhook value:', sendWebhook, 'Type:', typeof sendWebhook);
    
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

    // Create teams for the game
    const team1Id = await createGameTeam(gameId, 1, 'Team 1');
    const team2Id = await createGameTeam(gameId, 2, 'Team 2');

    // Add the host as a player in the game_players table
    await addPlayerToGame(gameId, {
      steamId: hostSteamId,
      teamId: team1Id, // Assign host to Team 1
      joinTime: now
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

    // Send Discord webhook notification only if sendWebhook is true
    if (sendWebhook === true) {
      console.log('Sending Discord webhook notification...');
      const maxPlayers = getMaxPlayersForGamemode(gameMode);
      await sendDiscordWebhook(gameMode, maxPlayers);
    } else {
      console.log('Skipping Discord webhook notification (sendWebhook = false)');
    }

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
