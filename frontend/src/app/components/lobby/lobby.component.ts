import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, NgZone, PLATFORM_ID, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { interval, Subscription, EMPTY, timer } from 'rxjs';
import { switchMap, catchError, takeWhile } from 'rxjs/operators';
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
  mapAnimSelectStartTime?: number; // Animation timing for map selection
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
  @Input() isPollingPaused: boolean = false;
  @Output() lobbyLeft = new EventEmitter<void>();

  mapSelectionForm!: FormGroup;
  availableMaps: GameMap[] = [];
  mapsLoading: boolean = false;
  playerProfiles: Map<string, PlayerProfile> = new Map();
  private apiBaseUrl: string = environment.apiUrl;
  private mapRefreshSubscription?: Subscription;

  // Animation state properties
  isAnimating: boolean = false;
  animationCountdown: number = 0;
  currentCyclingMapName: string = '';
  private animationSubscription?: Subscription;
  private mapCyclingSubscription?: Subscription;
  private isBrowser: boolean;

  constructor(
    private fb: FormBuilder, 
    private http: HttpClient, 
    public authService: AuthService,
    private ngZone: NgZone,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

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
    if (this.animationSubscription) {
      this.animationSubscription.unsubscribe();
    }
    if (this.mapCyclingSubscription) {
      this.mapCyclingSubscription.unsubscribe();
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
          const maps = response.data || [];
          // Add "Random Map" option at the beginning
          this.availableMaps = [{
            id: 'random',
            name: 'Random Map',
            thumbnailUrl: 'assets/dice_roll.jpg',
            gameModes: [] // Empty since it works for all game modes
          }, ...maps];
          this.mapsLoading = false;
        },
        error: (error) => {
          console.error('Error loading maps:', error);
          // Even on error, provide the random map option
          this.availableMaps = [{
            id: 'random',
            name: 'Random Map',
            thumbnailUrl: 'assets/dice_roll.jpg',
            gameModes: []
          }];
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
    // Only start polling in the browser
    if (!this.isBrowser) return;
    
    // Refresh lobby state every 2 seconds to check for map selection updates
    this.mapRefreshSubscription = interval(2000)
      .pipe(
        switchMap(() => {
          // Skip polling if paused
          if (this.isPollingPaused) {
            return EMPTY;
          }
          
          return this.http.get(`${this.apiBaseUrl}/userQueue`, {
            headers: this.getAuthHeaders()
          }).pipe(
            catchError((error) => {
              console.error('Error refreshing lobby state:', error);
              // Return EMPTY to skip this emission and keep the last successful state
              return EMPTY;
            })
          );
        })
      )
      .subscribe({
        next: (response: any) => {
          if (response.lobby && response.lobby.id === this.lobby.id) {
            // Update lobby data
            const oldPlayerCount = this.lobby.players?.length || 0;
            const previousAnimStartTime = this.lobby.mapAnimSelectStartTime;
            this.lobby = response.lobby;
            
            // Check if animation should start
            if (this.lobby.mapAnimSelectStartTime && !previousAnimStartTime && !this.isAnimating) {
              this.startMapSelectionAnimation();
            }
            
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

  private startMapSelectionAnimation(): void {
    if (!this.lobby.mapAnimSelectStartTime || !this.isBrowser) return;
    
    console.log('Starting map selection animation...');
    this.isAnimating = true;
    
    // Calculate initial countdown based on animation start time
    const now = Date.now();
    const endTime = this.lobby.mapAnimSelectStartTime + 10000; // 10 seconds from start
    this.animationCountdown = Math.max(0, Math.ceil((endTime - now) / 1000));
    
    // If animation has already ended, skip to completed state
    if (this.animationCountdown <= 0) {
      this.completeMapSelectionAnimation();
      return;
    }

    // Start the map name cycling animation
    this.startMapNameCycling();
    
    // Use RxJS timer for countdown
    this.animationSubscription = timer(0, 1000)
      .pipe(
        takeWhile(() => this.animationCountdown >= 0 && this.isAnimating)
      )
      .subscribe(() => {
        this.ngZone.run(() => {
          if (this.animationCountdown <= 0) {
            this.completeMapSelectionAnimation();
          } else {
            this.animationCountdown--;
          }
        });
      });
    
    // Optimize polling during animation - check every 5 seconds instead of 2
    if (this.mapRefreshSubscription) {
      this.mapRefreshSubscription.unsubscribe();
      this.startOptimizedPolling();
    }
  }

  private startMapNameCycling(): void {
    if (!this.availableMaps || this.availableMaps.length === 0) {
      // If no maps loaded yet, show a placeholder
      this.currentCyclingMapName = 'Loading maps...';
      return;
    }

    let mapIndex = 0;
    let cycleInterval = 200; // Start fast
    // Start with first map
    this.currentCyclingMapName = this.availableMaps[mapIndex].name;
    
    const cycleMaps = () => {
      // Gradually slow down the cycling as countdown approaches 0
      const timeRemaining = this.animationCountdown;
      if (timeRemaining <= 3) {
        // Slow down dramatically in the last 3 seconds
        cycleInterval = 800;
      } else if (timeRemaining <= 5) {
        // Start slowing down
        cycleInterval = 400;
      } else {
        // Keep fast pace
        cycleInterval = 200;
      }
      
      // Stop cycling in the last second to build suspense
      if (timeRemaining <= 1) {
        if (this.mapCyclingSubscription) {
          this.mapCyclingSubscription.unsubscribe();
          this.mapCyclingSubscription = undefined;
        }
        return;
      }
      
      mapIndex = (mapIndex + 1) % this.availableMaps.length;
      this.currentCyclingMapName = this.availableMaps[mapIndex].name;
      
      // Schedule next cycle with updated interval
      if (this.isAnimating) {
        setTimeout(() => {
          if (this.isAnimating) {
            cycleMaps();
          }
        }, cycleInterval);
      }
    };
    
    // Start the first cycle
    setTimeout(() => {
      if (this.isAnimating) {
        cycleMaps();
      }
    }, cycleInterval);
  }

  private completeMapSelectionAnimation(): void {
    console.log('Map selection animation completed');
    
    // Show the final selected map name for a moment before completing
    if (this.lobby.selectedMap) {
      const finalMapName = this.getSelectedMapName();
      this.currentCyclingMapName = finalMapName;
      
      // Wait a moment to show the final map, then complete
      setTimeout(() => {
        this.finishAnimation();
      }, 1000); // Show final map for 1 second
    } else {
      this.finishAnimation();
    }
  }

  private finishAnimation(): void {
    this.isAnimating = false;
    this.animationCountdown = 0;
    this.currentCyclingMapName = '';
    
    if (this.animationSubscription) {
      this.animationSubscription.unsubscribe();
      this.animationSubscription = undefined;
    }
    
    if (this.mapCyclingSubscription) {
      this.mapCyclingSubscription.unsubscribe();
      this.mapCyclingSubscription = undefined;
    }
    
    // Resume normal polling
    this.startMapRefresh();
  }

  private startOptimizedPolling(): void {
    // Only start polling in the browser
    if (!this.isBrowser) return;
    
    // Reduced polling frequency during animation
    this.mapRefreshSubscription = interval(5000)
      .pipe(
        switchMap(() => this.http.get(`${this.apiBaseUrl}/userQueue`, {
          headers: this.getAuthHeaders()
        }).pipe(
          catchError((error) => {
            console.error('Error during optimized polling:', error);
            return EMPTY;
          })
        ))
      )
      .subscribe({
        next: (response: any) => {
          if (response.lobby && response.lobby.id === this.lobby.id) {
            // Update lobby data but maintain animation state
            this.lobby = response.lobby;
            
            // Check if map selection completed during animation
            if (this.lobby.mapSelectionComplete && this.isAnimating) {
              this.completeMapSelectionAnimation();
            }
          } else if (!response.inLobby) {
            this.lobbyLeft.emit();
          }
        }
      });
  }

  selectMapTile(mapId: string): void {
    this.mapSelectionForm.patchValue({ selectedMap: mapId });
  }

  canSelectMap(): boolean {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser || !this.lobby || this.isAnimating) return false;

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
        // No more popup alerts - let the UI handle the feedback naturally
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
    if (mapId === 'random') {
      return 'Random Map';
    }
    const map = this.availableMaps.find(m => m.id === mapId);
    return map ? map.name : 'Choosing...';
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
