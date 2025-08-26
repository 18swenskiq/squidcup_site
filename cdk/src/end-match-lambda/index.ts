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
    
    // Calculate and update ELO for all players based on pre-calculated values
    console.log('Starting ELO updates using pre-calculated values...');
    
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
    
      // Get game players with teams and pre-calculated ELO changes
      console.log('Fetching game players with teams and ELO changes for game:', game.id);
      const gamePlayers = await getGamePlayersWithTeams(game.id);
      console.log(`Retrieved ${gamePlayers?.length || 0} game players:`, 
        gamePlayers?.map(p => ({ 
          steam_id: p.player_steam_id, 
          team_number: p.team_number,
          elo_change_win: p.elo_change_win,
          elo_change_loss: p.elo_change_loss
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
    
      // Determine which team won
      const team1Won = matchResults.team1Score > matchResults.team2Score;
      console.log(`${team1Won ? 'Team 1' : 'Team 2'} won - applying pre-calculated ELO changes...`);
      
      // Get all steam IDs first
      const steamIds = gamePlayers.map(p => p.player_steam_id);
      console.log('Getting current user data for steam IDs:', steamIds);
      
      // Get all users in one batch to reduce database connections
      const users = await getUsersBySteamIds(steamIds);
      console.log(`Retrieved ${users.length} users from database`);
      
      // Create a lookup map for quick access
      const userMap = new Map(users.map(u => [u.steam_id, u]));
      
      // Update player ELO values using pre-calculated changes
      let playersUpdated = 0;
      const eloUpdates: Array<{steamId: string, oldElo: number, newElo: number, change: number, playerName?: string}> = [];
      
      for (let i = 0; i < gamePlayers.length; i++) {
        const player = gamePlayers[i];
        console.log(`Processing player ${i + 1}/${gamePlayers.length}: ${player.player_steam_id} (team: ${player.team_number})`);
        
        try {
          // Get player's current ELO rating
          const user = userMap.get(player.player_steam_id);
          console.log(`User data from map:`, { 
            found: !!user, 
            current_elo: user?.current_elo, 
            username: user?.username 
          });
          
          if (!user) {
            console.warn(`User not found for steam ID: ${player.player_steam_id}`);
            continue;
          }
          
          const currentElo = Number(user.current_elo) || ELO.getDefaultElo();
          
          // Determine which pre-calculated ELO change to use based on match result
          let eloChange: number;
          const playerTeam = player.team_number;
          
          console.log(`Player ${player.player_steam_id} details:`, {
            team_number: playerTeam,
            elo_change_win: player.elo_change_win,
            elo_change_loss: player.elo_change_loss,
            team1Won: team1Won
          });
          
          if ((team1Won && playerTeam === 1) || (!team1Won && playerTeam === 2)) {
            // Player's team won - use win change
            eloChange = Number(player.elo_change_win) || 0;
            console.log(`Player ${player.player_steam_id} is on winning team, using elo_change_win: ${eloChange}`);
          } else {
            // Player's team lost - use loss change
            eloChange = Number(player.elo_change_loss) || 0;
            console.log(`Player ${player.player_steam_id} is on losing team, using elo_change_loss: ${eloChange}`);
          }
          
          const newElo = Math.round(currentElo + eloChange);
          
          console.log(`Player ${player.player_steam_id}: ${currentElo} + ${eloChange} = ${newElo}`);
          console.log(`About to call updatePlayerElo with steamId: ${player.player_steam_id}, newElo: ${newElo}`);
          
          // Update ELO in database
          await updatePlayerElo(player.player_steam_id, newElo);
          console.log(`Successfully called updatePlayerElo for ${player.player_steam_id} - new ELO: ${newElo}`);
          playersUpdated++;
          
          eloUpdates.push({
            steamId: player.player_steam_id,
            oldElo: currentElo,
            newElo: newElo,
            change: eloChange,
            playerName: user?.username || `Player ${player.player_steam_id.slice(-4)}`
          });
          
          console.log(`Successfully updated player ${i + 1}/${gamePlayers.length}`);
        } catch (error) {
          console.error(`Error processing player ${player.player_steam_id}:`, error);
          throw error; // Re-throw to stop processing
        }
      }
      
      console.log(`ELO updates completed: Updated ${playersUpdated} players using pre-calculated values`);
      
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
            playerChanges: eloUpdates.map(u => ({
              player: u.playerName || u.steamId.slice(-4),
              change: u.change > 0 ? `+${u.change}` : `${u.change}`,
              oldElo: u.oldElo,
              newElo: u.newElo
            }))
          }
        }),
      };
    
  } catch (eloError) {
    console.error('Error during ELO updates:', eloError);
    console.error('Stack trace:', (eloError as Error)?.stack);
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Match ended successfully (ELO update failed)',
        gameId: game.id,
        matchId: matchId,
        error: `ELO update error: ${(eloError as Error)?.message || 'Unknown error'}`
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
