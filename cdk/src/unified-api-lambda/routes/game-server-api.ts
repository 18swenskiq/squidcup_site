/**
 * Game Server API Routes - Called by game servers
 * 
 * Routes:
 * - POST /api/matches          - Initialize a match (init-match-lambda)
 * - POST /api/matches/{matchId}/end - Finalize a match (finalize-match-lambda)
 * - POST /api/matches/{matchId}/maps/{mapNumber}/end - End a map (end-map-lambda)
 * - PUT  /api/matches/{matchId}/maps/{mapNumber}/scores - Update map scores (update-map-scores-lambda)
 * - PUT  /api/matches/{matchId}/maps/{mapNumber}/players - Update player stats (update-player-stats-lambda)
 * 
 * Authentication: IP-based (game servers only)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    isAuthorizedServer,
    createServerAuthErrorResponse,
    extractSourceIp,
    initMatchStats,
    finalizeMatch,
    finalizeMap,
    upsertPlayerStats,
    updateMapScores as updateMapScoresDb,
    InitMatchRequest,
    EndMatchRequest,
    EndMapRequest,
    UpdatePlayersRequest,
    UpdateMapScoresRequest,
} from '@squidcup/shared-lambda-utils';

export async function handleGameServerApi(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const path = event.path;
    const method = event.httpMethod;

    // IP-based authentication
    const sourceIp = extractSourceIp(event);
    console.log('[GameServerAPI] Request from IP:', sourceIp);

    if (!sourceIp) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Could not determine source IP' }),
        };
    }

    const authResult = await isAuthorizedServer(sourceIp);
    if (!authResult.authorized) {
        console.log(`[GameServerAPI] Unauthorized IP: ${sourceIp}`);
        return createServerAuthErrorResponse();
    }

    console.log(`[GameServerAPI] Authorized server: ${authResult.serverId}`);

    try {
        // POST /api/matches — Initialize a match
        if (method === 'POST' && path === '/api/matches') {
            return await handleInitMatch(event);
        }

        // POST /api/matches/{matchId}/end — Finalize a match
        const matchEndMatch = path.match(/^\/api\/matches\/(\d+)\/end$/);
        if (method === 'POST' && matchEndMatch) {
            const matchId = parseInt(matchEndMatch[1], 10);
            return await handleFinalizeMatch(event, matchId);
        }

        // POST /api/matches/{matchId}/maps/{mapNumber}/end — End a map
        const mapEndMatch = path.match(/^\/api\/matches\/(\d+)\/maps\/(\d+)\/end$/);
        if (method === 'POST' && mapEndMatch) {
            const matchId = parseInt(mapEndMatch[1], 10);
            const mapNumber = parseInt(mapEndMatch[2], 10);
            return await handleEndMap(event, matchId, mapNumber);
        }

        // PUT /api/matches/{matchId}/maps/{mapNumber}/scores — Update map scores
        const mapScoresMatch = path.match(/^\/api\/matches\/(\d+)\/maps\/(\d+)\/scores$/);
        if (method === 'PUT' && mapScoresMatch) {
            const matchId = parseInt(mapScoresMatch[1], 10);
            const mapNumber = parseInt(mapScoresMatch[2], 10);
            return await handleUpdateMapScores(event, matchId, mapNumber);
        }

        // PUT /api/matches/{matchId}/maps/{mapNumber}/players — Update player stats (batch)
        const mapPlayersMatch = path.match(/^\/api\/matches\/(\d+)\/maps\/(\d+)\/players$/);
        if (method === 'PUT' && mapPlayersMatch) {
            const matchId = parseInt(mapPlayersMatch[1], 10);
            const mapNumber = parseInt(mapPlayersMatch[2], 10);
            return await handleUpdatePlayerStatsBatch(event, matchId, mapNumber);
        }

        return {
            statusCode: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Game server API endpoint not found' }),
        };
    } catch (error) {
        console.error('[GameServerAPI] Error:', error);
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

// ─── POST /api/matches — Init Match ──────────────────────────────────────────

async function handleInitMatch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const requestBody: InitMatchRequest = JSON.parse(event.body || '{}');

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

    // Use source IP for server_ip if not provided
    if (!requestBody.serverIp) {
        requestBody.serverIp = extractSourceIp(event) || '';
    }

    console.log('[GameServerAPI] Initializing match:', requestBody);

    const matchId = await initMatchStats(requestBody);

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, matchId }),
    };
}

// ─── POST /api/matches/{matchId}/end — Finalize Match ────────────────────────

async function handleFinalizeMatch(
    event: APIGatewayProxyEvent,
    matchId: number
): Promise<APIGatewayProxyResult> {
    if (isNaN(matchId)) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid matchId in path' }),
        };
    }

    const requestBody: EndMatchRequest = JSON.parse(event.body || '{}');

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

    console.log(`[GameServerAPI] Finalizing match ${matchId}`);

    await finalizeMatch(matchId, requestBody);

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
    };
}

// ─── POST /api/matches/{matchId}/maps/{mapNumber}/end — End Map ──────────────

async function handleEndMap(
    event: APIGatewayProxyEvent,
    matchId: number,
    mapNumber: number
): Promise<APIGatewayProxyResult> {
    if (isNaN(matchId) || isNaN(mapNumber)) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid matchId or mapNumber in path' }),
        };
    }

    const requestBody: EndMapRequest = JSON.parse(event.body || '{}');

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

    console.log(`[GameServerAPI] Ending map ${mapNumber} for match ${matchId}`);

    await finalizeMap(matchId, mapNumber, requestBody);

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
    };
}

// ─── PUT /api/matches/{matchId}/maps/{mapNumber}/scores — Update Map Scores ──

async function handleUpdateMapScores(
    event: APIGatewayProxyEvent,
    matchId: number,
    mapNumber: number
): Promise<APIGatewayProxyResult> {
    if (isNaN(matchId) || isNaN(mapNumber)) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid matchId or mapNumber in path' }),
        };
    }

    const requestBody: UpdateMapScoresRequest = JSON.parse(event.body || '{}');

    if (requestBody.team1Score === undefined || requestBody.team2Score === undefined) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Missing required fields: team1Score, team2Score'
            }),
        };
    }

    console.log(`[GameServerAPI] Updating scores for match ${matchId} map ${mapNumber}`);

    await updateMapScoresDb(matchId, mapNumber, requestBody.team1Score, requestBody.team2Score);

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
    };
}

// ─── PUT /api/matches/{matchId}/maps/{mapNumber}/players — Update Player Stats

async function handleUpdatePlayerStatsBatch(
    event: APIGatewayProxyEvent,
    matchId: number,
    mapNumber: number
): Promise<APIGatewayProxyResult> {
    if (isNaN(matchId) || isNaN(mapNumber)) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid matchId or mapNumber in path' }),
        };
    }

    const requestBody: UpdatePlayersRequest = JSON.parse(event.body || '{}');

    if (!requestBody.players || !Array.isArray(requestBody.players) || requestBody.players.length === 0) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Missing or empty players array'
            }),
        };
    }

    console.log(`[GameServerAPI] Updating player stats for match ${matchId} map ${mapNumber}`);

    const playersUpdated = await upsertPlayerStats(matchId, mapNumber, requestBody.players);

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, playersUpdated }),
    };
}
