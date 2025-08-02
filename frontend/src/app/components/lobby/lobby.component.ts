import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges, NgZone, PLATFORM_ID, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { interval, Subscription, EMPTY, timer } from 'rxjs';
import { switchMap, catchError, takeWhile } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { LobbyPlayer, LobbyData } from '../../shared/interfaces';

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
export class LobbyComponent implements OnInit, OnDestroy, OnChanges {
  @Input() lobby!: LobbyData;
  @Input() isHost!: boolean;
  @Input() isPollingPaused: boolean = false;
  @Output() lobbyLeft = new EventEmitter<void>();

  mapSelectionForm!: FormGroup;
  availableMaps: GameMap[] = [];
  mapsLoading: boolean = false;
  mapSelectionLoading: boolean = false;
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
    // Note: We don't need to load individual player profiles since 
    // names and avatars are already included in the lobby response
    this.startMapRefresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Handle changes to isPollingPaused input
    if (changes['isPollingPaused'] && !changes['isPollingPaused'].firstChange) {
      if (changes['isPollingPaused'].currentValue) {
        // Polling is now paused - stop the subscription
        this.stopMapRefresh();
      } else {
        // Polling is now resumed - restart the subscription
        this.startMapRefresh();
      }
    }
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
    
    // Try to get player profile from a potential profiles endpoint
    // If this fails, we'll fall back to a placeholder
    this.http.get(`${this.apiBaseUrl}/profiles/${steamId}`, { headers })
      .subscribe({
        next: (response: any) => {
          this.playerProfiles.set(steamId, {
            steamId: steamId,
            name: response.name || response.username || `Player ${steamId.slice(-4)}`,
            avatar: response.avatar || undefined
          });
        },
        error: (error) => {
          console.log('Profile endpoint not available, using placeholder for:', steamId);
          // Fallback to placeholder profile
          this.playerProfiles.set(steamId, {
            steamId: steamId,
            name: `Player ${steamId.slice(-4)}`,
            avatar: undefined
          });
        }
      });
  }

  private startMapRefresh(): void {
    // Only start polling in the browser and if not paused
    if (!this.isBrowser || this.isPollingPaused) return;
    
    // Don't start if already running
    if (this.mapRefreshSubscription) return;
    
    // Refresh lobby state every 2 seconds to check for map selection updates
    this.mapRefreshSubscription = interval(2000)
      .pipe(
        switchMap(() => {
          // Double check polling pause state
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
            
            // Debug logging for animation timing
            if (this.lobby.mapAnimSelectStartTime) {
              console.log('Received mapAnimSelectStartTime:', this.lobby.mapAnimSelectStartTime);
              console.log('Current time:', Date.now());
              console.log('Time difference:', Date.now() - this.lobby.mapAnimSelectStartTime);
              console.log('Currently animating:', this.isAnimating);
              
              // Reset map selection loading state since server has processed the selection
              this.mapSelectionLoading = false;
            }
            
            // Check if animation should start or continue
            if (this.lobby.mapAnimSelectStartTime && !this.isAnimating) {
              const now = Date.now();
              const animationStartTime = this.lobby.mapAnimSelectStartTime;
              const timeSinceAnimationStart = now - animationStartTime;
              const animationDuration = 10000; // 10 seconds
              
              console.log('Animation check - timeSinceStart:', timeSinceAnimationStart, 'duration:', animationDuration);
              
              // Start animation if we're within the animation window (before or during)
              if (timeSinceAnimationStart < animationDuration) {
                console.log('Starting animation now');
                this.startMapSelectionAnimation();
              } else {
                console.log('Animation window has passed, not starting animation');
              }
            }
            
            // If new players joined, their data is already included in the lobby response
            const newPlayerCount = this.lobby.players?.length || 0;
            if (newPlayerCount > oldPlayerCount) {
              console.log('New players joined, player count increased from', oldPlayerCount, 'to', newPlayerCount);
            }
          } else if (!response.inLobby) {
            // Lobby was disbanded
            this.lobbyLeft.emit();
          }
        }
        // Remove the error handler since we're handling it in the pipe
      });
  }

  private stopMapRefresh(): void {
    if (this.mapRefreshSubscription) {
      this.mapRefreshSubscription.unsubscribe();
      this.mapRefreshSubscription = undefined;
    }
  }

  getTeamPlayers(teamNumber: number): LobbyPlayer[] {
    // Check if we have teams data from the API
    if (this.lobby?.teams && this.lobby.teams.length > 0) {
      // Find the team with the matching team number
      const team = this.lobby.teams.find(t => t.team_number === teamNumber);
      if (team) {
        // Return players assigned to this specific team UUID
        return this.lobby.players?.filter(player => player.team === team.id) || [];
      }
    }
    
    // Fallback: Handle legacy string-based team identifiers
    const assignedTeamPlayers = this.lobby?.players?.filter(player => {
      // Try to match by team ID/name that includes the team number
      return player.team === teamNumber.toString() || 
             player.team === `Team ${teamNumber}` ||
             (player.team && player.team.includes(`Team ${teamNumber}`)) ||
             // Backwards compatibility - check if team was stored as number and converted to string
             player.team === String(teamNumber)
    }) || [];
    
    // If we have assigned players, return them
    if (assignedTeamPlayers.length > 0) {
      return assignedTeamPlayers;
    }
    
    // If no assigned players, distribute unassigned players across teams for display
    const unassignedPlayers = this.lobby?.players?.filter(player => 
      !player.team || player.team === 'unassigned' || player.team === 'undefined'
    ) || [];
    
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
    console.log('mapAnimSelectStartTime:', this.lobby.mapAnimSelectStartTime);
    console.log('Current time:', Date.now());
    
    this.isAnimating = true;
    
    const now = Date.now();
    const animationStartTime = this.lobby.mapAnimSelectStartTime;
    
    console.log('Animation start time:', animationStartTime);
    
    // If animation hasn't started yet, countdown to animation start
    if (now < animationStartTime) {
      const timeUntilAnimation = animationStartTime - now;
      this.animationCountdown = Math.ceil(timeUntilAnimation / 1000);
      console.log('Countdown until animation starts:', this.animationCountdown, 'seconds');
      
      // Start countdown timer
      this.animationSubscription = timer(0, 1000)
        .pipe(
          takeWhile(() => this.animationCountdown > 0 && this.isAnimating)
        )
        .subscribe(() => {
          this.ngZone.run(() => {
            this.animationCountdown--;
            console.log('Countdown:', this.animationCountdown);
            
            // When countdown reaches 0, start the actual animation
            if (this.animationCountdown <= 0) {
              console.log('Countdown finished, starting map cycling animation');
              this.animationSubscription?.unsubscribe();
              this.startMapCyclingAnimation();
            }
          });
        });
    } 
    // If animation should have already started, start it immediately
    else {
      console.log('Animation should be running now, starting map cycling immediately');
      this.startMapCyclingAnimation();
    }
  }

  private startMapCyclingAnimation(): void {
    console.log('Starting map cycling animation');
    this.animationCountdown = 10; // Fixed 10-second animation
    this.startMapNameCycling();
    
    // Start the 10-second animation countdown
    this.animationSubscription = timer(0, 1000)
      .pipe(
        takeWhile(() => this.animationCountdown > 0 && this.isAnimating)
      )
      .subscribe(() => {
        this.ngZone.run(() => {
          this.animationCountdown--;
          console.log('Animation countdown:', this.animationCountdown);
          
          // When animation countdown reaches 0, complete the animation
          if (this.animationCountdown <= 0) {
            this.completeMapSelectionAnimation();
          }
        });
      });
    
    // Optimize polling during animation - check every 5 seconds instead of 2
    if (this.mapRefreshSubscription) {
      this.mapRefreshSubscription.unsubscribe();
      this.startOptimizedPolling();
    }
  }

  private getPlayerSelectedMaps(): any[] {
    if (!this.lobby?.players || !this.availableMaps) {
      return [];
    }
    
    // Get unique map IDs that players have selected
    const selectedMapIds = new Set<string>();
    this.lobby.players.forEach(player => {
      if (player.hasSelectedMap && player.mapSelection) {
        selectedMapIds.add(player.mapSelection);
      }
    });
    
    // Return the actual map objects for those IDs
    return this.availableMaps.filter(map => selectedMapIds.has(map.id));
  }

  private startMapNameCycling(): void {
    // Get maps that players actually selected for the animation
    const playerSelectedMaps = this.getPlayerSelectedMaps();
    
    if (!playerSelectedMaps || playerSelectedMaps.length === 0) {
      // If no player selections or maps not loaded yet, show a placeholder
      this.currentCyclingMapName = 'Loading selections...';
      return;
    }

    let mapIndex = 0;
    let cycleInterval = 150; // Start faster for better effect
    // Start with first player-selected map
    this.currentCyclingMapName = playerSelectedMaps[mapIndex].name;
    
    const cycleMaps = () => {
      // Gradually slow down the cycling as countdown approaches 0
      const timeRemaining = this.animationCountdown;
      if (timeRemaining <= 2) {
        // Slow down dramatically in the last 2 seconds
        cycleInterval = 600;
      } else if (timeRemaining <= 4) {
        // Start slowing down
        cycleInterval = 300;
      } else {
        // Keep fast pace
        cycleInterval = 150;
      }
      
      // Stop cycling in the last second to build suspense
      if (timeRemaining <= 1) {
        if (this.mapCyclingSubscription) {
          this.mapCyclingSubscription.unsubscribe();
          this.mapCyclingSubscription = undefined;
        }
        return;
      }
      
      mapIndex = (mapIndex + 1) % playerSelectedMaps.length;
      this.currentCyclingMapName = playerSelectedMaps[mapIndex].name;
      
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
            
            // Only complete animation early if server signals completion 
            // AND we're in the final second (to avoid race condition)
            if (this.lobby.mapSelectionComplete && this.isAnimating && this.animationCountdown <= 1) {
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

  openWorkshopPage(mapId: string, event: Event): void {
    // Prevent the map tile click event from firing
    event.stopPropagation();
    
    // Only open in browser environment
    if (this.isBrowser) {
      const workshopUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${mapId}`;
      window.open(workshopUrl, '_blank');
    }
  }

  onWorkshopLinkHover(isHovering: boolean, event: Event): void {
    // Find the parent map tile and toggle the workshop-link-hovered class
    const target = event.target as HTMLElement;
    const mapTile = target.closest('.map-tile') as HTMLElement;
    
    if (mapTile) {
      if (isHovering) {
        mapTile.classList.add('workshop-link-hovered');
      } else {
        mapTile.classList.remove('workshop-link-hovered');
      }
    }
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

    // Set loading state
    this.mapSelectionLoading = true;

    const headers = this.getAuthHeaders();
    
    this.http.post(`${this.apiBaseUrl}/selectMap`, {
      gameId: this.lobby.id,  // Use gameId to match backend expectations
      mapId: selectedMapId
    }, { headers }).subscribe({
      next: (response: any) => {
        console.log('Map selection response:', response);
        // Keep loading state - it will be reset when userQueue polling updates the UI
        // No more popup alerts - let the UI handle the feedback naturally
      },
      error: (error) => {
        console.error('Error selecting map:', error);
        // Reset loading state on error
        this.mapSelectionLoading = false;
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

  getSelectedMapThumbnailUrl(): string {
    if (!this.lobby?.selectedMap) {
      return '';
    }
    const map = this.availableMaps.find(m => m.id === this.lobby.selectedMap);
    return map ? map.thumbnailUrl : '';
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

  getPlayerAvatarUrl(steamId: string): string | undefined {
    // First check if the lobby player data has an avatar
    const lobbyPlayer = this.lobby?.players?.find(p => p.steamId === steamId);
    if (lobbyPlayer?.avatar) {
      return lobbyPlayer.avatar;
    }
    
    // Fallback to profile map
    const profile = this.playerProfiles.get(steamId);
    return profile?.avatar;
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

  getMapSelectionModeFriendlyName(): string {
    if (!this.lobby?.mapSelectionMode) return 'Unknown';
    
    switch (this.lobby.mapSelectionMode) {
      case 'all-pick':
        return 'All Pick';
      case 'host-pick':
        return 'Host Pick';
      case 'random-map':
        return 'Random Map';
      default:
        // Fallback: capitalize first letter of each word and replace hyphens/underscores
        return this.lobby.mapSelectionMode
          .split(/[-_]/)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
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
