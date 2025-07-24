// Shared type definitions for SquidCup Lambda functions

// Database types
export interface DatabaseConnection {
  host: string;
  user: string;
  password: string;
  database: string;
  port?: number;
}

// Session types
export interface Session {
  steamId: string;
  expiresAt: string;
}

// Queue types
export interface QueuePlayer {
  player_steam_id: string;
  team?: number;
  joined_at: string;
}

export interface LobbyPlayer {
  player_steam_id: string;
  team?: string;
  joined_at: string;
}

export interface QueueData {
  id: string;
  host_steam_id: string;
  game_mode: string;
  map_selection_mode: string;
  server_id: string;
  password?: string;
  ranked: boolean;
  start_time: string;
  max_players: number;
  current_players: number;
  status: string;
  players: QueuePlayer[];
  isHost?: boolean;
  created_at: string;
  updated_at: string;
}

export interface LobbyData {
  id: string;
  host_steam_id: string;
  game_mode: string;
  map_selection_mode: string;
  server_id: string;
  password?: string;
  ranked: boolean;
  status: string;
  players: LobbyPlayer[];
  isHost?: boolean;
  created_at: string;
  updated_at: string;
}

// User types
export interface User {
  steam_id: string;
  username?: string;
  profile_url?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// Lambda event types
export interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}
