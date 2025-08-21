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
  currentElo: number; // Player's current ELO rating
  winrate: number; // Overall win rate percentage
  // Combined stats from sqlidcup_stats_players
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
    { key: 'currentElo', label: 'ELO', tooltip: 'Current ELO Rating' },
    { key: 'winrate', label: 'WIN%', tooltip: 'Win Rate Percentage' },
    { key: 'kills', label: 'K', tooltip: 'Kills' },
    { key: 'deaths', label: 'D', tooltip: 'Deaths' },
    { key: 'assists', label: 'A', tooltip: 'Assists' },
    { key: 'kdr', label: 'KDR', tooltip: 'Kill/Death Ratio' },
    { key: 'damage', label: 'DMG', tooltip: 'Total Damage' },
    { key: 'adr', label: 'ADR', tooltip: 'Average Damage per Round' },
    { key: 'headShotKills', label: 'HS', tooltip: 'Headshot Kills' },
    { key: 'headShotPercentage', label: 'HS%', tooltip: 'Headshot Percentage' },
    { key: 'accuracy', label: 'ACC%', tooltip: 'Accuracy Percentage' },
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
    if (key === 'currentElo') {
      // For ELO, remove trailing zeros after decimal point
      if (typeof value === 'number') {
        return value % 1 === 0 ? value.toString() : value.toFixed(1).replace(/\.0$/, '');
      }
      return '0';
    }
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

  // Flag display logic based on location data
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

  private getCountryFlagEmoji(countryCode: string): string {
    // Common country flags mapping
    const countryFlags: { [key: string]: string } = {
      'AD': '🇦🇩', 'AE': '🇦🇪', 'AF': '🇦🇫', 'AG': '🇦🇬', 'AI': '🇦🇮',
      'AL': '🇦🇱', 'AM': '🇦🇲', 'AO': '🇦🇴', 'AQ': '🇦🇶', 'AR': '🇦🇷',
      'AS': '🇦🇸', 'AT': '🇦🇹', 'AU': '🇦🇺', 'AW': '🇦🇼', 'AX': '🇦🇽',
      'AZ': '🇦🇿', 'BA': '🇧🇦', 'BB': '🇧🇧', 'BD': '🇧🇩', 'BE': '🇧🇪',
      'BF': '🇧🇫', 'BG': '🇧🇬', 'BH': '🇧🇭', 'BI': '🇧🇮', 'BJ': '🇧🇯',
      'BL': '🇧🇱', 'BM': '🇧🇲', 'BN': '🇧🇳', 'BO': '🇧🇴', 'BQ': '🇧🇶',
      'BR': '🇧🇷', 'BS': '🇧🇸', 'BT': '🇧🇹', 'BV': '🇧🇻', 'BW': '🇧🇼',
      'BY': '🇧🇾', 'BZ': '🇧🇿', 'CA': '🇨🇦', 'CC': '🇨🇨', 'CD': '🇨🇩',
      'CF': '🇨🇫', 'CG': '🇨🇬', 'CH': '🇨🇭', 'CI': '🇨🇮', 'CK': '🇨🇰',
      'CL': '🇨🇱', 'CM': '🇨🇲', 'CN': '🇨🇳', 'CO': '🇨🇴', 'CR': '🇨�',
      'CU': '🇨�🇺', 'CV': '🇨🇻', 'CW': '🇨🇼', 'CX': '🇨🇽', 'CY': '🇨🇾',
      'CZ': '🇨🇿', 'DE': '🇩🇪', 'DJ': '🇩🇯', 'DK': '🇩🇰', 'DM': '🇩🇲',
      'DO': '🇩🇴', 'DZ': '🇩🇿', 'EC': '🇪🇨', 'EE': '�🇪', 'EG': '🇪🇬',
      'EH': '🇪🇭', 'ER': '🇪🇷', 'ES': '🇪�🇸', 'ET': '🇪🇹', 'FI': '🇫🇮',
      'FJ': '🇫🇯', 'FK': '🇫🇰', 'FM': '🇫🇲', 'FO': '🇫🇴', 'FR': '🇫🇷',
      'GA': '🇬🇦', 'GB': '🇬🇧', 'GD': '🇬🇩', 'GE': '🇬🇪', 'GF': '🇬🇫',
      'GG': '🇬🇬', 'GH': '🇬🇭', 'GI': '🇬🇮', 'GL': '🇬🇱', 'GM': '🇬🇲',
      'GN': '🇬🇳', 'GP': '🇬🇵', 'GQ': '🇬🇶', 'GR': '🇬🇷', 'GS': '🇬🇸',
      'GT': '🇬🇹', 'GU': '🇬🇺', 'GW': '🇬🇼', 'GY': '🇬🇾', 'HK': '🇭🇰',
      'HM': '🇭🇲', 'HN': '🇭🇳', 'HR': '🇭🇷', 'HT': '🇭🇹', 'HU': '🇭🇺',
      'ID': '🇮🇩', 'IE': '🇮🇪', 'IL': '🇮🇱', 'IM': '🇮🇲', 'IN': '🇮🇳',
      'IO': '🇮🇴', 'IQ': '🇮🇶', 'IR': '🇮🇷', 'IS': '🇮🇸', 'IT': '🇮🇹',
      'JE': '🇯🇪', 'JM': '🇯🇲', 'JO': '🇯🇴', 'JP': '🇯🇵', 'KE': '🇰🇪',
      'KG': '🇰🇬', 'KH': '🇰🇭', 'KI': '🇰🇮', 'KM': '🇰🇲', 'KN': '🇰🇳',
      'KP': '🇰🇵', 'KR': '🇰🇷', 'KW': '🇰🇼', 'KY': '🇰🇾', 'KZ': '🇰🇿',
      'LA': '🇱🇦', 'LB': '🇱🇧', 'LC': '🇱🇨', 'LI': '🇱🇮', 'LK': '🇱🇰',
      'LR': '🇱🇷', 'LS': '🇱🇸', 'LT': '🇱🇹', 'LU': '🇱🇺', 'LV': '🇱🇻',
      'LY': '🇱🇾', 'MA': '🇲🇦', 'MC': '🇲🇨', 'MD': '🇲🇩', 'ME': '🇲🇪',
      'MF': '🇲🇫', 'MG': '🇲🇬', 'MH': '🇲🇭', 'MK': '🇲🇰', 'ML': '🇲🇱',
      'MM': '🇲🇲', 'MN': '🇲🇳', 'MO': '🇲🇴', 'MP': '🇲🇵', 'MQ': '🇲🇶',
      'MR': '🇲🇷', 'MS': '🇲🇸', 'MT': '🇲🇹', 'MU': '🇲🇺', 'MV': '🇲🇻',
      'MW': '🇲🇼', 'MX': '🇲🇽', 'MY': '🇲🇾', 'MZ': '🇲🇿', 'NA': '🇳🇦',
      'NC': '🇳🇨', 'NE': '🇳🇪', 'NF': '🇳🇫', 'NG': '🇳🇬', 'NI': '🇳🇮',
      'NL': '🇳🇱', 'NO': '🇳🇴', 'NP': '🇳🇵', 'NR': '🇳🇷', 'NU': '🇳🇺',
      'NZ': '🇳🇿', 'OM': '🇴🇲', 'PA': '🇵🇦', 'PE': '🇵🇪', 'PF': '🇵🇫',
      'PG': '🇵🇬', 'PH': '🇵🇭', 'PK': '🇵🇰', 'PL': '🇵🇱', 'PM': '🇵🇲',
      'PN': '🇵🇳', 'PR': '🇵🇷', 'PS': '🇵🇸', 'PT': '🇵🇹', 'PW': '🇵🇼',
      'PY': '🇵🇾', 'QA': '🇶🇦', 'RE': '🇷🇪', 'RO': '🇷🇴', 'RS': '🇷🇸',
      'RU': '🇷🇺', 'RW': '🇷🇼', 'SA': '🇸🇦', 'SB': '🇸🇧', 'SC': '🇸🇨',
      'SD': '🇸🇩', 'SE': '🇸🇪', 'SG': '🇸🇬', 'SH': '🇸🇭', 'SI': '🇸🇮',
      'SJ': '🇸🇯', 'SK': '🇸🇰', 'SL': '🇸🇱', 'SM': '🇸🇲', 'SN': '🇸🇳',
      'SO': '🇸🇴', 'SR': '🇸🇷', 'SS': '🇸🇸', 'ST': '🇸🇹', 'SV': '🇸🇻',
      'SX': '🇸🇽', 'SY': '🇸🇾', 'SZ': '🇸🇿', 'TC': '🇹🇨', 'TD': '🇹🇩',
      'TF': '🇹🇫', 'TG': '🇹🇬', 'TH': '🇹🇭', 'TJ': '🇹🇯', 'TK': '🇹🇰',
      'TL': '🇹🇱', 'TM': '🇹🇲', 'TN': '🇹🇳', 'TO': '🇹🇴', 'TR': '🇹🇷',
      'TT': '🇹🇹', 'TV': '🇹🇻', 'TW': '🇹🇼', 'TZ': '🇹🇿', 'UA': '🇺🇦',
      'UG': '🇺🇬', 'UM': '🇺🇲', 'US': '🇺🇸', 'UY': '🇺🇾', 'UZ': '🇺🇿',
      'VA': '🇻🇦', 'VC': '🇻🇨', 'VE': '🇻🇪', 'VG': '🇻🇬', 'VI': '🇻🇮',
      'VN': '🇻🇳', 'VU': '🇻🇺', 'WF': '🇼🇫', 'WS': '🇼🇸', 'YE': '🇾🇪',
      'YT': '🇾🇹', 'ZA': '🇿🇦', 'ZM': '🇿🇲', 'ZW': '🇿🇼'
    };

    return countryFlags[countryCode.toUpperCase()] || '🏳️'; // Fallback to generic flag
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
    
    // Get the raw value
    const value = (player as any)[column];
    
    // Define numeric columns that should be treated as numbers
    const numericColumns = [
      'kills', 'deaths', 'assists', 'damage', 'utilityDamage', 
      'shotsFiredTotal', 'shotsOnTargetTotal', 'entryCount', 'entryWins',
      'liveTime', 'headShotKills', 'cashEarned', 'enemiesFlashed', 'totalRounds',
      'kdr', 'adr', 'headShotPercentage', 'accuracy', 'entryWinRate', 'currentElo', 'winrate'
    ];
    
    // If it's a numeric column, ensure we return a number
    if (numericColumns.includes(column)) {
      return parseFloat(value) || 0;
    }
    
    // For all other columns, return the raw value
    return value || 0;
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
