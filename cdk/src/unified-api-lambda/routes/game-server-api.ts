/**
 * Game Server API Routes - Called by game servers
 * 
 * Routes:
 * - POST /api/matches/init - Initialize a match
 * - POST /api/matches/{matchId}/map/{mapNumber}/finalize - Finalize a map
 * - POST /api/matches/{matchId}/players/{steamId}/stats - Update player stats
 * 
 * Authentication: IP-based (game servers only)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    createCorsHeaders,
    getGameByMatchNumber,
    updateGame,
    getServers,
    processMatchEloChanges,
    getGamePlayersWithElo,
    updatePlayerElo,
    calculateTeamAverageElo
} from '@squidcup/shared-lambda-utils';

const ALLOWED_SERVER_IPS = process.env.ALLOWED_SERVER_IPS?.split(',') || [];

export async function handleGameServerApi(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const path = event.path;
    const method = event.httpMethod;

    // IP-based authentication for game server APIs
    const sourceIp = event.requestContext?.identity?.sourceIp;
    console.log('[GameServerAPI] Request from IP:', sourceIp);

    // Check if the request is from an allowed server IP
    const servers = await getServers();
    const serverFromIp = servers.find(s => s.ip === sourceIp);

    if (!serverFromIp && ALLOWED_SERVER_IPS.length > 0 && !ALLOWED_SERVER_IPS.includes(sourceIp || '')) {
        console.warn('[GameServerAPI] Unauthorized IP:', sourceIp);
        return {
            statusCode: 403,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Unauthorized: Unknown server IP' }),
        };
    }

    try {
        // POST /api/matches/init
        if (method === 'POST' && path === '/api/matches/init') {
            return await handleInitMatch(event);
        }

        // POST /api/matches/{matchId}/map/{mapNumber}/finalize
        const mapFinalizeMatch = path.match(/^\/api\/matches\/(\d+)\/map\/(\d+)\/finalize$/);
        if (method === 'POST' && mapFinalizeMatch) {
            const matchId = mapFinalizeMatch[1];
            const mapNumber = mapFinalizeMatch[2];
            return await handleFinalizeMap(event, matchId, mapNumber);
        }

        // POST /api/matches/{matchId}/players/{steamId}/stats
        const playerStatsMatch = path.match(/^\/api\/matches\/(\d+)\/players\/([^/]+)\/stats$/);
        if (method === 'POST' && playerStatsMatch) {
            const matchId = playerStatsMatch[1];
            const steamId = playerStatsMatch[2];
            return await handleUpdatePlayerStats(event, matchId, steamId);
        }

        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Game server API endpoint not found' }),
        };
    } catch (error) {
        console.error('[GameServerAPI] Error:', error);
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

async function handleInitMatch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const { matchId, gameMode, map, team1, team2 } = JSON.parse(event.body || '{}');

    if (!matchId) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Match ID is required' }),
        };
    }

    console.log('[GameServerAPI] Initializing match:', matchId);

    // Find the game by match number
    const game = await getGameByMatchNumber(String(matchId));
    if (!game) {
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Game not found' }),
        };
    }

    // Update game with match init data
    await updateGame(game.id, {
        status: 'in_progress',
        map: map || game.map
    });

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            message: 'Match initialized',
            matchId,
            gameId: game.id
        }),
    };
}

async function handleFinalizeMap(
    event: APIGatewayProxyEvent,
    matchId: string,
    mapNumber: string
): Promise<APIGatewayProxyResult> {
    const {
        winningTeam,
        team1Score,
        team2Score
    } = JSON.parse(event.body || '{}');

    console.log('[GameServerAPI] Finalizing map', mapNumber, 'for match:', matchId);

    // Find the game by match number
    const game = await getGameByMatchNumber(String(matchId));
    if (!game) {
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Game not found' }),
        };
    }

    // Calculate and apply ELO changes for ranked games
    if (game.ranked) {
        try {
            const playersWithElo = await getGamePlayersWithElo(game.id);

            const team1Players = playersWithElo.filter(p => p.team_number === 1);
            const team2Players = playersWithElo.filter(p => p.team_number === 2);

            const team1Data = {
                players: team1Players.map(p => ({ steamId: p.player_steam_id, currentElo: p.current_elo })),
                averageElo: calculateTeamAverageElo(team1Players.map(p => ({ steamId: p.player_steam_id, currentElo: p.current_elo })))
            };

            const team2Data = {
                players: team2Players.map(p => ({ steamId: p.player_steam_id, currentElo: p.current_elo })),
                averageElo: calculateTeamAverageElo(team2Players.map(p => ({ steamId: p.player_steam_id, currentElo: p.current_elo })))
            };

            const winningTeamData = winningTeam === 1 ? team1Data : team2Data;
            const losingTeamData = winningTeam === 1 ? team2Data : team1Data;

            const eloResults = processMatchEloChanges(winningTeamData, losingTeamData);

            // Apply ELO changes
            for (const result of [...eloResults.winningTeamResults, ...eloResults.losingTeamResults]) {
                await updatePlayerElo(result.steamId, result.newElo);
            }

            console.log('[GameServerAPI] ELO changes applied');
        } catch (error) {
            console.error('[GameServerAPI] ELO calculation error:', error);
        }
    }

    // Update game status to completed (match results logged above)
    console.log('[GameServerAPI] Match finalized - Winner:', winningTeam, 'Score:', team1Score, '-', team2Score);
    await updateGame(game.id, {
        status: 'completed'
    });

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            message: 'Map finalized',
            matchId,
            mapNumber,
            winner: winningTeam
        }),
    };
}

async function handleUpdatePlayerStats(
    event: APIGatewayProxyEvent,
    matchId: string,
    steamId: string
): Promise<APIGatewayProxyResult> {
    const stats = JSON.parse(event.body || '{}');

    console.log('[GameServerAPI] Updating stats for player', steamId, 'in match:', matchId);

    // Find the game by match number
    const game = await getGameByMatchNumber(String(matchId));
    if (!game) {
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Game not found' }),
        };
    }

    // Stats are typically handled by the game server plugin via dedicated stats API
    // This endpoint can be used for manual updates if needed
    console.log('[GameServerAPI] Stats received:', stats);

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            message: 'Player stats received',
            matchId,
            steamId
        }),
    };
}
