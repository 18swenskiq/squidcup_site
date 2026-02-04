/**
 * Matches Routes - User-facing match operations
 * 
 * Routes:
 * - POST /acceptMatchResult - Accept match result
 * - GET /matchHistory - Get user's match history
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    createCorsHeaders,
    getSession,
    extractSteamIdFromOpenId,
    getMatchHistory,
    updateGamePlayerAcceptance
} from '@squidcup/shared-lambda-utils';

export async function handleMatches(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const path = event.path;
    const method = event.httpMethod;

    try {
        if (method === 'POST' && path === '/acceptMatchResult') {
            return await handleAcceptMatchResult(event);
        }

        if (method === 'GET' && path === '/matchHistory') {
            return await handleGetMatchHistory(event);
        }

        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Match endpoint not found' }),
        };
    } catch (error) {
        console.error('[Matches] Error:', error);
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

async function handleAcceptMatchResult(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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
    const { matchId, accepted } = JSON.parse(event.body || '{}');

    if (!matchId || accepted === undefined) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Match ID and accepted status are required' }),
        };
    }

    const result = await updateGamePlayerAcceptance(matchId, userSteamId, accepted);

    if (!result.success) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: result.error || 'Failed to update acceptance' }),
        };
    }

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            message: accepted ? 'Match result accepted' : 'Match result disputed',
            matchId
        }),
    };
}

async function handleGetMatchHistory(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    // Match history endpoint - no auth required for public view
    const history = await getMatchHistory();

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            matches: history,
            total: history.length
        }),
    };
}
