import {
    isAuthorizedServer,
    createServerAuthErrorResponse,
    extractSourceIp,
    finalizeMatch,
    EndMatchRequest
} from '@squidcup/shared-lambda-utils';

/**
 * Lambda handler for POST /api/matches/{matchId}/end
 * Finalizes a match with winner, end time, and final series scores
 * 
 * Note: This is separate from the existing end-match-lambda which handles
 * the frontend-triggered match ending workflow.
 * 
 * Authentication: IP-based (request must come from a registered game server)
 */
export async function handler(event: any): Promise<any> {
    console.log('finalize-match-lambda invoked');
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

        if (isNaN(matchId)) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid matchId in path'
                }),
            };
        }

        // Parse request body
        const requestBody: EndMatchRequest = JSON.parse(event.body);

        // Validate required fields
        if (!requestBody.winnerName ||
            requestBody.team1Score === undefined ||
            requestBody.team2Score === undefined) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Missing required fields: winnerName, team1Score, team2Score'
                }),
            };
        }

        // Finalize match
        await finalizeMatch(matchId, requestBody);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true
            }),
        };

    } catch (error) {
        console.error('Error in finalize-match-lambda:', error);
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
