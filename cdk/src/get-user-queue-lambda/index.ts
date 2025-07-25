import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserCompleteStatus, createCorsHeaders } from '@squidcup/shared-lambda-utils';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  console.log('Get user queue handler started at:', new Date().toISOString());
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const corsHeaders = createCorsHeaders();

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

    // Use consolidated database call to get complete user status
    const statusCheckStart = Date.now();
    console.log(`Starting consolidated status check for token: ${sessionToken.substring(0, 8)}...`);
    
    const userStatus = await getUserCompleteStatus(sessionToken);
    
    const statusCheckTime = Date.now() - statusCheckStart;
    console.log(`Consolidated status check completed in ${statusCheckTime}ms`);
    
    if (!userStatus.session) {
      const totalTime = Date.now() - startTime;
      console.log(`Invalid session - total time: ${totalTime}ms`);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    const userSteamId = userStatus.userSteamId;
    console.log('User Steam ID:', userSteamId);

    // Check if user is in a lobby
    if (userStatus.lobby) {
      console.log('User found in lobby:', userStatus.lobby.id);
      const lobby = userStatus.lobby;
      
      // Enrich players with names
      const enrichedPlayers = lobby.players.map((player: any) => ({
        steamId: player.player_steam_id,
        team: player.team,
        joinedAt: player.joined_at,
        name: lobby.playerNames[player.player_steam_id] || `Player ${player.player_steam_id.slice(-4)}`
      }));
      
      const totalTime = Date.now() - startTime;
      console.log(`Lobby response completed in total ${totalTime}ms`);
      console.log(`[TIMING SUMMARY] Auth: ${authTime}ms, StatusCheck: ${statusCheckTime}ms, Total: ${totalTime}ms`);
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          inLobby: true,
          isHost: lobby.isHost,
          lobby: {
            id: lobby.id,
            hostSteamId: lobby.host_steam_id,
            hostName: lobby.playerNames[lobby.host_steam_id] || `Player ${lobby.host_steam_id.slice(-4)}`,
            gameMode: lobby.game_mode,
            mapSelectionMode: 'Host Pick', // Default since lobbies don't store this
            serverId: lobby.server_id,
            hasPassword: false, // Lobbies don't have passwords
            ranked: false, // Default for lobbies
            players: enrichedPlayers,
            createdAt: lobby.created_at,
            updatedAt: lobby.updated_at,
          }
        }),
      };
    }

    // Check if user is in a queue
    if (userStatus.queue) {
      console.log('User found in queue:', userStatus.queue.id);
      const queue = userStatus.queue;
      
      // Enrich players with names (converting from queue players to joiners format)
      const enrichedJoiners = queue.players
        .filter((player: any) => player.player_steam_id !== queue.host_steam_id) // Exclude host from joiners
        .map((player: any) => ({
          steamId: player.player_steam_id,
          joinTime: player.joined_at,
          name: queue.playerNames[player.player_steam_id] || `Player ${player.player_steam_id.slice(-4)}`
        }));
      
      const totalTime = Date.now() - startTime;
      console.log(`Queue response completed in total ${totalTime}ms`);
      console.log(`[TIMING SUMMARY] Auth: ${authTime}ms, StatusCheck: ${statusCheckTime}ms, Total: ${totalTime}ms`);
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          inQueue: true,
          isHost: queue.isHost,
          queue: {
            id: queue.id,
            hostSteamId: queue.host_steam_id,
            hostName: queue.playerNames[queue.host_steam_id] || `Player ${queue.host_steam_id.slice(-4)}`,
            gameMode: queue.game_mode,
            mapSelectionMode: queue.map_selection_mode,
            serverId: queue.server_id,
            hasPassword: !!queue.password,
            ranked: !!queue.ranked,
            startTime: queue.start_time,
            joiners: enrichedJoiners,
            createdAt: queue.created_at,
            updatedAt: queue.updated_at,
          }
        }),
      };
    }

    // User is not in any queue or lobby
    const totalTime = Date.now() - startTime;
    console.log(`No queue/lobby found - total time: ${totalTime}ms`);
    console.log(`[TIMING SUMMARY] Auth: ${authTime}ms, StatusCheck: ${statusCheckTime}ms, Total: ${totalTime}ms`);
    
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
