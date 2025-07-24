import { 
  getQueue, 
  getQueuePlayers, 
  createLobby, 
  addLobbyPlayers, 
  deleteQueue, 
  storeLobbyHistoryEvent,
  getMaxPlayersForGamemode,
  GameMode,
  MapSelectionMode 
} from '@squidcup/shared-lambda-utils';
import * as crypto from 'crypto';

interface QueueData {
  id: string;
  game_mode: string;
  map: string;
  host_steam_id: string;
  max_players: number;
  current_players: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface QueuePlayer {
  queue_id: string;
  player_steam_id: string;
  team: number;
  joined_at: string;
}

interface LobbyPlayer {
  steamId: string;
  team?: number; // 1 or 2 for team assignment
  mapSelection?: string; // Selected map ID (for applicable modes)
  hasSelectedMap?: boolean;
}

interface LobbyData {
  id: string;
  queueId: string;
  hostSteamId: string;
  gameMode: GameMode;
  mapSelectionMode: MapSelectionMode;
  serverId: string;
  password?: string;
  ranked: boolean;
  players: LobbyPlayer[];
  mapSelectionComplete: boolean;
  selectedMap?: string; // Final selected map
  createdAt: string;
  updatedAt: string;
}

// Function to balance players into teams
function balancePlayersIntoTeams(players: LobbyPlayer[], gameMode: GameMode): LobbyPlayer[] {
  const maxPlayers = getMaxPlayersForGamemode(gameMode);
  const playersPerTeam = maxPlayers / 2;
  
  // Shuffle players randomly for now (later we can implement skill-based balancing)
  const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
  
  return shuffledPlayers.map((player, index) => ({
    ...player,
    team: Math.floor(index / playersPerTeam) + 1
  }));
}

export const handler = async (event: any) => {
  console.log('Create lobby event:', JSON.stringify(event, null, 2));

  try {
    const { queueId } = JSON.parse(event.body || '{}');
    
    if (!queueId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Queue ID is required' })
      };
    }

    // Get the queue from database
    const queueData: QueueData = await getQueue(queueId);

    if (!queueData) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Queue not found' })
      };
    }
    
    // Get queue players
    const queuePlayers: QueuePlayer[] = await getQueuePlayers(queueId);
    
    // Check if queue is full
    const maxPlayers = getMaxPlayersForGamemode(queueData.game_mode as GameMode);
    const currentPlayers = 1 + queuePlayers.length; // host + joiners
    
    if (currentPlayers < maxPlayers) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Queue is not full yet' })
      };
    }

    // Create lobby ID
    const lobbyId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create players array from queue data
    const allPlayers: LobbyPlayer[] = [
      { steamId: queueData.host_steam_id, hasSelectedMap: false },
      ...queuePlayers.map(player => ({
        steamId: player.player_steam_id,
        hasSelectedMap: false
      }))
    ];

    // Balance players into teams if gamemode has more than 2 players
    const playersWithTeams = maxPlayers > 2 
      ? balancePlayersIntoTeams(allPlayers, queueData.game_mode as GameMode)
      : allPlayers;

    // For now, we'll use default map selection mode since it's not stored in queue yet
    // TODO: Add mapSelectionMode to queue schema
    let mapSelectionMode = 'Host Pick' as MapSelectionMode; 
    const needsMapSelection = mapSelectionMode === 'All Pick' || mapSelectionMode === 'Host Pick';
    let selectedMap: string | undefined;
    let mapSelectionComplete = false;

    // Handle Random Map selection immediately
    if (mapSelectionMode === 'Random Map') {
      // TODO: Get random map from maps table based on gameMode
      // For now, we'll leave it undefined and handle it later
      mapSelectionComplete = true;
    }

    // Create lobby data
    const lobbyData = {
      id: lobbyId,
      queueId: queueId,
      gameMode: queueData.game_mode,
      map: selectedMap,
      hostSteamId: queueData.host_steam_id,
      serverId: null, // Will be assigned later
      status: 'waiting'
    };

    // Create the lobby in database
    await createLobby(lobbyData);

    // Add lobby players
    await addLobbyPlayers(lobbyId, playersWithTeams.map(player => ({
      steamId: player.steamId,
      team: player.team || 0
    })));

    // Delete the original queue
    await deleteQueue(queueId);

    // Store lobby creation events for all players
    for (const player of playersWithTeams) {
      await storeLobbyHistoryEvent({
        id: crypto.randomUUID(),
        lobbyId,
        playerSteamId: player.steamId,
        eventType: 'created',
        eventData: {
          gameMode: queueData.game_mode,
          mapSelectionMode: mapSelectionMode,
          isHost: player.steamId === queueData.host_steam_id,
          team: player.team
        }
      });
    }

    console.log('Lobby created successfully:', lobbyId);

    // Create response data matching expected format
    const responseData: LobbyData = {
      id: lobbyId,
      queueId: queueId,
      hostSteamId: queueData.host_steam_id,
      gameMode: queueData.game_mode as GameMode,
      mapSelectionMode: mapSelectionMode,
      serverId: '', // Will be assigned later
      ranked: false, // Default for now
      players: playersWithTeams,
      mapSelectionComplete,
      selectedMap,
      createdAt: now,
      updatedAt: now,
    };

    return {
      statusCode: 201,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify({
        message: 'Lobby created successfully',
        lobby: responseData
      })
    };

  } catch (error) {
    console.error('Error creating lobby:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to create lobby'
      })
    };
  }
};
