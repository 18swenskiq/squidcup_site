import { Component, OnInit, Inject, PLATFORM_ID, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { environment } from '../../environments/environment';

export interface PlayerProfileData {
  steamId: string;
  username: string;
  avatarUrl?: string;
  countryCode?: string;
  stateCode?: string;
  currentElo?: number;
  stats?: any[]; // Individual game stats array
}

export interface AggregatedPlayerStats {
  // Win/Loss record
  totalGames: number;
  wins: number;
  losses: number;
  winrate: number;
  
  // ELO changes
  totalEloGained: number;
  totalEloLost: number;
  netEloChange: number;
  
  // Combat stats (same as leaderboard)
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
  totalRounds: number;
  
  // Calculated stats
  kdr: number;
  adr: number;
  headShotPercentage: number;
  accuracy: number;
  entryWinRate: number;
}

export interface GameModeStats {
  gameMode: string;
  displayName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winrate: number;
}

export interface PlayerMapStats {
  mapId: string;
  mapName: string;
  mapThumbnailUrl?: string;
  mapWorkshopUrl?: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winrate: number;
}

export interface MapInfo {
  id: string;
  name: string;
  totalRounds: number;
  totalGames: number;
}

export interface MapStatsResponse {
  wingman: MapInfo[];
  threev3: MapInfo[];
  fivev5: MapInfo[];
}

export interface ChartDataPoint {
  x: string; // match_number or "0" for starting point
  y: number; // cumulative value or elo
  matchNumber: string;
  result: 'W' | 'L' | 'T'; // Win/Loss/Tie
  runningTotal: number;
}

export interface EloDataPoint {
  x: string; // match_number or "0" for starting point
  y: number; // elo value
  matchNumber: string;
  result: 'W' | 'L' | 'T' | 'START'; // Win/Loss/Tie/Starting point
  eloChange: number; // elo change for this match
  currentElo: number; // elo after this match
}

@Component({
  selector: 'app-player-profile-view',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  templateUrl: './player-profile-view.component.html',
  styleUrls: ['./player-profile-view.component.scss']
})
export class PlayerProfileViewComponent implements OnInit, AfterViewInit {
  steamId: string = '';
  isLoading: boolean = true;
  error: string | null = null;
  
  // Tab management
  activeTab: string = 'overview';
  
  // Aggregated stats
  aggregatedStats: AggregatedPlayerStats | null = null;
  
  // Gamemode and map stats
  gameModeStats: GameModeStats[] = [];
  mapStats: PlayerMapStats[] = [];
  allMapsData: Map<string, MapInfo> = new Map(); // Cache for map info lookup
  
  // Charts tab
  selectedChartType: string = '';
  chartData: ChartDataPoint[] = [];
  eloData: EloDataPoint[] = [];
  
  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  
  // Placeholder player data - will be replaced with actual API call
  playerData: PlayerProfileData = {
    steamId: '',
    username: 'Loading...',
    avatarUrl: '/assets/default-avatar.png',
    countryCode: 'US',
    stateCode: 'CA'
  };

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    // Get the steam_id from the route parameters
    this.route.params.subscribe(params => {
      this.steamId = params['steam_id'];
      this.playerData.steamId = this.steamId;
      
      // Load maps data first, then player profile
      this.loadMapsData().then(() => {
        this.loadPlayerProfile();
      });
    });
  }

  ngAfterViewInit(): void {
    // Chart will be rendered when data is selected
  }

  // Load maps data to get map names and thumbnails
  async loadMapsData(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      const apiUrl = `${environment.apiUrl}/mapStats`;
      const response = await this.http.get<MapStatsResponse>(apiUrl).toPromise();
      
      if (response) {
        // Combine all maps into a single lookup map
        [...response.wingman, ...response.threev3, ...response.fivev5].forEach(map => {
          this.allMapsData.set(map.id, map);
        });
        console.log('Maps data loaded:', this.allMapsData);
      }
    } catch (error) {
      console.error('Error loading maps data:', error);
      // Continue anyway with just map IDs
    }
  }

  loadPlayerProfile(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.isLoading = true;
    this.error = null;

    // Call the API to get player profile data
    const apiUrl = `${environment.apiUrl}/userProfileStats/${this.steamId}`;
    
    this.http.get<PlayerProfileData>(apiUrl).subscribe({
      next: (data) => {
        console.log('Player profile data received:', data);
        this.playerData = data;
        this.calculateAggregatedStats();
        this.calculateGameModeStats();
        this.calculateMapStats();
        this.generateChartData();
        this.generateEloData();
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading player profile:', error);
        this.error = error.status === 404 ? 'Player not found' : 'Failed to load player profile';
        this.isLoading = false;
        
        // Fallback to placeholder data on error
        this.playerData = {
          steamId: this.steamId,
          username: `Player_${this.steamId.substring(this.steamId.length - 8)}`,
          avatarUrl: '/assets/default-avatar.png',
          countryCode: undefined,
          stateCode: undefined,
          currentElo: 1000,
          stats: []
        };
      }
    });
  }

  // Tab management methods
  switchTab(tabName: string): void {
    this.activeTab = tabName;
  }

  // Calculate aggregated stats from individual game data
  calculateAggregatedStats(): void {
    if (!this.playerData.stats || this.playerData.stats.length === 0) {
      this.aggregatedStats = this.getEmptyStats();
      return;
    }

    const stats = this.playerData.stats;
    let totalGames = 0;
    let wins = 0;
    let losses = 0;
    let totalEloGained = 0;
    let totalEloLost = 0;

    // Initialize cumulative stats
    let kills = 0;
    let deaths = 0;
    let assists = 0;
    let damage = 0;
    let utilityDamage = 0;
    let shotsFiredTotal = 0;
    let shotsOnTargetTotal = 0;
    let entryCount = 0;
    let entryWins = 0;
    let liveTime = 0;
    let headShotKills = 0;
    let cashEarned = 0;
    let enemiesFlashed = 0;
    let totalRounds = 0;

    // Process each game
    for (const game of stats) {
      totalGames++;

      // Calculate if player won this game
      const playerTeam = game.team_number;
      const team1Score = game.team1_score || 0;
      const team2Score = game.team2_score || 0;
      
      let playerWon = false;
      if (playerTeam === 1 && team1Score > team2Score) {
        playerWon = true;
      } else if (playerTeam === 2 && team2Score > team1Score) {
        playerWon = true;
      }

      if (playerWon) {
        wins++;
        // Add ELO gained (convert string to number)
        const eloGained = Number(game.elo_change_win) || 0;
        if (eloGained > 0) {
          totalEloGained += eloGained;
        }
      } else if (team1Score !== team2Score) { // Only count as loss if it wasn't a tie
        losses++;
        // Add ELO lost (convert string to number)
        const eloLost = Number(game.elo_change_loss) || 0;
        if (eloLost < 0) {
          totalEloLost += Math.abs(eloLost);
        }
      }

      // Aggregate combat stats
      kills += game.kills || 0;
      deaths += game.deaths || 0;
      assists += game.assists || 0;
      damage += game.damage || 0;
      utilityDamage += game.utility_damage || 0;
      shotsFiredTotal += game.shots_fired_total || 0;
      shotsOnTargetTotal += game.shots_on_target_total || 0;
      entryCount += game.entry_count || 0;
      entryWins += game.entry_wins || 0;
      liveTime += game.live_time || 0;
      headShotKills += game.head_shot_kills || 0;
      cashEarned += game.cash_earned || 0;
      enemiesFlashed += game.enemies_flashed || 0;
      totalRounds += (team1Score + team2Score) || 0;
    }

    // Calculate derived stats
    const winrate = totalGames > 0 ? Number(((wins / totalGames) * 100).toFixed(1)) : 0;
    const kdr = deaths > 0 ? Number((kills / deaths).toFixed(2)) : kills;
    const adr = totalRounds > 0 ? Number((damage / totalRounds).toFixed(1)) : 0;
    const headShotPercentage = kills > 0 ? Number(((headShotKills / kills) * 100).toFixed(1)) : 0;
    const accuracy = shotsFiredTotal > 0 ? Number(((shotsOnTargetTotal / shotsFiredTotal) * 100).toFixed(1)) : 0;
    const entryWinRate = entryCount > 0 ? Number(((entryWins / entryCount) * 100).toFixed(1)) : 0;
    const netEloChange = totalEloGained - totalEloLost;

    this.aggregatedStats = {
      totalGames,
      wins,
      losses,
      winrate,
      totalEloGained,
      totalEloLost,
      netEloChange,
      kills,
      deaths,
      assists,
      damage,
      utilityDamage,
      shotsFiredTotal,
      shotsOnTargetTotal,
      entryCount,
      entryWins,
      liveTime,
      headShotKills,
      cashEarned,
      enemiesFlashed,
      totalRounds,
      kdr,
      adr,
      headShotPercentage,
      accuracy,
      entryWinRate
    };

    console.log('Calculated aggregated stats:', this.aggregatedStats);
  }

  // Calculate gamemode statistics
  calculateGameModeStats(): void {
    if (!this.playerData.stats || this.playerData.stats.length === 0) {
      this.gameModeStats = [];
      return;
    }

    const gameModeMap = new Map<string, {games: number, wins: number, losses: number}>();

    // Process each game
    for (const game of this.playerData.stats) {
      const gameMode = game.game_mode || 'unknown';
      
      if (!gameModeMap.has(gameMode)) {
        gameModeMap.set(gameMode, { games: 0, wins: 0, losses: 0 });
      }

      const stats = gameModeMap.get(gameMode)!;
      stats.games++;

      // Calculate if player won this game
      const playerTeam = game.team_number;
      const team1Score = game.team1_score || 0;
      const team2Score = game.team2_score || 0;
      
      if (playerTeam === 1 && team1Score > team2Score) {
        stats.wins++;
      } else if (playerTeam === 2 && team2Score > team1Score) {
        stats.wins++;
      } else if (team1Score !== team2Score) {
        stats.losses++;
      }
    }

    // Convert to array and sort by games played
    this.gameModeStats = Array.from(gameModeMap.entries()).map(([gameMode, stats]) => ({
      gameMode,
      displayName: this.formatGameModeName(gameMode),
      gamesPlayed: stats.games,
      wins: stats.wins,
      losses: stats.losses,
      winrate: stats.games > 0 ? Number(((stats.wins / stats.games) * 100).toFixed(1)) : 0
    })).sort((a, b) => b.gamesPlayed - a.gamesPlayed);

    console.log('Calculated gamemode stats:', this.gameModeStats);
  }

  // Calculate map statistics
  calculateMapStats(): void {
    if (!this.playerData.stats || this.playerData.stats.length === 0) {
      this.mapStats = [];
      return;
    }

    const mapStatsMap = new Map<string, {games: number, wins: number, losses: number}>();

    // Process each game
    for (const game of this.playerData.stats) {
      const mapId = game.map_id || game.map || 'unknown';
      
      if (!mapStatsMap.has(mapId)) {
        mapStatsMap.set(mapId, { games: 0, wins: 0, losses: 0 });
      }

      const stats = mapStatsMap.get(mapId)!;
      stats.games++;

      // Calculate if player won this game
      const playerTeam = game.team_number;
      const team1Score = game.team1_score || 0;
      const team2Score = game.team2_score || 0;
      
      if (playerTeam === 1 && team1Score > team2Score) {
        stats.wins++;
      } else if (playerTeam === 2 && team2Score > team1Score) {
        stats.wins++;
      } else if (team1Score !== team2Score) {
        stats.losses++;
      }
    }

    // Convert to array and sort by games played
    this.mapStats = Array.from(mapStatsMap.entries()).map(([mapId, stats]) => {
      // Find a game with this map to get the map info from the API response
      const gameWithMap = this.playerData?.stats?.find(game => (game.map_id || game.map) === mapId);
      
      return {
        mapId,
        mapName: gameWithMap?.mapName || `Workshop Map ${mapId}`,
        mapThumbnailUrl: gameWithMap?.mapThumbnailUrl || '',
        mapWorkshopUrl: gameWithMap?.mapWorkshopUrl || `https://steamcommunity.com/sharedfiles/filedetails/?id=${mapId}`,
        gamesPlayed: stats.games,
        wins: stats.wins,
        losses: stats.losses,
        winrate: stats.games > 0 ? Number(((stats.wins / stats.games) * 100).toFixed(1)) : 0
      };
    }).sort((a, b) => b.gamesPlayed - a.gamesPlayed);

    console.log('Calculated map stats:', this.mapStats);
  }

  // Format gamemode names for display
  private formatGameModeName(gameMode: string): string {
    switch (gameMode.toLowerCase()) {
      case 'wingman':
        return 'Wingman';
      case '3v3':
        return '3v3';
      case '5v5':
        return '5v5';
      case 'casual':
        return 'Casual';
      case 'competitive':
        return 'Competitive';
      default:
        return gameMode.charAt(0).toUpperCase() + gameMode.slice(1);
    }
  }

  // Get map thumbnail URL (placeholder for now)
  private getMapThumbnailUrl(mapId: string): string {
    // This could be expanded to fetch actual map thumbnails from Steam Workshop API
    return `https://steamuserimages-a.akamaihd.net/ugc/${mapId}/preview.jpg`;
  }

  // Open map workshop page in new tab
  openMapWorkshop(mapWorkshopUrl: string): void {
    if (mapWorkshopUrl) {
      window.open(mapWorkshopUrl, '_blank');
    }
  }

  // Chart data generation methods
  generateChartData(): void {
    if (!this.playerData.stats || this.playerData.stats.length === 0) {
      this.chartData = [];
      return;
    }

    // Sort games by match_number (ascending order)
    const sortedGames = [...this.playerData.stats].sort((a, b) => {
      const matchA = parseInt(a.match_number) || 0;
      const matchB = parseInt(b.match_number) || 0;
      return matchA - matchB;
    });

    this.chartData = [];
    let cumulativeWins = 0;
    let cumulativeLosses = 0;

    for (const game of sortedGames) {
      // Determine if player won, lost, or tied
      const playerTeam = game.team_number;
      const team1Score = game.team1_score || 0;
      const team2Score = game.team2_score || 0;
      
      let result: 'W' | 'L' | 'T' = 'T';
      
      if (playerTeam === 1 && team1Score > team2Score) {
        result = 'W';
        cumulativeWins++;
      } else if (playerTeam === 2 && team2Score > team1Score) {
        result = 'W';
        cumulativeWins++;
      } else if (team1Score !== team2Score) {
        result = 'L';
        cumulativeLosses++;
      }

      const runningTotal = cumulativeWins - cumulativeLosses;

      this.chartData.push({
        x: game.match_number,
        y: runningTotal,
        matchNumber: game.match_number,
        result: result,
        runningTotal: runningTotal
      });
    }

    console.log('Generated chart data:', this.chartData);
  }

  // Generate ELO progression data
  generateEloData(): void {
    if (!this.playerData.stats || this.playerData.stats.length === 0) {
      // Still create starting point even with no data
      this.eloData = [{
        x: "0",
        y: 1000,
        matchNumber: "Starting ELO",
        result: 'START',
        eloChange: 0,
        currentElo: 1000
      }];
      return;
    }

    // Sort games by match_number (ascending order)
    const sortedGames = [...this.playerData.stats].sort((a, b) => {
      const matchA = parseInt(a.match_number) || 0;
      const matchB = parseInt(b.match_number) || 0;
      return matchA - matchB;
    });

    this.eloData = [];
    let currentElo = 1000; // Starting ELO

    // Add starting point
    this.eloData.push({
      x: "0",
      y: currentElo,
      matchNumber: "Starting ELO",
      result: 'START',
      eloChange: 0,
      currentElo: currentElo
    });

    // Process each game
    for (const game of sortedGames) {
      // Determine if player won, lost, or tied
      const playerTeam = game.team_number;
      const team1Score = game.team1_score || 0;
      const team2Score = game.team2_score || 0;
      
      let result: 'W' | 'L' | 'T' = 'T';
      let eloChange = 0;
      
      if (playerTeam === 1 && team1Score > team2Score) {
        result = 'W';
        eloChange = Number(game.elo_change_win) || 0;
      } else if (playerTeam === 2 && team2Score > team1Score) {
        result = 'W';
        eloChange = Number(game.elo_change_win) || 0;
      } else if (team1Score !== team2Score) {
        result = 'L';
        eloChange = Number(game.elo_change_loss) || 0;
      }

      // Apply ELO change
      currentElo += eloChange;

      this.eloData.push({
        x: game.match_number,
        y: currentElo,
        matchNumber: game.match_number,
        result: result,
        eloChange: eloChange,
        currentElo: currentElo
      });
    }

    console.log('Generated ELO data:', this.eloData);
  }

  onChartTypeChange(chartType: string): void {
    this.selectedChartType = chartType;
    console.log('Chart type changed to:', chartType);
    
    // Wait for view to update, then render chart
    setTimeout(() => {
      if (chartType === 'cumulative-wins-losses') {
        this.renderWinLossChart();
      } else if (chartType === 'elo') {
        this.renderEloChart();
      }
    }, 100);
  }

  private renderWinLossChart(): void {
    if (!this.chartCanvas || this.chartData.length === 0) {
      console.log('Canvas not available or no data');
      return;
    }

    const canvas = this.chartCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Chart dimensions and padding
    const padding = 60;
    const chartWidth = canvas.width - (padding * 2);
    const chartHeight = canvas.height - (padding * 2);

    // Calculate min and max values for Y axis
    const yValues = this.chartData.map(d => d.y);
    const minY = Math.min(0, Math.min(...yValues)) - 1;
    const maxY = Math.max(0, Math.max(...yValues)) + 1;
    const yRange = maxY - minY;

    // Draw axes
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Y axis
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, padding + chartHeight);
    // X axis
    ctx.moveTo(padding, padding + chartHeight);
    ctx.lineTo(padding + chartWidth, padding + chartHeight);
    ctx.stroke();

    // Draw grid lines and labels
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ccc';
    ctx.font = '12px Arial';

    // Y axis grid and labels
    const ySteps = 10;
    for (let i = 0; i <= ySteps; i++) {
      const y = padding + (chartHeight * i / ySteps);
      const value = maxY - (yRange * i / ySteps);
      
      // Grid line
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + chartWidth, y);
      ctx.stroke();
      
      // Label
      ctx.fillText(value.toFixed(0), 10, y + 4);
    }

    // Draw data line
    if (this.chartData.length > 1) {
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 3;
      ctx.beginPath();

      this.chartData.forEach((point, index) => {
        const x = padding + (chartWidth * index / (this.chartData.length - 1));
        const y = padding + chartHeight - ((point.y - minY) / yRange * chartHeight);
        
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      // Draw data points
      ctx.fillStyle = '#4CAF50';
      this.chartData.forEach((point, index) => {
        const x = padding + (chartWidth * index / (this.chartData.length - 1));
        const y = padding + chartHeight - ((point.y - minY) / yRange * chartHeight);
        
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.fill();
      });
    }

    // Add click/hover event listener for tooltips
    this.addChartInteractivity(canvas, padding, chartWidth, chartHeight, minY, yRange);
  }

  private renderEloChart(): void {
    if (!this.chartCanvas || this.eloData.length === 0) {
      console.log('Canvas not available or no ELO data');
      return;
    }

    const canvas = this.chartCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Chart dimensions and padding
    const padding = 60;
    const chartWidth = canvas.width - (padding * 2);
    const chartHeight = canvas.height - (padding * 2);

    // Calculate min and max values for Y axis (ELO values)
    const yValues = this.eloData.map(d => d.y);
    const minY = Math.min(...yValues) - 50; // Add some padding
    const maxY = Math.max(...yValues) + 50; // Add some padding
    const yRange = maxY - minY;

    // Draw axes
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Y axis
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, padding + chartHeight);
    // X axis
    ctx.moveTo(padding, padding + chartHeight);
    ctx.lineTo(padding + chartWidth, padding + chartHeight);
    ctx.stroke();

    // Draw grid lines and labels
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ccc';
    ctx.font = '12px Arial';

    // Y axis grid and labels (ELO values)
    const ySteps = 10;
    for (let i = 0; i <= ySteps; i++) {
      const y = padding + (chartHeight * i / ySteps);
      const value = maxY - (yRange * i / ySteps);
      
      // Grid line
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + chartWidth, y);
      ctx.stroke();
      
      // Label
      ctx.fillText(Math.round(value).toString(), 10, y + 4);
    }

    // Draw ELO line
    if (this.eloData.length > 1) {
      ctx.strokeStyle = '#FFD700'; // Gold color for ELO
      ctx.lineWidth = 3;
      ctx.beginPath();

      this.eloData.forEach((point, index) => {
        const x = padding + (chartWidth * index / (this.eloData.length - 1));
        const y = padding + chartHeight - ((point.y - minY) / yRange * chartHeight);
        
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      // Draw data points with different colors based on result
      this.eloData.forEach((point, index) => {
        const x = padding + (chartWidth * index / (this.eloData.length - 1));
        const y = padding + chartHeight - ((point.y - minY) / yRange * chartHeight);
        
        // Set color based on result
        if (point.result === 'START') {
          ctx.fillStyle = '#888'; // Gray for starting point
        } else if (point.result === 'W') {
          ctx.fillStyle = '#4CAF50'; // Green for wins
        } else if (point.result === 'L') {
          ctx.fillStyle = '#f44336'; // Red for losses
        } else {
          ctx.fillStyle = '#FFA500'; // Orange for ties
        }
        
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.fill();
      });
    }

    // Add click/hover event listener for ELO tooltips
    this.addEloChartInteractivity(canvas, padding, chartWidth, chartHeight, minY, yRange);
  }

  private addChartInteractivity(canvas: HTMLCanvasElement, padding: number, chartWidth: number, chartHeight: number, minY: number, yRange: number): void {
    canvas.onmousemove = (event) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      // Find closest data point
      let closestPoint: ChartDataPoint | null = null;
      let closestDistance = Infinity;

      this.chartData.forEach((point, index) => {
        const x = padding + (chartWidth * index / (this.chartData.length - 1));
        const y = padding + chartHeight - ((point.y - minY) / yRange * chartHeight);
        
        const distance = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2));
        if (distance < 15 && distance < closestDistance) {
          closestPoint = point;
          closestDistance = distance;
        }
      });

      // Update canvas title for tooltip effect
      if (closestPoint !== null) {
        const point = closestPoint as ChartDataPoint;
        canvas.title = `Match ${point.matchNumber}: ${point.result} (Running Total: ${point.runningTotal})`;
        canvas.style.cursor = 'pointer';
      } else {
        canvas.title = '';
        canvas.style.cursor = 'default';
      }
    };
  }

  private addEloChartInteractivity(canvas: HTMLCanvasElement, padding: number, chartWidth: number, chartHeight: number, minY: number, yRange: number): void {
    canvas.onmousemove = (event) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      // Find closest ELO data point
      let closestPoint: EloDataPoint | null = null;
      let closestDistance = Infinity;

      this.eloData.forEach((point, index) => {
        const x = padding + (chartWidth * index / (this.eloData.length - 1));
        const y = padding + chartHeight - ((point.y - minY) / yRange * chartHeight);
        
        const distance = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2));
        if (distance < 15 && distance < closestDistance) {
          closestPoint = point;
          closestDistance = distance;
        }
      });

      // Update canvas title for tooltip effect
      if (closestPoint !== null) {
        const point = closestPoint as EloDataPoint;
        let tooltipText = '';
        
        if (point.result === 'START') {
          tooltipText = `Starting ELO: ${point.currentElo}`;
        } else {
          const changeText = point.eloChange >= 0 ? `+${point.eloChange}` : `${point.eloChange}`;
          tooltipText = `Match ${point.matchNumber}: ${point.result} (${changeText}) | ELO: ${point.currentElo}`;
        }
        
        canvas.title = tooltipText;
        canvas.style.cursor = 'pointer';
      } else {
        canvas.title = '';
        canvas.style.cursor = 'default';
      }
    };
  }

  private getEmptyStats(): AggregatedPlayerStats {
    return {
      totalGames: 0,
      wins: 0,
      losses: 0,
      winrate: 0,
      totalEloGained: 0,
      totalEloLost: 0,
      netEloChange: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      damage: 0,
      utilityDamage: 0,
      shotsFiredTotal: 0,
      shotsOnTargetTotal: 0,
      entryCount: 0,
      entryWins: 0,
      liveTime: 0,
      headShotKills: 0,
      cashEarned: 0,
      enemiesFlashed: 0,
      totalRounds: 0,
      kdr: 0,
      adr: 0,
      headShotPercentage: 0,
      accuracy: 0,
      entryWinRate: 0
    };
  }

  // Flag display logic (copied from leaderboard component)
  getCountryFlag(countryCode?: string, stateCode?: string): string {
    // If no country code, return empty string (no flag)
    if (!countryCode) {
      return '';
    }

    // For US accounts
    if (countryCode === 'US') {
      // If state is provided, show state flag
      if (stateCode) {
        return this.getStateFlagUrl(stateCode);
      }
      // If no state, show US flag
      return 'https://flagcdn.com/20x15/us.png';
    }

    // For non-US countries, show country flag
    return `https://flagcdn.com/20x15/${countryCode.toLowerCase()}.png`;
  }

  private getStateFlagUrl(stateCode: string): string {
    // US State flags from flagcdn.com using their state flag collection
    // Format: https://flagcdn.com/20x15/us-{state}.png
    const stateCodeLower = stateCode.toLowerCase();
    return `https://flagcdn.com/20x15/us-${stateCodeLower}.png`;
  }

  // Helper method to get flag alt text for accessibility
  getFlagAltText(countryCode?: string, stateCode?: string): string {
    if (!countryCode) {
      return 'No flag';
    }

    if (countryCode === 'US' && stateCode) {
      return `${stateCode} state flag`;
    }

    return `${countryCode} flag`;
  }
}
