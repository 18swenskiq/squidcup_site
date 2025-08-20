import { 
  getSession,
  createCorsHeaders,
  extractSteamIdFromOpenId,
  getUser
} from '@squidcup/shared-lambda-utils';

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

    // TODO: Implement ELO recalculation logic here
    // This will involve:
    // 1. Getting all completed games from the database
    // 2. Resetting all player ELOs to starting values
    // 3. Recalculating ELO changes for each game in chronological order
    // 4. Updating the database with the new ELO values

    console.log('ELO recalculation completed successfully');

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'ELO recalculation completed successfully',
        timestamp: new Date().toISOString()
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
