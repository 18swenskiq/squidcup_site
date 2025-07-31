import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { interval, Subscription, EMPTY } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';

export interface LobbyPlayer {
  steamId: string;
  team?: number;
  mapSelection?: string;
  hasSelectedMap?: boolean;
  name?: string; // Add name field
}

export interface LobbyData {
  id: string;
  hostSteamId: string;
  hostName?: string; // Add host name field
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
  mapsLoading: boolean = false;
  playerProfiles: Map<string, PlayerProfile> = new Map();
  private apiBaseUrl: string = environment.apiUrl;
  private mapRefreshSubscription?: Subscription;

  constructor(
    private fb: FormBuilder, 
    private http: HttpClient, 
    public authService: AuthService
  ) {}

  ngOnInit(): void {
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
    
    this.mapsLoading = true;
    const url = `${this.apiBaseUrl}/maps?gameModes=${this.lobby.gameMode}`;
    
    this.http.get<{data: GameMap[]}>(url)
      .subscribe({
        next: (response) => {
          this.availableMaps = response.data || [];
          this.mapsLoading = false;
        },
        error: (error) => {
          console.error('Error loading maps:', error);
          this.availableMaps = []; // Ensure it's empty array on error
          this.mapsLoading = false;
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
        }).pipe(
          catchError((error) => {
            console.error('Error refreshing lobby state:', error);
            // Return EMPTY to skip this emission and keep the last successful state
            return EMPTY;
          })
        ))
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
        }
        // Remove the error handler since we're handling it in the pipe
      });
  }

  getTeamPlayers(teamNumber: number): LobbyPlayer[] {
    // First try to get players assigned to this team
    const assignedTeamPlayers = this.lobby?.players?.filter(player => player.team === teamNumber) || [];
    
    // If we have assigned players, return them
    if (assignedTeamPlayers.length > 0) {
      return assignedTeamPlayers;
    }
    
    // If no assigned players, distribute unassigned players across teams for display
    const unassignedPlayers = this.lobby?.players?.filter(player => !player.team) || [];
    
    if (unassignedPlayers.length > 0) {
      // For team 1, take the first half (rounded up)
      // For team 2, take the second half
      const playersPerTeam = Math.ceil(unassignedPlayers.length / 2);
      
      if (teamNumber === 1) {
        return unassignedPlayers.slice(0, playersPerTeam);
      } else {
        return unassignedPlayers.slice(playersPerTeam);
      }
    }
    
    return [];
  }

  getPlayersWithoutTeam(): LobbyPlayer[] {
    return this.lobby?.players?.filter(player => !player.team) || [];
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
    // Use the name from lobby data if available, otherwise use profile or fallback
    const playerName = firstPlayer.name || this.getPlayerDisplayName(firstPlayer.steamId);
    return `Team ${playerName}`;
  }

  selectMapTile(mapId: string): void {
    this.mapSelectionForm.patchValue({ selectedMap: mapId });
  }

  canSelectMap(): boolean {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser || !this.lobby) return false;

    const userSteamId = this.extractSteamId(currentUser.steamId);
    
    if (this.lobby.mapSelectionMode === 'host-pick') {
      return this.isHost;
    } else if (this.lobby.mapSelectionMode === 'all-pick') {
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
      gameId: this.lobby.id,  // Use gameId to match backend expectations
      mapId: selectedMapId
    }, { headers }).subscribe({
      next: (response: any) => {
        console.log('Map selection response:', response);
        
        if (response.selectionStatus) {
          // All-pick mode response
          const status = response.selectionStatus;
          if (status.hasAllSelected) {
            alert(`All players have selected! Final map: ${status.finalMap}`);
          } else {
            alert(`Map selection recorded! ${status.playersWithSelections}/${status.totalPlayers} players have selected.`);
          }
        } else {
          // Host-pick mode response
          alert('Map selected successfully!');
        }
      },
      error: (error) => {
        console.error('Error selecting map:', error);
        let errorMessage = 'Failed to select map. Please try again.';
        if (error.error?.error) {
          errorMessage = error.error.error;
        }
        alert(errorMessage);
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
    
    this.http.delete(`${this.apiBaseUrl}/leaveLobby`, {
      headers,
      body: JSON.stringify({
        gameId: this.lobby.id  // Use gameId to match backend expectations
      })
    }).subscribe({
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
    // First check if we have the name from the lobby data
    const lobbyPlayer = this.lobby?.players?.find(p => p.steamId === steamId);
    if (lobbyPlayer?.name) {
      return lobbyPlayer.name;
    }
    
    // Fallback to profile map
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

  getSelectedMapName(): string {
    if (this.lobby?.selectedMap) {
      return this.getMapName(this.lobby.selectedMap);
    }
    return 'No map selected';
  }

  getMapSelectionStatus(): string {
    if (!this.lobby) return 'Loading...';
    
    switch (this.lobby.mapSelectionMode) {
      case 'random-map':
        return 'Random map will be selected';
      case 'host-pick':
        return this.isHost ? 'Select a map below' : 'Waiting for host selection';
      case 'all-pick':
        const selected = this.playersWithMapSelection;
        const total = this.totalPlayers;
        return `${selected}/${total} players selected`;
      default:
        return 'Waiting for map selection';
    }
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
