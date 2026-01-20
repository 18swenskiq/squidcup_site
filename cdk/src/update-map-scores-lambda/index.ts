import {
    isAuthorizedServer,
    createServerAuthErrorResponse,
    extractSourceIp,
    updateMapScores as updateMapScoresDb,
    UpdateMapScoresRequest
} from '@squidcup/shared-lambda-utils';

/**
 * Lambda handler for PUT /api/matches/{matchId}/maps/{mapNumber}/scores
 * Updates team scores for a specific match and map (called every round)
 * 
 * Authentication: IP-based (request must come from a registered game server)
 */
export async function handler(event: any): Promise<any> {
    console.log('update-map-scores-lambda invoked');
    console.log('Event:', JSON.stringify(event, null, 2));

    try {
        // Extract and validate source IP
        const sourceIp = extractSourceIp(event);
        console.log('Source IP:', sourceIp);

        if (!sourceIp) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Could not determine source IP'
                }),
            };
        }

        // Verify the request comes from a registered server
        const authResult = await isAuthorizedServer(sourceIp);
        if (!authResult.authorized) {
            console.log(`Unauthorized request from IP: ${sourceIp}`);
            return createServerAuthErrorResponse();
        }

        console.log(`Authorized server: ${authResult.serverId}`);

        // Extract path parameters
        const matchId = parseInt(event.pathParameters?.matchId, 10);
        const mapNumber = parseInt(event.pathParameters?.mapNumber, 10);

        if (isNaN(matchId) || isNaN(mapNumber)) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid matchId or mapNumber in path'
                }),
            };
        }

        // Parse request body
        const requestBody: UpdateMapScoresRequest = JSON.parse(event.body);

        if (requestBody.team1Score === undefined || requestBody.team2Score === undefined) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Missing required fields: team1Score, team2Score'
                }),
            };
        }

        // Update map scores
        await updateMapScoresDb(matchId, mapNumber, requestBody.team1Score, requestBody.team2Score);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true
            }),
        };

    } catch (error) {
        console.error('Error in update-map-scores-lambda:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Internal server error'
            }),
        };
    }
}

// CommonJS export for Lambda runtime
exports.handler = handler;
