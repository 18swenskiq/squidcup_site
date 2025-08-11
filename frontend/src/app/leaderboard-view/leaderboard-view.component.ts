import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { environment } from '../../environments/environment';

export interface PlayerLeaderboardStats {
  steamId: string;
  username: string;
  avatarUrl?: string;
  countryCode?: string;
  stateCode?: string;
  // Combined stats from sqlidcup_stats_players
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  enemy5ks: number;
  enemy4ks: number;
  enemy3ks: number;
  enemy2ks: number;
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

export interface LeaderboardResponse {
  players: PlayerLeaderboardStats[];
  total: number;
}

@Component({
  selector: 'app-leaderboard-view',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent],
  templateUrl: './leaderboard-view.component.html',
  styleUrl: './leaderboard-view.component.scss',
})
export class LeaderboardViewComponent implements OnInit {
  players: PlayerLeaderboardStats[] = [];
  originalPlayers: PlayerLeaderboardStats[] = [];
  isLoading = true;
  error: string | null = null;
  sortColumn: string | null = null;
  sortDirection: 'asc' | 'desc' = 'desc';

  // Column definitions with abbreviations and full names for tooltips
  columns = [
    { key: 'kills', label: 'K', tooltip: 'Kills' },
    { key: 'deaths', label: 'D', tooltip: 'Deaths' },
    { key: 'assists', label: 'A', tooltip: 'Assists' },
    { key: 'kdr', label: 'KDR', tooltip: 'Kill/Death Ratio' },
    { key: 'damage', label: 'DMG', tooltip: 'Total Damage' },
    { key: 'adr', label: 'ADR', tooltip: 'Average Damage per Round' },
    { key: 'headShotKills', label: 'HS', tooltip: 'Headshot Kills' },
    { key: 'headShotPercentage', label: 'HS%', tooltip: 'Headshot Percentage' },
    { key: 'accuracy', label: 'ACC%', tooltip: 'Accuracy Percentage' },
    { key: 'enemy5ks', label: '5K', tooltip: '5-Kill Rounds (Aces)' },
    { key: 'enemy4ks', label: '4K', tooltip: '4-Kill Rounds' },
    { key: 'enemy3ks', label: '3K', tooltip: '3-Kill Rounds' },
    { key: 'enemy2ks', label: '2K', tooltip: '2-Kill Rounds' },
    { key: 'entryCount', label: 'ENT', tooltip: 'Entry Attempts' },
    { key: 'entryWins', label: 'ENTW', tooltip: 'Entry Wins' },
    { key: 'entryWinRate', label: 'ENT%', tooltip: 'Entry Win Rate' },
    { key: 'utilityDamage', label: 'UD', tooltip: 'Utility Damage' },
    { key: 'totalRounds', label: 'RDS', tooltip: 'Total Rounds Played' },
    { key: 'shotsFiredTotal', label: 'SF', tooltip: 'Shots Fired' },
    { key: 'shotsOnTargetTotal', label: 'SOT', tooltip: 'Shots on Target' },
    { key: 'liveTime', label: 'TIME', tooltip: 'Live Time (seconds)' },
    { key: 'cashEarned', label: 'CASH', tooltip: 'Cash Earned' },
    { key: 'enemiesFlashed', label: 'FLASH', tooltip: 'Enemies Flashed' }
  ];

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    this.loadLeaderboardData();
  }

  loadLeaderboardData(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.isLoading = true;
    this.error = null;

    const apiUrl = `${environment.apiUrl}/playerLeaderboardStats`;
    
    this.http.get<LeaderboardResponse>(apiUrl).subscribe({
      next: (response) => {
        this.originalPlayers = [...response.players];
        this.players = [...response.players];
        this.isLoading = false;
        // Default sort by KDR descending
        this.sortBy('kdr');
      },
      error: (error) => {
        console.error('Error loading leaderboard data:', error);
        this.error = 'Failed to load leaderboard data. Please try again later.';
        this.isLoading = false;
      }
    });
  }

  getStatValue(player: PlayerLeaderboardStats, key: string): string | number {
    const value = (player as any)[key];
    
    // Format certain values for display
    if (key === 'kdr' || key === 'adr') {
      return typeof value === 'number' ? value.toFixed(1) : '0.0';
    }
    if (key.includes('Percentage') || key.includes('Rate')) {
      return typeof value === 'number' ? value.toFixed(1) + '%' : '0.0%';
    }
    if (key === 'liveTime') {
      // Convert seconds to minutes:seconds format
      const minutes = Math.floor(value / 60);
      const seconds = value % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    return value || 0;
  }

  getPlayerRank(index: number): number {
    return index + 1;
  }

  // Placeholder for flag - will implement country flags later
  getCountryFlag(countryCode?: string): string {
    // For now, return US flag as placeholder
    return '🇺🇸';
  }

  sortBy(column: string): void {
    if (this.sortColumn === column) {
      // Toggle direction if same column
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // New column, default to descending for most stats (except deaths)
      this.sortColumn = column;
      this.sortDirection = column === 'deaths' ? 'asc' : 'desc';
    }

    this.players.sort((a, b) => {
      let valueA = this.getSortValue(a, column);
      let valueB = this.getSortValue(b, column);

      // Handle string comparisons (username)
      if (typeof valueA === 'string' && typeof valueB === 'string') {
        valueA = valueA.toLowerCase();
        valueB = valueB.toLowerCase();
      }

      let comparison = 0;
      if (valueA < valueB) {
        comparison = -1;
      } else if (valueA > valueB) {
        comparison = 1;
      }

      return this.sortDirection === 'asc' ? comparison : -comparison;
    });
  }

  private getSortValue(player: PlayerLeaderboardStats, column: string): any {
    // For username, we want to sort by the actual username string
    if (column === 'username') {
      return player.username;
    }
    
    // For all other columns, get the raw numeric value
    return (player as any)[column] || 0;
  }

  getSortIcon(column: string): string {
    if (this.sortColumn !== column) {
      return '↕️'; // Neutral sort icon
    }
    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  getSortClass(column: string): string {
    if (this.sortColumn === column) {
      return `sorted-${this.sortDirection}`;
    }
    return 'sortable';
  }
}
