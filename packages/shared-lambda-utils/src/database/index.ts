import * as mysql from 'mysql2/promise';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { 
  User, 
  Session, 
  GameServer, 
  ActiveQueueWithDetails,
  DatabaseQueue,
  DatabaseLobby,
  QueuePlayerRecord,
  LobbyPlayerRecord,
  QueueHistoryRecord,
  LobbyHistoryRecord,
  EnrichedQueueWithPlayers,
  EnrichedLobbyWithPlayers,
  UserCompleteStatus,
  UserWithSteamData,
  QueueCleanupRecord,
  CreateQueueInput,
  UpdateQueueInput,
  CreateLobbyInput,
  UpdateLobbyInput,
  AddPlayerToQueueInput,
  UpdateServerInput,
  UpsertUserInput,
  QueueHistoryEventInput,
  LobbyHistoryEventInput,
  AddLobbyPlayerInput
} from '../types';

// Initialize SSM client
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Database configuration interface
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

export async function createSession(sessionToken: string, steamId: string, expiresAt: string): Promise<void> {
  const connection = await getDatabaseConnection();
  
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

// Queue management functions
export async function getQueue(queueId: string): Promise<DatabaseQueue | null> {
  const connection = await getDatabaseConnection();
  const rows = await executeQuery(
    connection,
    'SELECT * FROM squidcup_queues WHERE id = ?',
    [queueId]
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function getQueueWithPlayers(queueId: string): Promise<EnrichedQueueWithPlayers | null> {
  const queue = await getQueue(queueId);
  if (!queue) return null;
  
  const players = await getQueuePlayers(queueId);
  return {
    ...queue,
    players
  };
}

export async function getUserActiveQueue(steamId: string): Promise<EnrichedQueueWithPlayers | null> {
  const connection = await getDatabaseConnection();
  
  // First check if user is hosting a queue
  const hostQueue = await executeQuery(
    connection,
    'SELECT * FROM squidcup_queues WHERE host_steam_id = ? AND status = "waiting"',
    [steamId]
  );
  
  if (hostQueue.length > 0) {
    const players = await getQueuePlayers(hostQueue[0].id);
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
    const players = await getQueuePlayers(playerQueue[0].id);
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

export async function getQueuePlayers(queueId: string): Promise<QueuePlayerRecord[]> {
  const connection = await getDatabaseConnection();
  return await executeQuery(
    connection,
    'SELECT * FROM squidcup_queue_players WHERE queue_id = ? ORDER BY joined_at',
    [queueId]
  );
}

export async function createQueue(queueData: CreateQueueInput): Promise<void> {
  const connection = await getDatabaseConnection();
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

export async function updateQueue(queueId: string, queueData: UpdateQueueInput): Promise<void> {
  const connection = await getDatabaseConnection();
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

export async function addPlayerToQueue(queueId: string, playerData: AddPlayerToQueueInput): Promise<void> {
  const connection = await getDatabaseConnection();
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

export async function removePlayerFromQueue(queueId: string, steamId: string): Promise<void> {
  const connection = await getDatabaseConnection();
  await executeQuery(
    connection,
    'DELETE FROM squidcup_queue_players WHERE queue_id = ? AND player_steam_id = ?',
    [queueId, steamId]
  );
}

export async function deleteQueue(queueId: string): Promise<void> {
  const connection = await getDatabaseConnection();
  // Delete queue players first (due to foreign key constraints)
  await executeQuery(connection, 'DELETE FROM squidcup_queue_players WHERE queue_id = ?', [queueId]);
  // Delete the queue
  await executeQuery(connection, 'DELETE FROM squidcup_queues WHERE id = ?', [queueId]);
}

// Lobby management functions
export async function getUserActiveLobby(steamId: string): Promise<EnrichedLobbyWithPlayers | null> {
  const connection = await getDatabaseConnection();
  
  // First check if user is hosting a lobby
  const hostLobby = await executeQuery(
    connection,
    'SELECT * FROM squidcup_lobbies WHERE host_steam_id = ? AND status = "waiting"',
    [steamId]
  );
  
  if (hostLobby.length > 0) {
    const players = await getLobbyPlayers(hostLobby[0].id);
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
    const players = await getLobbyPlayers(playerLobby[0].id);
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

export async function createLobby(lobbyData: CreateLobbyInput): Promise<void> {
  const connection = await getDatabaseConnection();
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

export async function getLobby(lobbyId: string): Promise<DatabaseLobby | null> {
  const connection = await getDatabaseConnection();
  const rows = await executeQuery(
    connection,
    'SELECT * FROM squidcup_lobbies WHERE id = ?',
    [lobbyId]
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function getLobbyWithPlayers(lobbyId: string): Promise<EnrichedLobbyWithPlayers | null> {
  const lobby = await getLobby(lobbyId);
  if (!lobby) return null;
  
  const players = await getLobbyPlayers(lobbyId);
  return {
    ...lobby,
    players
  };
}

export async function getLobbyPlayers(lobbyId: string): Promise<LobbyPlayerRecord[]> {
  const connection = await getDatabaseConnection();
  return await executeQuery(
    connection,
    'SELECT * FROM squidcup_lobby_players WHERE lobby_id = ? ORDER BY joined_at',
    [lobbyId]
  );
}

export async function updateLobby(lobbyId: string, lobbyData: UpdateLobbyInput): Promise<void> {
  const connection = await getDatabaseConnection();
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

export async function addLobbyPlayers(lobbyId: string, players: AddLobbyPlayerInput[]): Promise<void> {
  if (players.length === 0) return;
  
  const connection = await getDatabaseConnection();
  const values = players.map(player => [lobbyId, player.steamId, player.team || 0]);
  const placeholders = values.map(() => '(?, ?, ?)').join(', ');
  
  await executeQuery(
    connection,
    `INSERT INTO squidcup_lobby_players (lobby_id, player_steam_id, team) VALUES ${placeholders}`,
    values.flat()
  );
}

export async function deleteLobby(lobbyId: string): Promise<void> {
  const connection = await getDatabaseConnection();
  // Delete lobby players first (due to foreign key constraints)
  await executeQuery(connection, 'DELETE FROM squidcup_lobby_players WHERE lobby_id = ?', [lobbyId]);
  // Delete the lobby
  await executeQuery(connection, 'DELETE FROM squidcup_lobbies WHERE id = ?', [lobbyId]);
}

// History functions
export async function storeLobbyHistoryEvent(eventData: LobbyHistoryEventInput): Promise<void> {
  const connection = await getDatabaseConnection();
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

export async function storeQueueHistoryEvent(eventData: QueueHistoryEventInput): Promise<void> {
  const connection = await getDatabaseConnection();
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

export async function getUserQueueHistory(steamId: string, limit: number = 50): Promise<QueueHistoryRecord[]> {
  const connection = await getDatabaseConnection();
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
    [steamId, Number(sanitizedLimit)]
  );
}

// Consolidated function to get user's complete status (session + queue + lobby + player names)
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

// Function to get SSM parameter value (for external use)
export async function getSsmParameter(parameterName: string): Promise<string> {
  return await getParameterValue(parameterName);
}

// Function to get active queues for cleanup (simple format)
export async function getActiveQueuesForCleanup(): Promise<QueueCleanupRecord[]> {
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
     FROM squidcup_queues
     WHERE status = 'waiting'
     ORDER BY created_at DESC`
  );
}

// Function to get active queues with user and server details
export async function getActiveQueuesWithDetails(): Promise<ActiveQueueWithDetails[]> {
  const connection = await getDatabaseConnection();
  
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

// Raw query execution function
export async function executeRawQuery(query: string, params: any[] = []): Promise<any> {
  const connection = await getDatabaseConnection();
  return await executeQuery(connection, query, params);
}
