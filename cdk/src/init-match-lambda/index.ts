import {
    isAuthorizedServer,
    createServerAuthErrorResponse,
    extractSourceIp,
    initMatchStats,
    InitMatchRequest
} from '@squidcup/shared-lambda-utils';

/**
 * Lambda handler for POST /api/matches
 * Initializes a new match record in the database
 * 
 * Authentication: IP-based (request must come from a registered game server)
 */
export async function handler(event: any): Promise<any> {
    console.log('init-match-lambda invoked');
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

        // Parse request body
        const requestBody: InitMatchRequest = JSON.parse(event.body);

        // Validate required fields
        if (!requestBody.team1Name || !requestBody.team2Name ||
            !requestBody.seriesType || requestBody.mapNumber === undefined ||
            !requestBody.mapName) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Missing required fields: team1Name, team2Name, seriesType, mapNumber, mapName'
                }),
            };
        }

        // Use source IP for server_ip field if not provided
        if (!requestBody.serverIp) {
            requestBody.serverIp = sourceIp;
        }

        // Initialize match in database
        const matchId = await initMatchStats(requestBody);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                matchId: matchId
            }),
        };

    } catch (error) {
        console.error('Error in init-match-lambda:', error);
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
