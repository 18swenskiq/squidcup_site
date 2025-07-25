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
export type MapSelectionMode = 'all-pick' | 'host-pick' | 'random-map';
export type QueueStatus = 'waiting' | 'matched' | 'cancelled';
export type LobbyStatus = 'active' | 'in_game' | 'completed' | 'cancelled';

// ===== MAP TYPES =====

export interface MapResponseObj {
  name: string;
  id: string;
  thumbnailUrl: string;
  gameModes: GameMode[];
}

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

export interface QueueHistoryEntry {
  id: string;
  gameMode: string;
  mapSelectionMode: string;
  ranked: boolean;
  startTime: string;
  endTime: string;
  status: 'completed' | 'cancelled' | 'disbanded' | 'timeout' | 'error' | 'active';
  statusDescription: string;
  wasHost: boolean;
  finalPlayerCount: number;
  duration: string;
}

export interface QueueJoiner {
  steamId: string;
  joinTime: string;
  name: string;
}

export interface ActiveQueueWithDetails {
  queueId: string;
  hostSteamId: string;
  hostName: string;
  gameMode: GameMode;
  mapSelectionMode: MapSelectionMode;
  serverId: string;
  serverName: string;
  startTime: string;
  players: number;
  maxPlayers: number;
  joiners: QueueJoiner[];
  ranked: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastActivity: string;
}

// Interface for admin queue management (frontend-specific format)
export interface QueueWithUserInfo {
  id: string;
  hostSteamId: string;
  hostName: string;
  gameMode: string;
  mapSelectionMode: string;
  serverId: string;
  serverName: string;
  hasPassword: boolean;
  ranked: boolean;
  startTime: string;
  joiners: Array<{
    steamId: string;
    name: string;
    joinTime: string;
  }>;
  createdAt: string;
  updatedAt: string;
  players: number;
  maxPlayers: number;
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

// ===== DATABASE SPECIFIC TYPES =====

export interface DatabaseQueue {
  id: string;
  game_mode: GameMode;
  map?: string;
  map_selection_mode: MapSelectionMode;
  host_steam_id: string;
  server_id?: string;
  password?: string;
  ranked: boolean;
  start_time: string;
  max_players: number;
  current_players: number;
  status: 'waiting' | 'ready' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface DatabaseLobby {
  id: string;
  queue_id?: string;
  game_mode: GameMode;
  map?: string;
  host_steam_id: string;
  server_id?: string;
  status: 'waiting' | 'ready' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface QueuePlayerRecord {
  queue_id: string;
  player_steam_id: string;
  team: number;
  joined_at: string;
}

export interface LobbyPlayerRecord {
  lobby_id: string;
  player_steam_id: string;
  team: number;
  joined_at: string;
}

export interface QueueHistoryRecord {
  id: string;
  queue_id: string;
  player_steam_id: string;
  event_type: 'join' | 'leave' | 'disband' | 'timeout' | 'complete';
  event_data?: any;
  created_at: string;
  game_mode?: string;
  map_selection_mode?: string;
}

export interface LobbyHistoryRecord {
  id: string;
  lobby_id: string;
  player_steam_id: string;
  event_type: 'join' | 'leave' | 'disband' | 'timeout' | 'complete';
  event_data?: any;
  created_at: string;
}

export interface EnrichedQueueWithPlayers extends DatabaseQueue {
  players: QueuePlayerRecord[];
  isHost?: boolean;
  userJoinedAt?: string;
  userTeam?: number;
}

export interface EnrichedLobbyWithPlayers extends DatabaseLobby {
  players: LobbyPlayerRecord[];
  isHost?: boolean;
  userJoinedAt?: string;
  userTeam?: number;
}

export interface UserCompleteStatus {
  session: Session | null;
  userSteamId?: string;
  queue?: {
    id: string;
    game_mode: string;
    map?: string;
    map_selection_mode: string;
    host_steam_id: string;
    server_id?: string;
    password?: string;
    ranked: boolean;
    start_time: string;
    max_players: number;
    current_players: number;
    status: string;
    created_at: string;
    updated_at: string;
    isHost: boolean;
    players: QueuePlayerRecord[];
    playerNames: Record<string, string>;
  };
  lobby?: {
    id: string;
    queue_id?: string;
    game_mode: string;
    map?: string;
    host_steam_id: string;
    server_id?: string;
    status: string;
    created_at: string;
    updated_at: string;
    isHost: boolean;
    players: LobbyPlayerRecord[];
    playerNames: Record<string, string>;
  };
}

export interface UserWithSteamData {
  steam_id: string;
  username: string;
  avatar: string;
}

export interface QueueCleanupRecord {
  id: string;
  host_steam_id: string;
  game_mode: string;
  map_selection_mode: string;
  start_time: string;
  created_at: string;
  updated_at: string;
}

// ===== INPUT DATA TYPES =====

export interface CreateQueueInput {
  id: string;
  gameMode: GameMode;
  map?: string;
  mapSelectionMode: MapSelectionMode;
  hostSteamId: string;
  serverId?: string;
  password?: string;
  ranked: boolean;
  startTime: string;
  maxPlayers: number;
}

export interface UpdateQueueInput {
  currentPlayers?: number;
  status?: 'waiting' | 'ready' | 'in_progress' | 'completed' | 'cancelled';
  map?: string;
}

export interface CreateLobbyInput {
  id: string;
  queueId?: string;
  gameMode: GameMode;
  map?: string;
  hostSteamId: string;
  serverId?: string;
  status?: 'waiting' | 'ready' | 'in_progress' | 'completed' | 'cancelled';
}

export interface UpdateLobbyInput {
  map?: string;
  status?: 'waiting' | 'ready' | 'in_progress' | 'completed' | 'cancelled';
  serverId?: string;
  gameMode?: GameMode;
}

export interface AddPlayerToQueueInput {
  steamId: string;
  team?: number;
  joinTime?: string;
}

export interface UpdateServerInput {
  ip?: string;
  port?: number;
  location?: string;
  rconPassword?: string;
  defaultPassword?: string;
  maxPlayers?: number;
  nickname?: string;
}

export interface UpsertUserInput {
  steamId: string;
  username?: string;
  avatar?: string;
  avatarMedium?: string;
  avatarFull?: string;
  countryCode?: string;
  stateCode?: string;
  isAdmin?: boolean;
}

export interface QueueHistoryEventInput {
  id: string;
  queueId: string;
  playerSteamId: string;
  eventType: 'join' | 'leave' | 'disband' | 'timeout' | 'complete';
  eventData?: any;
}

export interface LobbyHistoryEventInput {
  id: string;
  lobbyId: string;
  playerSteamId: string;
  eventType: 'join' | 'leave' | 'disband' | 'timeout' | 'complete';
  eventData?: any;
}

export interface AddLobbyPlayerInput {
  steamId: string;
  team?: number;
}

// ===== UTILITY TYPES =====

export type PlayerName = {
  steamId: string;
  name: string;
};

export type PlayerNameMap = Record<string, string>;

// ===== STEAM API TYPES =====

export interface SteamPlayer {
  steamid: string;
  communityvisibilitystate: number;
  profilestate: number;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  avatarhash: string;
  lastlogoff: number;
  personastate: number;
  realname?: string;
  primaryclanid?: string;
  timecreated?: number;
  personastateflags?: number;
  loccountrycode?: string;
  locstatecode?: string;
  loccityid?: number;
}

export interface SteamUserResponse {
  response: {
    players: SteamPlayer[];
  };
}
