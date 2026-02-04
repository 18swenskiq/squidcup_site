/**
 * Stats Routes
 * 
 * Routes:
 * - GET /playerLeaderboardStats - Get ELO leaderboard
 * - GET /mapStats - Get map statistics
 * - GET /userProfileStats/{steamId} - Get player statistics
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    createCorsHeaders,
    getPlayerLeaderboardStats,
    getMapStats,
    getUser,
    getUserProfileStats,
    getSsmParameter,
    getWorkshopMapInfo
} from '@squidcup/shared-lambda-utils';

export async function handleStats(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const path = event.path;
    const method = event.httpMethod;

    try {
        if (method === 'GET' && path === '/playerLeaderboardStats') {
            return await handleGetLeaderboard(event);
        }

        if (method === 'GET' && path === '/mapStats') {
            return await handleGetMapStats(event);
        }

        if (method === 'GET' && path.startsWith('/userProfileStats/')) {
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
        body: JSON.stringify({
            players: leaderboard,
            total: leaderboard.length
        }),
    };
}

async function handleGetMapStats(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const mapStats = await getMapStats();

    // Collect all unique map IDs across game modes
    const allMaps = [...mapStats.wingman, ...mapStats.threev3, ...mapStats.fivev5];
    const uniqueMapIds = [...new Set(allMaps.map(m => m.mapId))];

    // Fetch map names from Steam API (same pattern as getMatchHistory)
    const mapDetails = new Map<string, { name: string; thumbnailUrl: string }>();

    try {
        const steamApiKey = await getSsmParameter('/unencrypted/SteamApiKey');

        // Fetch all map details in parallel
        const mapPromises = uniqueMapIds.map(async (mapId) => {
            try {
                const mapInfo = await getWorkshopMapInfo(mapId, steamApiKey);
                if (mapInfo) {
                    mapDetails.set(mapId, {
                        name: mapInfo.name,
                        thumbnailUrl: mapInfo.thumbnailUrl
                    });
                }
            } catch (error) {
                console.error(`Failed to fetch map info for ${mapId}:`, error);
                mapDetails.set(mapId, {
                    name: `Workshop Map ${mapId}`,
                    thumbnailUrl: ''
                });
            }
        });

        await Promise.all(mapPromises);
    } catch (error) {
        console.error('Failed to fetch Steam API key or map details:', error);
        // Fallback to placeholder names
        uniqueMapIds.forEach(mapId => {
            mapDetails.set(mapId, {
                name: `Workshop Map ${mapId}`,
                thumbnailUrl: ''
            });
        });
    }

    // Helper to map array with real names
    const mapArray = (arr: any[]) => arr.map(m => {
        const details = mapDetails.get(m.mapId);
        return {
            id: m.mapId,
            name: details?.name || `Workshop Map ${m.mapId}`,
            thumbnailUrl: details?.thumbnailUrl || '',
            totalGames: m.gamesPlayed,
            totalRounds: m.totalRounds
        };
    });

    const response = {
        wingman: mapArray(mapStats.wingman),
        threev3: mapArray(mapStats.threev3),
        fivev5: mapArray(mapStats.fivev5)
    };

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify(response),
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

    // Get user data and stats in parallel
    const [user, stats] = await Promise.all([
        getUser(steamId),
        getUserProfileStats(steamId)
    ]);

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
            avatarUrl: user.avatar,
            countryCode: user.country_code,
            stateCode: user.state_code,
            currentElo: user.current_elo || 1000,
            stats: stats || []
        }),
    };
}
