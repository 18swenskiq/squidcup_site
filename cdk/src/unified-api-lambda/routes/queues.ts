/**
 * Queues Routes
 * 
 * Routes:
 * - POST /startQueue - Start a new queue
 * - GET /userQueue - Get user's current queue/lobby status
 * - POST /joinQueue - Join an existing queue
 * - POST /leaveQueue - Leave a queue
 * - GET /activeQueues - Get all active queues
 * - GET /queueHistory - Get queue history for a player
 * - POST /queueCleanup - Cleanup stale queues (EventBridge)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import {
    getSession,
    createQueue,
    addPlayerToGame,
    createGameTeam,
    storeQueueHistoryEvent,
    createCorsHeaders,
    getMaxPlayersForGamemode,
    extractSteamIdFromOpenId,
    isUserBanned,
    getSsmParameter,
    getUserCompleteStatus,
    getUserActiveQueue,
    removePlayerFromQueue,
    updateQueue,
    getQueueWithPlayers,
    getQueue,
    getActiveGamesWithDetails,
    getUserQueueHistory
} from '@squidcup/shared-lambda-utils';

export async function handleQueues(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const path = event.path;
    const method = event.httpMethod;

    try {
        // POST /startQueue
        if (method === 'POST' && path === '/startQueue') {
            return await handleStartQueue(event);
        }

        // GET /userQueue
        if (method === 'GET' && path === '/userQueue') {
            return await handleGetUserQueue(event);
        }

        // POST /joinQueue
        if (method === 'POST' && path === '/joinQueue') {
            return await handleJoinQueue(event);
        }

        // POST /leaveQueue
        if (method === 'POST' && path === '/leaveQueue') {
            return await handleLeaveQueue(event);
        }

        // GET /activeQueues
        if (method === 'GET' && path === '/activeQueues') {
            return await handleGetActiveQueues(event);
        }

        // GET /queueHistory
        if (method === 'GET' && path.startsWith('/queueHistory')) {
            return await handleGetQueueHistory(event);
        }

        // POST /queueCleanup - EventBridge triggered
        if (path === '/queueCleanup') {
            return await handleQueueCleanup(event);
        }

        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Queue endpoint not found' }),
        };
    } catch (error) {
        console.error('[Queues] Error:', error);
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

async function handleStartQueue(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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

    const hostSteamId = extractSteamIdFromOpenId(session.steamId);

    // Check if user is banned
    const isBanned = await isUserBanned(hostSteamId);
    if (isBanned) {
        return {
            statusCode: 403,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'You are temporarily banned from creating queues' }),
        };
    }

    const queueData = JSON.parse(event.body || '{}');
    const { gameMode, mapSelectionMode, server, password, ranked, sendWebhook } = queueData;

    if (!gameMode || !mapSelectionMode || !server) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Missing required fields: gameMode, mapSelectionMode, server' }),
        };
    }

    const gameId = crypto.randomUUID();
    const now = new Date();

    await createQueue({
        id: gameId,
        gameMode: gameMode,
        mapSelectionMode: mapSelectionMode,
        hostSteamId: hostSteamId,
        serverId: server,
        password: password || null,
        ranked: ranked === true,
        startTime: now,
        maxPlayers: getMaxPlayersForGamemode(gameMode)
    });

    // Create teams for the game
    const team1Id = await createGameTeam(gameId, 1, 'Team 1');
    await createGameTeam(gameId, 2, 'Team 2');

    // Add the host as a player
    await addPlayerToGame(gameId, {
        steamId: hostSteamId,
        teamId: team1Id,
        joinTime: now
    });

    // Store queue history event
    await storeQueueHistoryEvent({
        id: crypto.randomUUID(),
        gameId: gameId,
        playerSteamId: hostSteamId,
        eventType: 'join',
        eventData: { gameMode, mapSelectionMode, serverId: server, ranked, isHost: true }
    });

    // Send Discord webhook if requested
    if (sendWebhook === true) {
        await sendDiscordWebhook(gameMode, getMaxPlayersForGamemode(gameMode));
    }

    return {
        statusCode: 201,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            id: gameId,
            hostSteamId,
            gameMode,
            mapSelectionMode,
            serverId: server,
            password: password || undefined,
            ranked: ranked === true,
            startTime: now.toISOString(),
            joiners: [],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
        }),
    };
}

async function handleGetUserQueue(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    if (!authHeader) {
        return {
            statusCode: 401,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'No session token provided' }),
        };
    }

    const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const userStatus = await getUserCompleteStatus(sessionToken);

    if (!userStatus.session) {
        return {
            statusCode: 401,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Invalid or expired session' }),
        };
    }

    // Check if user is in a lobby
    if (userStatus.lobby) {
        const lobby = userStatus.lobby;
        const enrichedPlayers = lobby.players.map((player: any) => ({
            steamId: player.player_steam_id,
            team: player.team_id || 'unassigned',
            joinedAt: player.joined_at,
            mapSelection: player.map_selection,
            hasSelectedMap: !!player.map_selection,
            name: lobby.playerNames[player.player_steam_id] || `Player ${player.player_steam_id.slice(-4)}`,
            avatar: lobby.playerAvatars ? lobby.playerAvatars[player.player_steam_id] : null,
            currentElo: lobby.playerElos ? lobby.playerElos[player.player_steam_id] : 1000
        }));

        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                inLobby: true,
                isHost: lobby.isHost,
                lobby: {
                    id: lobby.id,
                    hostSteamId: lobby.host_steam_id,
                    hostName: lobby.playerNames[lobby.host_steam_id] || `Player ${lobby.host_steam_id.slice(-4)}`,
                    gameMode: lobby.game_mode,
                    mapSelectionMode: lobby.map_selection_mode || 'host-pick',
                    serverId: lobby.server_id,
                    hasPassword: false,
                    ranked: !!lobby.ranked,
                    status: lobby.status,
                    players: enrichedPlayers,
                    teams: lobby.teams || [],
                    mapSelectionComplete: lobby.map ? true : false,
                    selectedMap: lobby.map,
                    mapAnimSelectStartTime: lobby.map_anim_select_start_time,
                    createdAt: lobby.created_at,
                    updatedAt: lobby.updated_at,
                    ...((lobby as any).server && { server: (lobby as any).server })
                }
            }),
        };
    }

    // Check if user is in a queue
    if (userStatus.queue) {
        const queue = userStatus.queue;
        const enrichedJoiners = queue.players
            .filter((player: any) => player.player_steam_id !== queue.host_steam_id)
            .map((player: any) => ({
                steamId: player.player_steam_id,
                joinTime: player.joined_at,
                mapSelection: player.map_selection,
                hasSelectedMap: !!player.map_selection,
                name: queue.playerNames[player.player_steam_id] || `Player ${player.player_steam_id.slice(-4)}`,
                avatar: queue.playerAvatars ? queue.playerAvatars[player.player_steam_id] : null,
                currentElo: queue.playerElos ? queue.playerElos[player.player_steam_id] : 1000
            }));

        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                inQueue: true,
                isHost: queue.isHost,
                queue: {
                    id: queue.id,
                    hostSteamId: queue.host_steam_id,
                    hostName: queue.playerNames[queue.host_steam_id] || `Player ${queue.host_steam_id.slice(-4)}`,
                    gameMode: queue.game_mode,
                    mapSelectionMode: queue.map_selection_mode,
                    serverId: queue.server_id,
                    hasPassword: !!queue.password,
                    ranked: !!queue.ranked,
                    startTime: queue.start_time,
                    joiners: enrichedJoiners,
                    mapSelectionComplete: queue.map ? true : false,
                    selectedMap: queue.map,
                    createdAt: queue.created_at,
                    updatedAt: queue.updated_at,
                }
            }),
        };
    }

    // User is not in any queue or lobby
    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            inQueue: false,
            inLobby: false,
            isHost: false,
            queue: null,
            lobby: null,
        }),
    };
}

async function handleJoinQueue(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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

    // Check if user is banned
    const isBanned = await isUserBanned(userSteamId);
    if (isBanned) {
        return {
            statusCode: 403,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'You are temporarily banned from joining queues' }),
        };
    }

    const { queueId, password } = JSON.parse(event.body || '{}');

    if (!queueId) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Queue ID is required' }),
        };
    }

    // Get queue data
    const queueData = await getQueueWithPlayers(queueId);

    if (!queueData) {
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Queue not found' }),
        };
    }

    // Check password if queue is password protected
    if (queueData.password && queueData.password !== password) {
        return {
            statusCode: 403,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Invalid queue password' }),
        };
    }

    // Check if queue is full
    const maxPlayers = getMaxPlayersForGamemode(queueData.game_mode);
    if (queueData.players && queueData.players.length >= maxPlayers) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Queue is full' }),
        };
    }

    // Check if user is already in the queue
    const alreadyInQueue = queueData.players?.some((p: any) => p.player_steam_id === userSteamId);
    if (alreadyInQueue) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'You are already in this queue' }),
        };
    }

    const now = new Date();

    // Add player to queue (assign to team 2 by default for joiners)
    await addPlayerToGame(queueId, {
        steamId: userSteamId,
        teamId: undefined, // Will be assigned by team balancing
        joinTime: now
    });

    // Store queue history event
    await storeQueueHistoryEvent({
        id: crypto.randomUUID(),
        gameId: queueId,
        playerSteamId: userSteamId,
        eventType: 'join',
        eventData: {
            gameMode: queueData.game_mode,
            mapSelectionMode: queueData.map_selection_mode,
            isHost: false
        }
    });

    // Update queue player count
    await updateQueue(queueId, {
        currentPlayers: (queueData.players?.length || 0) + 1
    });

    // Check if queue is now full and trigger lobby creation
    const newPlayerCount = (queueData.players?.length || 0) + 1;
    if (newPlayerCount >= maxPlayers) {
        // Invoke lobby creation internally
        const { handleLobbies } = await import('./lobbies');
        const lobbyEvent = {
            ...event,
            path: '/createLobby',
            httpMethod: 'POST',
            body: JSON.stringify({ queueId })
        };
        await handleLobbies(lobbyEvent as APIGatewayProxyEvent);
    }

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            message: 'Successfully joined queue',
            queueId
        }),
    };
}

async function handleLeaveQueue(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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

    const userSteamId = session.steamId;

    // Find the user's active queue
    const userQueue = await getUserActiveQueue(userSteamId);
    if (!userQueue) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'User is not in any queue' }),
        };
    }

    const isHost = userQueue.isHost || userQueue.host_steam_id === userSteamId;

    if (isHost) {
        // User is the host - disband the entire queue
        await storeQueueHistoryEvent({
            id: crypto.randomUUID(),
            gameId: userQueue.id,
            playerSteamId: userSteamId,
            eventType: 'disband',
            eventData: {
                gameMode: userQueue.game_mode,
                mapSelectionMode: userQueue.map_selection_mode,
                joinerCount: userQueue.players ? userQueue.players.length : 0,
            }
        });

        // Store disband events for all players
        if (userQueue.players && userQueue.players.length > 0) {
            for (const player of userQueue.players) {
                if (player.player_steam_id !== userSteamId) {
                    await storeQueueHistoryEvent({
                        id: crypto.randomUUID(),
                        gameId: userQueue.id,
                        playerSteamId: player.player_steam_id,
                        eventType: 'disband',
                        eventData: {
                            gameMode: userQueue.game_mode,
                            mapSelectionMode: userQueue.map_selection_mode,
                            disbandedByHost: userSteamId,
                        }
                    });
                }
            }
        }

        await updateQueue(userQueue.id, { status: 'cancelled' });

        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                action: 'disbanded',
                message: 'Queue disbanded successfully',
                wasHost: true,
            }),
        };
    } else {
        // User is a joiner - remove them from the queue
        await storeQueueHistoryEvent({
            id: crypto.randomUUID(),
            gameId: userQueue.id,
            playerSteamId: userSteamId,
            eventType: 'leave',
            eventData: {
                gameMode: userQueue.game_mode,
                mapSelectionMode: userQueue.map_selection_mode,
                hostSteamId: userQueue.host_steam_id,
            }
        });

        await removePlayerFromQueue(userQueue.id, userSteamId);

        const newPlayerCount = Math.max(0, (userQueue.current_players || 1) - 1);
        await updateQueue(userQueue.id, { currentPlayers: newPlayerCount });

        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                action: 'left',
                message: 'Successfully left the queue',
                wasHost: false,
            }),
        };
    }
}

async function handleGetActiveQueues(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const queues = await getActiveGamesWithDetails();

    const mappedQueues = queues.map((q: any) => ({
        ...q,
        host: q.hostName,
        server: q.serverName
    }));

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({ queues: mappedQueues }),
    };
}

async function handleGetQueueHistory(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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
    const history = await getUserQueueHistory(userSteamId);

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify(history),
    };
}

async function handleQueueCleanup(event: any): Promise<APIGatewayProxyResult> {
    console.log('[QueueCleanup] Triggered by EventBridge');

    // This is called by EventBridge to cleanup stale queues
    // Implementation would mark old queues as expired

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({ message: 'Queue cleanup completed' }),
    };
}

async function sendDiscordWebhook(gameMode: string, maxPlayers: number): Promise<void> {
    try {
        const webhookUrl = await getSsmParameter('/squidcup/webhook_url');
        const playersNeeded = maxPlayers - 1;

        const payload = {
            embeds: [{
                title: "New Squidcup Queue Started",
                url: "https://squidcup.spkymnr.xyz/play",
                description: `A new **${gameMode}** queue has been created!`,
                fields: [
                    { name: "Game Mode", value: gameMode, inline: true },
                    { name: "Players Needed", value: `${playersNeeded} more players`, inline: true }
                ],
                color: 0x2196F3,
                timestamp: new Date().toISOString(),
                footer: { text: "Click the title to join!" }
            }]
        };

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error('Discord webhook failed:', response.status);
        }
    } catch (error) {
        console.error('Error sending Discord webhook:', error);
    }
}
