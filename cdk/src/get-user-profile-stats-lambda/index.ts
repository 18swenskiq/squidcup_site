import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  createCorsHeaders
} from '@squidcup/shared-lambda-utils';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get user profile stats event received');
  console.log('Path parameters:', JSON.stringify(event.pathParameters, null, 2));
  
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

    // Extract steamId from path parameters
    const steamId = event.pathParameters?.steamId;
    
    if (!steamId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Steam ID is required' }),
      };
    }

    console.log(`Getting profile stats for Steam ID: ${steamId}`);

    // TODO: Implement actual database call to get user profile stats
    // For now, return placeholder data
    const placeholderProfileStats = {
      steamId: steamId,
      username: `Player_${steamId.substring(steamId.length - 8)}`,
      avatarUrl: 'https://avatars.steamstatic.com/b5bd56c1aa4644a474a2e4972be27ef9e82e517e_full.jpg',
      countryCode: 'US',
      stateCode: 'CA',
      stats: {
        currentElo: 1500,
        winrate: 65.5,
        totalMatches: 42,
        wins: 28,
        losses: 14,
        kills: 856,
        deaths: 432,
        assists: 234,
        kdr: 1.98,
        adr: 85.2,
        headShotPercentage: 42.1,
        accuracy: 38.7,
        totalRounds: 468,
        damage: 39876,
        utilityDamage: 2143,
        shotsFiredTotal: 5234,
        shotsOnTargetTotal: 2025,
        entryCount: 89,
        entryWins: 56,
        entryWinRate: 62.9,
        liveTime: 28450,
        headShotKills: 360,
        cashEarned: 284500,
        enemiesFlashed: 125
      }
    };

    console.log(`Retrieved profile stats for Steam ID: ${steamId}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(placeholderProfileStats),
    };
  } catch (error) {
    console.error('Error getting user profile stats:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to get user profile stats' }),
    };
  }
}
