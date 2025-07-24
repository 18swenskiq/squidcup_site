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
let cachedConfig: DatabaseConfig | null = null;

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

// Function to get database configuration from Parameter Store
async function getDatabaseConfig(): Promise<DatabaseConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const [host, port, user, password, database] = await Promise.all([
      getParameterValue('/squidcup/mysql/host'),
      getParameterValue('/squidcup/mysql/port'),
      getParameterValue('/squidcup/mysql/user'),
      getParameterValue('/squidcup/mysql/password'),
      getParameterValue('/squidcup/mysql/database')
    ]);

    cachedConfig = {
      host,
      port: parseInt(port, 10),
      user,
      password,
      database
    };

    return cachedConfig;
  } catch (error) {
    console.error('Error getting database configuration:', error);
    throw error;
  }
}

// Function to create database connection
async function createConnection(): Promise<mysql.Connection> {
  const config = await getDatabaseConfig();
  
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: {
      rejectUnauthorized: false
    }
  });

  return connection;
}

// Function to ensure database tables exist
async function ensureTablesExist(connection: mysql.Connection): Promise<void> {
  try {
    // Create users table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        steam_id VARCHAR(20) PRIMARY KEY,
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
      CREATE TABLE IF NOT EXISTS sessions (
        session_token VARCHAR(255) PRIMARY KEY,
        user_steam_id VARCHAR(20) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_steam_id) REFERENCES users(steam_id) ON DELETE CASCADE,
        INDEX idx_expires_at (expires_at),
        INDEX idx_user_steam_id (user_steam_id)
      )
    `);

    // Create servers table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS servers (
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
      CREATE TABLE IF NOT EXISTS queues (
        id VARCHAR(36) PRIMARY KEY,
        game_mode VARCHAR(20) NOT NULL,
        map VARCHAR(100),
        host_steam_id VARCHAR(20) NOT NULL,
        max_players INT NOT NULL,
        current_players INT DEFAULT 0,
        status ENUM('waiting', 'ready', 'in_progress', 'completed', 'cancelled') DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (host_steam_id) REFERENCES users(steam_id),
        INDEX idx_status (status),
        INDEX idx_game_mode (game_mode)
      )
    `);

    // Create queue_players table (many-to-many relationship)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS queue_players (
        queue_id VARCHAR(36) NOT NULL,
        player_steam_id VARCHAR(20) NOT NULL,
        team INT DEFAULT 0,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (queue_id, player_steam_id),
        FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE,
        FOREIGN KEY (player_steam_id) REFERENCES users(steam_id) ON DELETE CASCADE,
        INDEX idx_queue_id (queue_id),
        INDEX idx_player_steam_id (player_steam_id)
      )
    `);

    // Create lobbies table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS lobbies (
        id VARCHAR(36) PRIMARY KEY,
        queue_id VARCHAR(36),
        game_mode VARCHAR(20) NOT NULL,
        map VARCHAR(100),
        host_steam_id VARCHAR(20) NOT NULL,
        server_id VARCHAR(36),
        status ENUM('waiting', 'ready', 'in_progress', 'completed', 'cancelled') DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (queue_id) REFERENCES queues(id),
        FOREIGN KEY (host_steam_id) REFERENCES users(steam_id),
        FOREIGN KEY (server_id) REFERENCES servers(id),
        INDEX idx_status (status),
        INDEX idx_queue_id (queue_id)
      )
    `);

    // Create lobby_players table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS lobby_players (
        lobby_id VARCHAR(36) NOT NULL,
        player_steam_id VARCHAR(20) NOT NULL,
        team INT DEFAULT 0,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (lobby_id, player_steam_id),
        FOREIGN KEY (lobby_id) REFERENCES lobbies(id) ON DELETE CASCADE,
        FOREIGN KEY (player_steam_id) REFERENCES users(steam_id) ON DELETE CASCADE,
        INDEX idx_lobby_id (lobby_id),
        INDEX idx_player_steam_id (player_steam_id)
      )
    `);

    // Create history tables for audit trail
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS queue_history (
        id VARCHAR(36) PRIMARY KEY,
        queue_id VARCHAR(36) NOT NULL,
        player_steam_id VARCHAR(20) NOT NULL,
        event_type ENUM('join', 'leave', 'disband', 'timeout', 'complete') NOT NULL,
        event_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_queue_id (queue_id),
        INDEX idx_player_steam_id (player_steam_id),
        INDEX idx_event_type (event_type)
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS lobby_history (
        id VARCHAR(36) PRIMARY KEY,
        lobby_id VARCHAR(36) NOT NULL,
        player_steam_id VARCHAR(20) NOT NULL,
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
    const [rows] = await connection.execute(query, params);
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
    'SELECT user_steam_id as steamId, expires_at as expiresAt FROM sessions WHERE session_token = ? AND expires_at > NOW()',
    [sessionToken]
  );
  return rows.length > 0 ? rows[0] : null;
}

// Function to create session
async function createSession(connection: mysql.Connection, sessionToken: string, steamId: string, expiresAt: string): Promise<void> {
  await executeQuery(
    connection,
    'INSERT INTO sessions (session_token, user_steam_id, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)',
    [sessionToken, steamId, expiresAt]
  );
}

// Function to delete session
async function deleteSession(connection: mysql.Connection, sessionToken: string): Promise<void> {
  await executeQuery(
    connection,
    'DELETE FROM sessions WHERE session_token = ?',
    [sessionToken]
  );
}

// Function to get or create user
async function upsertUser(connection: mysql.Connection, userData: any): Promise<void> {
  await executeQuery(
    connection,
    `INSERT INTO users (steam_id, username, avatar, avatar_medium, avatar_full, country_code, state_code, is_admin)
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
      userData.steamId,
      userData.username,
      userData.avatar,
      userData.avatarMedium,
      userData.avatarFull,
      userData.countryCode,
      userData.stateCode,
      userData.isAdmin || false
    ]
  );
}

// Function to get user
async function getUser(connection: mysql.Connection, steamId: string): Promise<any> {
  const rows = await executeQuery(
    connection,
    'SELECT * FROM users WHERE steam_id = ?',
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
    `SELECT steam_id, username, avatar FROM users WHERE steam_id IN (${placeholders})`,
    steamIds
  );
  return rows;
}

// Function to add server
async function addServer(connection: mysql.Connection, serverData: any): Promise<void> {
  await executeQuery(
    connection,
    `INSERT INTO servers (id, ip, port, location, rcon_password, default_password, max_players, nickname)
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
async function getServers(connection: mysql.Connection): Promise<any[]> {
  return await executeQuery(connection, 'SELECT * FROM servers ORDER BY created_at DESC');
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
    `UPDATE servers SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

// Function to delete server
async function deleteServer(connection: mysql.Connection, serverId: string): Promise<void> {
  await executeQuery(connection, 'DELETE FROM servers WHERE id = ?', [serverId]);
}

// Function to get queue by ID
async function getQueue(connection: mysql.Connection, queueId: string): Promise<any> {
  const rows = await executeQuery(
    connection,
    'SELECT * FROM queues WHERE id = ?',
    [queueId]
  );
  return rows.length > 0 ? rows[0] : null;
}

// Function to get queue players
async function getQueuePlayers(connection: mysql.Connection, queueId: string): Promise<any[]> {
  return await executeQuery(
    connection,
    'SELECT * FROM queue_players WHERE queue_id = ? ORDER BY joined_at',
    [queueId]
  );
}

// Function to create lobby
async function createLobby(connection: mysql.Connection, lobbyData: any): Promise<void> {
  await executeQuery(
    connection,
    `INSERT INTO lobbies (id, queue_id, game_mode, map, host_steam_id, server_id, status)
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

// Function to add lobby players
async function addLobbyPlayers(connection: mysql.Connection, lobbyId: string, players: any[]): Promise<void> {
  if (players.length === 0) return;
  
  const values = players.map(player => [lobbyId, player.steamId, player.team || 0]);
  const placeholders = values.map(() => '(?, ?, ?)').join(', ');
  
  await executeQuery(
    connection,
    `INSERT INTO lobby_players (lobby_id, player_steam_id, team) VALUES ${placeholders}`,
    values.flat()
  );
}

// Function to delete queue and its players
async function deleteQueue(connection: mysql.Connection, queueId: string): Promise<void> {
  // Delete queue players first (due to foreign key constraints)
  await executeQuery(connection, 'DELETE FROM queue_players WHERE queue_id = ?', [queueId]);
  // Delete the queue
  await executeQuery(connection, 'DELETE FROM queues WHERE id = ?', [queueId]);
}

// Function to store lobby history event
async function storeLobbyHistoryEvent(connection: mysql.Connection, eventData: any): Promise<void> {
  await executeQuery(
    connection,
    `INSERT INTO lobby_history (id, lobby_id, player_steam_id, event_type, event_data)
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

// Function to get active queues with user and server details
async function getActiveQueuesWithDetails(connection: mysql.Connection): Promise<any[]> {
  // Get all active queues with host information
  const queues = await executeQuery(
    connection,
    `SELECT 
      q.id,
      q.game_mode,
      q.map,
      q.host_steam_id,
      q.max_players,
      q.current_players,
      q.status,
      q.created_at,
      q.updated_at,
      u.personaname as host_name
     FROM queues q
     LEFT JOIN users u ON q.host_steam_id = u.steam_id
     WHERE q.status = 'waiting'
     ORDER BY q.created_at DESC`
  );

  // For each queue, get the players and server details
  const result = [];
  for (const queue of queues) {
    // Get queue players
    const players = await executeQuery(
      connection,
      `SELECT 
        qp.player_steam_id,
        qp.team,
        qp.joined_at,
        u.personaname
       FROM queue_players qp
       LEFT JOIN users u ON qp.player_steam_id = u.steam_id
       WHERE qp.queue_id = ?
       ORDER BY qp.joined_at`,
      [queue.id]
    );

    // Convert to format expected by frontend
    const joiners = players.map((player: any) => ({
      steamId: player.player_steam_id,
      joinTime: player.joined_at,
      name: player.personaname || 'Unknown'
    }));

    result.push({
      queueId: queue.id,
      hostSteamId: queue.host_steam_id,
      hostName: queue.host_name || 'Unknown',
      gameMode: queue.game_mode,
      players: 1 + joiners.length, // host + joiners
      maxPlayers: queue.max_players,
      joiners: joiners,
      ranked: false, // TODO: Add ranked field to queues table when needed
      hasPassword: false, // TODO: Add password field to queues table when needed  
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
        const servers = await getServers(connection);
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

      case 'getQueuePlayers':
        const queuePlayers = await getQueuePlayers(connection, event.params![0]);
        return { success: true, data: queuePlayers };

      case 'createLobby':
        await createLobby(connection, event.data);
        return { success: true };

      case 'addLobbyPlayers':
        await addLobbyPlayers(connection, event.params![0], event.data);
        return { success: true };

      case 'deleteQueue':
        await deleteQueue(connection, event.params![0]);
        return { success: true };

      case 'storeLobbyHistoryEvent':
        await storeLobbyHistoryEvent(connection, event.data);
        return { success: true };

      case 'getActiveQueuesWithDetails':
        const activeQueues = await getActiveQueuesWithDetails(connection);
        return { success: true, data: activeQueues };

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
