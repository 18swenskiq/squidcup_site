import * as mysql from 'mysql2/promise';
import * as crypto from 'crypto';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { 
  User, 
  Session, 
  GameServer, 
  ActiveQueueWithDetails,
  DatabaseGame,
  GamePlayerRecord,
  GameHistoryRecord,
  EnrichedGameWithPlayers,
  UserCompleteStatus,
  UserWithSteamData,
  QueueCleanupRecord,
  CreateGameInput,
  UpdateGameInput,
  AddPlayerToGameInput,
  UpdateServerInput,
  UpsertUserInput,
  GameHistoryEventInput,
  GameTeamRecord,
  MatchHistoryMatch,
  MatchHistoryPlayer,
  MatchHistoryTeam,
  PlayerLeaderboardStats,
  CompletedGameWithPlayers
} from '../types';
import { getWorkshopMapInfo } from '../steam';

// Initialize SSM client
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  caCert: string;
}

// Cache for database configuration and connection promise
let cachedConfig: DatabaseConfig | null = null;
let configPromise: Promise<DatabaseConfig> | null = null;
let cachedConnection: mysql.Connection | null = null;

// Function to get a parameter from SSM Parameter Store
async function getParameterValue(parameterName: string): Promise<string> {
  try {
    const command = new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true,
    });
    
    const response = await ssmClient.send(command);
    return response.Parameter?.Value || '';
  } catch (error) {
    console.error(`Error getting parameter ${parameterName}:`, error);
    throw error;
  }
}

// Function to sanitize query parameters (convert undefined to null)
function sanitizeParams(params: any[]): any[] {
  return params.map(param => param === undefined ? null : param);
}

// Function to get database configuration from Parameter Store
async function getDatabaseConfig(): Promise<DatabaseConfig> {
  // If we already have a cached config, return it immediately
  if (cachedConfig) {
    return cachedConfig;
  }

  // If there's already a config loading operation in progress, wait for it
  if (configPromise) {
    return configPromise;
  }

  // Start the configuration loading process
  configPromise = (async (): Promise<DatabaseConfig> => {
    try {
      const [host, port, user, password, database, caCert] = await Promise.all([
        getParameterValue('/squidcup/sql/host'),
        getParameterValue('/squidcup/sql/port'),
        getParameterValue('/squidcup/sql/user'),
        getParameterValue('/squidcup/sql/password'),
        getParameterValue('/squidcup/sql/database'),
        getParameterValue('/squidcup/sql/ca_cert')
      ]);

      const config: DatabaseConfig = {
        host,
        port: parseInt(port, 10),
        user,
        password,
        database,
        caCert
      };

      // Cache the config for future use
      cachedConfig = config;
      return config;
    } catch (error) {
      // Clear the promise on error so retry is possible
      configPromise = null;
      console.error('Error getting database configuration:', error);
      throw error;
    }
  })();

  return configPromise!; // Non-null assertion is safe here since we just assigned it
}

// Function to create database connection
async function createConnection(): Promise<mysql.Connection> {
  const config = await getDatabaseConfig();
  
  // Configure connection with SSL using the CA certificate
  const connectionConfig: any = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: {
      rejectUnauthorized: false, // Allow self-signed certificates
      ca: config.caCert
    }
  };
  
  const connection = await mysql.createConnection(connectionConfig);
  return connection;
}

// Function to get or create reusable database connection
export async function getDatabaseConnection(): Promise<mysql.Connection> {
  if (cachedConnection) {
    // Test if connection is still alive
    try {
      await cachedConnection.ping();
      return cachedConnection;
    } catch (error) {
      console.log('Cached connection lost, creating new connection');
      cachedConnection = null;
    }
  }
  
  cachedConnection = await createConnection();
  await ensureTablesExist(cachedConnection);
  return cachedConnection;
}

// Function to ensure database tables exist
async function ensureTablesExist(connection: mysql.Connection): Promise<void> {
  try {
    // Create users table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_users (
        steam_id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(255),
        avatar VARCHAR(500),
        avatar_medium VARCHAR(500),
        avatar_full VARCHAR(500),
        country_code VARCHAR(2),
        state_code VARCHAR(3),
        is_admin BOOLEAN DEFAULT FALSE,
        current_elo DECIMAL(7,2) DEFAULT 1000.00,
        temp_banned BOOLEAN NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_temp_banned (temp_banned)
      )
    `);

    // Create sessions table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_sessions (
        session_token VARCHAR(255) PRIMARY KEY,
        user_steam_id VARCHAR(50) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_steam_id) REFERENCES squidcup_users(steam_id) ON DELETE CASCADE,
        INDEX idx_expires_at (expires_at),
        INDEX idx_user_steam_id (user_steam_id)
      )
    `);

    // Create servers table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_servers (
        id VARCHAR(36) PRIMARY KEY,
        ip VARCHAR(45) NOT NULL,
        port INT NOT NULL,
        location VARCHAR(100) NOT NULL,
        rcon_password VARCHAR(255) NOT NULL,
        default_password VARCHAR(255) DEFAULT '',
        max_players INT NOT NULL,
        nickname VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_ip_port (ip, port)
      )
    `);

    // Create unified games table (replaces both queues and lobbies)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_games (
        id VARCHAR(36) PRIMARY KEY,
        match_number INT AUTO_INCREMENT UNIQUE,
        game_mode VARCHAR(20) NOT NULL,
        map VARCHAR(100),
        map_selection_mode ENUM('all-pick', 'host-pick', 'random-map') NOT NULL,
        host_steam_id VARCHAR(50) NOT NULL,
        server_id VARCHAR(36),
        password VARCHAR(255),
        ranked BOOLEAN DEFAULT FALSE,
        start_time TIMESTAMP NOT NULL,
        max_players INT NOT NULL,
        current_players INT DEFAULT 0,
        status ENUM('queue', 'lobby', 'in_progress', 'completed', 'cancelled') DEFAULT 'queue',
        map_anim_select_start_time BIGINT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (host_steam_id) REFERENCES squidcup_users(steam_id),
        FOREIGN KEY (server_id) REFERENCES squidcup_servers(id),
        INDEX idx_status (status),
        INDEX idx_game_mode (game_mode),
        INDEX idx_server_id (server_id),
        INDEX idx_start_time (start_time),
        INDEX idx_host_steam_id (host_steam_id),
        INDEX idx_match_number (match_number)
      )
    `);

    // Create game teams table for proper team management
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_game_teams (
        id VARCHAR(36) PRIMARY KEY,
        game_id VARCHAR(36) NOT NULL,
        team_number INT NOT NULL,
        team_name VARCHAR(100) NOT NULL,
        average_elo DECIMAL(7,2) DEFAULT 1000.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES squidcup_games(id) ON DELETE CASCADE,
        UNIQUE KEY unique_game_team_number (game_id, team_number),
        INDEX idx_game_id (game_id)
      )
    `);

    // Create unified game_players table (replaces both queue_players and lobby_players)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_game_players (
        game_id VARCHAR(36) NOT NULL,
        player_steam_id VARCHAR(50) NOT NULL,
        team_id VARCHAR(36) DEFAULT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        map_selection VARCHAR(100) DEFAULT NULL,
        player_accepted_match_result BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (game_id, player_steam_id),
        FOREIGN KEY (game_id) REFERENCES squidcup_games(id) ON DELETE CASCADE,
        FOREIGN KEY (player_steam_id) REFERENCES squidcup_users(steam_id) ON DELETE CASCADE,
        FOREIGN KEY (team_id) REFERENCES squidcup_game_teams(id) ON DELETE SET NULL,
        INDEX idx_game_id (game_id),
        INDEX idx_player_steam_id (player_steam_id),
        INDEX idx_team_id (team_id)
      )
    `);

    // Create unified game history table for audit trail
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_game_history (
        id VARCHAR(36) PRIMARY KEY,
        game_id VARCHAR(36) NOT NULL,
        player_steam_id VARCHAR(50) NOT NULL,
        event_type ENUM('join', 'leave', 'disband', 'timeout', 'complete', 'convert_to_lobby') NOT NULL,
        event_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_game_id (game_id),
        INDEX idx_player_steam_id (player_steam_id),
        INDEX idx_event_type (event_type)
      )
    `);

    console.log('Database tables ensured to exist');
  } catch (error) {
    console.error('Error ensuring tables exist:', error);
    throw error;
  }
}

// Function to execute raw query
async function executeQuery(connection: mysql.Connection, query: string, params: any[] = []): Promise<any> {
  try {
    // Sanitize parameters to convert undefined to null
    const sanitizedParams = sanitizeParams(params);
    
    // Debug logging for data length issues
    if (query.includes('squidcup_')) {
      console.log('Executing sessions query:', query);
      console.log('Original params:', params);
      console.log('Sanitized params:', sanitizedParams);
      sanitizedParams.forEach((param, index) => {
        if (typeof param === 'string') {
          console.log(`Param ${index}: length=${param.length}, value="${param}"`);
        } else {
          console.log(`Param ${index}: type=${typeof param}, value=${param}`);
        }
      });
    }
    
    const [rows] = await connection.execute(query, sanitizedParams);
    return rows;
  } catch (error) {
    console.error('Error executing query:', error);
    throw error;
  }
}

// Session management functions
export async function getSession(sessionToken: string): Promise<Session | null> {
  const connection = await getDatabaseConnection();
  const rows = await executeQuery(
    connection,
    'SELECT user_steam_id as steamId, expires_at as expiresAt FROM squidcup_sessions WHERE session_token = ? AND expires_at > NOW()',
    [sessionToken]
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function createSession(sessionToken: string, steamId: string, expiresAt: Date): Promise<void> {
  const connection = await getDatabaseConnection();
  let mysqlDateTime = jsDateToMySQLDate(expiresAt);
  
  await executeQuery(
    connection,
    'INSERT INTO squidcup_sessions (session_token, user_steam_id, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)',
    [sessionToken, steamId, mysqlDateTime]
  );
}

export async function deleteSession(sessionToken: string): Promise<void> {
  const connection = await getDatabaseConnection();
  await executeQuery(
    connection,
    'DELETE FROM squidcup_sessions WHERE session_token = ?',
    [sessionToken]
  );
}

// User management functions
export async function upsertUser(userData: UpsertUserInput): Promise<void> {
  const connection = await getDatabaseConnection();
  await executeQuery(
    connection,
    `INSERT INTO squidcup_users (steam_id, username, avatar, avatar_medium, avatar_full, country_code, state_code, is_admin, current_elo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
     username = VALUES(username),
     avatar = VALUES(avatar),
     avatar_medium = VALUES(avatar_medium),
     avatar_full = VALUES(avatar_full),
     country_code = VALUES(country_code),
     state_code = VALUES(state_code),
     current_elo = COALESCE(VALUES(current_elo), current_elo),
     updated_at = CURRENT_TIMESTAMP`,
    [
      userData.steamId || null,
      userData.username || null,
      userData.avatar || null,
      userData.avatarMedium || null,
      userData.avatarFull || null,
      userData.countryCode || null,
      userData.stateCode || null,
      userData.isAdmin || false,
      userData.currentElo || null
    ]
  );
}

export async function getUser(steamId: string): Promise<User | null> {
  const connection = await getDatabaseConnection();
  const rows = await executeQuery(
    connection,
    'SELECT * FROM squidcup_users WHERE steam_id = ?',
    [steamId]
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function getUsersBySteamIds(steamIds: string[]): Promise<UserWithSteamData[]> {
  if (steamIds.length === 0) return [];
  
  const connection = await getDatabaseConnection();
  const placeholders = steamIds.map(() => '?').join(',');
  const rows = await executeQuery(
    connection,
    `SELECT steam_id, username, avatar FROM squidcup_users WHERE steam_id IN (${placeholders})`,
    steamIds
  );
  return rows;
}

export async function isUserBanned(steamId: string): Promise<boolean> {
  const connection = await getDatabaseConnection();
  const rows = await executeQuery(
    connection,
    'SELECT temp_banned FROM squidcup_users WHERE steam_id = ?',
    [steamId]
  );
  
  if (rows.length === 0) {
    // User doesn't exist, consider them not banned
    return false;
  }
  
  // Return true if temp_banned is 1 (true), false otherwise
  return Boolean(rows[0].temp_banned);
}

// Server management functions
export async function addServer(serverData: GameServer): Promise<void> {
  const connection = await getDatabaseConnection();
  await executeQuery(
    connection,
    `INSERT INTO squidcup_servers (id, ip, port, location, rcon_password, default_password, max_players, nickname)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      serverData.id,
      serverData.ip,
      serverData.port,
      serverData.location,
      serverData.rcon_password,
      serverData.default_password || '',
      serverData.max_players,
      serverData.nickname
    ]
  );
}

export async function getServers(minPlayers?: number): Promise<GameServer[]> {
  const connection = await getDatabaseConnection();
  
  // Build the query to exclude servers that are currently in use by active games
  let query = `
    SELECT s.* 
    FROM squidcup_servers s
    WHERE s.id NOT IN (
      SELECT DISTINCT g.server_id 
      FROM squidcup_games g 
      WHERE g.server_id IS NOT NULL 
      AND g.status IN ('queue', 'lobby', 'in_progress')
    )
  `;
  
  const params: any[] = [];
  
  if (minPlayers && minPlayers > 0) {
    query += ' AND s.max_players >= ?';
    params.push(minPlayers);
  }
  
  query += ' ORDER BY s.created_at DESC';
  
  return await executeQuery(connection, query, params);
}

export async function updateServer(serverId: string, serverData: UpdateServerInput): Promise<void> {
  const connection = await getDatabaseConnection();
  const fields = [];
  const values = [];
  
  if (serverData.ip !== undefined) { fields.push('ip = ?'); values.push(serverData.ip); }
  if (serverData.port !== undefined) { fields.push('port = ?'); values.push(serverData.port); }
  if (serverData.location !== undefined) { fields.push('location = ?'); values.push(serverData.location); }
  if (serverData.rconPassword !== undefined) { fields.push('rcon_password = ?'); values.push(serverData.rconPassword); }
  if (serverData.defaultPassword !== undefined) { fields.push('default_password = ?'); values.push(serverData.defaultPassword); }
  if (serverData.maxPlayers !== undefined) { fields.push('max_players = ?'); values.push(serverData.maxPlayers); }
  if (serverData.nickname !== undefined) { fields.push('nickname = ?'); values.push(serverData.nickname); }
  
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(serverId);
  
  await executeQuery(
    connection,
    `UPDATE squidcup_servers SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteServer(serverId: string): Promise<void> {
  const connection = await getDatabaseConnection();
  await executeQuery(connection, 'DELETE FROM squidcup_servers WHERE id = ?', [serverId]);
}

export async function getServerInfoForGame(gameId: string): Promise<GameServer | null> {
  const connection = await getDatabaseConnection();
  const result = await executeQuery(
    connection,
    `SELECT s.* 
     FROM squidcup_servers s 
     JOIN squidcup_games g ON s.id = g.server_id 
     WHERE g.id = ?`,
    [gameId]
  );
  
  return result.length > 0 ? result[0] : null;
}

// Game management functions (unified queue/lobby)
export async function getGame(gameId: string): Promise<DatabaseGame | null> {
  const connection = await getDatabaseConnection();
  const rows = await executeQuery(
    connection,
    'SELECT * FROM squidcup_games WHERE id = ?',
    [gameId]
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function getGameByMatchNumber(matchNumber: string): Promise<DatabaseGame | null> {
  const connection = await getDatabaseConnection();
  const rows = await executeQuery(
    connection,
    'SELECT * FROM squidcup_games WHERE match_number = ?',
    [matchNumber]
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function getGameWithPlayers(gameId: string): Promise<EnrichedGameWithPlayers | null> {
  const game = await getGame(gameId);
  if (!game) return null;
  
  const players = await getGamePlayers(gameId);
  return {
    ...game,
    players
  };
}

export async function getUserActiveGame(steamId: string): Promise<EnrichedGameWithPlayers | null> {
  const connection = await getDatabaseConnection();
  
  // First check if user is hosting a game
  const hostGame = await executeQuery(
    connection,
    `SELECT * FROM squidcup_games g
     WHERE g.host_steam_id = ? AND (
       g.status IN ('queue', 'lobby', 'in_progress') OR 
       (g.status = 'completed' AND EXISTS (
         SELECT 1 FROM squidcup_game_players gp 
         WHERE gp.game_id = g.id AND gp.player_steam_id = ? AND gp.player_accepted_match_result = FALSE
       ))
     )`,
    [steamId, steamId]
  );
  
  if (hostGame.length > 0) {
    const players = await getGamePlayers(hostGame[0].id);
    return {
      ...hostGame[0],
      players,
      isHost: true
    };
  }
  
  // Check if user is a player in any game
  const playerGame = await executeQuery(
    connection,
    `SELECT g.*, gp.joined_at, gp.team_id
     FROM squidcup_games g
     INNER JOIN squidcup_game_players gp ON g.id = gp.game_id
     WHERE gp.player_steam_id = ? AND (
       g.status IN ('queue', 'lobby', 'in_progress') OR 
       (g.status = 'completed' AND gp.player_accepted_match_result = FALSE)
     )`,
    [steamId]
  );
  
  if (playerGame.length > 0) {
    const players = await getGamePlayers(playerGame[0].id);
    return {
      ...playerGame[0],
      players,
      isHost: false,
      userJoinedAt: playerGame[0].joined_at,
      userTeam: playerGame[0].team_id
    };
  }
  
  return null;
}

export async function getGamePlayers(gameId: string): Promise<GamePlayerRecord[]> {
  const connection = await getDatabaseConnection();
  return await executeQuery(
    connection,
    'SELECT * FROM squidcup_game_players WHERE game_id = ? ORDER BY joined_at',
    [gameId]
  );
}

export async function createGame(gameData: CreateGameInput): Promise<void> {
  const connection = await getDatabaseConnection();
  await executeQuery(
    connection,
    `INSERT INTO squidcup_games (id, game_mode, map, map_selection_mode, host_steam_id, server_id, password, ranked, start_time, max_players, current_players, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      gameData.id,
      gameData.gameMode,
      gameData.map,
      gameData.mapSelectionMode,
      gameData.hostSteamId,
      gameData.serverId,
      gameData.password || null,
      gameData.ranked || false,
      jsDateToMySQLDate(gameData.startTime),
      gameData.maxPlayers,
      0, // Initialize current_players to 0, will be incremented when host is added as player
      gameData.status || 'queue'
    ]
  );
}

export async function updateGame(gameId: string, gameData: UpdateGameInput): Promise<void> {
  const connection = await getDatabaseConnection();
  const fields = [];
  const values = [];
  
  if (gameData.currentPlayers !== undefined) { fields.push('current_players = ?'); values.push(gameData.currentPlayers); }
  if (gameData.status !== undefined) { fields.push('status = ?'); values.push(gameData.status); }
  if (gameData.map !== undefined) { fields.push('map = ?'); values.push(gameData.map); }
  if (gameData.mapSelectionMode !== undefined) { fields.push('map_selection_mode = ?'); values.push(gameData.mapSelectionMode); }
  if (gameData.serverId !== undefined) { fields.push('server_id = ?'); values.push(gameData.serverId); }
  if (gameData.gameMode !== undefined) { fields.push('game_mode = ?'); values.push(gameData.gameMode); }
  if (gameData.mapAnimSelectStartTime !== undefined) { fields.push('map_anim_select_start_time = ?'); values.push(gameData.mapAnimSelectStartTime); }
  
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(gameId);
  
  await executeQuery(
    connection,
    `UPDATE squidcup_games SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function addPlayerToGame(gameId: string, playerData: AddPlayerToGameInput): Promise<void> {
  const connection = await getDatabaseConnection();
  
  // Add player to game_players table
  await executeQuery(
    connection,
    `INSERT INTO squidcup_game_players (game_id, player_steam_id, team_id, joined_at)
     VALUES (?, ?, ?, ?)`,
    [
      gameId,
      playerData.steamId,
      playerData.teamId || null,
      jsDateToMySQLDate(playerData.joinTime ?? new Date())
    ]
  );
  
  // Update current_players count
  await executeQuery(
    connection,
    'UPDATE squidcup_games SET current_players = current_players + 1 WHERE id = ?',
    [gameId]
  );
}

export async function updateGamePlayerAcceptance(gameId: string, steamId: string, accepted: boolean): Promise<{ success: boolean; error?: string }> {
  const connection = await getDatabaseConnection();
  
  try {
    // First check if the player exists in the game
    const checkResult = await executeQuery(
      connection,
      'SELECT game_id FROM squidcup_game_players WHERE game_id = ? AND player_steam_id = ?',
      [gameId, steamId]
    );
    
    if (checkResult.length === 0) {
      return { success: false, error: 'PLAYER_NOT_FOUND' };
    }
    
    // Update the player's acceptance status
    await executeQuery(
      connection,
      'UPDATE squidcup_game_players SET player_accepted_match_result = ? WHERE game_id = ? AND player_steam_id = ?',
      [accepted ? 1 : 0, gameId, steamId]
    );
    
    return { success: true };
  } catch (error) {
    console.error('Error updating player acceptance:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Team management functions
export async function createGameTeam(gameId: string, teamNumber: number, teamName: string): Promise<string> {
  const connection = await getDatabaseConnection();
  const teamId = crypto.randomUUID();
  
  await executeQuery(
    connection,
    `INSERT INTO squidcup_game_teams (id, game_id, team_number, team_name, average_elo)
     VALUES (?, ?, ?, ?, ?)`,
    [teamId, gameId, teamNumber, teamName, 1000.00]
  );
  
  return teamId;
}

export async function updateTeamName(teamId: string, teamName: string): Promise<void> {
  const connection = await getDatabaseConnection();
  await executeQuery(
    connection,
    'UPDATE squidcup_game_teams SET team_name = ? WHERE id = ?',
    [teamName, teamId]
  );
}

export async function updateTeamAverageElo(gameId: string, teamNumber: number, averageElo: number): Promise<void> {
  const connection = await getDatabaseConnection();
  
  try {
    await executeQuery(
      connection,
      'UPDATE squidcup_game_teams SET average_elo = ? WHERE game_id = ? AND team_number = ?',
      [averageElo, gameId, teamNumber]
    );
  } finally {
    await connection.end();
  }
}

export async function updatePlayerElo(steamId: string, newElo: number): Promise<void> {
  const connection = await getDatabaseConnection();
  
  try {
    await executeQuery(
      connection,
      'UPDATE squidcup_users SET current_elo = ? WHERE steam_id = ?',
      [newElo, steamId]
    );
  } finally {
    await connection.end();
  }
}

export async function getMatchResults(matchNumber: string): Promise<{team1Score: number, team2Score: number} | null> {
  const connection = await getDatabaseConnection();
  
  try {
    const rows = await executeQuery(
      connection,
      'SELECT team1_score, team2_score FROM squidcup_stats_maps WHERE matchid = ?',
      [matchNumber]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    const row = rows[0] as any;
    return {
      team1Score: row.team1_score || 0,
      team2Score: row.team2_score || 0
    };
  } finally {
    await connection.end();
  }
}

export async function getGamePlayersWithTeams(gameId: string): Promise<Array<{
  player_steam_id: string;
  team_id: string | null;
  team_number: number | null;
  joined_at: string;
}>> {
  const connection = await getDatabaseConnection();
  
  try {
    const rows = await executeQuery(
      connection,
      `SELECT 
         gp.player_steam_id,
         gp.team_id,
         gp.joined_at,
         gt.team_number
       FROM squidcup_game_players gp
       LEFT JOIN squidcup_game_teams gt ON gp.team_id = gt.id
       WHERE gp.game_id = ?
       ORDER BY gp.joined_at`,
      [gameId]
    );
    
    return rows as any[];
  } finally {
    await connection.end();
  }
}

export async function getGamePlayersWithElo(gameId: string): Promise<Array<{
  player_steam_id: string;
  team_id: string | null;
  team_number: number | null;
  joined_at: string;
  current_elo: number;
  username: string;
}>> {
  const connection = await getDatabaseConnection();
  
  try {
    const rows = await executeQuery(
      connection,
      `SELECT 
         gp.player_steam_id,
         gp.team_id,
         gp.joined_at,
         gt.team_number,
         u.current_elo,
         u.username
       FROM squidcup_game_players gp
       LEFT JOIN squidcup_game_teams gt ON gp.team_id = gt.id
       INNER JOIN squidcup_users u ON gp.player_steam_id = u.steam_id
       WHERE gp.game_id = ?
       ORDER BY gp.joined_at`,
      [gameId]
    );
    
    return rows as any[];
  } finally {
    await connection.end();
  }
}

export async function getPlayerUsernamesBySteamIds(steamIds: string[]): Promise<Record<string, string>> {
  if (steamIds.length === 0) return {};
  
  const connection = await getDatabaseConnection();
  const placeholders = steamIds.map(() => '?').join(',');
  const results = await executeQuery(
    connection,
    `SELECT steam_id, username FROM squidcup_users WHERE steam_id IN (${placeholders})`,
    steamIds
  );
  
  const usernameMap: Record<string, string> = {};
  for (const row of results) {
    usernameMap[row.steam_id] = row.username;
  }
  return usernameMap;
}

export async function getGameTeams(gameId: string): Promise<GameTeamRecord[]> {
  const connection = await getDatabaseConnection();
  return await executeQuery(
    connection,
    'SELECT * FROM squidcup_game_teams WHERE game_id = ? ORDER BY team_number',
    [gameId]
  );
}

export async function updatePlayerTeam(gameId: string, steamId: string, teamId: string): Promise<void> {
  const connection = await getDatabaseConnection();
  await executeQuery(
    connection,
    'UPDATE squidcup_game_players SET team_id = ? WHERE game_id = ? AND player_steam_id = ?',
    [teamId, gameId, steamId]
  );
}

export async function removePlayerFromGame(gameId: string, steamId: string): Promise<void> {
  const connection = await getDatabaseConnection();
  
  // Remove player from game_players table
  await executeQuery(
    connection,
    'DELETE FROM squidcup_game_players WHERE game_id = ? AND player_steam_id = ?',
    [gameId, steamId]
  );
  
  // Update current_players count
  await executeQuery(
    connection,
    'UPDATE squidcup_games SET current_players = current_players - 1 WHERE id = ?',
    [gameId]
  );
}

export async function deleteGame(gameId: string): Promise<void> {
  const connection = await getDatabaseConnection();
  // Delete game players first (due to foreign key constraints)
  await executeQuery(connection, 'DELETE FROM squidcup_game_players WHERE game_id = ?', [gameId]);
  // Delete the game
  await executeQuery(connection, 'DELETE FROM squidcup_games WHERE id = ?', [gameId]);
}

// History functions
export async function storeGameHistoryEvent(eventData: GameHistoryEventInput): Promise<void> {
  const connection = await getDatabaseConnection();
  
  if (!eventData.gameId) {
    throw new Error('Missing gameId in history event data');
  }
  
  await executeQuery(
    connection,
    `INSERT INTO squidcup_game_history (id, game_id, player_steam_id, event_type, event_data)
     VALUES (?, ?, ?, ?, ?)`,
    [
      eventData.id,
      eventData.gameId,
      eventData.playerSteamId,
      eventData.eventType,
      JSON.stringify(eventData.eventData || {})
    ]
  )
}

export async function getUserGameHistory(steamId: string, limit: number = 50): Promise<GameHistoryRecord[]> {
  const connection = await getDatabaseConnection();
  console.log('getUserGameHistory called with steamId:', steamId, 'limit:', limit, 'limit type:', typeof limit);
  
  // Ensure limit is a positive integer
  const sanitizedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  console.log('Sanitized limit:', sanitizedLimit);
  
  return await executeQuery(
    connection,
    `SELECT gh.*, g.game_mode, g.map_selection_mode
     FROM squidcup_game_history gh
     LEFT JOIN squidcup_games g ON gh.game_id = g.id
     WHERE gh.player_steam_id = '?'
     ORDER BY gh.created_at DESC
     LIMIT ?`,
    [steamId, Number(sanitizedLimit)]
  );
}

// Consolidated function to get user's complete status (session + game + player names)
export async function getUserCompleteStatus(sessionToken: string): Promise<UserCompleteStatus> {
  const connection = await getDatabaseConnection();
  console.log('getUserCompleteStatus called with token:', sessionToken.substring(0, 8) + '...');
  
  // Step 1: Validate session
  const session = await executeQuery(
    connection,
    'SELECT * FROM squidcup_sessions WHERE session_token = ? AND expires_at > NOW()',
    [sessionToken]
  );
  
  if (!session || session.length === 0) {
    return { session: null };
  }
  
  const userSteamId = session[0].user_steam_id;
  console.log('User Steam ID from session:', userSteamId);
  
  // Step 2: Check for active game (as host)
  const hostGame = await executeQuery(
    connection,
    `SELECT g.*, 'host' as user_role
     FROM squidcup_games g 
     WHERE g.host_steam_id = ? AND (
       g.status IN ('queue', 'lobby', 'in_progress') OR 
       (g.status = 'completed' AND EXISTS (
         SELECT 1 FROM squidcup_game_players gp 
         WHERE gp.game_id = g.id AND gp.player_steam_id = ? AND gp.player_accepted_match_result = FALSE
       ))
     )`,
    [userSteamId, userSteamId]
  );
  
  // Step 3: Check for active game (as player)
  const playerGame = await executeQuery(
    connection,
    `SELECT g.*, 'player' as user_role
     FROM squidcup_games g 
     JOIN squidcup_game_players gp ON g.id = gp.game_id 
     WHERE gp.player_steam_id = ? AND (
       g.status IN ('queue', 'lobby', 'in_progress') OR 
       (g.status = 'completed' AND gp.player_accepted_match_result = FALSE)
     )`,
    [userSteamId]
  );
  
  // Log for debugging
  console.log('Game check results for user:', userSteamId);
  console.log('Host games found:', hostGame.length);
  console.log('Player games found:', playerGame.length);
  
  let activeGame = null;
  let isGameHost = false;
  
  if (hostGame.length > 0) {
    activeGame = hostGame[0];
    isGameHost = true;
  } else if (playerGame.length > 0) {
    activeGame = playerGame[0];
    isGameHost = false;
  }
  
  // Step 4: If in game, get game players and their names
  let gamePlayers = [];
  let gamePlayerNames = new Map();
  let gamePlayerAvatars = new Map();
  let gamePlayerElos = new Map();

  if (activeGame) {
    console.log('User found in game:', activeGame.id, 'status:', activeGame.status);
    
    // Get all game players
    gamePlayers = await executeQuery(
      connection,
      'SELECT * FROM squidcup_game_players WHERE game_id = ?',
      [activeGame.id]
    );
    
    // Get teams for the game
    const gameTeams = await executeQuery(
      connection,
      'SELECT * FROM squidcup_game_teams WHERE game_id = ? ORDER BY team_number',
      [activeGame.id]
    );
    
    // Get player names and avatars for game
    const allGameIds = [activeGame.host_steam_id, ...gamePlayers.map((p: any) => p.player_steam_id)];
    const gameUsers = await executeQuery(
      connection,
      `SELECT steam_id, username, avatar, current_elo FROM squidcup_users WHERE steam_id IN (${allGameIds.map(() => '?').join(',')})`,
      allGameIds
    );
    
    for (const user of gameUsers) {
      gamePlayerNames.set(user.steam_id, user.username || `Player ${user.steam_id.slice(-4)}`);
      gamePlayerAvatars.set(user.steam_id, user.avatar || null);
      gamePlayerElos.set(user.steam_id, user.current_elo || 1000);
    }
    
    // Add fallback names for missing users
    for (const steamId of allGameIds) {
      if (!gamePlayerNames.has(steamId)) {
        gamePlayerNames.set(steamId, `Player ${steamId.slice(-4)}`);
        gamePlayerAvatars.set(steamId, null);
        gamePlayerElos.set(steamId, 1000);
      }
    }
    
    const gameData = {
      ...activeGame,
      isHost: isGameHost,
      players: gamePlayers,
      playerNames: Object.fromEntries(gamePlayerNames),
      playerAvatars: Object.fromEntries(gamePlayerAvatars),
      playerElos: Object.fromEntries(gamePlayerElos),
      teams: gameTeams // Add teams to the response
    };    // If game is in progress, include server connection information
    if (activeGame.status === 'in_progress' && activeGame.server_id) {
      try {
        const serverInfo = await getServerInfoForGame(activeGame.id);
        if (serverInfo) {
          gameData.server = {
            ip: serverInfo.ip,
            port: serverInfo.port,
            password: serverInfo.default_password
          };
        }
      } catch (error) {
        console.error('Failed to get server info for game:', activeGame.id, error);
      }
    }
    
    return {
      session: session[0],
      userSteamId,
      game: gameData,
      // Legacy compatibility - populate queue or lobby based on status
      ...(activeGame.status === 'queue' ? { queue: gameData } : {}),
      ...(activeGame.status === 'lobby' ? { lobby: gameData } : {}),
      ...(activeGame.status === 'in_progress' ? { lobby: gameData } : {}), // Also return as lobby for in_progress games
      ...(activeGame.status === 'completed' ? { lobby: gameData } : {}) // Also return as lobby for completed games where player hasn't accepted
    };
  }
  
  // User is not in any game
  return {
    session: session[0],
    userSteamId
  };
}

// Function to get SSM parameter value (for external use)
export async function getSsmParameter(parameterName: string): Promise<string> {
  return await getParameterValue(parameterName);
}

// Function to get active games for cleanup (simple format)
export async function getActiveGamesForCleanup(): Promise<QueueCleanupRecord[]> {
  const connection = await getDatabaseConnection();
  return await executeQuery(
    connection,
    `SELECT 
      id,
      host_steam_id,
      game_mode,
      map_selection_mode,
      start_time,
      created_at,
      updated_at
     FROM squidcup_games
     WHERE status IN ('queue')
     ORDER BY created_at DESC`
  );
}

// Function to get active games with user and server details
export async function getActiveGamesWithDetails(): Promise<ActiveQueueWithDetails[]> {
  const connection = await getDatabaseConnection();
  
  // Get all active games with host information and server details
  const games = await executeQuery(
    connection,
    `SELECT 
      g.id,
      g.game_mode,
      g.map,
      g.map_selection_mode,
      g.host_steam_id,
      g.server_id,
      g.password,
      g.ranked,
      g.start_time,
      g.max_players,
      g.current_players,
      g.status,
      g.created_at,
      g.updated_at,
      u.username as host_name,
      s.nickname as server_name
     FROM squidcup_games g
     LEFT JOIN squidcup_users u ON g.host_steam_id = u.steam_id
     LEFT JOIN squidcup_servers s ON g.server_id = s.id
     WHERE g.status = 'queue'
     ORDER BY g.created_at DESC`
  );

  // For each game, get the players
  const result = [];
  for (const game of games) {
    // Get game players
    const players = await executeQuery(
      connection,
      `SELECT 
        gp.player_steam_id,
        gp.team_id,
        gp.joined_at,
        u.username
       FROM squidcup_game_players gp
       LEFT JOIN squidcup_users u ON gp.player_steam_id = u.steam_id
       WHERE gp.game_id = ?
       ORDER BY gp.joined_at`,
      [game.id]
    );

    // Convert to format expected by frontend
    const joiners = players.map((player: any) => ({
      steamId: player.player_steam_id,
      joinTime: player.joined_at,
      name: player.username || 'Unknown'
    }));

    result.push({
      queueId: game.id, // Legacy field name for API compatibility
      hostSteamId: game.host_steam_id,
      hostName: game.host_name || 'Unknown',
      gameMode: game.game_mode,
      mapSelectionMode: game.map_selection_mode,
      serverId: game.server_id,
      serverName: game.server_name || 'Unknown Server',
      startTime: game.start_time,
      players: joiners.length, // Use actual player count from game_players table
      maxPlayers: game.max_players,
      joiners: joiners,
      ranked: !!game.ranked,
      hasPassword: !!game.password,
      createdAt: game.created_at,
      lastActivity: game.updated_at || game.created_at
    });
  }

  return result;
}

// Map selection functions for all-pick mode
export async function updatePlayerMapSelection(gameId: string, steamId: string, mapId: string): Promise<void> {
  const connection = await getDatabaseConnection();
  await executeQuery(
    connection,
    'UPDATE squidcup_game_players SET map_selection = ? WHERE game_id = ? AND player_steam_id = ?',
    [mapId, gameId, steamId]
  );
}

export async function getMapSelectionStatus(gameId: string): Promise<{ hasAllSelected: boolean; mapSelections: { [playerId: string]: string }; totalPlayers: number; playersWithSelections: number }> {
  const connection = await getDatabaseConnection();
  const players = await executeQuery(
    connection,
    'SELECT player_steam_id, map_selection FROM squidcup_game_players WHERE game_id = ?',
    [gameId]
  );

  const mapSelections: { [playerId: string]: string } = {};
  let playersWithSelections = 0;

  players.forEach((player: any) => {
    if (player.map_selection) {
      mapSelections[player.player_steam_id] = player.map_selection;
      playersWithSelections++;
    }
  });

  const totalPlayers = players.length;
  const hasAllSelected = playersWithSelections === totalPlayers && totalPlayers > 0;

  return {
    hasAllSelected,
    mapSelections,
    totalPlayers,
    playersWithSelections
  };
}

export async function selectRandomMapFromSelections(gameId: string): Promise<string | null> {
  const { mapSelections, hasAllSelected } = await getMapSelectionStatus(gameId);
  
  if (!hasAllSelected) {
    return null;
  }

  const selectedMaps = Object.values(mapSelections);
  if (selectedMaps.length === 0) {
    return null;
  }

  // Select a random map from the player selections
  const randomIndex = Math.floor(Math.random() * selectedMaps.length);
  return selectedMaps[randomIndex];
}

// Raw query execution function
export async function executeRawQuery(query: string, params: any[] = []): Promise<any> {
  const connection = await getDatabaseConnection();
  return await executeQuery(connection, query, params);
}

// Update the replaceRandomMapSelections function to use the new steam module
export async function replaceRandomMapSelections(gameId: string, availableMaps: string[]): Promise<void> {
  const connection = await getDatabaseConnection();
  
  // Get players who selected "random" map
  const randomSelectors = await executeQuery(
    connection,
    'SELECT player_steam_id FROM squidcup_game_players WHERE game_id = ? AND map_selection = ?',
    [gameId, 'random']
  );

  // Import the function from steam module
  const { selectRandomMapFromAvailable } = await import('../steam');

  // Replace each random selection with an actual random map
  for (const player of randomSelectors) {
    const randomMap = selectRandomMapFromAvailable(availableMaps);
    if (randomMap) {
      await executeQuery(
        connection,
        'UPDATE squidcup_game_players SET map_selection = ? WHERE game_id = ? AND player_steam_id = ?',
        [randomMap, gameId, player.player_steam_id]
      );
    }
  }
}

export async function getMatchHistory(): Promise<MatchHistoryMatch[]> {
  const connection = await getDatabaseConnection();
  
  try {
    // Complex query to get all match history data in one go
    const query = `
      SELECT 
        g.id as game_id,
        g.match_number,
        g.game_mode,
        g.map as map_id,
        g.ranked,
        g.start_time,
        
        -- Team 1 data
        gt1.id as team1_id,
        gt1.team_name as team1_name,
        gt1.average_elo as team1_average_elo,
        COALESCE(sm.team1_score, 0) as team1_score,
        
        -- Team 2 data  
        gt2.id as team2_id,
        gt2.team_name as team2_name,
        gt2.average_elo as team2_average_elo,
        COALESCE(sm.team2_score, 0) as team2_score,
        
        -- Player data
        gp.player_steam_id,
        gp.team_id,
        gt.team_number,
        u.username as player_name,
        
        -- Player stats
        COALESCE(sp.kills, 0) as kills,
        COALESCE(sp.deaths, 0) as deaths,
        COALESCE(sp.assists, 0) as assists,
        COALESCE(sp.damage, 0) as damage
        
      FROM squidcup_games g
      
      -- Join team 1
      LEFT JOIN squidcup_game_teams gt1 ON g.id = gt1.game_id AND gt1.team_number = 1
      
      -- Join team 2
      LEFT JOIN squidcup_game_teams gt2 ON g.id = gt2.game_id AND gt2.team_number = 2
      
      -- Join match scores (use match_number for stats tables)
      LEFT JOIN squidcup_stats_maps sm ON g.match_number = sm.matchid
      
      -- Join players
      LEFT JOIN squidcup_game_players gp ON g.id = gp.game_id
      LEFT JOIN squidcup_game_teams gt ON gp.team_id = gt.id
      LEFT JOIN squidcup_users u ON gp.player_steam_id = u.steam_id
      
      -- Join player stats (use match_number for stats tables, convert steam_id string to BIGINT for matching)
      LEFT JOIN squidcup_stats_players sp ON g.match_number = sp.matchid 
        AND CAST(gp.player_steam_id AS UNSIGNED) = sp.steamid64
      
      WHERE g.status = 'completed'
      ORDER BY g.start_time DESC, gp.player_steam_id
    `;

    const rows = await executeQuery(connection, query, []);

    // Group the results by match
    const matchesMap = new Map<string, MatchHistoryMatch>();
    
    for (const row of rows as any[]) {
      const matchNumber = row.match_number;
      
      if (!matchesMap.has(matchNumber)) {
        // Initialize match data
        matchesMap.set(matchNumber, {
          matchNumber,
          gameMode: row.game_mode,
          mapId: row.map_id || '',
          mapName: '', // Will be populated when we get map data
          mapThumbnailUrl: '', // Will be populated when we get map data
          ranked: !!row.ranked,
          startTime: row.start_time,
          team1: {
            teamNumber: 1,
            teamName: row.team1_name || 'Team 1',
            averageElo: row.team1_average_elo || 0,
            score: row.team1_score
          },
          team2: {
            teamNumber: 2,
            teamName: row.team2_name || 'Team 2', 
            averageElo: row.team2_average_elo || 0,
            score: row.team2_score
          },
          players: []
        });
      }

      // Add player to match if we have player data
      if (row.player_steam_id) {
        const match = matchesMap.get(matchNumber)!;
        
        // Check if player already added (avoid duplicates from joins)
        const existingPlayer = match.players.find(p => p.steamId === row.player_steam_id);
        if (!existingPlayer) {
          match.players.push({
            steamId: row.player_steam_id,
            name: row.player_name || `Player ${row.player_steam_id.slice(-4)}`,
            team: row.team_number || 1,
            kills: row.kills,
            deaths: row.deaths,
            assists: row.assists,
            damage: row.damage
          });
        }
      }
    }

    const matches = Array.from(matchesMap.values());

    // Get Steam API key for fetching map details
    try {
      const steamApiKey = await getParameterValue('/unencrypted/SteamApiKey');
      
      // Fetch map details for all unique map IDs
      const mapDetails = new Map<string, {name: string, thumbnailUrl: string}>();
      const uniqueMapIds = [...new Set(matches.map(match => match.mapId).filter(id => id))];
      
      console.log(`Fetching details for ${uniqueMapIds.length} unique maps`);
      
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
          // Set fallback data
          mapDetails.set(mapId, {
            name: `Workshop Map ${mapId}`,
            thumbnailUrl: ''
          });
        }
      });
      
      await Promise.all(mapPromises);
      
      // Apply map details to matches
      matches.forEach(match => {
        if (match.mapId) {
          const details = mapDetails.get(match.mapId);
          if (details) {
            match.mapName = details.name;
            match.mapThumbnailUrl = details.thumbnailUrl;
          } else {
            match.mapName = `Workshop Map ${match.mapId}`;
            match.mapThumbnailUrl = '';
          }
        }
      });
      
    } catch (error) {
      console.error('Failed to fetch Steam API key or map details:', error);
      // Fallback to placeholder names
      matches.forEach(match => {
        if (match.mapId) {
          match.mapName = `Workshop Map ${match.mapId}`;
          match.mapThumbnailUrl = '';
        }
      });
    }

    return matches;
  } finally {
    await connection.end();
  }
}

// Legacy compatibility functions (deprecated - use unified game functions instead)
export const getQueue = getGame;
export const getQueueWithPlayers = getGameWithPlayers;
export const getUserActiveQueue = getUserActiveGame;
export const getQueuePlayers = getGamePlayers;
export const createQueue = createGame;
export const updateQueue = updateGame;
export const addPlayerToQueue = addPlayerToGame;
export const removePlayerFromQueue = removePlayerFromGame;
export const deleteQueue = deleteGame;
export const getActiveQueuesForCleanup = getActiveGamesForCleanup;
export const getActiveQueuesWithDetails = getActiveGamesWithDetails;
export const storeQueueHistoryEvent = storeGameHistoryEvent;
export const getUserQueueHistory = getUserGameHistory;

// Lobby compatibility (all lobbies are now games with status='lobby')
export const getUserActiveLobby = getUserActiveGame;
export const createLobby = (lobbyData: any) => createGame({ ...lobbyData, status: 'lobby' });
export const getLobby = getGame;
export const getLobbyWithPlayers = getGameWithPlayers;
export const getLobbyPlayers = getGamePlayers;
export const updateLobby = updateGame;
export const addLobbyPlayers = (gameId: string, players: any[]) => {
  return Promise.all(players.map(player => addPlayerToGame(gameId, player)));
};
export const deleteLobby = deleteGame;
export const storeLobbyHistoryEvent = storeGameHistoryEvent;

// Helper function to get total rounds played for all players
async function getTotalRoundsPlayedByPlayers(connection: mysql.Connection): Promise<Map<string, number>> {
  const roundsQuery = `
    SELECT 
      sp.steamid64,
      SUM(COALESCE(sm.team1_score, 0) + COALESCE(sm.team2_score, 0)) as total_rounds
    FROM squidcup_stats_players sp
    LEFT JOIN squidcup_stats_maps sm ON sp.matchid = sm.matchid
    WHERE sm.matchid IS NOT NULL
    GROUP BY sp.steamid64
  `;

  console.log('Executing rounds query:', roundsQuery);
  const roundsRows = await executeQuery(connection, roundsQuery, []);
  console.log('Rounds query returned', roundsRows.length, 'rows');
  
  const roundsMap = new Map<string, number>();
  
  for (const row of roundsRows as any[]) {
    const steamId = String(row.steamid64);
    const totalRounds = Number(row.total_rounds) || 0;
    console.log(`Player ${steamId} (type: ${typeof row.steamid64}): ${totalRounds} rounds (type: ${typeof row.total_rounds})`);
    roundsMap.set(steamId, totalRounds);
  }
  
  console.log('Final rounds map size:', roundsMap.size);
  console.log('Sample map entries:', Array.from(roundsMap.entries()).slice(0, 3));
  
  return roundsMap;
}

export async function getPlayerLeaderboardStats(): Promise<PlayerLeaderboardStats[]> {
  const connection = await getDatabaseConnection();
  
  try {
    // Get total rounds played for all players
    const totalRoundsMap = await getTotalRoundsPlayedByPlayers(connection);
    
    // Get win/loss data for each player
    const winLossQuery = `
      SELECT 
        gp.player_steam_id,
        COUNT(CASE WHEN 
          (gp.team_id IN (SELECT id FROM squidcup_game_teams WHERE game_id = g.id AND team_number = 1) AND SUBSTRING_INDEX(g.match_number, '-', -1) = '1-0') OR
          (gp.team_id IN (SELECT id FROM squidcup_game_teams WHERE game_id = g.id AND team_number = 2) AND SUBSTRING_INDEX(g.match_number, '-', -1) = '0-1')
        THEN 1 END) as wins,
        COUNT(*) as total_games
      FROM squidcup_game_players gp
      INNER JOIN squidcup_games g ON gp.game_id = g.id
      WHERE g.status = 'completed' AND g.match_number IS NOT NULL
      GROUP BY gp.player_steam_id
    `;
    
    const winLossRows = await executeQuery(connection, winLossQuery, []);
    const winLossMap = new Map();
    winLossRows.forEach((row: any) => {
      const steamId = String(row.player_steam_id);
      const wins = row.wins || 0;
      const totalGames = row.total_games || 0;
      const winrate = totalGames > 0 ? Number(((wins / totalGames) * 100).toFixed(1)) : 0;
      winLossMap.set(steamId, winrate);
    });
    
    // Query to get aggregated player stats from squidcup_stats_players joined with user info
    const query = `
      SELECT 
        sp.steamid64,
        u.username,
        u.avatar as avatar_url,
        u.country_code,
        u.state_code,
        u.current_elo,
        
        -- Aggregated stats from all matches
        SUM(sp.kills) as total_kills,
        SUM(sp.deaths) as total_deaths,
        SUM(sp.assists) as total_assists,
        SUM(sp.damage) as total_damage,
        SUM(sp.utility_damage) as total_utility_damage,
        SUM(sp.shots_fired_total) as total_shots_fired,
        SUM(sp.shots_on_target_total) as total_shots_on_target,
        SUM(sp.entry_count) as total_entry_count,
        SUM(sp.entry_wins) as total_entry_wins,
        SUM(sp.live_time) as total_live_time,
        SUM(sp.head_shot_kills) as total_head_shot_kills,
        SUM(sp.cash_earned) as total_cash_earned,
        SUM(sp.enemies_flashed) as total_enemies_flashed
        
      FROM squidcup_stats_players sp
      LEFT JOIN squidcup_users u ON CAST(sp.steamid64 AS CHAR) COLLATE utf8mb4_general_ci = u.steam_id COLLATE utf8mb4_general_ci
      GROUP BY sp.steamid64, u.username, u.avatar, u.country_code, u.state_code, u.current_elo
      HAVING total_kills > 0 OR total_deaths > 0  -- Only include players who have actually played
      ORDER BY total_kills DESC
    `;

    const rows = await executeQuery(connection, query, []);

    // Process the results and calculate derived stats
    const playerStats: PlayerLeaderboardStats[] = (rows as any[]).map(row => {
      const steamId = String(row.steamid64);
      const kills = row.total_kills || 0;
      const deaths = row.total_deaths || 0;
      const damage = row.total_damage || 0;
      const headShotKills = row.total_head_shot_kills || 0;
      const shotsFired = row.total_shots_fired || 0;
      const shotsOnTarget = row.total_shots_on_target || 0;
      const entryCount = row.total_entry_count || 0;
      const entryWins = row.total_entry_wins || 0;
      const totalRounds = totalRoundsMap.get(steamId) || 0;

      console.log(`Processing player ${steamId} (from steamid64: ${row.steamid64}, type: ${typeof row.steamid64})`);
      console.log(`  Looking up in rounds map...`);
      console.log(`  Found totalRounds: ${totalRounds}`);
      console.log(`  Map has key: ${totalRoundsMap.has(steamId)}`);

      // Calculate derived statistics
      const kdr = deaths > 0 ? Number((kills / deaths).toFixed(2)) : kills;
      const headShotPercentage = kills > 0 ? Number(((headShotKills / kills) * 100).toFixed(1)) : 0;
      const accuracy = shotsFired > 0 ? Number(((shotsOnTarget / shotsFired) * 100).toFixed(1)) : 0;
      const entryWinRate = entryCount > 0 ? Number(((entryWins / entryCount) * 100).toFixed(1)) : 0;
      const adr = totalRounds > 0 ? Number((damage / totalRounds).toFixed(1)) : 0;

      console.log(`  Final ADR calculation: ${damage} / ${totalRounds} = ${adr}`);

      return {
        steamId,
        username: row.username || `Player ${steamId.slice(-4)}`,
        avatarUrl: row.avatar_url || undefined,
        countryCode: row.country_code || undefined,
        stateCode: row.state_code || undefined,
        currentElo: row.current_elo || 1000,
        winrate: winLossMap.get(steamId) || 0,
        kills,
        deaths,
        assists: row.total_assists || 0,
        damage,
        utilityDamage: row.total_utility_damage || 0,
        shotsFiredTotal: shotsFired,
        shotsOnTargetTotal: shotsOnTarget,
        entryCount,
        entryWins,
        liveTime: row.total_live_time || 0,
        headShotKills,
        cashEarned: row.total_cash_earned || 0,
        enemiesFlashed: row.total_enemies_flashed || 0,
        totalRounds,
        // Calculated stats
        kdr,
        adr,
        headShotPercentage,
        accuracy,
        entryWinRate
      };
    });

    console.log(`Retrieved leaderboard stats for ${playerStats.length} players`);
    return playerStats;

  } finally {
    await connection.end();
  }
}

// Helper function to get map statistics by game mode
export async function getMapStats(): Promise<{ wingman: { mapId: string; gamesPlayed: number; totalRounds: number }[], threev3: { mapId: string; gamesPlayed: number; totalRounds: number }[], fivev5: { mapId: string; gamesPlayed: number; totalRounds: number }[] }> {
  const connection = await getDatabaseConnection();
  
  try {
    // First, get all completed games with their map IDs and match numbers
    const gamesQuery = `
      SELECT 
        map,
        match_number,
        game_mode
      FROM squidcup_games 
      WHERE status = 'completed' 
        AND map IS NOT NULL 
        AND match_number IS NOT NULL
    `;

    console.log('Executing games query:', gamesQuery);
    const games = await executeQuery(connection, gamesQuery, []);
    console.log(`Found ${games.length} completed games`);

    // Get match numbers for rounds lookup
    const matchNumbers = (games as any[]).map(game => game.match_number);
    
    if (matchNumbers.length === 0) {
      console.log('No completed games found, returning empty results');
      return { wingman: [], threev3: [], fivev5: [] };
    }

    // Get rounds data for these matches
    const roundsQuery = `
      SELECT 
        matchid,
        COALESCE(team1_score, 0) + COALESCE(team2_score, 0) as total_rounds
      FROM squidcup_stats_maps 
      WHERE matchid IN (${matchNumbers.map(() => '?').join(',')})
    `;

    console.log('Executing rounds query:', roundsQuery);
    const roundsData = await executeQuery(connection, roundsQuery, matchNumbers);
    console.log(`Found ${roundsData.length} rounds entries`);

    // Create a map of matchid -> total_rounds
    const roundsMap = new Map();
    (roundsData as any[]).forEach(row => {
      roundsMap.set(row.matchid, row.total_rounds || 0);
    });

    // Process games data to aggregate by map and game mode
    const mapStatsMap = new Map();
    
    (games as any[]).forEach(game => {
      const mapId = game.map;
      const gameMode = game.game_mode;
      const matchNumber = game.match_number;
      const totalRounds = roundsMap.get(matchNumber) || 0;

      const key = `${mapId}_${gameMode}`;
      
      if (!mapStatsMap.has(key)) {
        mapStatsMap.set(key, {
          mapId,
          gameMode,
          gamesPlayed: 0,
          totalRounds: 0
        });
      }

      const stats = mapStatsMap.get(key);
      stats.gamesPlayed += 1;
      stats.totalRounds += totalRounds;
    });

    console.log(`Processed ${mapStatsMap.size} unique map-gamemode combinations`);

    // Group by game mode - return just mapId, gamesPlayed, totalRounds for now
    const result: { 
      wingman: { mapId: string; gamesPlayed: number; totalRounds: number }[], 
      threev3: { mapId: string; gamesPlayed: number; totalRounds: number }[], 
      fivev5: { mapId: string; gamesPlayed: number; totalRounds: number }[] 
    } = {
      wingman: [],
      threev3: [],
      fivev5: []
    };

    for (const stats of mapStatsMap.values()) {
      const mapData = {
        mapId: stats.mapId,
        gamesPlayed: stats.gamesPlayed,
        totalRounds: stats.totalRounds
      };

      switch (stats.gameMode) {
        case 'wingman':
          result.wingman.push(mapData);
          break;
        case '3v3':
          result.threev3.push(mapData);
          break;
        case '5v5':
          result.fivev5.push(mapData);
          break;
      }
    }

    console.log(`Wingman maps: ${result.wingman.length}, 3v3 maps: ${result.threev3.length}, 5v5 maps: ${result.fivev5.length}`);
    return result;

  } finally {
    await connection.end();
  }
}

function jsDateToMySQLDate(date: Date): string {
  const dateISOString = date.toISOString();

  let mysqlDateTime = dateISOString;
  if (dateISOString.includes('T')) {
    // Convert ISO string (2025-07-25T08:00:24.370Z) to MySQL format (2025-07-25 08:00:24)
    mysqlDateTime = new Date(dateISOString).toISOString().slice(0, 19).replace('T', ' ');
  }
  return mysqlDateTime;
}

// ELO recalculation functions

// Get all completed games with their players for ELO recalculation
export async function getAllCompletedGamesWithPlayers(): Promise<CompletedGameWithPlayers[]> {
  const connection = await getDatabaseConnection();
  
  try {
    console.log('Getting all completed games with players and match results for ELO recalculation...');
    
    // Query to get all completed games with their players, team assignments, and match results
    const query = `
      SELECT 
        g.id as game_id,
        g.match_number,
        g.game_mode,
        g.start_time,
        
        -- Match results from stats table
        sm.team1_score,
        sm.team2_score,
        
        -- Player data
        gp.player_steam_id,
        gt.team_number,
        
        -- User data for names (optional)
        u.username as player_name
        
      FROM squidcup_games g
      
      -- Join match results (scores) - required for ELO calculation
      INNER JOIN squidcup_stats_maps sm ON g.match_number = sm.matchid
      
      -- Join players in game
      LEFT JOIN squidcup_game_players gp ON g.id = gp.game_id
      
      -- Join team assignments
      LEFT JOIN squidcup_game_teams gt ON gp.team_id = gt.id
      
      -- Join user data for names
      LEFT JOIN squidcup_users u ON gp.player_steam_id = u.steam_id
      
      WHERE g.status = 'completed' 
        AND g.match_number IS NOT NULL
        AND gt.team_number IS NOT NULL  -- Only include players with valid team assignments
      ORDER BY g.start_time ASC, g.match_number ASC
    `;

    const rows = await executeQuery(connection, query, []);
    console.log(`Found ${rows.length} game-player records from completed games with match results`);

    // Group the results by match number (not game_id, as we want unique matches)
    const gamesMap = new Map<string, CompletedGameWithPlayers>();
    
    for (const row of rows as any[]) {
      const matchNumber = row.match_number;
      
      if (!gamesMap.has(matchNumber)) {
        gamesMap.set(matchNumber, {
          gameId: row.game_id,
          matchNumber: matchNumber,
          gameMode: row.game_mode,
          startTime: row.start_time,
          team1Score: row.team1_score || 0,
          team2Score: row.team2_score || 0,
          players: []
        });
      }

      // Add player if present and has valid team assignment
      if (row.player_steam_id && row.team_number) {
        const game = gamesMap.get(matchNumber)!;
        game.players.push({
          steamId: row.player_steam_id,
          teamNumber: row.team_number,
          playerName: row.player_name || `Player ${row.player_steam_id.slice(-4)}`
        });
      }
    }

    const completedGames = Array.from(gamesMap.values());
    console.log(`Processed ${completedGames.length} unique completed games with match results`);
    
    // Log some statistics
    const totalPlayers = completedGames.reduce((sum, game) => sum + game.players.length, 0);
    const uniquePlayers = new Set(completedGames.flatMap(game => game.players.map(p => p.steamId)));
    
    console.log(`Total player-game combinations: ${totalPlayers}`);
    console.log(`Unique players involved: ${uniquePlayers.size}`);
    console.log(`Games with decisive results: ${completedGames.filter(g => g.team1Score !== g.team2Score).length}`);
    
    return completedGames;
  } finally {
    await connection.end();
  }
}
