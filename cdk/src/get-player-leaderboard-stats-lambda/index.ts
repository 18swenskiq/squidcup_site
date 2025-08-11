import { 
  createCorsHeaders,
  getPlayerLeaderboardStats
} from '@squidcup/shared-lambda-utils';

export async function handler(event: any): Promise<any> {
  console.log('Get player leaderboard stats event received');
  
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

    // Get player leaderboard stats using shared utilities
    const playerStats = await getPlayerLeaderboardStats();

    console.log(`Retrieved stats for ${playerStats.length} players`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        players: playerStats,
        total: playerStats.length
      }),
    };
  } catch (error) {
    console.error('Error getting player leaderboard stats:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to get player leaderboard stats' }),
    };
  }
}
