import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { updateGamePlayerAcceptance } from 'shared-lambda-utils';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Accept match result request:', JSON.stringify(event, null, 2));

  const headers = {
    'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    // Parse the request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Request body is required',
          message: 'matchId and steamId must be provided'
        })
      };
    }

    const { matchId, steamId } = JSON.parse(event.body);

    // Validate required parameters
    if (!matchId || !steamId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required parameters',
          message: 'Both matchId and steamId are required'
        })
      };
    }

    console.log(`Accepting match result for matchId: ${matchId}, steamId: ${steamId}`);

    // Update the player's acceptance status
    const result = await updateGamePlayerAcceptance(matchId, steamId, true);

    if (!result.success) {
      if (result.error === 'PLAYER_NOT_FOUND') {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            error: 'Player not found',
            message: 'No player found for the given matchId and steamId'
          })
        };
      }

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Database error',
          message: result.error || 'Failed to update player acceptance status'
        })
      };
    }

    console.log('Successfully updated player acceptance status');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Match result accepted successfully'
      })
    };

  } catch (error) {
    console.error('Error accepting match result:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to accept match result'
      })
    };
  }
};
