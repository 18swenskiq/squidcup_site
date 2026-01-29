/**
 * Admin Routes
 * 
 * Routes:
 * - POST /recalculateElo - Recalculate ELO for all players (admin only)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    createCorsHeaders,
    getSession,
    getUser,
    extractSteamIdFromOpenId
} from '@squidcup/shared-lambda-utils';

export async function handleAdmin(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const path = event.path;
    const method = event.httpMethod;

    try {
        if (method === 'POST' && path === '/recalculateElo') {
            return await handleRecalculateElo(event);
        }

        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Admin endpoint not found' }),
        };
    } catch (error) {
        console.error('[Admin] Error:', error);
        return {
            statusCode: 500,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                error: 'Internal server error',
                details: error instanceof Error ? error.message : String(error)
            }),
        };
    }
}

async function handleRecalculateElo(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
            statusCode: 401,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
        };
    }

    const sessionToken = authHeader.substring(7);
    const session = await getSession(sessionToken);

    if (!session) {
        return {
            statusCode: 401,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Invalid or expired session' }),
        };
    }

    const userSteamId = extractSteamIdFromOpenId(session.steamId);
    const user = await getUser(userSteamId);

    if (!user || !(user.is_admin === true || user.is_admin === 1)) {
        return {
            statusCode: 403,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Admin access required' }),
        };
    }

    console.log('[Admin] ELO recalculation requested by:', userSteamId);

    // Note: ELO recalculation is handled by full-recalculate-elo-lambda
    // This endpoint can be used to trigger it or return a message
    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            message: 'ELO recalculation is not yet implemented in unified lambda. Use the dedicated Lambda function.'
        }),
    };
}
