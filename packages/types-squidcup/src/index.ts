// Shared type definitions for SquidCup platform
// Used across Frontend, Lambda functions, and other services

// ===== DATABASE TYPES =====

export interface DatabaseConnection {
  host: string;
  user: string;
  password: string;
  database: string;
  port?: number;
}

// ===== USER TYPES =====

export interface User {
  steam_id: string;
  username?: string;
  avatar?: string;
  avatar_medium?: string;
  avatar_full?: string;
  country_code?: string;
  state_code?: string;
  is_admin: boolean | number; // MySQL BOOLEAN can return 0/1 or true/false
  created_at: string;
  updated_at: string;
}

export interface Session {
  steamId: string;
  expiresAt: string;
}

// ===== GAME TYPES =====

export type GameMode = '5v5' | 'wingman' | '3v3' | '1v1';
export type MapSelectionMode = 'All Pick' | 'Host Pick' | 'Random Map';
export type QueueStatus = 'waiting' | 'matched' | 'cancelled';
export type LobbyStatus = 'active' | 'in_game' | 'completed' | 'cancelled';

// ===== QUEUE TYPES =====

export interface QueuePlayer {
  player_steam_id: string;
  team?: number;
  joined_at: string;
}

export interface QueueData {
  id: string;
  host_steam_id: string;
  game_mode: GameMode;
  map_selection_mode: MapSelectionMode;
  server_id: string;
  password?: string;
  ranked: boolean;
  start_time: string;
  max_players: number;
  current_players: number;
  status: QueueStatus;
  players: QueuePlayer[];
  isHost?: boolean;
  created_at: string;
  updated_at: string;
}

export interface QueueHistoryEvent {
  id: string;
  queue_id: string;
  player_steam_id: string;
  event_type: 'start' | 'join' | 'leave' | 'match' | 'cancel';
  event_data?: Record<string, any>;
  created_at: string;
}

// ===== LOBBY TYPES =====

export interface LobbyPlayer {
  player_steam_id: string;
  team?: string;
  joined_at: string;
}

export interface LobbyData {
  id: string;
  host_steam_id: string;
  game_mode: GameMode;
  map_selection_mode: MapSelectionMode;
  server_id: string;
  password?: string;
  ranked: boolean;
  status: LobbyStatus;
  players: LobbyPlayer[];
  isHost?: boolean;
  created_at: string;
  updated_at: string;
}

export interface LobbyHistoryEvent {
  id: string;
  lobby_id: string;
  player_steam_id: string;
  event_type: 'create' | 'join' | 'leave' | 'start_game' | 'end_game' | 'disband';
  event_data?: Record<string, any>;
  created_at: string;
}

// ===== SERVER TYPES =====

export interface GameServer {
  id: string;
  ip: string;
  port: number;
  location: string;
  rcon_password: string;
  default_password: string;
  max_players: number;
  nickname: string;
  created_at: string;
  updated_at: string;
}

export interface Server {
  id: string;
  name: string;
  ip: string;
  port: number;
  region: string;
  status: 'online' | 'offline' | 'maintenance';
  current_players: number;
  max_players: number;
  game_mode_support: GameMode[];
}

// ===== API RESPONSE TYPES =====

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ===== FRONTEND SPECIFIC TYPES =====

export interface ViewState {
  showStartQueue: boolean;
  showJoinQueue: boolean;
  showLobby: boolean;
  isLoading: boolean;
  error?: string;
}

export interface QueueFormData {
  gameMode: GameMode;
  mapSelectionMode: MapSelectionMode;
  server: string;
  password?: string;
  ranked: boolean;
}

// ===== LAMBDA RESPONSE TYPES =====

export interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// ===== ENRICHED TYPES (with additional computed fields) =====

export interface EnrichedQueueData extends QueueData {
  playerNames: Record<string, string>;
  joiners: Array<{
    steamId: string;
    joinTime: string;
    name: string;
  }>;
}

export interface EnrichedLobbyData extends LobbyData {
  playerNames: Record<string, string>;
  enrichedPlayers: Array<{
    steamId: string;
    team?: string;
    joinedAt: string;
    name: string;
  }>;
}

// ===== UTILITY TYPES =====

export type PlayerName = {
  steamId: string;
  name: string;
};

export type PlayerNameMap = Record<string, string>;
