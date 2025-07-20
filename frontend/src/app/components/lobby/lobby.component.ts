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
  gamemode: string;
  location: string;
  createdAt: string;
  updatedAt: string;
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
    
    this.http.get<GameMap[]>(`${this.apiBaseUrl}/maps?gamemode=${this.lobby.gameMode}`)
      .subscribe({
        next: (maps) => {
          this.availableMaps = maps;
          console.log('Loaded maps for gamemode:', this.lobby.gameMode, maps);
        },
        error: (error) => {
          console.error('Error loading maps:', error);
        }
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
            this.lobby = response.lobby;
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
    return this.lobby?.players?.filter(player => player.team === teamNumber) || [];
  }

  getPlayersWithoutTeam(): LobbyPlayer[] {
    return this.lobby?.players?.filter(player => !player.team) || [];
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
    // TODO: Implement player name lookup
    return `Player ${steamId.slice(-4)}`;
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
