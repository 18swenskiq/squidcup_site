import { 
  getQueue, 
  getQueuePlayers, 
  updateGame,
  storeLobbyHistoryEvent,
  getMaxPlayersForGamemode,
  getMapsByGameMode,
  selectRandomMapFromAvailable,
  getSsmParameter,
  createCorsHeaders,
  getGameTeams,
  createGameTeam,
  updatePlayerTeam,
  LobbyPlayerRecord, 
  GameMode, 
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
async function balancePlayersIntoTeams(gameId: string, players: LobbyPlayerRecord[], gameMode: GameMode): Promise<void> {
  const maxPlayers = getMaxPlayersForGamemode(gameMode);
  const playersPerTeam = maxPlayers / 2;
  
  // Get existing teams for this game
  const teams = await getGameTeams(gameId);
  if (teams.length < 2) {
    throw new Error('Game must have at least 2 teams');
  }
  
  // Shuffle players randomly for now (later we can implement skill-based balancing)
  const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
  
  // Assign players to teams
  for (let i = 0; i < shuffledPlayers.length; i++) {
    const teamIndex = Math.floor(i / playersPerTeam);
    const team = teams[teamIndex];
    if (team) {
      await updatePlayerTeam(gameId, shuffledPlayers[i].player_steam_id, team.id);
    }
  }
}

export const handler = async (event: any) => {
  console.log('Create lobby event:', JSON.stringify(event, null, 2));

  try {
    const { queueId } = JSON.parse(event.body || '{}');
    
    // Note: queueId is actually a gameId in the unified architecture
    const gameId = queueId;
    
    if (!gameId) {
      return {
        statusCode: 400,
        headers: createCorsHeaders(),
        body: JSON.stringify({ error: 'Queue ID is required' })
      };
    }

    // Get the queue from database
    const queueData = await getQueue(gameId);

    if (!queueData) {
      return {
        statusCode: 404,
        headers: createCorsHeaders(),
        body: JSON.stringify({ error: 'Queue not found' })
      };
    }
    
    // Check if queue has already been converted to lobby
    if (queueData.status !== 'queue') {
      return {
        statusCode: 400,
        headers: createCorsHeaders(),
        body: JSON.stringify({ error: 'Queue has already been processed' })
      };
    }
    
    // Get queue players
    const queuePlayers = await getQueuePlayers(gameId);
    
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

    // In the unified architecture, we just update the same game record to 'lobby' status
    // instead of creating a new lobby with a new ID
    const lobbyId = gameId; // Use the same game ID
    const now = new Date().toISOString();

    // Create players array from queue data (no team assignment yet)
    const allPlayers: LobbyPlayerRecord[] = [
      { 
        game_id: lobbyId,
        player_steam_id: queueData.host_steam_id, 
        team_id: undefined,
        joined_at: new Date().toISOString() 
      },
      ...queuePlayers.map(player => ({
        game_id: lobbyId,
        player_steam_id: player.player_steam_id,
        team_id: undefined,
        joined_at: player.joined_at
      }))
    ];

    // Balance players into teams if gamemode has more than 2 players
    if (maxPlayers > 2) {
      await balancePlayersIntoTeams(gameId, allPlayers, queueData.game_mode as GameMode);
    }

    // Get updated players with team assignments
    const updatedPlayers = await getQueuePlayers(gameId);

    let mapSelectionMode = queueData.map_selection_mode;
    const needsMapSelection = mapSelectionMode === 'all-pick' || mapSelectionMode === 'host-pick';
    let selectedMap: string | undefined;
    let mapSelectionComplete = false;

    // Handle Random Map selection immediately
    if (mapSelectionMode === 'random-map') {
      try {
        // Get Steam API key and fetch available maps
        const steamApiKey = await getSsmParameter('/unencrypted/SteamApiKey');
        const availableMaps = await getMapsByGameMode(queueData.game_mode, steamApiKey);
        const mapNames = availableMaps.map(map => map.name);
        
        // Select a random map from available maps
        const randomMap = selectRandomMapFromAvailable(mapNames);
        if (randomMap) {
          selectedMap = randomMap;
        }
        mapSelectionComplete = true;
      } catch (error) {
        console.error('Error selecting random map:', error);
        // Fallback: leave map undefined and handle later
        mapSelectionComplete = true;
      }
    }

    // Create lobby data
    const lobbyData: CreateLobbyInput = {
      id: lobbyId,
      gameMode: queueData.game_mode as GameMode,
      map: selectedMap,
      mapSelectionMode: mapSelectionMode,
      hostSteamId: queueData.host_steam_id,
      serverId: undefined, // Will be assigned later
      status: 'lobby',
      ranked: queueData.ranked || false,
      startTime: new Date(queueData.start_time),
      maxPlayers: maxPlayers
    };

    // Update the existing game to lobby status instead of creating a new one
    await updateGame(gameId, {
      status: 'lobby',
      map: selectedMap,
      mapSelectionMode: mapSelectionMode,
      serverId: undefined // Will be assigned later when map is selected
    });

    // No need to add players again - they're already in the game_players table
    // Just update their team assignments if needed
    // TODO: Update player teams if required by game mode

    // Store lobby creation events for all players
    for (const player of updatedPlayers) {
      await storeLobbyHistoryEvent({
        id: crypto.randomUUID(),
        gameId: lobbyId,
        playerSteamId: player.player_steam_id,
        eventType: 'join',
        eventData: {
          gameMode: queueData.game_mode,
          mapSelectionMode: mapSelectionMode,
          isHost: player.player_steam_id === queueData.host_steam_id,
          teamId: player.team_id
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
      players: updatedPlayers.map(p => ({
        player_steam_id: p.player_steam_id,
        team: p.team_id || 'unassigned',
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
