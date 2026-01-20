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
  current_elo: number;
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
  queueId: string; // Legacy field name for API compatibility
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

// ===== API REQUEST TYPES =====

export interface SelectMapRequest {
  gameId: string;
  mapId: string;
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
  playerAvatars?: Record<string, string | null>;
  joiners: Array<{
    steamId: string;
    joinTime: string;
    name: string;
  }>;
}

export interface EnrichedLobbyData extends LobbyData {
  playerNames: Record<string, string>;
  playerAvatars?: Record<string, string | null>;
  enrichedPlayers: Array<{
    steamId: string;
    team?: string;
    joinedAt: string;
    name: string;
  }>;
}

// ===== UNIFIED GAME TYPES (replaces separate Queue/Lobby types) =====

export interface DatabaseGame {
  id: string;
  match_number: number;
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
  status: 'queue' | 'lobby' | 'in_progress' | 'completed' | 'cancelled';
  map_anim_select_start_time?: number | null;
  created_at: string;
  updated_at: string;
}

export interface GamePlayerRecord {
  game_id: string;
  player_steam_id: string;
  team_id?: string; // Foreign key to squidcup_game_teams table
  joined_at: string;
  map_selection?: string; // Optional map selection (map ID)
  player_accepted_match_result?: boolean; // Whether player accepted the match result
}

export interface GameTeamRecord {
  id: string;
  game_id: string;
  team_number: number;
  team_name: string;
  average_elo: number;
  created_at: string;
}

export interface GameHistoryRecord {
  id: string;
  game_id: string;
  player_steam_id: string;
  event_type: 'join' | 'leave' | 'disband' | 'timeout' | 'complete' | 'convert_to_lobby';
  event_data?: any;
  created_at: string;
  game_mode?: string;
  map_selection_mode?: string;
}

export interface EnrichedGameWithPlayers extends DatabaseGame {
  players: GamePlayerRecord[];
  isHost?: boolean;
  userJoinedAt?: string;
  userTeam?: number;
}

export interface UserCompleteStatus {
  session: Session | null;
  userSteamId?: string;
  game?: {
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
    map_anim_select_start_time?: number | null;
    created_at: string;
    updated_at: string;
    isHost: boolean;
    players: GamePlayerRecord[];
    playerNames: Record<string, string>;
    playerAvatars?: Record<string, string | null>;
    playerElos?: Record<string, number>;
    teams?: GameTeamRecord[]; // Include teams data for proper team assignment mapping
  };
  // Legacy compatibility properties
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
    map_anim_select_start_time?: number | null;
    created_at: string;
    updated_at: string;
    isHost: boolean;
    players: GamePlayerRecord[];
    playerNames: Record<string, string>;
    playerAvatars?: Record<string, string | null>;
    playerElos?: Record<string, number>;
    teams?: GameTeamRecord[]; // Include teams data for proper team assignment mapping
  };
  lobby?: {
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
    map_anim_select_start_time?: number | null;
    created_at: string;
    updated_at: string;
    isHost: boolean;
    players: GamePlayerRecord[];
    playerNames: Record<string, string>;
    playerAvatars?: Record<string, string | null>;
    playerElos?: Record<string, number>;
    teams?: GameTeamRecord[]; // Include teams data for proper team assignment mapping
  };
}

export interface UserWithSteamData {
  steam_id: string;
  username: string;
  avatar: string;
  current_elo: number;
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

export interface CreateGameInput {
  id: string;
  gameMode: GameMode;
  map?: string;
  mapSelectionMode: MapSelectionMode;
  hostSteamId: string;
  serverId?: string;
  password?: string;
  ranked: boolean;
  startTime: Date;
  maxPlayers: number;
  status?: 'queue' | 'lobby' | 'in_progress' | 'completed' | 'cancelled';
}

export interface UpdateGameInput {
  currentPlayers?: number;
  status?: 'queue' | 'lobby' | 'in_progress' | 'completed' | 'cancelled';
  map?: string;
  mapSelectionMode?: MapSelectionMode;
  serverId?: string;
  gameMode?: GameMode;
  mapAnimSelectStartTime?: number | null;
}

export interface AddPlayerToGameInput {
  steamId: string;
  teamId?: string;
  joinTime?: Date;
}

export interface GameHistoryEventInput {
  id: string;
  gameId: string;
  playerSteamId: string;
  eventType: 'join' | 'leave' | 'disband' | 'timeout' | 'complete' | 'convert_to_lobby';
  eventData?: any;
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
  currentElo?: number;
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

// ===== LEGACY TYPE ALIASES (for backward compatibility) =====
export type LobbyPlayerRecord = GamePlayerRecord;
export type QueuePlayerRecord = GamePlayerRecord;
export type CreateLobbyInput = CreateGameInput;
export type UpdateLobbyInput = UpdateGameInput;
export type AddLobbyPlayerInput = AddPlayerToGameInput;
export type LobbyHistoryEventInput = GameHistoryEventInput;
export type QueueHistoryEventInput = GameHistoryEventInput;
export type QueueHistoryRecord = GameHistoryRecord;
export type DatabaseQueue = DatabaseGame;
export type DatabaseLobby = DatabaseGame;
export type EnrichedQueueWithPlayers = EnrichedGameWithPlayers;
export type EnrichedLobbyWithPlayers = EnrichedGameWithPlayers;
export type CreateQueueInput = CreateGameInput;
export type UpdateQueueInput = UpdateGameInput;
export type AddPlayerToQueueInput = AddPlayerToGameInput;

// ===== MATCH HISTORY TYPES =====

export interface MatchHistoryPlayer {
  steamId: string;
  name: string;
  team: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  eloChange: number;
}

export interface MatchHistoryTeam {
  teamNumber: number;
  teamName: string;
  averageElo: number;
  score: number;
}

export interface MatchHistoryMatch {
  matchNumber: string;
  gameMode: string;
  mapId: string;
  mapName: string;
  mapThumbnailUrl: string;
  ranked: boolean;
  startTime: string;
  team1: MatchHistoryTeam;
  team2: MatchHistoryTeam;
  players: MatchHistoryPlayer[];
}

export interface PlayerLeaderboardStats {
  steamId: string;
  username: string;
  avatarUrl?: string;
  countryCode?: string;
  stateCode?: string;
  currentElo: number; // Player's current ELO rating
  winrate: number; // Overall win rate percentage
  // Combined stats from squidcup_stats_players
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  utilityDamage: number;
  shotsFiredTotal: number;
  shotsOnTargetTotal: number;
  entryCount: number;
  entryWins: number;
  liveTime: number;
  headShotKills: number;
  cashEarned: number;
  enemiesFlashed: number;
  totalRounds: number; // Total rounds played across all matches
  // Calculated stats
  kdr: number;
  adr: number; // Average damage per round (if we have round data)
  headShotPercentage: number;
  accuracy: number; // shots on target / shots fired
  entryWinRate: number; // entry wins / entry count
}

// ===== ELO RECALCULATION TYPES =====

// Interface for completed game data with players for ELO recalculation
export interface CompletedGameWithPlayers {
  gameId: string;
  matchNumber: string;
  gameMode: string;
  startTime: string;
  team1Score: number;
  team2Score: number;
  players: {
    steamId: string;
    teamNumber: number;
    playerName?: string;
  }[];
}

// ===== MATCH STATS API TYPES (for game server integration) =====

export interface InitMatchRequest {
  matchId?: number;        // Optional: pre-assigned match ID
  team1Name: string;
  team2Name: string;
  serverIp: string;
  seriesType: string;      // "BO1", "BO3", etc.
  mapNumber: number;
  mapName: string;
}

export interface PlayerStatsUpdate {
  steamId64: number;
  team: string;
  name: string;
  kills: number;
  deaths: number;
  damage: number;
  assists: number;
  enemy5ks: number;
  enemy4ks: number;
  enemy3ks: number;
  enemy2ks: number;
  utilityCount: number;
  utilityDamage: number;
  utilitySuccesses: number;
  utilityEnemies: number;
  flashCount: number;
  flashSuccesses: number;
  healthPointsRemovedTotal: number;
  healthPointsDealtTotal: number;
  shotsFiredTotal: number;
  shotsOnTargetTotal: number;
  v1Count: number;
  v1Wins: number;
  v2Count: number;
  v2Wins: number;
  entryCount: number;
  entryWins: number;
  equipmentValue: number;
  moneySaved: number;
  killReward: number;
  liveTime: number;
  headShotKills: number;
  cashEarned: number;
  enemiesFlashed: number;
}

export interface UpdatePlayersRequest {
  players: PlayerStatsUpdate[];
}

export interface UpdateMapScoresRequest {
  team1Score: number;
  team2Score: number;
}

export interface EndMapRequest {
  winnerName: string;
  team1Score: number;
  team2Score: number;
  team1SeriesScore: number;
  team2SeriesScore: number;
}

export interface EndMatchRequest {
  winnerName: string;
  team1Score: number;
  team2Score: number;
}

export interface ServerAuthResult {
  authorized: boolean;
  serverId?: string;
}
