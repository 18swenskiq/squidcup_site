import { 
  getSession,
  createCorsHeaders,
  extractSteamIdFromOpenId,
  getUser,
  getAllCompletedGamesWithPlayers,
  CompletedGameWithPlayers,
  updateTeamAverageElo,
  updatePlayerElo
} from '@squidcup/shared-lambda-utils';
import * as ELO from '@squidcup/shared-lambda-utils/dist/elo';

export async function handler(event: any): Promise<any> {
  console.log('Recalculate all ELO event received');
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

    // Validate HTTP method
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Method not allowed. Use POST.' }),
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
    const userSteamId = extractSteamIdFromOpenId(session.steamId);
    console.log('User Steam ID:', userSteamId);

    // Check if user is admin (only admins can recalculate ELO)
    const user = await getUser(userSteamId);
    if (!user || !user.is_admin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Admin access required to recalculate ELO' }),
      };
    }

    console.log('Admin authorization confirmed. Starting ELO recalculation...');

    // Step 1: Get all completed games with their players
    console.log('Step 1: Getting all completed games with players...');
    const completedGames = await getAllCompletedGamesWithPlayers();
    
    if (completedGames.length === 0) {
      console.log('No completed games found - nothing to recalculate');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: 'No completed games found - ELO recalculation not needed',
          timestamp: new Date().toISOString(),
          gamesProcessed: 0
        }),
      };
    }

    console.log(`Step 1 completed: Found ${completedGames.length} games to process`);

    // Step 2: Create in-memory ELO tracking for all players
    console.log('Step 2: Initializing player ELO values...');
    
    // Extract all unique players from completed games
    const allPlayers = new Set<string>();
    for (const game of completedGames) {
      for (const player of game.players) {
        allPlayers.add(player.steamId);
      }
    }
    
    // Initialize all players with default ELO from shared package
    const playerEloMap = new Map<string, number>();
    const DEFAULT_ELO = ELO.getDefaultElo();
    
    for (const steamId of allPlayers) {
      playerEloMap.set(steamId, DEFAULT_ELO);
    }
    
    console.log(`Initialized ELO tracking for ${playerEloMap.size} unique players (default ELO: ${DEFAULT_ELO})`);
    
    // Log some sample players for verification
    const samplePlayers = Array.from(playerEloMap.entries()).slice(0, 3);
    console.log('Sample player ELO initializations:', samplePlayers);

    console.log(`Step 2 completed: ${playerEloMap.size} players initialized with ELO ${DEFAULT_ELO}`);

    // Step 3: Process each completed game chronologically and calculate ELO changes
    console.log('Step 3: Processing games chronologically with ELO calculations...');
    
    let gamesProcessed = 0;

    for (const game of completedGames) {
      console.log(`Processing match ${game.matchNumber} (${game.team1Score}-${game.team2Score})`);
      
      // Skip tied games (no ELO changes for ties)
      if (game.team1Score === game.team2Score) {
        console.log(`  Skipping tied game: ${game.team1Score}-${game.team2Score}`);
        continue;
      }
      
      // Separate players by team
      const team1Players = game.players.filter(p => p.teamNumber === 1);
      const team2Players = game.players.filter(p => p.teamNumber === 2);
      
      if (team1Players.length === 0 || team2Players.length === 0) {
        console.log(`  Skipping game with incomplete teams: Team1=${team1Players.length}, Team2=${team2Players.length}`);
        continue;
      }

      // Build team ELO data with current ELO ratings
      const team1EloData: ELO.TeamEloData = {
        players: team1Players.map(p => ({
          steamId: p.steamId,
          currentElo: playerEloMap.get(p.steamId) || DEFAULT_ELO
        })),
        averageElo: 0 // Will be calculated
      };
      
      const team2EloData: ELO.TeamEloData = {
        players: team2Players.map(p => ({
          steamId: p.steamId,
          currentElo: playerEloMap.get(p.steamId) || DEFAULT_ELO
        })),
        averageElo: 0 // Will be calculated
      };
      
      // Calculate team average ELOs (pre-match values)
      team1EloData.averageElo = ELO.calculateTeamAverageElo(team1EloData.players);
      team2EloData.averageElo = ELO.calculateTeamAverageElo(team2EloData.players);
      
      // Store pre-match team averages for database update (these represent team strength at match start)
      const preMatchTeam1AvgElo = team1EloData.averageElo;
      const preMatchTeam2AvgElo = team2EloData.averageElo;
      
      // Determine winning and losing teams
      const team1Won = game.team1Score > game.team2Score;
      const winningTeam = team1Won ? team1EloData : team2EloData;
      const losingTeam = team1Won ? team2EloData : team1EloData;
      
      // Calculate ELO changes for this match
      const eloResults = ELO.processMatchEloChanges(winningTeam, losingTeam);
      
      // Update player ELO ratings in our tracking map
      for (const result of eloResults.winningTeamResults) {
        playerEloMap.set(result.steamId, result.newElo);
      }
      for (const result of eloResults.losingTeamResults) {
        playerEloMap.set(result.steamId, result.newElo);
      }
      
      // Update team average ELO values in database (using PRE-match averages)
      // This represents the team strength at the beginning of the match
      await updateTeamAverageElo(game.gameId, 1, preMatchTeam1AvgElo);
      await updateTeamAverageElo(game.gameId, 2, preMatchTeam2AvgElo);
      
      gamesProcessed++;
      
      console.log(`  Match ${game.matchNumber}: ${team1Won ? 'Team 1' : 'Team 2'} won (${game.team1Score}-${game.team2Score})`);
      console.log(`  Pre-match ELOs: T1=${preMatchTeam1AvgElo} vs T2=${preMatchTeam2AvgElo}`);
      console.log(`  ELO changes: Winners=${eloResults.winningTeamResults.length} players, Losers=${eloResults.losingTeamResults.length} players`);
    }

    console.log(`Step 3 completed: Processed ${gamesProcessed} games with ELO changes`);

    // Step 4: Update database with final calculated ELO values for all players
    console.log('Step 4: Updating player ELO values in database...');
    
    let playersUpdated = 0;
    for (const [steamId, finalElo] of playerEloMap.entries()) {
      try {
        await updatePlayerElo(steamId, finalElo);
        playersUpdated++;
        
        if (playersUpdated % 10 === 0) {
          console.log(`  Updated ${playersUpdated}/${playerEloMap.size} players...`);
        }
      } catch (error) {
        console.error(`Failed to update ELO for player ${steamId}:`, error);
      }
    }
    
    console.log(`Step 4 completed: Updated ELO values for ${playersUpdated}/${playerEloMap.size} players in database`);

    // TODO: Implement Step 4:
    // 4. Update the database with the new ELO values

    console.log('All ELO recalculation steps completed successfully!');

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'ELO recalculation completed successfully - all player and team ELO values updated',
        timestamp: new Date().toISOString(),
        stats: {
          gamesFound: completedGames.length,
          gamesProcessed: gamesProcessed,
          playersAffected: playerEloMap.size,
          playersUpdated: playersUpdated,
          tiedGamesSkipped: completedGames.length - gamesProcessed
        },
        preview: {
          finalPlayerElos: Array.from(playerEloMap.entries()).slice(0, 5).map(([steamId, elo]) => ({
            steamId: steamId.slice(-4), // Show only last 4 digits for privacy
            finalElo: Math.round(elo)
          }))
        }
      }),
    };
  } catch (error) {
    console.error('Error recalculating ELO:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to recalculate ELO' }),
    };
  }
}
