// Shared interfaces used across multiple components

export interface LobbyPlayer {
  steamId: string;
  team?: string; // Team ID (string) to match backend team_id
  mapSelection?: string;
  hasSelectedMap?: boolean;
  name?: string; // Player display name
  avatar?: string; // Steam avatar URL
  joinTime?: string; // When player joined
  isHost?: boolean; // Whether this player is the host
  currentElo?: number; // Player's current ELO rating
}

export interface GameTeam {
  id: string; // Team UUID
  game_id: string; // Game this team belongs to
  team_number: number; // Team number (1, 2, etc.)
  team_name: string; // Team display name
  average_elo: number; // Team's average Elo rating
  created_at: string; // When team was created
}

export interface LobbyData {
  id: string;
  hostSteamId: string; // Using camelCase for frontend consistency
  gameMode: string; // Using camelCase for frontend consistency
  mapSelectionMode: string; // Using camelCase for frontend consistency
  serverId?: string; // Using camelCase for frontend consistency
  ranked: boolean;
  status: string;
  players: LobbyPlayer[];
  teams?: GameTeam[]; // Add teams array to provide team metadata
  mapSelectionComplete?: boolean;
  selectedMap?: string;
  mapAnimSelectStartTime?: number; // Animation timing for map selection
  createdAt: string; // Using camelCase for frontend consistency
  updatedAt: string; // Using camelCase for frontend consistency
  server?: {
    ip: string;
    port: number;
    password: string;
  }; // Server connection info for in_progress games
}

export interface GameServer {
  id: string;
  ip: string;
  port: number;
  location: string;
  defaultPassword: string;
  maxPlayers: number;
  nickname: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveQueue {
  queueId: string;
  host: string;
  gameMode: string;
  players: number;
  maxPlayers: number;
  server: string;
  ranked: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastActivity: string;
}

export interface UserActiveQueue {
  id: string;
  hostSteamId: string;
  gameMode: string;
  mapSelectionMode: string;
  serverId: string;
  ranked: boolean;
  status: string;
  players: LobbyPlayer[];
  mapSelectionComplete: boolean;
  selectedMap?: string;
  mapAnimSelectStartTime?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Queue {
  id: string;
  host: string;
  gameMode: string;
  players: string;
  server: string;
  map: string;
  hasPassword: boolean;
  ranked: boolean;
}

export interface ViewState {
  showStartQueue: boolean;
  showJoinQueue: boolean;
  showLobby: boolean;
}

// Match History interfaces
export interface MatchHistoryPlayer {
  steamId: string;
  name: string;
  team: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
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
  expanded?: boolean; // For UI state
}

export interface MatchHistoryResponse {
  matches: MatchHistoryMatch[];
  total: number;
}
