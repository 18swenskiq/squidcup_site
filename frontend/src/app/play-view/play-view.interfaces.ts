import { LobbyPlayer, LobbyData, GameServer, ActiveQueue, Queue, ViewState } from '../shared/interfaces';

// Re-export shared interfaces for backwards compatibility
export { LobbyPlayer, LobbyData, GameServer, ActiveQueue, Queue, ViewState };

// Keep only the interfaces specific to play-view
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
  inLobby: boolean;
  isHost: boolean;
  queue: UserActiveQueue | null;
  lobby: LobbyData | null;
}
