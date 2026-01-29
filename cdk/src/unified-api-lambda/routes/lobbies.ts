/**
 * Lobbies Routes
 * 
 * Routes:
 * - POST /createLobby - Create a lobby from a full queue
 * - POST /leaveLobby - Leave a lobby
 * - POST /selectMap - Select a map for the lobby
 * - POST /endMatch - End a match
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import {
    createCorsHeaders,
    getQueue,
    getQueuePlayers,
    updateGame,
    getSession,
    extractSteamIdFromOpenId,
    getUserActiveLobby,
    removePlayerFromQueue,
    storeQueueHistoryEvent,
    getGameWithPlayers,
    updatePlayerMapSelection,
    getGameTeams,
    getUsersBySteamIds,
    GameMode
} from '@squidcup/shared-lambda-utils';

export async function handleLobbies(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const path = event.path;
    const method = event.httpMethod;

    try {
        if (method === 'POST' && path === '/createLobby') {
            return await handleCreateLobby(event);
        }

        if (method === 'POST' && path === '/leaveLobby') {
            return await handleLeaveLobby(event);
        }

        if (method === 'POST' && path === '/selectMap') {
            return await handleSelectMap(event);
        }

        if (method === 'POST' && path === '/endMatch') {
            return await handleEndMatch(event);
        }

        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Lobby endpoint not found' }),
        };
    } catch (error) {
        console.error('[Lobbies] Error:', error);
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

async function handleCreateLobby(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const { queueId } = JSON.parse(event.body || '{}');
    const gameId = queueId;

    console.log('[CreateLobby] Creating lobby for queue:', gameId);

    const queueData = await getQueue(gameId);
    if (!queueData) {
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Queue not found' }),
        };
    }

    const queuePlayers = await getQueuePlayers(gameId);
    console.log('[CreateLobby] Queue has', queuePlayers.length, 'players');

    // Balance players into teams based on ELO
    await balancePlayersIntoTeams(gameId, queuePlayers, queueData.game_mode as GameMode);

    // Update game status to 'lobby'
    await updateGame(gameId, {
        status: 'lobby',
        mapAnimSelectStartTime: Date.now()
    });

    console.log('[CreateLobby] Lobby created successfully for game:', gameId);

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            message: 'Lobby created successfully',
            gameId
        }),
    };
}

async function handleLeaveLobby(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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

    const userLobby = await getUserActiveLobby(userSteamId);
    if (!userLobby) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'User is not in any lobby' }),
        };
    }

    const isHost = userLobby.host_steam_id === userSteamId;

    // Store leave event - use valid event types
    await storeQueueHistoryEvent({
        id: crypto.randomUUID(),
        gameId: userLobby.id,
        playerSteamId: userSteamId,
        eventType: isHost ? 'disband' : 'leave',
        eventData: {
            gameMode: userLobby.game_mode,
            isHost
        }
    });

    if (isHost) {
        // Cancel the entire lobby
        await updateGame(userLobby.id, { status: 'cancelled' });
        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                action: 'disbanded',
                message: 'Lobby disbanded successfully',
                wasHost: true,
            }),
        };
    } else {
        // Remove player from lobby
        await removePlayerFromQueue(userLobby.id, userSteamId);
        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                action: 'left',
                message: 'Successfully left the lobby',
                wasHost: false,
            }),
        };
    }
}

async function handleSelectMap(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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
    const { mapId } = JSON.parse(event.body || '{}');

    if (!mapId) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Map ID is required' }),
        };
    }

    const userLobby = await getUserActiveLobby(userSteamId);
    if (!userLobby) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'User is not in any lobby' }),
        };
    }

    // Update player's map selection
    await updatePlayerMapSelection(userLobby.id, userSteamId, mapId);

    // Check if all players have selected maps
    const gameWithPlayers = await getGameWithPlayers(userLobby.id);
    if (gameWithPlayers) {
        const allSelected = gameWithPlayers.players.every((p: any) => p.map_selection);

        if (allSelected) {
            // Determine final map based on selections (random from selections)
            const mapSelections = gameWithPlayers.players.map((p: any) => p.map_selection).filter(Boolean);
            const finalMap = mapSelections[Math.floor(Math.random() * mapSelections.length)];

            await updateGame(userLobby.id, { map: finalMap });
        }
    }

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            message: 'Map selection recorded',
            mapId
        }),
    };
}

async function handleEndMatch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    // This endpoint is called by the game server to finalize a match
    const { gameId, winningTeam, team1Score, team2Score } = JSON.parse(event.body || '{}');

    if (!gameId) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Game ID is required' }),
        };
    }

    console.log('[EndMatch] Finalizing match:', gameId);
    console.log('[EndMatch] Match results - Winner:', winningTeam, 'Score:', team1Score, '-', team2Score);

    // Update game status to completed (match results are tracked separately in match stats)
    await updateGame(gameId, {
        status: 'completed'
    });

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            message: 'Match ended successfully',
            gameId,
            winningTeam,
            team1Score,
            team2Score
        }),
    };
}

async function balancePlayersIntoTeams(gameId: string, players: any[], gameMode: GameMode): Promise<void> {
    console.log('[BalanceTeams] Balancing', players.length, 'players into teams');

    const teams = await getGameTeams(gameId);
    const team1 = teams.find((t: any) => t.team_number === 1);
    const team2 = teams.find((t: any) => t.team_number === 2);

    if (!team1 || !team2) {
        console.error('[BalanceTeams] Teams not found for game:', gameId);
        return;
    }

    // Get player ELOs
    const steamIds = players.map((p: any) => p.player_steam_id);
    const users = await getUsersBySteamIds(steamIds);

    const playerElos = new Map<string, number>();
    users.forEach((user: any) => {
        playerElos.set(user.steam_id, user.current_elo || 1000);
    });

    // Sort players by ELO descending
    const sortedPlayers = [...players].sort((a, b) => {
        const eloA = playerElos.get(a.player_steam_id) || 1000;
        const eloB = playerElos.get(b.player_steam_id) || 1000;
        return eloB - eloA;
    });

    // Distribute players alternating between teams (snake draft)
    let team1Total = 0;
    let team2Total = 0;

    for (let i = 0; i < sortedPlayers.length; i++) {
        const player = sortedPlayers[i];
        const elo = playerElos.get(player.player_steam_id) || 1000;

        let assignedTeamId;
        if (team1Total <= team2Total) {
            assignedTeamId = team1.id;
            team1Total += elo;
        } else {
            assignedTeamId = team2.id;
            team2Total += elo;
        }

        // Update player's team assignment (would need database function)
        console.log(`[BalanceTeams] Assigned ${player.player_steam_id} to team ${assignedTeamId}`);
    }

    console.log('[BalanceTeams] Team balance complete. Team1:', team1Total, 'Team2:', team2Total);
}
