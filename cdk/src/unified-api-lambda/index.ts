/**
 * Unified API Lambda - Main Router
 * 
 * This Lambda handles all API routes by dispatching to the appropriate handler
 * based on the HTTP path and method.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createCorsHeaders } from '@squidcup/shared-lambda-utils';

// Import route handlers
import { handleAuth } from './routes/auth';
import { handleMaps } from './routes/maps';
import { handleServers } from './routes/servers';
import { handleQueues } from './routes/queues';
import { handleLobbies } from './routes/lobbies';
import { handleMatches } from './routes/matches';
import { handleGameServerApi } from './routes/game-server-api';
import { handleStats } from './routes/stats';
import { handleUsers } from './routes/users';
import { handleAdmin } from './routes/admin';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const { path, httpMethod } = event;

    console.log(`[Router] ${httpMethod} ${path}`);
    console.log('[Router] Headers:', JSON.stringify(event.headers, null, 2));

    // Handle CORS preflight requests
    if (httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: '',
        };
    }

    try {
        // Route based on path prefix

        // Auth routes: /auth/*
        if (path.startsWith('/auth')) {
            return handleAuth(event);
        }

        // Maps route: /maps
        if (path === '/maps') {
            return handleMaps(event);
        }

        // Server routes: /servers, /addServer, /setupServer, /deleteServer
        if (path === '/servers' || path.startsWith('/servers/') ||
            path === '/addServer' || path === '/setupServer' ||
            path.startsWith('/deleteServer')) {
            return handleServers(event);
        }

        // Queue routes: /startQueue, /userQueue, /queues, /joinQueue, /leaveQueue, /queueHistory, /activeQueues
        if (path === '/startQueue' || path === '/userQueue' ||
            path === '/queues' || path === '/joinQueue' ||
            path === '/leaveQueue' || path.startsWith('/queueHistory') ||
            path === '/activeQueues' || path === '/queueCleanup') {
            return handleQueues(event);
        }

        // Lobby routes: /createLobby, /leaveLobby, /selectMap, /endMatch
        if (path === '/createLobby' || path === '/leaveLobby' ||
            path === '/selectMap' || path === '/endMatch') {
            return handleLobbies(event);
        }

        // User-facing match routes: /acceptMatchResult, /matchHistory
        if (path === '/acceptMatchResult' || path === '/matchHistory') {
            return handleMatches(event);
        }

        // Game server API routes: /api/matches/*
        if (path.startsWith('/api/matches')) {
            return handleGameServerApi(event);
        }

        // Stats routes: /playerLeaderboardStats, /mapStats, /userProfileStats
        if (path === '/playerLeaderboardStats' || path === '/mapStats' ||
            path.startsWith('/userProfileStats')) {
            return handleStats(event);
        }

        // User routes: /profile, /user/*
        if (path === '/profile' || path.startsWith('/user/')) {
            return handleUsers(event);
        }

        // Admin routes: /recalculateElo
        if (path === '/recalculateElo') {
            return handleAdmin(event);
        }

        // Route not found
        console.log(`[Router] No handler found for ${httpMethod} ${path}`);
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Endpoint not found', path, method: httpMethod }),
        };

    } catch (error) {
        console.error('[Router] Unhandled error:', error);
        return {
            statusCode: 500,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            }),
        };
    }
}

// CommonJS export for Lambda runtime
exports.handler = handler;
