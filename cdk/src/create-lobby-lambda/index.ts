import { 
  getQueue, 
  getQueuePlayers, 
  createLobby,
  addLobbyPlayers, 
  deleteQueue,
  updateQueue,
  storeLobbyHistoryEvent,
  getMaxPlayersForGamemode,
  createCorsHeaders,
  LobbyPlayerRecord, 
  GameMode, 
  MapSelectionMode,
  LobbyData,
  CreateLobbyInput,
} from '@squidcup/shared-lambda-utils';
import * as crypto from 'crypto';

// Extended response interface for API responses
interface LobbyResponseData extends LobbyData {
  mapSelectionComplete: boolean;
  selectedMap?: string;
}

// Function to balance players into teams
function balancePlayersIntoTeams(players: LobbyPlayerRecord[], gameMode: GameMode): LobbyPlayerRecord[] {
  const maxPlayers = getMaxPlayersForGamemode(gameMode);
  const playersPerTeam = maxPlayers / 2;
  
  // Shuffle players randomly for now (later we can implement skill-based balancing)
  const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
  
  return shuffledPlayers.map((player, index) => ({
    ...player,
    team: Math.floor(index / playersPerTeam) + 1 // Team numbers as numbers
  }));
}

export const handler = async (event: any) => {
  console.log('Create lobby event:', JSON.stringify(event, null, 2));

  try {
    const { queueId } = JSON.parse(event.body || '{}');
    
    if (!queueId) {
      return {
        statusCode: 400,
        headers: createCorsHeaders(),
        body: JSON.stringify({ error: 'Queue ID is required' })
      };
    }

    // Get the queue from database
    const queueData = await getQueue(queueId);

    if (!queueData) {
      return {
        statusCode: 404,
        headers: createCorsHeaders(),
        body: JSON.stringify({ error: 'Queue not found' })
      };
    }
    
    // Check if queue has already been converted to lobby
    if (queueData.status !== 'waiting') {
      return {
        statusCode: 400,
        headers: createCorsHeaders(),
        body: JSON.stringify({ error: 'Queue has already been processed' })
      };
    }
    
    // Get queue players
    const queuePlayers = await getQueuePlayers(queueId);
    
    // Check if queue is full
    const maxPlayers = getMaxPlayersForGamemode(queueData.game_mode as GameMode);
    const currentPlayers = queueData.current_players;
    
    if (currentPlayers < maxPlayers) {
      return {
        statusCode: 400,
        headers: createCorsHeaders(),
        body: JSON.stringify({ error: 'Queue is not full yet' })
      };
    }

    // Create lobby ID
    const lobbyId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create players array from queue data
    const allPlayers: LobbyPlayerRecord[] = [
      { 
        lobby_id: lobbyId,
        player_steam_id: queueData.host_steam_id, 
        team: 0,
        joined_at: new Date().toISOString() 
      },
      ...queuePlayers.map(player => ({
        lobby_id: lobbyId,
        player_steam_id: player.player_steam_id,
        team: 0,
        joined_at: player.joined_at
      }))
    ];

    // Balance players into teams if gamemode has more than 2 players
    const playersWithTeams = maxPlayers > 2 
      ? balancePlayersIntoTeams(allPlayers, queueData.game_mode as GameMode)
      : allPlayers;

    let mapSelectionMode = queueData.map_selection_mode;
    const needsMapSelection = mapSelectionMode === 'all-pick' || mapSelectionMode === 'host-pick';
    let selectedMap: string | undefined;
    let mapSelectionComplete = false;

    // Handle Random Map selection immediately
    if (mapSelectionMode === 'random-map') {
      // TODO: Get random map from maps table based on gameMode
      // For now, we'll leave it undefined and handle it later
      mapSelectionComplete = true;
    }

    // Create lobby data
    const lobbyData: CreateLobbyInput = {
      id: lobbyId,
      queueId: queueId,
      gameMode: queueData.game_mode as GameMode,
      map: selectedMap,
      hostSteamId: queueData.host_steam_id,
      serverId: undefined, // Will be assigned later
      status: 'waiting'
    };

    // Create the lobby in database
    await createLobby(lobbyData);

    // Add lobby players
    await addLobbyPlayers(lobbyId, playersWithTeams.map(player => ({
      steamId: player.player_steam_id,
      team: player.team || 0
    })));

    // Mark the original queue as completed (converted to lobby) instead of deleting immediately
    await updateQueue(queueId, { status: 'completed' });

    // Store lobby creation events for all players
    for (const player of playersWithTeams) {
      await storeLobbyHistoryEvent({
        id: crypto.randomUUID(),
        lobbyId,
        playerSteamId: player.player_steam_id,
        eventType: 'join',
        eventData: {
          gameMode: queueData.game_mode,
          mapSelectionMode: mapSelectionMode,
          isHost: player.player_steam_id === queueData.host_steam_id,
          team: player.team
        }
      });
    }

    console.log('Lobby created successfully:', lobbyId);

    // Create response data matching expected format
    const responseData: LobbyResponseData = {
      id: lobbyId,
      host_steam_id: queueData.host_steam_id,
      game_mode: queueData.game_mode as GameMode,
      map_selection_mode: mapSelectionMode,
      server_id: '', // Will be assigned later
      ranked: false, // Default for now
      status: 'active' as any, // Temporary cast, should match LobbyStatus
      players: playersWithTeams.map(p => ({
        player_steam_id: p.player_steam_id,
        team: String(p.team),
        joined_at: p.joined_at
      })),
      mapSelectionComplete,
      selectedMap,
      created_at: now,
      updated_at: now,
    };

    return {
      statusCode: 201,
      headers: createCorsHeaders(),
      body: JSON.stringify({
        message: 'Lobby created successfully',
        lobby: responseData
      })
    };

  } catch (error) {
    console.error('Error creating lobby:', error);
    
    return {
      statusCode: 500,
      headers: createCorsHeaders(),
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to create lobby'
      })
    };
  }
};
