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
    getLobbyWithPlayers,
    storeLobbyHistoryEvent,
    storeQueueHistoryEvent,
    getGameWithPlayers,
    updatePlayerMapSelection,
    getMapSelectionStatus,
    selectRandomMapFromSelections,
    replaceRandomMapSelections,
    getMapsByGameMode,
    getSsmParameter,
    selectRandomMapFromAvailable,
    getGameTeams,
    getUsersBySteamIds,
    getGamePlayersWithElo,
    getPlayerUsernamesBySteamIds,
    updatePlayerTeam,
    updateTeamName,
    updateTeamAverageElo,
    updatePlayerEloChangePredictions,
    getMaxPlayersForGamemode,
    getGameByMatchNumber,
    getMatchResults,
    getGamePlayersWithTeams,
    updatePlayerElo,
    GameMode
} from '@squidcup/shared-lambda-utils';
import * as ELO from '@squidcup/shared-lambda-utils/dist/elo';
import { TeamEloData } from '@squidcup/shared-lambda-utils/dist/elo';

// Import server setup for direct invocation within unified lambda
import { triggerServerSetupInternal } from './servers';

export async function handleLobbies(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const path = event.path;
    const method = event.httpMethod;

    try {
        if (method === 'POST' && path === '/createLobby') {
            return await handleCreateLobby(event);
        }

        if ((method === 'POST' || method === 'DELETE') && path === '/leaveLobby') {
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

// ─── CREATE LOBBY ────────────────────────────────────────────────────────────

async function handleCreateLobby(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const { queueId } = JSON.parse(event.body || '{}');
    const gameId = queueId;

    console.log('[CreateLobby] Creating lobby for queue:', gameId);

    if (!gameId) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Queue ID is required' }),
        };
    }

    const queueData = await getQueue(gameId);
    if (!queueData) {
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Queue not found' }),
        };
    }

    // Prevent double-conversion
    if (queueData.status !== 'queue') {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Queue has already been processed' }),
        };
    }

    // Check if queue is actually full
    const maxPlayers = getMaxPlayersForGamemode(queueData.game_mode as GameMode);
    if (queueData.current_players < maxPlayers) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Queue is not full yet' }),
        };
    }

    const queuePlayers = await getQueuePlayers(gameId);
    console.log('[CreateLobby] Queue has', queuePlayers.length, 'players');

    // Balance players into teams based on ELO
    if (maxPlayers >= 2) {
        await balancePlayersIntoTeams(gameId, queuePlayers, queueData.game_mode as GameMode);
    }

    // Handle random-map mode: select map immediately
    let selectedMap: string | undefined;
    const mapSelectionMode = queueData.map_selection_mode;

    if (mapSelectionMode === 'random-map') {
        try {
            const steamApiKey = await getSsmParameter('/unencrypted/SteamApiKey');
            const availableMaps = await getMapsByGameMode(queueData.game_mode, steamApiKey);
            const mapNames = availableMaps.map(map => map.name);
            const randomMap = selectRandomMapFromAvailable(mapNames);
            if (randomMap) {
                selectedMap = randomMap;
            }
        } catch (error) {
            console.error('[CreateLobby] Error selecting random map:', error);
        }
    }

    // Update game status to 'lobby' — do NOT set mapAnimSelectStartTime here
    await updateGame(gameId, {
        status: 'lobby',
        map: selectedMap,
        mapSelectionMode: mapSelectionMode,
    });

    // Get updated players with team assignments for history events
    const updatedPlayers = await getQueuePlayers(gameId);

    // Store lobby creation history events for all players
    for (const player of updatedPlayers) {
        await storeLobbyHistoryEvent({
            id: crypto.randomUUID(),
            gameId: gameId,
            playerSteamId: player.player_steam_id,
            eventType: 'join',
            eventData: {
                gameMode: queueData.game_mode,
                mapSelectionMode: mapSelectionMode,
                isHost: player.player_steam_id === queueData.host_steam_id,
                teamId: player.team_id
            }
        });
    }

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

// ─── LEAVE LOBBY ─────────────────────────────────────────────────────────────

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

    // Use getLobbyWithPlayers to get ALL lobby members for disband events
    const userLobby = await getUserActiveLobby(userSteamId);
    if (!userLobby) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'User is not in any lobby' }),
        };
    }

    const lobbyData = await getLobbyWithPlayers(userLobby.id);
    if (!lobbyData) {
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Lobby not found' }),
        };
    }

    const isHost = lobbyData.host_steam_id === userSteamId;

    // Store disband events for ALL players in the lobby
    for (const player of lobbyData.players) {
        await storeLobbyHistoryEvent({
            id: crypto.randomUUID(),
            gameId: lobbyData.id,
            playerSteamId: player.player_steam_id,
            eventType: 'disband',
            eventData: {
                gameMode: lobbyData.game_mode,
                mapSelectionMode: lobbyData.map_selection_mode || 'host-pick',
                disbandedBy: userSteamId,
                isHost: player.player_steam_id === lobbyData.host_steam_id,
            }
        });
    }

    // Cancel the lobby to preserve historical data
    await updateGame(lobbyData.id, { status: 'cancelled' });

    return {
        statusCode: 200,
        headers: createCorsHeaders(),
        body: JSON.stringify({
            action: 'cancelled',
            message: 'Lobby cancelled successfully',
            wasHost: isHost,
        }),
    };
}

// ─── SELECT MAP ──────────────────────────────────────────────────────────────

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
    const { gameId, mapId } = JSON.parse(event.body || '{}');

    if (!mapId) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Map ID is required' }),
        };
    }

    // Get the game to verify state and mode
    const game = await getGameWithPlayers(gameId || '');
    if (!game) {
        // Fallback: try getUserActiveLobby if gameId not provided
        const userLobby = await getUserActiveLobby(userSteamId);
        if (!userLobby) {
            return {
                statusCode: 400,
                headers: createCorsHeaders(),
                body: JSON.stringify({ error: 'User is not in any lobby' }),
            };
        }
        // Re-fetch with full player data
        const lobbyGame = await getGameWithPlayers(userLobby.id);
        if (!lobbyGame) {
            return {
                statusCode: 404,
                headers: createCorsHeaders(),
                body: JSON.stringify({ error: 'Game not found' }),
            };
        }
        return await processMapSelection(lobbyGame, userSteamId, mapId);
    }

    if (game.status !== 'lobby') {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Maps can only be selected when the game is in lobby status' }),
        };
    }

    return await processMapSelection(game, userSteamId, mapId);
}

async function processMapSelection(game: any, steamId: string, mapId: string): Promise<APIGatewayProxyResult> {
    const gameId = game.id;

    // ── Random-map mode: reject manual selection ──
    if (game.map_selection_mode === 'random-map') {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'Map selection is not allowed in random-map mode' }),
        };
    }

    // ── Host-pick mode ──
    if (game.map_selection_mode === 'host-pick') {
        if (game.host_steam_id !== steamId) {
            return {
                statusCode: 403,
                headers: createCorsHeaders(),
                body: JSON.stringify({ error: 'Only the game host can select the map in host-pick mode' }),
            };
        }

        await updateGame(gameId, { map: mapId });

        // Trigger server setup immediately for host-pick
        try {
            await triggerServerSetupInternal(gameId);
        } catch (error) {
            console.error('[SelectMap] Error triggering server setup:', error);
        }

        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({ message: 'Map selected successfully', mapId }),
        };
    }

    // ── All-pick mode ──
    if (game.map_selection_mode === 'all-pick') {
        const isPlayerInGame = game.players.some((p: any) => p.player_steam_id === steamId);
        if (!isPlayerInGame) {
            return {
                statusCode: 403,
                headers: createCorsHeaders(),
                body: JSON.stringify({ error: 'Only players in the game can select the map' }),
            };
        }

        // Store player's map selection
        await updatePlayerMapSelection(gameId, steamId, mapId);

        // Check if all players have selected
        const selectionStatus = await getMapSelectionStatus(gameId);

        let finalMap = null;
        if (selectionStatus.hasAllSelected) {
            // Replace any "random" selections with actual maps
            const steamApiKey = await getSsmParameter('/unencrypted/SteamApiKey');
            const availableMaps = await getMapsByGameMode(game.game_mode, steamApiKey);
            const mapIds = availableMaps.map((map: any) => map.id);

            await replaceRandomMapSelections(gameId, mapIds);

            // Pick final map from updated selections
            finalMap = await selectRandomMapFromSelections(gameId);

            if (finalMap) {
                // Set animation start time — 10 seconds from now
                const animStartTime = Date.now() + 10000;

                await updateGame(gameId, {
                    map: finalMap,
                    mapAnimSelectStartTime: animStartTime
                });

                // Trigger server setup
                try {
                    await triggerServerSetupInternal(gameId);
                } catch (error) {
                    console.error('[SelectMap] Error triggering server setup:', error);
                }
            }
        }

        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                message: selectionStatus.hasAllSelected
                    ? `Map selection complete. Selected map: ${finalMap}`
                    : 'Map selection recorded. Waiting for other players.',
                selectionStatus: {
                    playersWithSelections: selectionStatus.playersWithSelections,
                    totalPlayers: selectionStatus.totalPlayers,
                    hasAllSelected: selectionStatus.hasAllSelected,
                    finalMap: finalMap
                }
            }),
        };
    }

    return {
        statusCode: 400,
        headers: createCorsHeaders(),
        body: JSON.stringify({ error: 'Unknown map selection mode' }),
    };
}

// ─── END MATCH ───────────────────────────────────────────────────────────────

async function handleEndMatch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const { matchId, gameId: rawGameId } = JSON.parse(event.body || '{}');

    const lookupId = matchId || rawGameId;
    if (!lookupId) {
        return {
            statusCode: 400,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: 'matchId or gameId is required' }),
        };
    }

    console.log('[EndMatch] Finalizing match:', lookupId);

    // Find the game by match_number
    const game = await getGameByMatchNumber(String(lookupId));
    if (!game) {
        return {
            statusCode: 404,
            headers: createCorsHeaders(),
            body: JSON.stringify({ error: `Game with match_number ${lookupId} not found` }),
        };
    }

    console.log(`[EndMatch] Found game ${game.id}, status: ${game.status}`);

    // Update game status to completed
    await updateGame(game.id, { status: 'completed' });

    // ── ELO Processing ──
    try {
        const matchResults = await getMatchResults(String(lookupId));

        if (!matchResults) {
            console.log('[EndMatch] No match results found — skipping ELO');
            return {
                statusCode: 200,
                headers: createCorsHeaders(),
                body: JSON.stringify({
                    message: 'Match ended successfully (no match results for ELO calculation)',
                    gameId: game.id, matchId: lookupId
                }),
            };
        }

        console.log(`[EndMatch] Scores: Team1=${matchResults.team1Score}, Team2=${matchResults.team2Score}`);

        // Skip ELO for ties
        if (matchResults.team1Score === matchResults.team2Score) {
            return {
                statusCode: 200,
                headers: createCorsHeaders(),
                body: JSON.stringify({
                    message: 'Match ended successfully (tied game — no ELO changes)',
                    gameId: game.id, matchId: lookupId, matchResults
                }),
            };
        }

        // Get players with pre-calculated ELO predictions
        const gamePlayers = await getGamePlayersWithTeams(game.id);
        if (!gamePlayers || gamePlayers.length === 0) {
            return {
                statusCode: 200,
                headers: createCorsHeaders(),
                body: JSON.stringify({
                    message: 'Match ended successfully (no players for ELO)',
                    gameId: game.id, matchId: lookupId, matchResults
                }),
            };
        }

        const team1Won = matchResults.team1Score > matchResults.team2Score;
        console.log(`[EndMatch] ${team1Won ? 'Team 1' : 'Team 2'} won`);

        // Get all users for current ELO values
        const steamIds = gamePlayers.map(p => p.player_steam_id);
        const users = await getUsersBySteamIds(steamIds);
        const userMap = new Map(users.map(u => [u.steam_id, u]));

        const eloUpdates: Array<{ steamId: string; oldElo: number; newElo: number; change: number; playerName?: string }> = [];

        for (const player of gamePlayers) {
            const user = userMap.get(player.player_steam_id);
            if (!user) {
                console.warn(`[EndMatch] User not found: ${player.player_steam_id}`);
                continue;
            }

            const currentElo = Number(user.current_elo) || ELO.getDefaultElo();
            const playerTeam = player.team_number;

            let eloChange: number;
            if ((team1Won && playerTeam === 1) || (!team1Won && playerTeam === 2)) {
                eloChange = Number(player.elo_change_win) || 0;
            } else {
                eloChange = Number(player.elo_change_loss) || 0;
            }

            const newElo = Math.round(currentElo + eloChange);

            await updatePlayerElo(player.player_steam_id, newElo);
            eloUpdates.push({
                steamId: player.player_steam_id,
                oldElo: currentElo,
                newElo,
                change: eloChange,
                playerName: (user as any).username || `Player ${player.player_steam_id.slice(-4)}`
            });
        }

        console.log(`[EndMatch] ELO updated for ${eloUpdates.length} players`);

        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                message: 'Match ended successfully with ELO updates',
                gameId: game.id,
                matchId: lookupId,
                matchResults,
                eloUpdates: {
                    playersUpdated: eloUpdates.length,
                    winner: team1Won ? 'Team 1' : 'Team 2',
                    playerChanges: eloUpdates.map(u => ({
                        player: u.playerName,
                        change: u.change > 0 ? `+${u.change}` : `${u.change}`,
                        oldElo: u.oldElo,
                        newElo: u.newElo
                    }))
                }
            }),
        };
    } catch (eloError) {
        console.error('[EndMatch] ELO update error:', eloError);
        return {
            statusCode: 200,
            headers: createCorsHeaders(),
            body: JSON.stringify({
                message: 'Match ended successfully (ELO update failed)',
                gameId: game.id, matchId: lookupId,
                error: `ELO error: ${(eloError as Error)?.message || 'Unknown'}`
            }),
        };
    }
}

// ─── TEAM BALANCING ──────────────────────────────────────────────────────────

async function generateAndUpdateTeamNames(gameId: string, teams: any[], gameMode: GameMode): Promise<void> {
    const allPlayers = await getQueuePlayers(gameId);

    const teamPlayers: Record<string, any[]> = {};
    for (const player of allPlayers) {
        if (player.team_id) {
            if (!teamPlayers[player.team_id]) {
                teamPlayers[player.team_id] = [];
            }
            teamPlayers[player.team_id].push(player);
        }
    }

    const allSteamIds = allPlayers.map(p => p.player_steam_id);
    const usernameMap = await getPlayerUsernamesBySteamIds(allSteamIds);

    const maxPlayers = getMaxPlayersForGamemode(gameMode);
    const teamSize = maxPlayers / 2;

    for (const team of teams) {
        const playersInTeam = teamPlayers[team.id] || [];
        if (playersInTeam.length > 0) {
            const nameParts: string[] = [];
            for (let i = 0; i < playersInTeam.length; i++) {
                const playerSteamId = playersInTeam[i].player_steam_id;
                const playerName = usernameMap[playerSteamId] || `Player${i + 1}`;
                const nameLength = playerName.length;
                const portionSize = Math.max(1, Math.floor(nameLength / teamSize));
                const portionIndex = i % teamSize;
                const startIndex = portionIndex * portionSize;
                const endIndex = Math.min(startIndex + portionSize, nameLength);
                const portion = playerName.substring(startIndex, endIndex) || playerName.charAt(0);
                nameParts.push(portion);
            }
            const teamName = `Team ${nameParts.join('')}`;
            await updateTeamName(team.id, teamName);
        }
    }
}

async function balancePlayersIntoTeams(gameId: string, players: any[], gameMode: GameMode): Promise<void> {
    console.log('[BalanceTeams] Balancing', players.length, 'players into teams');

    // Get players with ELO ratings
    const playersWithElo = await getGamePlayersWithElo(gameId);
    const eloMap = new Map(playersWithElo.map(p => [p.player_steam_id, Number(p.current_elo)]));

    // Add ELO data and sort descending
    const playersWithEloData = players.map(player => ({
        ...player,
        current_elo: Number(eloMap.get(player.player_steam_id) || 1000)
    }));
    playersWithEloData.sort((a, b) => b.current_elo - a.current_elo);

    // Get existing teams
    const teams = await getGameTeams(gameId);
    const team1 = teams.find((t: any) => t.team_number === 1);
    const team2 = teams.find((t: any) => t.team_number === 2);

    if (!team1 || !team2) {
        console.error('[BalanceTeams] Teams not found for game:', gameId);
        return;
    }

    const team1Players: any[] = [];
    const team2Players: any[] = [];
    let team1Elo = 0;
    let team2Elo = 0;
    const playersPerTeam = Math.floor(playersWithEloData.length / 2);

    // Snake draft assignment
    for (let i = 0; i < playersWithEloData.length; i++) {
        const player = playersWithEloData[i];
        let assignToTeam1: boolean;

        if (team1Players.length === playersPerTeam && team2Players.length < playersPerTeam) {
            assignToTeam1 = false;
        } else if (team2Players.length === playersPerTeam && team1Players.length < playersPerTeam) {
            assignToTeam1 = true;
        } else {
            const roundNumber = Math.floor(i / 2);
            const isFirstInRound = i % 2 === 0;
            assignToTeam1 = roundNumber % 2 === 0 ? isFirstInRound : !isFirstInRound;
        }

        if (assignToTeam1) {
            team1Players.push(player);
            team1Elo += player.current_elo;
            await updatePlayerTeam(gameId, player.player_steam_id, team1.id);
        } else {
            team2Players.push(player);
            team2Elo += player.current_elo;
            await updatePlayerTeam(gameId, player.player_steam_id, team2.id);
        }
    }

    const team1AvgElo = team1Players.length > 0 ? team1Elo / team1Players.length : 1000;
    const team2AvgElo = team2Players.length > 0 ? team2Elo / team2Players.length : 1000;

    console.log(`[BalanceTeams] Team1: ${team1Players.length}p, avg ${team1AvgElo.toFixed(1)} | Team2: ${team2Players.length}p, avg ${team2AvgElo.toFixed(1)}`);

    // Update team average ELOs
    await updateTeamAverageElo(gameId, 1, Math.round(team1AvgElo * 100) / 100);
    await updateTeamAverageElo(gameId, 2, Math.round(team2AvgElo * 100) / 100);

    // Calculate and store ELO change predictions
    const team1EloData: TeamEloData = {
        players: team1Players.map(p => ({ steamId: p.player_steam_id, currentElo: p.current_elo })),
        averageElo: team1AvgElo
    };
    const team2EloData: TeamEloData = {
        players: team2Players.map(p => ({ steamId: p.player_steam_id, currentElo: p.current_elo })),
        averageElo: team2AvgElo
    };

    const team1WinsResults = ELO.processMatchEloChanges(team1EloData, team2EloData);
    const team2WinsResults = ELO.processMatchEloChanges(team2EloData, team1EloData);

    for (const player of team1Players) {
        const winResult = team1WinsResults.winningTeamResults.find(r => r.steamId === player.player_steam_id);
        const lossResult = team2WinsResults.losingTeamResults.find(r => r.steamId === player.player_steam_id);
        await updatePlayerEloChangePredictions(gameId, player.player_steam_id, winResult?.eloChange || 0, lossResult?.eloChange || 0);
    }

    for (const player of team2Players) {
        const winResult = team2WinsResults.winningTeamResults.find(r => r.steamId === player.player_steam_id);
        const lossResult = team1WinsResults.losingTeamResults.find(r => r.steamId === player.player_steam_id);
        await updatePlayerEloChangePredictions(gameId, player.player_steam_id, winResult?.eloChange || 0, lossResult?.eloChange || 0);
    }

    console.log('[BalanceTeams] ELO predictions stored');

    // Generate and update team names
    await generateAndUpdateTeamNames(gameId, teams, gameMode);

    console.log('[BalanceTeams] Complete');
}
