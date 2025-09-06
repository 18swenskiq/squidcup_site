import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  createCorsHeaders,
  getUser,
  getUserProfileStats
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

    // Get user profile data
    const user = await getUser(steamId);
    
    if (!user) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'User not found' }),
      };
    }

    // Get individual game stats for the user
    const gameStats = await getUserProfileStats(steamId);

    const userProfileStats = {
      steamId: steamId,
      username: user.username || `Player_${steamId.substring(steamId.length - 8)}`,
      avatarUrl: user.avatar_full || user.avatar || '/assets/default-avatar.png',
      countryCode: user.country_code,
      stateCode: user.state_code,
      currentElo: user.current_elo || 1000,
      stats: gameStats
    };

    console.log(`Retrieved profile stats for Steam ID: ${steamId}, found ${gameStats.length} games`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(userProfileStats),
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
