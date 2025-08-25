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
  updateTeamName,
  updateTeamAverageElo,
  getGamePlayersWithElo,
  getPlayerUsernamesBySteamIds,
  LobbyPlayerRecord, 
  GamePlayerRecord,
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

async function generateAndUpdateTeamNames(gameId: string, teams: any[], gameMode: GameMode): Promise<void> {
  // Get all players for this game
  const allPlayers = await getQueuePlayers(gameId);
  
  // Group players by team
  const teamPlayers: Record<string, any[]> = {};
  for (const player of allPlayers) {
    if (player.team_id) {
      if (!teamPlayers[player.team_id]) {
        teamPlayers[player.team_id] = [];
      }
      teamPlayers[player.team_id].push(player);
    }
  }
  
  // Get all steam IDs to fetch usernames
  const allSteamIds = allPlayers.map(p => p.player_steam_id);
  const usernameMap = await getPlayerUsernamesBySteamIds(allSteamIds);
  
  // Calculate team size based on game mode
  const maxPlayers = getMaxPlayersForGamemode(gameMode);
  const teamSize = maxPlayers / 2;
  
  // Generate and update team names
  for (const team of teams) {
    const playersInTeam = teamPlayers[team.id] || [];
    
    if (playersInTeam.length > 0) {
      // Generate team name using the algorithm
      const nameParts: string[] = [];
      
      for (let i = 0; i < playersInTeam.length; i++) {
        const playerSteamId = playersInTeam[i].player_steam_id;
        const playerName = usernameMap[playerSteamId] || `Player${i + 1}`;
        const nameLength = playerName.length;
        const portionSize = Math.max(1, Math.floor(nameLength / teamSize));
        
        // Calculate which portion to take based on player position
        const portionIndex = i % teamSize;
        const startIndex = portionIndex * portionSize;
        const endIndex = Math.min(startIndex + portionSize, nameLength);
        
        // Extract the portion (make sure we get at least 1 character)
        const portion = playerName.substring(startIndex, endIndex) || playerName.charAt(0);
        nameParts.push(portion);
      }
      
      // Combine all portions
      const combinedName = nameParts.join('');
      const teamName = `Team ${combinedName}`;
      
      // Update team name in database
      await updateTeamName(team.id, teamName);
    }
  }
}

async function balancePlayersIntoTeams(
  gameId: string,
  players: GamePlayerRecord[],
  gameMode: GameMode
): Promise<void> {
  console.log('Starting ELO-based team balancing for', players.length, 'players');
  
  // Get players with their ELO ratings
  const playersWithElo = await getGamePlayersWithElo(gameId);
  console.log('Players with ELO data:', playersWithElo.map(p => ({ 
    steam_id: p.player_steam_id, 
    elo: p.current_elo, 
    elo_type: typeof p.current_elo,
    elo_number: Number(p.current_elo),
    username: p.username 
  })));
  
  // Create a map for quick lookup, ensuring ELO values are numbers
  const eloMap = new Map(playersWithElo.map(p => [p.player_steam_id, Number(p.current_elo)]));
  
  // Add ELO data to players and ensure ELO values are numbers
  const playersWithEloData = players.map(player => ({
    ...player,
    current_elo: Number(eloMap.get(player.player_steam_id) || 1000) // Ensure it's a number, default ELO if not found
  }));
  
  // Sort players by ELO (highest to lowest) for balanced distribution
  playersWithEloData.sort((a, b) => b.current_elo - a.current_elo);
  
  console.log('Players sorted by ELO:', playersWithEloData.map(p => ({ steam_id: p.player_steam_id, elo: p.current_elo })));
  
  // Get existing teams for this game
  const teams = await getGameTeams(gameId);
  if (teams.length < 2) {
    throw new Error('Game must have at least 2 teams');
  }
  
  // Initialize team assignments
  const team1 = teams[0];
  const team2 = teams[1];
  const team1Players: any[] = [];
  const team2Players: any[] = [];
  let team1Elo = 0;
  let team2Elo = 0;
  
  // Distribute players ensuring equal team sizes first, then balance ELO
  const playersPerTeam = Math.floor(playersWithEloData.length / 2);
  const hasRemainder = playersWithEloData.length % 2 === 1;
  
  console.log(`Balancing ${playersWithEloData.length} players into teams of ${playersPerTeam} each${hasRemainder ? ' (with 1 extra)' : ''}`);
  console.log('Using snake draft pattern for balanced ELO distribution');
  
  // Use snake draft assignment to ensure balanced ELO distribution
  for (let i = 0; i < playersWithEloData.length; i++) {
    const player = playersWithEloData[i];
    
    // Determine which team to assign using snake draft pattern
    let assignToTeam1;
    
    if (team1Players.length === playersPerTeam && team2Players.length < playersPerTeam) {
      // Team 1 is full, assign remaining to team 2
      assignToTeam1 = false;
    } else if (team2Players.length === playersPerTeam && team1Players.length < playersPerTeam) {
      // Team 2 is full, assign remaining to team 1
      assignToTeam1 = true;
    } else {
      // Both teams have space, use snake draft pattern
      // Snake draft: 1->A, 2->B, 3->B, 4->A, 5->A, 6->B, 7->B, 8->A, etc.
      const roundNumber = Math.floor(i / 2);
      const isFirstInRound = i % 2 === 0;
      
      if (roundNumber % 2 === 0) {
        // Even rounds: first pick goes to Team 1, second to Team 2
        assignToTeam1 = isFirstInRound;
      } else {
        // Odd rounds: first pick goes to Team 2, second to Team 1 (snake reversal)
        assignToTeam1 = !isFirstInRound;
      }
      
      console.log(`Snake draft: Player ${i + 1} (round ${roundNumber}, ${isFirstInRound ? 'first' : 'second'} in round) → Team ${assignToTeam1 ? '1' : '2'}`);
    }
    
    if (assignToTeam1) {
      team1Players.push(player);
      team1Elo += player.current_elo;
      await updatePlayerTeam(gameId, player.player_steam_id, team1.id);
      console.log(`Assigned ${player.player_steam_id} (ELO: ${player.current_elo}, type: ${typeof player.current_elo}) to Team 1`);
      console.log(`Team 1 ELO now: ${team1Elo} (type: ${typeof team1Elo})`);
    } else {
      team2Players.push(player);
      team2Elo += player.current_elo;
      await updatePlayerTeam(gameId, player.player_steam_id, team2.id);
      console.log(`Assigned ${player.player_steam_id} (ELO: ${player.current_elo}, type: ${typeof player.current_elo}) to Team 2`);
      console.log(`Team 2 ELO now: ${team2Elo} (type: ${typeof team2Elo})`);
    }
  }
  
  const team1AvgElo = team1Players.length > 0 ? team1Elo / team1Players.length : 1000;
  const team2AvgElo = team2Players.length > 0 ? team2Elo / team2Players.length : 1000;
  
  console.log(`Team 1: ${team1Players.length} players, Avg ELO: ${team1AvgElo.toFixed(1)}, Total: ${team1Elo}`);
  console.log(`Team 2: ${team2Players.length} players, Avg ELO: ${team2AvgElo.toFixed(1)}, Total: ${team2Elo}`);
  console.log(`ELO Difference: ${Math.abs(team1AvgElo - team2AvgElo).toFixed(1)}`);
  
  // Update team average ELOs in database
  await updateTeamAverageElo(gameId, 1, Math.round(team1AvgElo * 100) / 100);
  await updateTeamAverageElo(gameId, 2, Math.round(team2AvgElo * 100) / 100);
  
  // Generate and update team names based on assigned players
  await generateAndUpdateTeamNames(gameId, teams, gameMode);
  
  console.log('ELO-based team balancing completed successfully');
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

    // Get actual players from database to balance into teams
    const existingPlayers = await getQueuePlayers(gameId);

    // Balance players into teams for all game modes with 2 or more players
    if (maxPlayers >= 2) {
      await balancePlayersIntoTeams(gameId, existingPlayers, queueData.game_mode as GameMode);
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
