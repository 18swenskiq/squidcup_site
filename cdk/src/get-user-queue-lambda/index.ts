import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ 
  region: process.env.REGION,
  maxAttempts: 3, // Retry failed requests
});

interface QueueData {
  id: string;
  host_steam_id: string;
  game_mode: string;
  map_selection_mode: string;
  server_id: string;
  password?: string;
  ranked: boolean;
  start_time: string;
  max_players: number;
  current_players: number;
  status: string;
  players: Array<{
    player_steam_id: string;
    team?: number;
    joined_at: string;
  }>;
  isHost?: boolean;
  created_at: string;
  updated_at: string;
}

interface LobbyData {
  id: string;
  host_steam_id: string;
  game_mode: string;
  map_selection_mode: string;
  server_id: string;
  password?: string;
  ranked: boolean;
  status: string;
  players: Array<{
    player_steam_id: string;
    team?: number;
    joined_at: string;
  }>;
  isHost?: boolean;
  created_at: string;
  updated_at: string;
}

// Function to call database service with timeout protection
async function callDatabaseService(operation: string, params?: any[], data?: any): Promise<any> {
  const startTime = Date.now();
  console.log(`[DB Service] Starting ${operation} operation with params:`, params?.length || 0, 'data keys:', data ? Object.keys(data).length : 0);
  
  const payload = {
    operation,
    params,
    data
  };

  try {
    const command = new InvokeCommand({
      FunctionName: process.env.DATABASE_SERVICE_FUNCTION_NAME,
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    });

    // Add timeout protection (8 seconds to leave buffer for overall 10s lambda timeout)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Database operation ${operation} timed out after 8000ms`)), 8000);
    });

    const lambdaInvokeStart = Date.now();
    const response = await Promise.race([
      lambdaClient.send(command),
      timeoutPromise
    ]) as any;
    const lambdaInvokeTime = Date.now() - lambdaInvokeStart;
    console.log(`[DB Service] Lambda invocation for ${operation} took ${lambdaInvokeTime}ms`);
    
    const parseStart = Date.now();
    const result = JSON.parse(new TextDecoder().decode(response.Payload));
    const parseTime = Date.now() - parseStart;
    console.log(`[DB Service] Response parsing for ${operation} took ${parseTime}ms`);

    if (!result.success) {
      const totalTime = Date.now() - startTime;
      console.error(`[DB Service] ${operation} failed after ${totalTime}ms:`, result.error);
      throw new Error(result.error || 'Database operation failed');
    }

    const totalTime = Date.now() - startTime;
    console.log(`[DB Service] ${operation} completed successfully in ${totalTime}ms, returned ${Array.isArray(result.data) ? result.data.length : typeof result.data} items`);
    
    return result.data;
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[DB Service] ${operation} failed after ${totalTime}ms:`, error);
    throw error;
  }
}

// Function to get player names by Steam IDs
async function getPlayerNames(steamIds: string[]): Promise<Map<string, string>> {
  const startTime = Date.now();
  console.log(`[Player Names] Starting lookup for ${steamIds.length} Steam IDs:`, steamIds);
  
  const playerNames = new Map<string, string>();
  
  if (steamIds.length === 0) {
    console.log('[Player Names] No Steam IDs provided, returning empty map');
    return playerNames;
  }

  try {
    const dbCallStart = Date.now();
    const users = await callDatabaseService('getUsersBySteamIds', [steamIds]);
    const dbCallTime = Date.now() - dbCallStart;
    console.log(`[Player Names] Database call completed in ${dbCallTime}ms, found ${users.length} users`);
    
    const processingStart = Date.now();
    for (const user of users) {
      playerNames.set(user.steam_id, user.username || `Player ${user.steam_id.slice(-4)}`);
    }

    // For any Steam IDs that weren't found in the database, use a fallback name
    for (const steamId of steamIds) {
      if (!playerNames.has(steamId)) {
        playerNames.set(steamId, `Player ${steamId.slice(-4)}`);
      }
    }
    const processingTime = Date.now() - processingStart;
    console.log(`[Player Names] Name processing completed in ${processingTime}ms`);

    const totalTime = Date.now() - startTime;
    console.log(`[Player Names] Total lookup completed in ${totalTime}ms, resolved ${playerNames.size} names`);
    console.log('[Player Names] Retrieved player names:', Object.fromEntries(playerNames));
    return playerNames;
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[Player Names] Error after ${totalTime}ms:`, error);
    
    // Fallback: create names for all Steam IDs
    for (const steamId of steamIds) {
      playerNames.set(steamId, `Player ${steamId.slice(-4)}`);
    }
    
    console.log(`[Player Names] Using fallback names for ${playerNames.size} Steam IDs`);
    return playerNames;
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  console.log('Get user queue handler started at:', new Date().toISOString());
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };

  try {
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
      const optionsTime = Date.now() - startTime;
      console.log(`OPTIONS request handled in ${optionsTime}ms`);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Get session token from headers
    const authCheckStart = Date.now();
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader) {
      const authTime = Date.now() - authCheckStart;
      console.log(`Auth check failed in ${authTime}ms - no header`);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No session token provided' }),
      };
    }

    // Extract token from Bearer format
    const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const authTime = Date.now() - authCheckStart;
    console.log(`Auth header processed in ${authTime}ms`);

    // Validate session using database service
    const sessionValidationStart = Date.now();
    console.log(`Starting session validation for token: ${sessionToken.substring(0, 8)}...`);
    const session = await callDatabaseService('getSession', [sessionToken]);
    const sessionValidationTime = Date.now() - sessionValidationStart;
    console.log(`Session validation completed in ${sessionValidationTime}ms`);
    
    if (!session) {
      const totalTime = Date.now() - startTime;
      console.log(`Invalid session - total time: ${totalTime}ms`);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    const userSteamId = session.steamId;
    console.log('User Steam ID:', userSteamId);

    // First check if user is in a lobby
    const lobbyCheckStart = Date.now();
    console.log('Starting lobby check for user:', userSteamId);
    const userLobby: LobbyData = await callDatabaseService('getUserActiveLobby', [userSteamId]);
    const lobbyCheckTime = Date.now() - lobbyCheckStart;
    console.log(`Lobby check completed in ${lobbyCheckTime}ms, found lobby:`, !!userLobby);
    
    if (userLobby) {
      console.log('User found in lobby:', userLobby.id);
      const isHost = userLobby.isHost || userLobby.host_steam_id === userSteamId;
      
      // Get player names for all players in the lobby
      const playerNamesStart = Date.now();
      const allSteamIds = [userLobby.host_steam_id, ...userLobby.players.map(p => p.player_steam_id)];
      console.log(`Getting player names for ${allSteamIds.length} users in lobby`);
      const playerNames = await getPlayerNames(allSteamIds);
      const playerNamesTime = Date.now() - playerNamesStart;
      console.log(`Player names retrieved in ${playerNamesTime}ms`);
      
      // Enrich players with names
      const enrichedPlayers = userLobby.players.map(player => ({
        steamId: player.player_steam_id,
        team: player.team,
        joinedAt: player.joined_at,
        name: playerNames.get(player.player_steam_id) || `Player ${player.player_steam_id.slice(-4)}`
      }));
      
      const totalTime = Date.now() - startTime;
      console.log(`Lobby response completed in total ${totalTime}ms`);
      console.log(`[TIMING SUMMARY] Auth: ${authTime}ms, Session: ${sessionValidationTime}ms, Lobby: ${lobbyCheckTime}ms, PlayerNames: ${playerNamesTime}ms, Total: ${totalTime}ms`);
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          inLobby: true,
          isHost: isHost,
          lobby: {
            id: userLobby.id,
            hostSteamId: userLobby.host_steam_id,
            hostName: playerNames.get(userLobby.host_steam_id) || `Player ${userLobby.host_steam_id.slice(-4)}`,
            gameMode: userLobby.game_mode,
            mapSelectionMode: userLobby.map_selection_mode,
            serverId: userLobby.server_id,
            hasPassword: !!userLobby.password,
            ranked: !!userLobby.ranked,
            players: enrichedPlayers,
            createdAt: userLobby.created_at,
            updatedAt: userLobby.updated_at,
          }
        }),
      };
    }

    // Check if user is in a queue
    const queueCheckStart = Date.now();
    console.log('Starting queue check for user:', userSteamId);
    const userQueue: QueueData = await callDatabaseService('getUserActiveQueue', [userSteamId]);
    const queueCheckTime = Date.now() - queueCheckStart;
    console.log(`Queue check completed in ${queueCheckTime}ms, found queue:`, !!userQueue);
    
    if (userQueue) {
      console.log('User found in queue:', userQueue.id);
      const isHost = userQueue.isHost || userQueue.host_steam_id === userSteamId;
      
      // Get player names for host and all players
      const playerNamesStart = Date.now();
      const allSteamIds = [userQueue.host_steam_id, ...userQueue.players.map(p => p.player_steam_id)];
      console.log(`Getting player names for ${allSteamIds.length} users in queue`);
      const playerNames = await getPlayerNames(allSteamIds);
      const playerNamesTime = Date.now() - playerNamesStart;
      console.log(`Player names retrieved in ${playerNamesTime}ms`);
      
      // Enrich players with names (converting from queue players to joiners format)
      const enrichedJoiners = userQueue.players
        .filter(player => player.player_steam_id !== userQueue.host_steam_id) // Exclude host from joiners
        .map(player => ({
          steamId: player.player_steam_id,
          joinTime: player.joined_at,
          name: playerNames.get(player.player_steam_id) || `Player ${player.player_steam_id.slice(-4)}`
        }));
      
      const totalTime = Date.now() - startTime;
      console.log(`Queue response completed in total ${totalTime}ms`);
      console.log(`[TIMING SUMMARY] Auth: ${authTime}ms, Session: ${sessionValidationTime}ms, Lobby: ${lobbyCheckTime}ms, Queue: ${queueCheckTime}ms, PlayerNames: ${playerNamesTime}ms, Total: ${totalTime}ms`);
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          inQueue: true,
          isHost: isHost,
          queue: {
            id: userQueue.id,
            hostSteamId: userQueue.host_steam_id,
            hostName: playerNames.get(userQueue.host_steam_id) || `Player ${userQueue.host_steam_id.slice(-4)}`,
            gameMode: userQueue.game_mode,
            mapSelectionMode: userQueue.map_selection_mode,
            serverId: userQueue.server_id,
            hasPassword: !!userQueue.password,
            ranked: !!userQueue.ranked,
            startTime: userQueue.start_time,
            joiners: enrichedJoiners,
            createdAt: userQueue.created_at,
            updatedAt: userQueue.updated_at,
          }
        }),
      };
    }

    // User is not in any queue or lobby
    const totalTime = Date.now() - startTime;
    console.log(`No queue/lobby found - total time: ${totalTime}ms`);
    console.log(`[TIMING SUMMARY] Auth: ${authTime}ms, Session: ${sessionValidationTime}ms, Lobby: ${lobbyCheckTime}ms, Queue: ${queueCheckTime}ms, Total: ${totalTime}ms`);
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        inQueue: false,
        inLobby: false,
        isHost: false,
        queue: null,
        lobby: null,
      }),
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`Error checking user queue status after ${totalTime}ms:`, error);
    
    // Log detailed error information
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
        executionTimeMs: totalTime
      }),
    };
  }
};
