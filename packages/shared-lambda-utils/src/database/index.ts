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
  GameTeamRecord
} from '../types';

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
        INDEX idx_host_steam_id (host_steam_id)
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
    `INSERT INTO squidcup_users (steam_id, username, avatar, avatar_medium, avatar_full, country_code, state_code, is_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
     username = VALUES(username),
     avatar = VALUES(avatar),
     avatar_medium = VALUES(avatar_medium),
     avatar_full = VALUES(avatar_full),
     country_code = VALUES(country_code),
     state_code = VALUES(state_code),
     updated_at = CURRENT_TIMESTAMP`,
    [
      userData.steamId || null,
      userData.username || null,
      userData.avatar || null,
      userData.avatarMedium || null,
      userData.avatarFull || null,
      userData.countryCode || null,
      userData.stateCode || null,
      userData.isAdmin || false
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
  let query = 'SELECT * FROM squidcup_servers';
  const params: any[] = [];
  
  if (minPlayers && minPlayers > 0) {
    query += ' WHERE max_players >= ?';
    params.push(minPlayers);
  }
  
  query += ' ORDER BY created_at DESC';
  
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
    'SELECT * FROM squidcup_games WHERE host_steam_id = ? AND status IN ("queue", "lobby")',
    [steamId]
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
     WHERE gp.player_steam_id = ? AND g.status IN ("queue", "lobby")`,
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
     WHERE g.host_steam_id = ? AND g.status IN ('queue', 'lobby', 'in_progress')`,
    [userSteamId]
  );
  
  // Step 3: Check for active game (as player)
  const playerGame = await executeQuery(
    connection,
    `SELECT g.*, 'player' as user_role
     FROM squidcup_games g 
     JOIN squidcup_game_players gp ON g.id = gp.game_id 
     WHERE gp.player_steam_id = ? AND g.status IN ('queue', 'lobby', 'in_progress')`,
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
    
    // Get player names for game
    const allGameIds = [activeGame.host_steam_id, ...gamePlayers.map((p: any) => p.player_steam_id)];
    const gameUsers = await executeQuery(
      connection,
      `SELECT steam_id, username FROM squidcup_users WHERE steam_id IN (${allGameIds.map(() => '?').join(',')})`,
      allGameIds
    );
    
    for (const user of gameUsers) {
      gamePlayerNames.set(user.steam_id, user.username || `Player ${user.steam_id.slice(-4)}`);
    }
    
    // Add fallback names for missing users
    for (const steamId of allGameIds) {
      if (!gamePlayerNames.has(steamId)) {
        gamePlayerNames.set(steamId, `Player ${steamId.slice(-4)}`);
      }
    }
    
    const gameData = {
      ...activeGame,
      isHost: isGameHost,
      players: gamePlayers,
      playerNames: Object.fromEntries(gamePlayerNames),
      teams: gameTeams // Add teams to the response
    };
    
    return {
      session: session[0],
      userSteamId,
      game: gameData,
      // Legacy compatibility - populate queue or lobby based on status
      ...(activeGame.status === 'queue' ? { queue: gameData } : {}),
      ...(activeGame.status === 'lobby' ? { lobby: gameData } : {})
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
     WHERE status IN ('queue', 'lobby')
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

function jsDateToMySQLDate(date: Date): string {
  const dateISOString = date.toISOString();

  let mysqlDateTime = dateISOString;
  if (dateISOString.includes('T')) {
    // Convert ISO string (2025-07-25T08:00:24.370Z) to MySQL format (2025-07-25 08:00:24)
    mysqlDateTime = new Date(dateISOString).toISOString().slice(0, 19).replace('T', ' ');
  }
  return mysqlDateTime;
}
