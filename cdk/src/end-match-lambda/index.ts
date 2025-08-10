import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getGameByMatchNumber, updateGame, createCorsHeaders } from '@squidcup/shared-lambda-utils';

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
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Match ended successfully',
        gameId: game.id,
        matchId: matchId
      }),
    };
    
  } catch (error) {
    console.error('Error in end match handler:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
