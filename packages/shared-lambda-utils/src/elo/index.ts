// ELO calculation utilities for SquidCup

// Standard ELO calculation constants
const K_FACTOR = 32; // How much ELO can change per game
const BASE_ELO = 1000; // Starting ELO rating

// Interface for team ELO calculation
export interface TeamEloData {
  players: {
    steamId: string;
    currentElo: number;
  }[];
  averageElo: number;
}

// Interface for ELO calculation result
export interface EloCalculationResult {
  steamId: string;
  oldElo: number;
  newElo: number;
  eloChange: number;
}

// Interface for match result processing
export interface MatchEloResult {
  winningTeamResults: EloCalculationResult[];
  losingTeamResults: EloCalculationResult[];
  matchDetails: {
    winningTeamAvgElo: number;
    losingTeamAvgElo: number;
    kFactor: number;
  };
}

/**
 * Calculate the expected score for a player/team based on ELO difference
 * @param playerElo - The player's current ELO rating
 * @param opponentElo - The opponent's ELO rating (or average for team)
 * @returns Expected score between 0 and 1
 */
export function calculateExpectedScore(playerElo: number, opponentElo: number): number {
  console.log(`Calculating expected score: playerElo=${playerElo}, opponentElo=${opponentElo}`);
  
  if (isNaN(playerElo) || isNaN(opponentElo)) {
    throw new Error(`Invalid ELO values for expected score calculation: playerElo=${playerElo}, opponentElo=${opponentElo}`);
  }
  
  const result = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  console.log(`Expected score result: ${result}`);
  
  if (isNaN(result)) {
    throw new Error(`Expected score calculation resulted in NaN: playerElo=${playerElo}, opponentElo=${opponentElo}`);
  }
  
  return result;
}

/**
 * Calculate new ELO rating after a match
 * @param currentElo - Player's current ELO rating
 * @param expectedScore - Expected score (0-1) from calculateExpectedScore
 * @param actualScore - Actual result (1 for win, 0 for loss)
 * @param kFactor - K-factor for ELO calculation (optional, defaults to 32)
 * @returns New ELO rating
 */
export function calculateNewElo(
  currentElo: number,
  expectedScore: number,
  actualScore: number,
  kFactor: number = K_FACTOR
): number {
  console.log(`Calculating new ELO: currentElo=${currentElo}, expectedScore=${expectedScore}, actualScore=${actualScore}, kFactor=${kFactor}`);
  
  if (isNaN(currentElo) || isNaN(expectedScore) || isNaN(actualScore) || isNaN(kFactor)) {
    throw new Error(`Invalid values for ELO calculation: currentElo=${currentElo}, expectedScore=${expectedScore}, actualScore=${actualScore}, kFactor=${kFactor}`);
  }
  
  const rawEloChange = kFactor * (actualScore - expectedScore);
  const newElo = currentElo + rawEloChange;
  
  console.log(`ELO calculation: rawEloChange=${rawEloChange}, newElo=${newElo}`);
  
  // Ensure winners always gain at least +1 ELO
  if (actualScore === 1) { // Win
    const minEloForWin = currentElo + 1;
    const finalElo = Math.round(Math.max(newElo, minEloForWin));
    console.log(`Winner ELO: minEloForWin=${minEloForWin}, finalElo=${finalElo}`);
    return finalElo;
  }
  
  // For losses, use standard calculation
  const finalElo = Math.round(newElo);
  console.log(`Loser ELO: finalElo=${finalElo}`);
  return finalElo;
}

/**
 * Calculate average ELO for a team
 * @param players - Array of players with their current ELO ratings
 * @returns Average ELO rating for the team
 */
export function calculateTeamAverageElo(players: { steamId: string; currentElo: number }[]): number {
  if (players.length === 0) return BASE_ELO;
  
  console.log('calculateTeamAverageElo input:', players.map(p => ({ 
    steamId: p.steamId, 
    currentElo: p.currentElo, 
    type: typeof p.currentElo 
  })));
  
  const totalElo = players.reduce((sum, player, index) => {
    const eloValue = Number(player.currentElo); // Ensure it's a number
    console.log(`Step ${index + 1}: sum=${sum} + playerElo=${eloValue} = ${sum + eloValue}`);
    
    if (isNaN(eloValue)) {
      console.error(`ERROR: Player ${player.steamId} has invalid ELO: ${player.currentElo}`);
      throw new Error(`Invalid ELO value for player ${player.steamId}: ${player.currentElo}`);
    }
    
    return sum + eloValue;
  }, 0);
  
  console.log(`Final calculation: totalElo=${totalElo}, players=${players.length}`);
  
  if (isNaN(totalElo)) {
    console.error('ERROR: totalElo is NaN!');
    throw new Error(`Total ELO calculation resulted in NaN. Players: ${JSON.stringify(players)}`);
  }
  
  const average = Math.round(totalElo / players.length);
  console.log(`Team average ELO: totalElo=${totalElo}, players=${players.length}, average=${average}`);
  
  if (isNaN(average)) {
    console.error('ERROR: average ELO is NaN!');
    throw new Error(`Average ELO calculation resulted in NaN. totalElo=${totalElo}, playerCount=${players.length}`);
  }
  
  return average;
}

/**
 * Process ELO changes for a completed match
 * @param winningTeam - Team data for the winning team
 * @param losingTeam - Team data for the losing team
 * @param kFactor - K-factor for ELO calculation (optional)
 * @returns Complete ELO calculation results for all players
 */
export function processMatchEloChanges(
  winningTeam: TeamEloData,
  losingTeam: TeamEloData,
  kFactor: number = K_FACTOR
): MatchEloResult {
  const winningTeamResults: EloCalculationResult[] = [];
  const losingTeamResults: EloCalculationResult[] = [];

  // Calculate ELO changes for winning team players
  for (const player of winningTeam.players) {
    const expectedScore = calculateExpectedScore(player.currentElo, losingTeam.averageElo);
    const newElo = calculateNewElo(player.currentElo, expectedScore, 1, kFactor); // 1 = win
    
    winningTeamResults.push({
      steamId: player.steamId,
      oldElo: player.currentElo,
      newElo: newElo,
      eloChange: newElo - player.currentElo
    });
  }

  // Calculate ELO changes for losing team players
  for (const player of losingTeam.players) {
    const expectedScore = calculateExpectedScore(player.currentElo, winningTeam.averageElo);
    const newElo = calculateNewElo(player.currentElo, expectedScore, 0, kFactor); // 0 = loss
    
    losingTeamResults.push({
      steamId: player.steamId,
      oldElo: player.currentElo,
      newElo: newElo,
      eloChange: newElo - player.currentElo
    });
  }

  return {
    winningTeamResults,
    losingTeamResults,
    matchDetails: {
      winningTeamAvgElo: winningTeam.averageElo,
      losingTeamAvgElo: losingTeam.averageElo,
      kFactor
    }
  };
}

/**
 * Get the default starting ELO rating
 */
export function getDefaultElo(): number {
  return BASE_ELO;
}

/**
 * Get the default K-factor for ELO calculations
 */
export function getDefaultKFactor(): number {
  return K_FACTOR;
}
