import { 
  createCorsHeaders,
  getMatchHistory
} from '@squidcup/shared-lambda-utils';

export async function handler(event: any): Promise<any> {
  console.log('Get match history request:', JSON.stringify(event, null, 2));

  const corsHeaders = createCorsHeaders();

  try {
    const matches = await getMatchHistory();

    console.log(`Retrieved ${matches.length} completed matches`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        matches: matches,
        total: matches.length
      }),
    };

  } catch (error) {
    console.error('Error retrieving match history:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to retrieve match history' }),
    };
  }
}
