import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { MatchHistoryMatch, MatchHistoryResponse } from '../shared/interfaces';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-history-view',
  standalone: true,
  imports: [CommonModule, HttpClientModule, PageHeaderComponent],
  templateUrl: './history-view.component.html',
  styleUrl: './history-view.component.scss',
})
export class HistoryViewComponent implements OnInit {
  matches: MatchHistoryMatch[] = [];
  isLoading: boolean = true;
  hasError: boolean = false;
  errorMessage: string = '';
  private apiBaseUrl = 'https://api.squidcup.spkymnr.xyz';

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    // Only load data when running in the browser, not during prerendering
    if (isPlatformBrowser(this.platformId)) {
      this.loadMatchHistory();
    } else {
      // During prerendering, show loading state
      this.isLoading = true;
    }
  }

  loadMatchHistory(): void {
    this.isLoading = true;
    this.hasError = false;
    
    // Note: This endpoint doesn't require authentication as it returns public match history
    this.http.get<MatchHistoryResponse>(`${this.apiBaseUrl}/matchHistory`).subscribe({
      next: (response) => {
        this.matches = response.matches.map(match => ({
          ...match,
          expanded: false // Initialize expansion state
        }));
        this.isLoading = false;
        console.log('Loaded match history:', this.matches);
      },
      error: (error) => {
        console.error('Error loading match history:', error);
        this.hasError = true;
        this.errorMessage = 'Failed to load match history. Please try again later.';
        this.isLoading = false;
      }
    });
  }

  toggleMatchExpansion(match: MatchHistoryMatch): void {
    match.expanded = !match.expanded;
  }

  getMapThumbnailUrl(mapId: string): string {
    // For now, return a placeholder or Steam Workshop thumbnail URL
    // In the future, this could be enhanced to fetch actual thumbnails
    if (mapId) {
      return `https://steamuserimages-a.akamaihd.net/ugc/${mapId}/preview.jpg`;
    }
    return 'assets/default-map-thumbnail.jpg'; // Fallback image
  }

  formatGameMode(gameMode: string): string {
    return gameMode.toUpperCase();
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  getTeamPlayers(match: MatchHistoryMatch, teamNumber: number): any[] {
    return match.players.filter(player => player.team === teamNumber);
  }

  getKDA(player: any): string {
    return `${player.kills}/${player.deaths}/${player.assists}`;
  }

  retry(): void {
    this.loadMatchHistory();
  }

  trackByMatchNumber(index: number, match: MatchHistoryMatch): string {
    return match.matchNumber;
  }
}
