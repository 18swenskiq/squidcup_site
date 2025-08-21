import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  getGameByMatchNumber, 
  updateGame, 
  createCorsHeaders,
  getGameWithPlayers,
  updatePlayerElo,
  getUser,
  getUsersBySteamIds,
  getDatabaseConnection,
  getMatchResults,
  getGamePlayersWithTeams
} from '@squidcup/shared-lambda-utils';
import * as ELO from '@squidcup/shared-lambda-utils/dist/elo';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('End match handler started');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const corsHeaders = createCorsHeaders();

  try {
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
      console.log('Handling OPTIONS request');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Parse request body
    let requestBody;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch (error) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid JSON in request body' }),
      };
    }

    const { matchId } = requestBody;
    
    if (!matchId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'matchId is required' }),
      };
    }
    
    console.log(`Looking for match with match_number: ${matchId}`);
    
    // Find the game by match_number
    const game = await getGameByMatchNumber(matchId);
    
    if (!game) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Game with match_number ${matchId} not found` }),
      };
    }
    
    console.log(`Found game with ID: ${game.id}, current status: ${game.status}`);
    
    // Update the game status to "completed"
    await updateGame(game.id, {
      status: 'completed'
    });
    
    console.log(`Successfully updated game ${game.id} (match_number: ${matchId}) status to "completed"`);
    
    // Calculate and update ELO for all players based on match results
    console.log('Starting ELO calculations for match players...');
    
    try {
      // Get match results (team scores)
      console.log('Fetching match results for matchId:', matchId);
      const matchResults = await getMatchResults(matchId.toString());
      console.log('Match results retrieved:', matchResults);
      
      if (!matchResults) {
        console.log('No match results found - skipping ELO calculations');
        return {
          statusCode: 200,
          headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Match ended successfully (no match results for ELO calculation)',
          gameId: game.id,
          matchId: matchId
        }),
      };
    }
    
    console.log(`Match results: Team 1: ${matchResults.team1Score}, Team 2: ${matchResults.team2Score}`);
    
    // Skip ELO calculations for tied games
    if (matchResults.team1Score === matchResults.team2Score) {
      console.log('Match was tied - no ELO changes');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Match ended successfully (tied game - no ELO changes)',
          gameId: game.id,
          matchId: matchId,
          matchResults
        }),
      };
    }
    
      // Get game with players and team assignments
      console.log('Fetching game players with teams for game:', game.id);
      const gamePlayers = await getGamePlayersWithTeams(game.id);
      console.log(`Retrieved ${gamePlayers?.length || 0} game players:`, 
        gamePlayers?.map(p => ({ 
          steam_id: p.player_steam_id, 
          team_number: p.team_number 
        })) || 'No players'
      );
      
      if (!gamePlayers || gamePlayers.length === 0) {
        console.log('No players found for ELO calculations');
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'Match ended successfully (no players found for ELO calculation)',
            gameId: game.id,
            matchId: matchId,
            matchResults
          }),
        };
      }
    
    // Separate players by team and get their current ELO ratings
    const team1Players: Array<{steamId: string, currentElo: number, playerName?: string}> = [];
    const team2Players: Array<{steamId: string, currentElo: number, playerName?: string}> = [];
    
      console.log(`Processing ${gamePlayers.length} players for ELO calculations...`);
      
      // Get all steam IDs first
      const steamIds = gamePlayers.map(p => p.player_steam_id);
      console.log('Getting user data for steam IDs:', steamIds);
      
      // Get all users in one batch to reduce database connections
      const users = await getUsersBySteamIds(steamIds);
      console.log(`Retrieved ${users.length} users from database`);
      
      // Create a lookup map for quick access
      const userMap = new Map(users.map(u => [u.steam_id, u]));
      
      for (let i = 0; i < gamePlayers.length; i++) {
        const player = gamePlayers[i];
        console.log(`Processing player ${i + 1}/${gamePlayers.length}: ${player.player_steam_id} (team: ${player.team_number})`);
        
        try {
          // Get player's current ELO rating from our map
          const user = userMap.get(player.player_steam_id);
          console.log(`User data from map:`, { 
            found: !!user, 
            current_elo: user?.current_elo, 
            username: user?.username 
          });
          
          const currentElo = Number(user?.current_elo) || ELO.getDefaultElo();
          
          console.log(`Player ${player.player_steam_id}: current_elo = ${user?.current_elo} (type: ${typeof user?.current_elo}), converted = ${currentElo} (type: ${typeof currentElo})`);
          
          const playerData = {
            steamId: player.player_steam_id,
            currentElo: currentElo,
            playerName: user?.username || `Player ${player.player_steam_id.slice(-4)}`
          };
          
          if (player.team_number === 1) {
            team1Players.push(playerData);
            console.log(`Added player to Team 1. Team 1 now has ${team1Players.length} players`);
          } else if (player.team_number === 2) {
            team2Players.push(playerData);
            console.log(`Added player to Team 2. Team 2 now has ${team2Players.length} players`);
          } else {
            console.warn(`Player ${player.player_steam_id} has invalid team_number: ${player.team_number}`);
          }
          
          console.log(`Successfully processed player ${i + 1}/${gamePlayers.length}`);
        } catch (error) {
          console.error(`Error processing player ${player.player_steam_id}:`, error);
          throw error; // Re-throw to stop processing
        }
      }    console.log(`Found ${team1Players.length} Team 1 players and ${team2Players.length} Team 2 players`);
    
    if (team1Players.length === 0 || team2Players.length === 0) {
      console.log('Incomplete teams - skipping ELO calculations');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Match ended successfully (incomplete teams - no ELO calculation)',
          gameId: game.id,
          matchId: matchId,
          matchResults
        }),
      };
    }
    
    // Build team ELO data
    console.log('Building team 1 ELO data from players:', team1Players);
    const team1EloData: ELO.TeamEloData = {
      players: team1Players.map(p => ({ steamId: p.steamId, currentElo: p.currentElo })),
      averageElo: ELO.calculateTeamAverageElo(team1Players.map(p => ({ steamId: p.steamId, currentElo: p.currentElo })))
    };
    
    console.log('Building team 2 ELO data from players:', team2Players);
    const team2EloData: ELO.TeamEloData = {
      players: team2Players.map(p => ({ steamId: p.steamId, currentElo: p.currentElo })),
      averageElo: ELO.calculateTeamAverageElo(team2Players.map(p => ({ steamId: p.steamId, currentElo: p.currentElo })))
    };
    
    console.log(`Team ELO averages: Team 1: ${team1EloData.averageElo}, Team 2: ${team2EloData.averageElo}`);
    
    // Determine winner and calculate ELO changes
    const team1Won = matchResults.team1Score > matchResults.team2Score;
    const winningTeam = team1Won ? team1EloData : team2EloData;
    const losingTeam = team1Won ? team2EloData : team1EloData;
    
    console.log(`${team1Won ? 'Team 1' : 'Team 2'} won - calculating ELO changes...`);
    
    // Calculate ELO changes
    const eloResults = ELO.processMatchEloChanges(winningTeam, losingTeam);
    
    // Update player ELO values in database
    let playersUpdated = 0;
    const eloUpdates: Array<{steamId: string, oldElo: number, newElo: number, change: number, playerName?: string}> = [];
    
    for (const result of eloResults.winningTeamResults) {
      await updatePlayerElo(result.steamId, result.newElo);
      playersUpdated++;
      
      const playerData = [...team1Players, ...team2Players].find(p => p.steamId === result.steamId);
      eloUpdates.push({
        steamId: result.steamId,
        oldElo: result.oldElo,
        newElo: result.newElo,
        change: result.eloChange,
        playerName: playerData?.playerName
      });
    }
    
    for (const result of eloResults.losingTeamResults) {
      await updatePlayerElo(result.steamId, result.newElo);
      playersUpdated++;
      
      const playerData = [...team1Players, ...team2Players].find(p => p.steamId === result.steamId);
      eloUpdates.push({
        steamId: result.steamId,
        oldElo: result.oldElo,
        newElo: result.newElo,
        change: result.eloChange,
        playerName: playerData?.playerName
      });
    }
    
    console.log(`ELO calculations completed: Updated ${playersUpdated} players`);
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Match ended successfully with ELO updates',
        gameId: game.id,
        matchId: matchId,
        matchResults,
        eloUpdates: {
          playersUpdated,
          winner: team1Won ? 'Team 1' : 'Team 2',
          teamAverages: {
            team1: { preMatch: team1EloData.averageElo },
            team2: { preMatch: team2EloData.averageElo }
          },
          playerChanges: eloUpdates.map(u => ({
            player: u.playerName || u.steamId.slice(-4),
            change: u.change > 0 ? `+${u.change}` : `${u.change}`,
            newElo: u.newElo
          }))
        }
      }),
    };
    
  } catch (eloError) {
    console.error('Error during ELO calculations:', eloError);
    console.error('Stack trace:', (eloError as Error)?.stack);
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Match ended successfully (ELO calculation failed)',
        gameId: game.id,
        matchId: matchId,
        error: `ELO calculation error: ${(eloError as Error)?.message || 'Unknown error'}`
      }),
    };
  }
    
  } catch (error) {
    console.error('Error in end match handler:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
