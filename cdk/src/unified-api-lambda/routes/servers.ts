/**
 * Servers Routes
 * 
 * Routes:
 * - GET /servers - Get all servers
 * - PUT /servers/{id} - Update server (admin only)
 * - POST /addServer - Add a new server (admin only)
 * - POST /setupServer - Setup server for a game
 * - DELETE /deleteServer/{id} - Delete a server (admin only)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
    getSession,
    getUser,
    getServers,
    addServer,
    updateServer,
    deleteServer,
    createCorsHeaders,
    extractSteamIdFromOpenId,
    getMaxPlayersForGamemode,
    GameServer,
    sendRconCommand,
    getServerInfoForGame,
    getGameWithPlayers,
    getGameTeams,
    getUsersBySteamIds,
    updateGame
} from '@squidcup/shared-lambda-utils';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

export async function handleServers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const path = event.path;
    const method = event.httpMethod;

    try {
        // GET /servers - Get all servers
        if (method === 'GET' && path === '/servers') {
            return await handleGetServers(event);
        }

        // PUT /servers/{id} - Update server
        if (method === 'PUT' && path.startsWith('/servers/')) {
            const serverId = path.split('/')[2];
            return await handleUpdateServer(event, serverId);
        }

        // POST /addServer - Add a new server
        if (method === 'POST' && path === '/addServer') {
            return await handleAddServer(event);
        }

        // POST /setupServer - Setup server for a game
        if (method === 'POST' && path === '/setupServer') {
            return await handleSetupServer(event);
        }

        // DELETE /deleteServer/{id} - Delete a server
        if (method === 'DELETE' && path.startsWith('/deleteServer/')) {
            const serverId = path.split('/')[2];
            return await handleDeleteServer(event, serverId);
        }

        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Server endpoint not found' }),
        };
    } catch (error) {
        console.error('[Servers] Error:', error);
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

async function handleGetServers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const gamemode = event?.queryStringParameters?.gamemode;
    const minPlayers = getMaxPlayersForGamemode(gamemode || '');

    const servers = await getServers(minPlayers);

    const serversResponse: Omit<GameServer, 'rcon_password'>[] = servers.map((server: any) => ({
        id: server.id,
        ip: server.ip,
        port: server.port,
        location: server.location,
        default_password: server.default_password || '',
        max_players: server.max_players,
        nickname: server.nickname,
        created_at: server.created_at,
        updated_at: server.updated_at
    }));

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify(serversResponse),
    };
}

async function handleUpdateServer(event: APIGatewayProxyEvent, serverId: string): Promise<APIGatewayProxyResult> {
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

    if (!user || !user.is_admin) {
        return {
            statusCode: 403,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Admin access required' }),
        };
    }

    const { ip, port, location, rconPassword, defaultPassword, maxPlayers, nickname } = JSON.parse(event.body || '{}');

    if (!ip || !port || !location || !rconPassword || !maxPlayers || !nickname) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Missing required fields' }),
        };
    }

    const serverData = {
        ip,
        port: Number(port),
        location,
        rcon_password: rconPassword,
        default_password: defaultPassword || '',
        max_players: Number(maxPlayers),
        nickname,
    };

    await updateServer(serverId, serverData);

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({ ...serverData, id: serverId, updated_at: new Date().toISOString() }),
    };
}

async function handleAddServer(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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

    const serverData = JSON.parse(event.body || '{}');
    const {
        ip,
        port,
        location,
        rconPassword,
        rcon_password = rconPassword,
        defaultPassword,
        default_password = defaultPassword,
        maxPlayers,
        max_players = maxPlayers,
        nickname
    } = serverData;

    const finalRconPassword = rcon_password || rconPassword;
    const finalDefaultPassword = default_password || defaultPassword;
    const finalMaxPlayers = max_players || maxPlayers;

    if (!ip || !port || !location || !finalRconPassword || !finalMaxPlayers || !nickname) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Missing required fields: ip, port, location, rcon_password, max_players, nickname' }),
        };
    }

    const serverId = crypto.randomUUID();
    const now = new Date().toISOString();

    const server: GameServer = {
        id: serverId,
        ip,
        port: Number(port),
        location,
        rcon_password: finalRconPassword,
        default_password: finalDefaultPassword || '',
        max_players: Number(finalMaxPlayers),
        nickname,
        created_at: now,
        updated_at: now
    };

    try {
        await addServer(server);
        return {
            statusCode: 201,
            headers: createCorsHeaders(),
            body: JSON.stringify(server),
        };
    } catch (error: any) {
        if (error.message?.includes('Duplicate entry') || error.code === 'ER_DUP_ENTRY') {
            return {
                statusCode: 409,
                headers: createCorsHeaders(),
                body: JSON.stringify({ error: 'Server with this IP and port already exists' }),
            };
        }
        throw error;
    }
}

async function handleDeleteServer(event: APIGatewayProxyEvent, serverId: string): Promise<APIGatewayProxyResult> {
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

    try {
        await deleteServer(serverId);
        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({ message: 'Server deleted successfully', serverId }),
        };
    } catch (error: any) {
        if (error.message?.includes('not found')) {
            return {
                statusCode: 404,
                headers: createCorsHeaders(),
                body: JSON.stringify({ error: 'Server not found' }),
            };
        }
        throw error;
    }
}

interface MatchZyConfig {
    matchid: number;
    team1: { name: string; players: Record<string, string>; };
    team2: { name: string; players: Record<string, string>; };
    maplist: string[];
    map_sides: string[];
    players_per_team: number;
    cvars: Record<string, string>;
    match_end_route: string;
    gamemode: string;
}

async function handleSetupServer(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const { gameId } = JSON.parse(event.body || '{}');

    if (!gameId) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'gameId is required' }),
        };
    }

    try {
        const serverInfo = await getServerInfoForGame(gameId);

        if (!serverInfo) {
            return {
                statusCode: 404,
                headers: createCorsHeaders(),
                body: JSON.stringify({ error: 'Server not found for this game' }),
            };
        }

        // Check for CounterStrikeSharp and MatchZy plugin
        const rconResult = await sendRconCommand(
            serverInfo.ip,
            serverInfo.port,
            serverInfo.rcon_password,
            'css_plugins list'
        );

        if (!rconResult.success) {
            return {
                statusCode: 500,
                headers: createCorsHeaders(),
                body: JSON.stringify({
                    error: 'Failed to connect to server via RCON',
                    gameId,
                    rconError: rconResult.error,
                }),
            };
        }

        if (rconResult.response?.includes("Unknown command 'css_plugins'")) {
            return {
                statusCode: 500,
                headers: createCorsHeaders(),
                body: JSON.stringify({ error: 'CounterStrikeSharp is not installed on the server', gameId }),
            };
        }

        if (!rconResult.response?.includes('Squidcup')) {
            return {
                statusCode: 500,
                headers: createCorsHeaders(),
                body: JSON.stringify({ error: 'MatchZy plugin is not loaded on the server', gameId }),
            };
        }

        // Generate and upload MatchZy config
        const configFileUrl = await generateAndUploadMatchZyConfig(gameId, serverInfo);

        // Load the match configuration on the server via RCON
        const loadMatchResult = await sendRconCommand(
            serverInfo.ip,
            serverInfo.port,
            serverInfo.rcon_password,
            `squidcup_loadmatch_url "${configFileUrl}"`
        );

        if (!loadMatchResult.success) {
            return {
                statusCode: 500,
                headers: createCorsHeaders(),
                body: JSON.stringify({
                    error: 'MatchZy config uploaded but failed to load on server',
                    gameId,
                    loadError: loadMatchResult.error,
                }),
            };
        }

        // Update game status to 'in_progress'
        await updateGame(gameId, { status: 'in_progress' });

        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                message: `Server setup completed successfully for game ${gameId}`,
                serverInfo: { id: serverInfo.id, ip: serverInfo.ip, port: serverInfo.port, nickname: serverInfo.nickname },
                configFile: { url: configFileUrl, loaded: true },
            }),
        };
    } catch (error) {
        console.error('[Servers] Setup error:', error);
        return {
            statusCode: 500,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Failed to setup server', gameId }),
        };
    }
}

async function generateAndUploadMatchZyConfig(gameId: string, serverInfo: any): Promise<string> {
    const gameWithPlayers = await getGameWithPlayers(gameId);
    if (!gameWithPlayers) {
        throw new Error(`Game ${gameId} not found`);
    }

    const teams = await getGameTeams(gameId);
    const playerSteamIds = gameWithPlayers.players.map(p => p.player_steam_id);
    const users = await getUsersBySteamIds(playerSteamIds);

    const steamIdToUsername = new Map();
    users.forEach(user => {
        steamIdToUsername.set(user.steam_id, user.username || `Player_${user.steam_id.slice(-4)}`);
    });

    const team1Players: Record<string, string> = {};
    const team2Players: Record<string, string> = {};

    let team1Name = 'Team 1';
    let team2Name = 'Team 2';
    let team1AvgElo = 1000;
    let team2AvgElo = 1000;

    if (teams.length >= 2) {
        const team1 = teams.find(t => t.team_number === 1);
        const team2 = teams.find(t => t.team_number === 2);

        if (team1) { team1Name = team1.team_name; team1AvgElo = Math.round(team1.average_elo); }
        if (team2) { team2Name = team2.team_name; team2AvgElo = Math.round(team2.average_elo); }
    }

    for (const player of gameWithPlayers.players) {
        const username = steamIdToUsername.get(player.player_steam_id) || `Player_${player.player_steam_id.slice(-4)}`;

        if (player.team_id && teams.length > 0) {
            const playerTeam = teams.find(t => t.id === player.team_id);
            if (playerTeam?.team_number === 1) {
                team1Players[player.player_steam_id] = username;
            } else if (playerTeam?.team_number === 2) {
                team2Players[player.player_steam_id] = username;
            } else {
                if (Object.keys(team1Players).length <= Object.keys(team2Players).length) {
                    team1Players[player.player_steam_id] = username;
                } else {
                    team2Players[player.player_steam_id] = username;
                }
            }
        } else {
            if (Object.keys(team1Players).length <= Object.keys(team2Players).length) {
                team1Players[player.player_steam_id] = username;
            } else {
                team2Players[player.player_steam_id] = username;
            }
        }
    }

    const playersPerTeam = Math.max(Object.keys(team1Players).length, Object.keys(team2Players).length);

    const config: MatchZyConfig = {
        matchid: gameWithPlayers.match_number,
        team1: { name: team1Name, players: team1Players },
        team2: { name: team2Name, players: team2Players },
        maplist: [gameWithPlayers.map || 'de_dust2'],
        map_sides: ['team1_ct', 'team2_ct', 'knife'],
        players_per_team: playersPerTeam,
        cvars: {
            hostname: `Squidcup: ${team1Name} (${team1AvgElo}) vs ${team2Name} (${team2AvgElo})`,
            sv_human_autojoin_team: '1'
        },
        gamemode: gameWithPlayers.game_mode,
        match_end_route: `https://9zea3urakj.execute-api.us-east-1.amazonaws.com/prod/endMatch`
    };

    const configJson = JSON.stringify(config, null, 2);
    const bucketName = process.env.GAME_CONFIGS_BUCKET;
    if (!bucketName) {
        throw new Error('GAME_CONFIGS_BUCKET environment variable not set');
    }

    const fileName = `${gameWithPlayers.match_number}_${gameId}.json`;

    await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: configJson,
        ContentType: 'application/json',
        CacheControl: 'no-cache'
    }));

    return `https://${bucketName}.s3.amazonaws.com/${fileName}`;
}
