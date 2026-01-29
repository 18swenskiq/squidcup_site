/**
 * Stats Routes
 * 
 * Routes:
 * - GET /leaderboard - Get ELO leaderboard
 * - GET /mapStats - Get map statistics
 * - GET /playerStats/{steamId} - Get player statistics
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    createCorsHeaders,
    getPlayerLeaderboardStats,
    getMapStats,
    getUser
} from '@squidcup/shared-lambda-utils';

export async function handleStats(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const path = event.path;
    const method = event.httpMethod;

    try {
        if (method === 'GET' && path === '/leaderboard') {
            return await handleGetLeaderboard(event);
        }

        if (method === 'GET' && path === '/mapStats') {
            return await handleGetMapStats(event);
        }

        if (method === 'GET' && path.startsWith('/playerStats/')) {
            const steamId = path.split('/')[2];
            return await handleGetPlayerStats(event, steamId);
        }

        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Stats endpoint not found' }),
        };
    } catch (error) {
        console.error('[Stats] Error:', error);
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

async function handleGetLeaderboard(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const leaderboard = await getPlayerLeaderboardStats();

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify(leaderboard),
    };
}

async function handleGetMapStats(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const mapStats = await getMapStats();

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify(mapStats),
    };
}

async function handleGetPlayerStats(event: APIGatewayProxyEvent, steamId: string): Promise<APIGatewayProxyResult> {
    if (!steamId) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Steam ID is required' }),
        };
    }

    // Get user data as player stats
    const user = await getUser(steamId);

    if (!user) {
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Player not found' }),
        };
    }

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            steamId: user.steam_id,
            username: user.username,
            currentElo: user.current_elo || 1000,
            createdAt: user.created_at
        }),
    };
}
