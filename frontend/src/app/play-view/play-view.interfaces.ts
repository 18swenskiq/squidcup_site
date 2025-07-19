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
  password?: string;
  ranked: boolean;
  startTime: string;
  joiners: Array<{
    steamId: string;
    joinTime: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface UserQueueStatus {
  inQueue: boolean;
  isHost: boolean;
  queue: UserActiveQueue | null;
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

export interface LobbyPlayer {
  steamId: string;
  name?: string;
  avatar?: string;
  joinTime: string;
  isHost: boolean;
}

export interface ViewState {
  showStartQueue: boolean;
  showJoinQueue: boolean;
  showLobby: boolean;
}
