import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import * as mysql from 'mysql2/promise';

// Initialize SSM client
const ssmClient = new SSMClient({ region: process.env.REGION });

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  caCert: string;
}

export interface DatabaseRequest {
  operation: string;
  table?: string;
  data?: any;
  query?: string;
  params?: any[];
  conditions?: any;
}

export interface DatabaseResponse {
  success: boolean;
  data?: any;
  error?: string;
  insertId?: number;
  affectedRows?: number;
}

// Cache for database configuration to avoid repeated SSM calls
// Uses Promise-based caching to prevent race conditions in concurrent Lambda executions
let cachedConfig: DatabaseConfig | null = null;
let configPromise: Promise<DatabaseConfig> | null = null;

// Function to get parameter from SSM Parameter Store
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

    // Create queues table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_queues (
        id VARCHAR(36) PRIMARY KEY,
        game_mode VARCHAR(20) NOT NULL,
        map VARCHAR(100),
        map_selection_mode ENUM('All Pick', 'Host Pick', 'Random Map') NOT NULL,
        host_steam_id VARCHAR(50) NOT NULL,
        server_id VARCHAR(36),
        password VARCHAR(255),
        ranked BOOLEAN DEFAULT FALSE,
        start_time TIMESTAMP NOT NULL,
        max_players INT NOT NULL,
        current_players INT DEFAULT 0,
        status ENUM('waiting', 'ready', 'in_progress', 'completed', 'cancelled') DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (host_steam_id) REFERENCES squidcup_users(steam_id),
        FOREIGN KEY (server_id) REFERENCES squidcup_servers(id),
        INDEX idx_status (status),
        INDEX idx_game_mode (game_mode),
        INDEX idx_server_id (server_id),
        INDEX idx_start_time (start_time)
      )
    `);

    // Create queue_players table (many-to-many relationship)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_queue_players (
        queue_id VARCHAR(36) NOT NULL,
        player_steam_id VARCHAR(50) NOT NULL,
        team INT DEFAULT 0,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (queue_id, player_steam_id),
        FOREIGN KEY (queue_id) REFERENCES squidcup_queues(id) ON DELETE CASCADE,
        FOREIGN KEY (player_steam_id) REFERENCES squidcup_users(steam_id) ON DELETE CASCADE,
        INDEX idx_queue_id (queue_id),
        INDEX idx_player_steam_id (player_steam_id)
      )
    `);

    // Create lobbies table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_lobbies (
        id VARCHAR(36) PRIMARY KEY,
        queue_id VARCHAR(36),
        game_mode VARCHAR(20) NOT NULL,
        map VARCHAR(100),
        host_steam_id VARCHAR(50) NOT NULL,
        server_id VARCHAR(36),
        status ENUM('waiting', 'ready', 'in_progress', 'completed', 'cancelled') DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (queue_id) REFERENCES squidcup_queues(id),
        FOREIGN KEY (host_steam_id) REFERENCES squidcup_users(steam_id),
        FOREIGN KEY (server_id) REFERENCES squidcup_servers(id),
        INDEX idx_status (status),
        INDEX idx_queue_id (queue_id)
      )
    `);

    // Create lobby_players table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_lobby_players (
        lobby_id VARCHAR(36) NOT NULL,
        player_steam_id VARCHAR(50) NOT NULL,
        team INT DEFAULT 0,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (lobby_id, player_steam_id),
        FOREIGN KEY (lobby_id) REFERENCES squidcup_lobbies(id) ON DELETE CASCADE,
        FOREIGN KEY (player_steam_id) REFERENCES squidcup_users(steam_id) ON DELETE CASCADE,
        INDEX idx_lobby_id (lobby_id),
        INDEX idx_player_steam_id (player_steam_id)
      )
    `);

    // Create history tables for audit trail
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_queue_history (
        id VARCHAR(36) PRIMARY KEY,
        queue_id VARCHAR(36) NOT NULL,
        player_steam_id VARCHAR(50) NOT NULL,
        event_type ENUM('join', 'leave', 'disband', 'timeout', 'complete') NOT NULL,
        event_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_queue_id (queue_id),
        INDEX idx_player_steam_id (player_steam_id),
        INDEX idx_event_type (event_type)
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS squidcup_lobby_history (
        id VARCHAR(36) PRIMARY KEY,
        lobby_id VARCHAR(36) NOT NULL,
        player_steam_id VARCHAR(50) NOT NULL,
        event_type ENUM('join', 'leave', 'disband', 'timeout', 'complete') NOT NULL,
        event_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_lobby_id (lobby_id),
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
    if (query.includes('squidcup_sessions')) {
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

// Function to get session
async function getSession(connection: mysql.Connection, sessionToken: string): Promise<any> {
  const rows = await executeQuery(
    connection,
    'SELECT user_steam_id as steamId, expires_at as expiresAt FROM squidcup_sessions WHERE session_token = ? AND expires_at > NOW()',
    [sessionToken]
  );
  return rows.length > 0 ? rows[0] : null;
}

// Function to create session
async function createSession(connection: mysql.Connection, sessionToken: string, steamId: string, expiresAt: string): Promise<void> {
  // Debug logging to see what data we're trying to insert
  console.log('createSession called with:');
  console.log('- sessionToken length:', sessionToken?.length, 'value:', sessionToken);
  console.log('- steamId length:', steamId?.length, 'value:', steamId);
  console.log('- expiresAt length:', expiresAt?.length, 'value:', expiresAt);
  
  // Convert ISO string to MySQL-compatible datetime format
  // MySQL TIMESTAMP expects 'YYYY-MM-DD HH:MM:SS' format
  let mysqlDateTime = expiresAt;
  if (expiresAt && typeof expiresAt === 'string' && expiresAt.includes('T')) {
    // Convert ISO string (2025-07-25T08:00:24.370Z) to MySQL format (2025-07-25 08:00:24)
    mysqlDateTime = new Date(expiresAt).toISOString().slice(0, 19).replace('T', ' ');
    console.log('Converted expiresAt from ISO to MySQL format:', mysqlDateTime);
  }
  
  await executeQuery(
    connection,
    'INSERT INTO squidcup_sessions (session_token, user_steam_id, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)',
    [sessionToken, steamId, mysqlDateTime]
  );
}

// Function to delete session
async function deleteSession(connection: mysql.Connection, sessionToken: string): Promise<void> {
  await executeQuery(
    connection,
    'DELETE FROM squidcup_sessions WHERE session_token = ?',
    [sessionToken]
  );
}

// Function to get or create user
async function upsertUser(connection: mysql.Connection, userData: any): Promise<void> {
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

// Function to get user
async function getUser(connection: mysql.Connection, steamId: string): Promise<any> {
  const rows = await executeQuery(
    connection,
    'SELECT * FROM squidcup_users WHERE steam_id = ?',
    [steamId]
  );
  return rows.length > 0 ? rows[0] : null;
}

// Function to get users by steam IDs
async function getUsersBySteamIds(connection: mysql.Connection, steamIds: string[]): Promise<any[]> {
  if (steamIds.length === 0) return [];
  
  const placeholders = steamIds.map(() => '?').join(',');
  const rows = await executeQuery(
    connection,
    `SELECT steam_id, username, avatar FROM squidcup_users WHERE steam_id IN (${placeholders})`,
    steamIds
  );
  return rows;
}

// Function to add server
async function addServer(connection: mysql.Connection, serverData: any): Promise<void> {
  await executeQuery(
    connection,
    `INSERT INTO squidcup_servers (id, ip, port, location, rcon_password, default_password, max_players, nickname)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      serverData.id,
      serverData.ip,
      serverData.port,
      serverData.location,
      serverData.rconPassword,
      serverData.defaultPassword || '',
      serverData.maxPlayers,
      serverData.nickname
    ]
  );
}

// Function to get all servers
async function getServers(connection: mysql.Connection, minPlayers?: number): Promise<any[]> {
  let query = 'SELECT * FROM squidcup_servers';
  const params: any[] = [];
  
  if (minPlayers && minPlayers > 0) {
    query += ' WHERE max_players >= ?';
    params.push(minPlayers);
  }
  
  query += ' ORDER BY created_at DESC';
  
  return await executeQuery(connection, query, params);
}

// Function to update server
async function updateServer(connection: mysql.Connection, serverId: string, serverData: any): Promise<void> {
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

// Function to delete server
async function deleteServer(connection: mysql.Connection, serverId: string): Promise<void> {
  await executeQuery(connection, 'DELETE FROM squidcup_servers WHERE id = ?', [serverId]);
}

// Function to get queue by ID
async function getQueue(connection: mysql.Connection, queueId: string): Promise<any> {
  const rows = await executeQuery(
    connection,
    'SELECT * FROM squidcup_queues WHERE id = ?',
    [queueId]
  );
  return rows.length > 0 ? rows[0] : null;
}

// Function to get queue with players by ID
async function getQueueWithPlayers(connection: mysql.Connection, queueId: string): Promise<any> {
  const queue = await getQueue(connection, queueId);
  if (!queue) return null;
  
  const players = await getQueuePlayers(connection, queueId);
  return {
    ...queue,
    players
  };
}

// Function to get user's active lobby (where they are host or player)
async function getUserActiveLobby(connection: mysql.Connection, steamId: string): Promise<any> {
  // First check if user is hosting a lobby
  const hostLobby = await executeQuery(
    connection,
    'SELECT * FROM squidcup_lobbies WHERE host_steam_id = ? AND status = "waiting"',
    [steamId]
  );
  
  if (hostLobby.length > 0) {
    const players = await getLobbyPlayers(connection, hostLobby[0].id);
    return {
      ...hostLobby[0],
      players,
      isHost: true
    };
  }
  
  // Check if user is a player in any lobby
  const playerLobby = await executeQuery(
    connection,
    `SELECT l.*, lp.joined_at, lp.team
     FROM squidcup_lobbies l
     INNER JOIN squidcup_lobby_players lp ON l.id = lp.lobby_id
     WHERE lp.player_steam_id = ? AND l.status = "waiting"`,
    [steamId]
  );
  
  if (playerLobby.length > 0) {
    const players = await getLobbyPlayers(connection, playerLobby[0].id);
    return {
      ...playerLobby[0],
      players,
      isHost: false,
      userJoinedAt: playerLobby[0].joined_at,
      userTeam: playerLobby[0].team
    };
  }
  
  return null;
}

// Function to get user's active queue (where they are host or player)
async function getUserActiveQueue(connection: mysql.Connection, steamId: string): Promise<any> {
  // First check if user is hosting a queue
  const hostQueue = await executeQuery(
    connection,
    'SELECT * FROM squidcup_queues WHERE host_steam_id = ? AND status = "waiting"',
    [steamId]
  );
  
  if (hostQueue.length > 0) {
    const players = await getQueuePlayers(connection, hostQueue[0].id);
    return {
      ...hostQueue[0],
      players,
      isHost: true
    };
  }
  
  // Check if user is a player in any queue
  const playerQueue = await executeQuery(
    connection,
    `SELECT q.*, qp.joined_at, qp.team
     FROM squidcup_queues q
     INNER JOIN squidcup_queue_players qp ON q.id = qp.queue_id
     WHERE qp.player_steam_id = ? AND q.status = "waiting"`,
    [steamId]
  );
  
  if (playerQueue.length > 0) {
    const players = await getQueuePlayers(connection, playerQueue[0].id);
    return {
      ...playerQueue[0],
      players,
      isHost: false,
      userJoinedAt: playerQueue[0].joined_at,
      userTeam: playerQueue[0].team
    };
  }
  
  return null;
}

// Function to get queue players
async function getQueuePlayers(connection: mysql.Connection, queueId: string): Promise<any[]> {
  return await executeQuery(
    connection,
    'SELECT * FROM squidcup_queue_players WHERE queue_id = ? ORDER BY joined_at',
    [queueId]
  );
}

// Function to create queue
async function createQueue(connection: mysql.Connection, queueData: any): Promise<void> {
  await executeQuery(
    connection,
    `INSERT INTO squidcup_queues (id, game_mode, map, map_selection_mode, host_steam_id, server_id, password, ranked, start_time, max_players)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      queueData.id,
      queueData.gameMode,
      queueData.map,
      queueData.mapSelectionMode,
      queueData.hostSteamId,
      queueData.serverId,
      queueData.password || null,
      queueData.ranked || false,
      queueData.startTime,
      queueData.maxPlayers
    ]
  );
}

// Function to update queue
async function updateQueue(connection: mysql.Connection, queueId: string, queueData: any): Promise<void> {
  const fields = [];
  const values = [];
  
  if (queueData.currentPlayers !== undefined) { fields.push('current_players = ?'); values.push(queueData.currentPlayers); }
  if (queueData.status !== undefined) { fields.push('status = ?'); values.push(queueData.status); }
  if (queueData.map !== undefined) { fields.push('map = ?'); values.push(queueData.map); }
  
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(queueId);
  
  await executeQuery(
    connection,
    `UPDATE squidcup_queues SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

// Function to add player to queue
async function addPlayerToQueue(connection: mysql.Connection, queueId: string, playerData: any): Promise<void> {
  await executeQuery(
    connection,
    `INSERT INTO squidcup_queue_players (queue_id, player_steam_id, team, joined_at)
     VALUES (?, ?, ?, ?)`,
    [
      queueId,
      playerData.steamId,
      playerData.team || 0,
      playerData.joinTime || new Date().toISOString()
    ]
  );
}

// Function to remove player from queue
async function removePlayerFromQueue(connection: mysql.Connection, queueId: string, steamId: string): Promise<void> {
  await executeQuery(
    connection,
    'DELETE FROM squidcup_queue_players WHERE queue_id = ? AND player_steam_id = ?',
    [queueId, steamId]
  );
}

// Function to create lobby
async function createLobby(connection: mysql.Connection, lobbyData: any): Promise<void> {
  await executeQuery(
    connection,
    `INSERT INTO squidcup_lobbies (id, queue_id, game_mode, map, host_steam_id, server_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      lobbyData.id,
      lobbyData.queueId,
      lobbyData.gameMode,
      lobbyData.map,
      lobbyData.hostSteamId,
      lobbyData.serverId,
      lobbyData.status || 'waiting'
    ]
  );
}

// Function to get lobby by ID
async function getLobby(connection: mysql.Connection, lobbyId: string): Promise<any> {
  const rows = await executeQuery(
    connection,
    'SELECT * FROM squidcup_lobbies WHERE id = ?',
    [lobbyId]
  );
  return rows.length > 0 ? rows[0] : null;
}

// Function to get lobby with players by ID
async function getLobbyWithPlayers(connection: mysql.Connection, lobbyId: string): Promise<any> {
  const lobby = await getLobby(connection, lobbyId);
  if (!lobby) return null;
  
  const players = await getLobbyPlayers(connection, lobbyId);
  return {
    ...lobby,
    players
  };
}

// Function to get lobby players
async function getLobbyPlayers(connection: mysql.Connection, lobbyId: string): Promise<any[]> {
  return await executeQuery(
    connection,
    'SELECT * FROM squidcup_lobby_players WHERE lobby_id = ? ORDER BY joined_at',
    [lobbyId]
  );
}

// Function to update lobby
async function updateLobby(connection: mysql.Connection, lobbyId: string, lobbyData: any): Promise<void> {
  const fields = [];
  const values = [];
  
  if (lobbyData.map !== undefined) { fields.push('map = ?'); values.push(lobbyData.map); }
  if (lobbyData.status !== undefined) { fields.push('status = ?'); values.push(lobbyData.status); }
  if (lobbyData.serverId !== undefined) { fields.push('server_id = ?'); values.push(lobbyData.serverId); }
  if (lobbyData.gameMode !== undefined) { fields.push('game_mode = ?'); values.push(lobbyData.gameMode); }
  
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(lobbyId);
  
  await executeQuery(
    connection,
    `UPDATE squidcup_lobbies SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

// Function to add lobby players
async function addLobbyPlayers(connection: mysql.Connection, lobbyId: string, players: any[]): Promise<void> {
  if (players.length === 0) return;
  
  const values = players.map(player => [lobbyId, player.steamId, player.team || 0]);
  const placeholders = values.map(() => '(?, ?, ?)').join(', ');
  
  await executeQuery(
    connection,
    `INSERT INTO squidcup_lobby_players (lobby_id, player_steam_id, team) VALUES ${placeholders}`,
    values.flat()
  );
}

// Function to delete lobby and its players
async function deleteLobby(connection: mysql.Connection, lobbyId: string): Promise<void> {
  // Delete lobby players first (due to foreign key constraints)
  await executeQuery(connection, 'DELETE FROM squidcup_lobby_players WHERE lobby_id = ?', [lobbyId]);
  // Delete the lobby
  await executeQuery(connection, 'DELETE FROM squidcup_lobbies WHERE id = ?', [lobbyId]);
}

// Function to delete queue and its players
async function deleteQueue(connection: mysql.Connection, queueId: string): Promise<void> {
  // Delete queue players first (due to foreign key constraints)
  await executeQuery(connection, 'DELETE FROM squidcup_queue_players WHERE queue_id = ?', [queueId]);
  // Delete the queue
  await executeQuery(connection, 'DELETE FROM squidcup_queues WHERE id = ?', [queueId]);
}

// Function to store lobby history event
async function storeLobbyHistoryEvent(connection: mysql.Connection, eventData: any): Promise<void> {
  await executeQuery(
    connection,
    `INSERT INTO squidcup_lobby_history (id, lobby_id, player_steam_id, event_type, event_data)
     VALUES (?, ?, ?, ?, ?)`,
    [
      eventData.id,
      eventData.lobbyId,
      eventData.playerSteamId,
      eventData.eventType,
      JSON.stringify(eventData.eventData || {})
    ]
  );
}

// Function to store queue history event
async function storeQueueHistoryEvent(connection: mysql.Connection, eventData: any): Promise<void> {
  await executeQuery(
    connection,
    `INSERT INTO squidcup_queue_history (id, queue_id, player_steam_id, event_type, event_data)
     VALUES (?, ?, ?, ?, ?)`,
    [
      eventData.id,
      eventData.queueId,
      eventData.playerSteamId,
      eventData.eventType,
      JSON.stringify(eventData.eventData || {})
    ]
  );
}

// Function to get queue history for a user
async function getUserQueueHistory(connection: mysql.Connection, steamId: string, limit: number = 50): Promise<any[]> {
  console.log('getUserQueueHistory called with steamId:', steamId, 'limit:', limit, 'limit type:', typeof limit);
  
  // Ensure limit is a positive integer
  const sanitizedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  console.log('Sanitized limit:', sanitizedLimit);
  
  return await executeQuery(
    connection,
    `SELECT qh.*, q.game_mode, q.map_selection_mode
     FROM squidcup_queue_history qh
     LEFT JOIN squidcup_queues q ON qh.queue_id = q.id
     WHERE qh.player_steam_id = ?
     ORDER BY qh.created_at DESC
     LIMIT ?`,
    [steamId, sanitizedLimit]
  );
}

// Consolidated function to get user's complete status (session + queue + lobby + player names)
async function getUserCompleteStatus(connection: mysql.Connection, sessionToken: string): Promise<any> {
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
  
  const userSteamId = session[0].steam_id;
  console.log('User Steam ID from session:', userSteamId);
  
  // Step 2: Check for active lobby (as host)
  const hostLobby = await executeQuery(
    connection,
    `SELECT l.*, 'host' as user_role
     FROM squidcup_lobbies l 
     WHERE l.host_steam_id = ? AND l.status = 'active'`,
    [userSteamId]
  );
  
  // Step 3: Check for active lobby (as player)
  const playerLobby = await executeQuery(
    connection,
    `SELECT l.*, 'player' as user_role
     FROM squidcup_lobbies l 
     JOIN squidcup_lobby_players lp ON l.id = lp.lobby_id 
     WHERE lp.player_steam_id = ? AND l.status = 'active'`,
    [userSteamId]
  );
  
  let activeLobby = null;
  let isLobbyHost = false;
  
  if (hostLobby.length > 0) {
    activeLobby = hostLobby[0];
    isLobbyHost = true;
  } else if (playerLobby.length > 0) {
    activeLobby = playerLobby[0];
    isLobbyHost = false;
  }
  
  // Step 4: If in lobby, get lobby players and their names
  let lobbyPlayers = [];
  let lobbyPlayerNames = new Map();
  
  if (activeLobby) {
    console.log('User found in lobby:', activeLobby.id);
    
    // Get all lobby players
    lobbyPlayers = await executeQuery(
      connection,
      'SELECT * FROM squidcup_lobby_players WHERE lobby_id = ?',
      [activeLobby.id]
    );
    
    // Get player names for lobby
    const allLobbyIds = [activeLobby.host_steam_id, ...lobbyPlayers.map((p: any) => p.player_steam_id)];
    const lobbyUsers = await executeQuery(
      connection,
      `SELECT steam_id, username FROM squidcup_users WHERE steam_id IN (${allLobbyIds.map(() => '?').join(',')})`,
      allLobbyIds
    );
    
    for (const user of lobbyUsers) {
      lobbyPlayerNames.set(user.steam_id, user.username || `Player ${user.steam_id.slice(-4)}`);
    }
    
    // Add fallback names for missing users
    for (const steamId of allLobbyIds) {
      if (!lobbyPlayerNames.has(steamId)) {
        lobbyPlayerNames.set(steamId, `Player ${steamId.slice(-4)}`);
      }
    }
    
    return {
      session: session[0],
      userSteamId,
      lobby: {
        ...activeLobby,
        isHost: isLobbyHost,
        players: lobbyPlayers,
        playerNames: Object.fromEntries(lobbyPlayerNames)
      }
    };
  }
  
  // Step 5: Check for active queue (as host)
  const hostQueue = await executeQuery(
    connection,
    `SELECT q.*, 'host' as user_role
     FROM squidcup_queues q 
     WHERE q.host_steam_id = ? AND q.status = 'waiting'`,
    [userSteamId]
  );
  
  // Step 6: Check for active queue (as player)
  const playerQueue = await executeQuery(
    connection,
    `SELECT q.*, 'player' as user_role
     FROM squidcup_queues q 
     JOIN squidcup_queue_players qp ON q.id = qp.queue_id 
     WHERE qp.player_steam_id = ? AND q.status = 'waiting'`,
    [userSteamId]
  );
  
  let activeQueue = null;
  let isQueueHost = false;
  
  if (hostQueue.length > 0) {
    activeQueue = hostQueue[0];
    isQueueHost = true;
  } else if (playerQueue.length > 0) {
    activeQueue = playerQueue[0];
    isQueueHost = false;
  }
  
  // Step 7: If in queue, get queue players and their names
  let queuePlayers = [];
  let queuePlayerNames = new Map();
  
  if (activeQueue) {
    console.log('User found in queue:', activeQueue.id);
    
    // Get all queue players
    queuePlayers = await executeQuery(
      connection,
      'SELECT * FROM squidcup_queue_players WHERE queue_id = ?',
      [activeQueue.id]
    );
    
    // Get player names for queue
    const allQueueIds = [activeQueue.host_steam_id, ...queuePlayers.map((p: any) => p.player_steam_id)];
    const queueUsers = await executeQuery(
      connection,
      `SELECT steam_id, username FROM squidcup_users WHERE steam_id IN (${allQueueIds.map(() => '?').join(',')})`,
      allQueueIds
    );
    
    for (const user of queueUsers) {
      queuePlayerNames.set(user.steam_id, user.username || `Player ${user.steam_id.slice(-4)}`);
    }
    
    // Add fallback names for missing users
    for (const steamId of allQueueIds) {
      if (!queuePlayerNames.has(steamId)) {
        queuePlayerNames.set(steamId, `Player ${steamId.slice(-4)}`);
      }
    }
    
    return {
      session: session[0],
      userSteamId,
      queue: {
        ...activeQueue,
        isHost: isQueueHost,
        players: queuePlayers,
        playerNames: Object.fromEntries(queuePlayerNames)
      }
    };
  }
  
  // User is not in any queue or lobby
  return {
    session: session[0],
    userSteamId
  };
}

// Function to get SSM parameter value
async function getSsmParameter(parameterName: string): Promise<string> {
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

// Function to get active queues for cleanup (simple format)
async function getActiveQueuesForCleanup(connection: mysql.Connection): Promise<any[]> {
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
     FROM squidcup_queues
     WHERE status = 'waiting'
     ORDER BY created_at DESC`
  );
}

// Function to get active queues with user and server details
async function getActiveQueuesWithDetails(connection: mysql.Connection): Promise<any[]> {
  // Get all active queues with host information and server details
  const queues = await executeQuery(
    connection,
    `SELECT 
      q.id,
      q.game_mode,
      q.map,
      q.map_selection_mode,
      q.host_steam_id,
      q.server_id,
      q.password,
      q.ranked,
      q.start_time,
      q.max_players,
      q.current_players,
      q.status,
      q.created_at,
      q.updated_at,
      u.username as host_name,
      s.nickname as server_name
     FROM squidcup_queues q
     LEFT JOIN squidcup_users u ON q.host_steam_id = u.steam_id
     LEFT JOIN squidcup_servers s ON q.server_id = s.id
     WHERE q.status = 'waiting'
     ORDER BY q.created_at DESC`
  );

  // For each queue, get the players
  const result = [];
  for (const queue of queues) {
    // Get queue players
    const players = await executeQuery(
      connection,
      `SELECT 
        qp.player_steam_id,
        qp.team,
        qp.joined_at,
        u.username
       FROM squidcup_queue_players qp
       LEFT JOIN squidcup_users u ON qp.player_steam_id = u.steam_id
       WHERE qp.queue_id = ?
       ORDER BY qp.joined_at`,
      [queue.id]
    );

    // Convert to format expected by frontend
    const joiners = players.map((player: any) => ({
      steamId: player.player_steam_id,
      joinTime: player.joined_at,
      name: player.username || 'Unknown'
    }));

    result.push({
      queueId: queue.id,
      hostSteamId: queue.host_steam_id,
      hostName: queue.host_name || 'Unknown',
      gameMode: queue.game_mode,
      mapSelectionMode: queue.map_selection_mode,
      serverId: queue.server_id,
      serverName: queue.server_name || 'Unknown Server',
      startTime: queue.start_time,
      players: 1 + joiners.length, // host + joiners
      maxPlayers: queue.max_players,
      joiners: joiners,
      ranked: !!queue.ranked,
      hasPassword: !!queue.password,
      createdAt: queue.created_at,
      lastActivity: queue.updated_at || queue.created_at
    });
  }

  return result;
}

// Main handler function
export async function handler(event: DatabaseRequest): Promise<DatabaseResponse> {
  console.log('Database service invoked with operation:', event.operation);

  let connection: mysql.Connection | null = null;

  try {
    // Create database connection
    connection = await createConnection();
    
    // Ensure tables exist on first call
    await ensureTablesExist(connection);

    // Route to appropriate operation
    switch (event.operation) {
      case 'getSession':
        const session = await getSession(connection, event.params![0]);
        return { success: true, data: session };

      case 'createSession':
        await createSession(connection, event.params![0], event.params![1], event.params![2]);
        return { success: true };

      case 'deleteSession':
        await deleteSession(connection, event.params![0]);
        return { success: true };

      case 'upsertUser':
        await upsertUser(connection, event.data);
        return { success: true };

      case 'getUser':
        const user = await getUser(connection, event.params![0]);
        return { success: true, data: user };

      case 'getUsersBySteamIds':
        const users = await getUsersBySteamIds(connection, event.params![0]);
        return { success: true, data: users };

      case 'addServer':
        await addServer(connection, event.data);
        return { success: true };

      case 'getServers':
        const minPlayers = event.data?.minPlayers;
        const servers = await getServers(connection, minPlayers);
        return { success: true, data: servers };

      case 'updateServer':
        await updateServer(connection, event.params![0], event.data);
        return { success: true };

      case 'deleteServer':
        await deleteServer(connection, event.params![0]);
        return { success: true };

      case 'getQueue':
        const queue = await getQueue(connection, event.params![0]);
        return { success: true, data: queue };

      case 'getQueueWithPlayers':
        const queueWithPlayers = await getQueueWithPlayers(connection, event.params![0]);
        return { success: true, data: queueWithPlayers };

      case 'getUserActiveQueue':
        const userQueue = await getUserActiveQueue(connection, event.params![0]);
        return { success: true, data: userQueue };

      case 'getUserActiveLobby':
        const userLobby = await getUserActiveLobby(connection, event.params![0]);
        return { success: true, data: userLobby };

      case 'getQueuePlayers':
        const queuePlayers = await getQueuePlayers(connection, event.params![0]);
        return { success: true, data: queuePlayers };

      case 'createLobby':
        await createLobby(connection, event.data);
        return { success: true };

      case 'getLobby':
        const lobby = await getLobby(connection, event.params![0]);
        return { success: true, data: lobby };

      case 'getLobbyWithPlayers':
        const lobbyWithPlayers = await getLobbyWithPlayers(connection, event.params![0]);
        return { success: true, data: lobbyWithPlayers };

      case 'getLobbyPlayers':
        const lobbyPlayers = await getLobbyPlayers(connection, event.params![0]);
        return { success: true, data: lobbyPlayers };

      case 'addLobbyPlayers':
        await addLobbyPlayers(connection, event.params![0], event.data);
        return { success: true };

      case 'updateLobby':
        await updateLobby(connection, event.params![0], event.data);
        return { success: true };

      case 'deleteLobby':
        await deleteLobby(connection, event.params![0]);
        return { success: true };

      case 'deleteQueue':
        await deleteQueue(connection, event.params![0]);
        return { success: true };

      case 'storeLobbyHistoryEvent':
        await storeLobbyHistoryEvent(connection, event.data);
        return { success: true };

      case 'storeQueueHistoryEvent':
        await storeQueueHistoryEvent(connection, event.data);
        return { success: true };

      case 'getUserCompleteStatus':
        console.log('Handling getUserCompleteStatus operation');
        const completeStatus = await getUserCompleteStatus(connection, event.data.sessionToken);
        return { success: true, data: completeStatus };

      case 'getUserQueueHistory':
        const queueHistory = await getUserQueueHistory(connection, event.data.steamId, event.data.limit);
        return { success: true, data: queueHistory };

      case 'getSsmParameter':
        const parameterValue = await getSsmParameter(event.data.parameterName);
        return { success: true, data: parameterValue };

      case 'getActiveQueuesForCleanup':
        const queuesForCleanup = await getActiveQueuesForCleanup(connection);
        return { success: true, data: queuesForCleanup };

      case 'getActiveQueuesWithDetails':
        const activeQueues = await getActiveQueuesWithDetails(connection);
        return { success: true, data: activeQueues };

      case 'createQueue':
        await createQueue(connection, event.data);
        return { success: true };

      case 'updateQueue':
        await updateQueue(connection, event.params![0], event.data);
        return { success: true };

      case 'addPlayerToQueue':
        await addPlayerToQueue(connection, event.params![0], event.data);
        return { success: true };

      case 'removePlayerFromQueue':
        await removePlayerFromQueue(connection, event.params![0], event.params![1]);
        return { success: true };

      case 'rawQuery':
        const result = await executeQuery(connection, event.query!, event.params || []);
        return { success: true, data: result };

      default:
        return { success: false, error: `Unknown operation: ${event.operation}` };
    }
  } catch (error) {
    console.error('Database service error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;











