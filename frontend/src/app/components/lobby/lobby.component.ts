import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { interval, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';

export interface LobbyPlayer {
  steamId: string;
  team?: number;
  mapSelection?: string;
  hasSelectedMap?: boolean;
}

export interface LobbyData {
  id: string;
  hostSteamId: string;
  gameMode: string;
  mapSelectionMode: string;
  serverId: string;
  hasPassword: boolean;
  ranked: boolean;
  players: LobbyPlayer[];
  mapSelectionComplete: boolean;
  selectedMap?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GameMap {
  id: string;
  name: string;
  thumbnailUrl: string;
  gameModes: string[];
}

export interface PlayerProfile {
  steamId: string;
  name: string;
  avatar?: string;
}

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './lobby.component.html',
  styleUrl: './lobby.component.scss'
})
export class LobbyComponent implements OnInit, OnDestroy {
  @Input() lobby!: LobbyData;
  @Input() isHost!: boolean;
  @Output() lobbyLeft = new EventEmitter<void>();

  mapSelectionForm!: FormGroup;
  availableMaps: GameMap[] = [];
  playerProfiles: Map<string, PlayerProfile> = new Map();
  private apiBaseUrl: string = environment.apiUrl;
  private mapRefreshSubscription?: Subscription;

  constructor(
    private fb: FormBuilder, 
    private http: HttpClient, 
    public authService: AuthService
  ) {}

  ngOnInit(): void {
    console.log('Lobby component initialized with lobby data:', this.lobby);
    console.log('Available maps on init:', this.availableMaps);
    this.initMapSelectionForm();
    this.loadAvailableMaps();
    this.loadPlayerProfiles();
    this.startMapRefresh();
  }

  ngOnDestroy(): void {
    if (this.mapRefreshSubscription) {
      this.mapRefreshSubscription.unsubscribe();
    }
  }

  private initMapSelectionForm(): void {
    this.mapSelectionForm = this.fb.group({
      selectedMap: ['']
    });
  }

  private loadAvailableMaps(): void {
    if (!this.lobby?.gameMode) {
      console.warn('Cannot load maps: lobby or gameMode not available');
      return;
    }
    
    console.log('Loading maps for gamemode:', this.lobby.gameMode);
    const url = `${this.apiBaseUrl}/maps?gameModes=${this.lobby.gameMode}`;
    console.log('Maps API URL:', url);
    
    this.http.get<{data: GameMap[]}>(url)
      .subscribe({
        next: (response) => {
          console.log('Maps API response:', response);
          this.availableMaps = response.data || [];
          console.log('Loaded maps for gamemode:', this.lobby.gameMode, this.availableMaps);
        },
        error: (error) => {
          console.error('Error loading maps:', error);
          this.availableMaps = []; // Ensure it's empty array on error
        }
      });
  }

  private loadPlayerProfiles(): void {
    if (!this.lobby?.players) return;

    // Get unique steam IDs
    const steamIds = this.lobby.players.map(p => p.steamId);
    
    // Load profiles for each player
    steamIds.forEach(steamId => {
      this.loadPlayerProfile(steamId);
    });
  }

  private loadPlayerProfile(steamId: string): void {
    // If we already have this profile, don't fetch again
    if (this.playerProfiles.has(steamId)) return;

    const headers = this.getAuthHeaders();
    
    // For now, we'll use a placeholder since there's no public profile endpoint
    // TODO: Implement when profile endpoint supports looking up other users
    this.playerProfiles.set(steamId, {
      steamId: steamId,
      name: `Player ${steamId.slice(-4)}`,
      avatar: undefined
    });
  }

  private startMapRefresh(): void {
    // Refresh lobby state every 2 seconds to check for map selection updates
    this.mapRefreshSubscription = interval(2000)
      .pipe(
        switchMap(() => this.http.get(`${this.apiBaseUrl}/userQueue`, {
          headers: this.getAuthHeaders()
        }))
      )
      .subscribe({
        next: (response: any) => {
          if (response.lobby && response.lobby.id === this.lobby.id) {
            // Update lobby data
            const oldPlayerCount = this.lobby.players?.length || 0;
            this.lobby = response.lobby;
            
            // If new players joined, load their profiles
            const newPlayerCount = this.lobby.players?.length || 0;
            if (newPlayerCount > oldPlayerCount) {
              this.loadPlayerProfiles();
            }
          } else if (!response.inLobby) {
            // Lobby was disbanded
            this.lobbyLeft.emit();
          }
        },
        error: (error) => {
          console.error('Error refreshing lobby state:', error);
        }
      });
  }

  getTeamPlayers(teamNumber: number): LobbyPlayer[] {
    // First try to get players assigned to this team
    const assignedTeamPlayers = this.lobby?.players?.filter(player => player.team === teamNumber) || [];
    
    // If we have assigned players, return them
    if (assignedTeamPlayers.length > 0) {
      console.log(`Team ${teamNumber} players (assigned):`, assignedTeamPlayers);
      return assignedTeamPlayers;
    }
    
    // If no assigned players, distribute unassigned players across teams for display
    const unassignedPlayers = this.lobby?.players?.filter(player => !player.team) || [];
    
    if (unassignedPlayers.length > 0) {
      // For team 1, take the first half (rounded up)
      // For team 2, take the second half
      const playersPerTeam = Math.ceil(unassignedPlayers.length / 2);
      
      if (teamNumber === 1) {
        const team1Players = unassignedPlayers.slice(0, playersPerTeam);
        console.log(`Team ${teamNumber} players (distributed):`, team1Players);
        return team1Players;
      } else {
        const team2Players = unassignedPlayers.slice(playersPerTeam);
        console.log(`Team ${teamNumber} players (distributed):`, team2Players);
        return team2Players;
      }
    }
    
    console.log(`Team ${teamNumber} players: empty`);
    return [];
  }

  getPlayersWithoutTeam(): LobbyPlayer[] {
    const unassignedPlayers = this.lobby?.players?.filter(player => !player.team) || [];
    console.log('Players without team:', unassignedPlayers);
    return unassignedPlayers;
  }

  getTeamName(teamNumber: number): string {
    const teamPlayers = this.getTeamPlayers(teamNumber);
    
    // For 1v1, use simple "Player 1" and "Player 2" naming
    if (this.lobby?.gameMode === '1v1') {
      return `Player ${teamNumber}`;
    }
    
    // For other game modes, use the first player's name
    if (teamPlayers.length === 0) return `Team ${teamNumber}`;
    
    const firstPlayer = teamPlayers[0];
    const playerName = this.getPlayerDisplayName(firstPlayer.steamId);
    return `Team ${playerName}`;
  }

  selectMapTile(mapId: string): void {
    this.mapSelectionForm.patchValue({ selectedMap: mapId });
  }

  canSelectMap(): boolean {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser || !this.lobby) return false;

    const userSteamId = this.extractSteamId(currentUser.steamId);
    
    if (this.lobby.mapSelectionMode === 'Host Pick') {
      return this.isHost;
    } else if (this.lobby.mapSelectionMode === 'All Pick') {
      const currentPlayer = this.lobby.players?.find(p => p.steamId === userSteamId);
      return currentPlayer ? !currentPlayer.hasSelectedMap : false;
    }
    
    return false;
  }

  selectMap(): void {
    const selectedMapId = this.mapSelectionForm.get('selectedMap')?.value;
    if (!selectedMapId) {
      alert('Please select a map');
      return;
    }

    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) return;

    const headers = this.getAuthHeaders();
    
    this.http.post(`${this.apiBaseUrl}/selectMap`, {
      lobbyId: this.lobby.id,
      mapId: selectedMapId
    }, { headers }).subscribe({
      next: (response) => {
        console.log('Map selected successfully', response);
      },
      error: (error) => {
        console.error('Error selecting map:', error);
        alert('Failed to select map. Please try again.');
      }
    });
  }

  leaveLobby(): void {
    const confirmed = confirm(
      'Leaving the lobby will disband it for all players. Are you sure you want to continue?'
    );
    
    if (!confirmed) return;

    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) return;

    const headers = this.getAuthHeaders();
    
    this.http.post(`${this.apiBaseUrl}/leaveLobby`, {
      lobbyId: this.lobby.id
    }, { headers }).subscribe({
      next: (response: any) => {
        console.log('Left lobby successfully', response);
        alert('Lobby has been disbanded.');
        this.lobbyLeft.emit();
      },
      error: (error) => {
        console.error('Error leaving lobby:', error);
        let errorMessage = 'Failed to leave lobby. Please try again.';
        if (error.status === 400 && error.error?.error) {
          errorMessage = error.error.error;
        }
        alert(errorMessage);
      }
    });
  }

  getMapName(mapId: string): string {
    const map = this.availableMaps.find(m => m.id === mapId);
    return map ? map.name : 'Unknown Map';
  }

  getPlayerDisplayName(steamId: string): string {
    const profile = this.playerProfiles.get(steamId);
    return profile ? profile.name : `Player ${steamId.slice(-4)}`;
  }

  // Safe getter methods for template
  get playersWithMapSelection(): number {
    return this.lobby?.players?.filter(p => p.hasSelectedMap)?.length || 0;
  }

  get totalPlayers(): number {
    return this.lobby?.players?.length || 0;
  }

  get isMapSelectionComplete(): boolean {
    return this.lobby?.mapSelectionComplete || false;
  }

  get selectedMapName(): string {
    return this.lobby?.selectedMap ? this.getMapName(this.lobby.selectedMap) : '';
  }

  private getAuthHeaders(): any {
    const currentUser = this.authService.getCurrentUser();
    return currentUser ? {
      'Authorization': `Bearer ${currentUser.sessionToken}`,
      'Content-Type': 'application/json'
    } : {};
  }

  private extractSteamId(userId: string): string {
    if (/^\d+$/.test(userId)) {
      return userId;
    }
    const match = userId.match(/\/id\/(\d+)$/);
    return match && match[1] ? match[1] : userId;
  }
}
