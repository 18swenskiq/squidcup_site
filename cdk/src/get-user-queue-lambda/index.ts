import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.REGION });

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

// Function to get player names by Steam IDs
async function getPlayerNames(steamIds: string[]): Promise<Map<string, string>> {
  const playerNames = new Map<string, string>();
  
  if (steamIds.length === 0) {
    return playerNames;
  }

  try {
    const users = await callDatabaseService('getUsersBySteamIds', [steamIds]);
    
    for (const user of users) {
      playerNames.set(user.steam_id, user.username || `Player ${user.steam_id.slice(-4)}`);
    }

    // For any Steam IDs that weren't found in the database, use a fallback name
    for (const steamId of steamIds) {
      if (!playerNames.has(steamId)) {
        playerNames.set(steamId, `Player ${steamId.slice(-4)}`);
      }
    }

    console.log('Retrieved player names:', Object.fromEntries(playerNames));
    return playerNames;
    
  } catch (error) {
    console.error('Error getting player names:', error);
    
    // Fallback: create names for all Steam IDs
    for (const steamId of steamIds) {
      playerNames.set(steamId, `Player ${steamId.slice(-4)}`);
    }
    
    return playerNames;
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Get user queue handler started');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };

  try {
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Get session token from headers
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No session token provided' }),
      };
    }

    // Extract token from Bearer format
    const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    // Validate session using database service
    const session = await callDatabaseService('getSession', [sessionToken]);
    if (!session) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    const userSteamId = session.steamId;
    console.log('User Steam ID:', userSteamId);

    // First check if user is in a lobby
    const userLobby: LobbyData = await callDatabaseService('getUserActiveLobby', [userSteamId]);
    
    if (userLobby) {
      console.log('User found in lobby:', userLobby.id);
      const isHost = userLobby.isHost || userLobby.host_steam_id === userSteamId;
      
      // Get player names for all players in the lobby
      const allSteamIds = [userLobby.host_steam_id, ...userLobby.players.map(p => p.player_steam_id)];
      const playerNames = await getPlayerNames(allSteamIds);
      
      // Enrich players with names
      const enrichedPlayers = userLobby.players.map(player => ({
        steamId: player.player_steam_id,
        team: player.team,
        joinedAt: player.joined_at,
        name: playerNames.get(player.player_steam_id) || `Player ${player.player_steam_id.slice(-4)}`
      }));
      
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
    const userQueue: QueueData = await callDatabaseService('getUserActiveQueue', [userSteamId]);
    
    if (userQueue) {
      console.log('User found in queue:', userQueue.id);
      const isHost = userQueue.isHost || userQueue.host_steam_id === userSteamId;
      
      // Get player names for host and all players
      const allSteamIds = [userQueue.host_steam_id, ...userQueue.players.map(p => p.player_steam_id)];
      const playerNames = await getPlayerNames(allSteamIds);
      
      // Enrich players with names (converting from queue players to joiners format)
      const enrichedJoiners = userQueue.players
        .filter(player => player.player_steam_id !== userQueue.host_steam_id) // Exclude host from joiners
        .map(player => ({
          steamId: player.player_steam_id,
          joinTime: player.joined_at,
          name: playerNames.get(player.player_steam_id) || `Player ${player.player_steam_id.slice(-4)}`
        }));
      
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
    console.error('Error checking user queue status:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      }),
    };
  }
};
