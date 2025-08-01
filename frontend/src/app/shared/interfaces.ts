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
  mapSelectionComplete?: boolean;
  selectedMap?: string;
  mapAnimSelectStartTime?: number; // Animation timing for map selection
  createdAt: string; // Using camelCase for frontend consistency
  updatedAt: string; // Using camelCase for frontend consistency
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
