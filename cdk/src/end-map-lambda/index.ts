import {
    isAuthorizedServer,
    createServerAuthErrorResponse,
    extractSourceIp,
    finalizeMap,
    EndMapRequest
} from '@squidcup/shared-lambda-utils';

/**
 * Lambda handler for POST /api/matches/{matchId}/maps/{mapNumber}/end
 * Finalizes a map with winner, end time, and final scores
 * 
 * Authentication: IP-based (request must come from a registered game server)
 */
export async function handler(event: any): Promise<any> {
    console.log('end-map-lambda invoked');
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
        const requestBody: EndMapRequest = JSON.parse(event.body);

        // Validate required fields
        if (!requestBody.winnerName ||
            requestBody.team1Score === undefined ||
            requestBody.team2Score === undefined ||
            requestBody.team1SeriesScore === undefined ||
            requestBody.team2SeriesScore === undefined) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Missing required fields: winnerName, team1Score, team2Score, team1SeriesScore, team2SeriesScore'
                }),
            };
        }

        // Finalize map
        await finalizeMap(matchId, mapNumber, requestBody);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true
            }),
        };

    } catch (error) {
        console.error('Error in end-map-lambda:', error);
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
