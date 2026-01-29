/**
 * Users Routes
 * 
 * Routes:
 * - GET /profile - Get authenticated user's profile
 * - GET /user/{steamId} - Get any user's public profile
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    createCorsHeaders,
    getSession,
    getUser,
    extractSteamIdFromOpenId,
    getSsmParameter
} from '@squidcup/shared-lambda-utils';

interface SteamPlayerSummary {
    personaname?: string;
    avatarfull?: string;
}

interface SteamResponse {
    response?: {
        players?: SteamPlayerSummary[];
    };
}

export async function handleUsers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const path = event.path;
    const method = event.httpMethod;

    try {
        if (method === 'GET' && path === '/profile') {
            return await handleGetProfile(event);
        }

        if (method === 'GET' && path.startsWith('/user/')) {
            const steamId = path.split('/')[2];
            return await handleGetUserPublicProfile(event, steamId);
        }

        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'User endpoint not found' }),
        };
    } catch (error) {
        console.error('[Users] Error:', error);
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

async function handleGetProfile(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
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

    if (!user) {
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'User not found' }),
        };
    }

    // Fetch additional profile data from Steam API
    let steamProfile: SteamPlayerSummary | null = null;
    try {
        const steamApiKey = await getSsmParameter('/unencrypted/SteamApiKey');
        const steamResponse = await fetch(
            `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamApiKey}&steamids=${userSteamId}`
        );
        const steamData = await steamResponse.json() as SteamResponse;
        if (steamData.response?.players?.[0]) {
            steamProfile = steamData.response.players[0];
        }
    } catch (error) {
        console.warn('[Users] Failed to fetch Steam profile:', error);
    }

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            steamId: user.steam_id,
            username: user.username || steamProfile?.personaname || `Player_${user.steam_id.slice(-4)}`,
            avatar: user.avatar_full || steamProfile?.avatarfull,
            currentElo: user.current_elo || 1000,
            isAdmin: user.is_admin === true || user.is_admin === 1,
            createdAt: user.created_at
        }),
    };
}

async function handleGetUserPublicProfile(event: APIGatewayProxyEvent, steamId: string): Promise<APIGatewayProxyResult> {
    if (!steamId) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Steam ID is required' }),
        };
    }

    const user = await getUser(steamId);

    if (!user) {
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'User not found' }),
        };
    }

    // Return only public profile data
    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            steamId: user.steam_id,
            username: user.username || `Player_${user.steam_id.slice(-4)}`,
            avatar: user.avatar_full,
            currentElo: user.current_elo || 1000,
            createdAt: user.created_at
        }),
    };
}
