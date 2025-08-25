import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { MatchHistoryMatch, MatchHistoryResponse } from '../shared/interfaces';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-history-view',
  standalone: true,
  imports: [CommonModule, HttpClientModule, FormsModule, PageHeaderComponent],
  templateUrl: './history-view.component.html',
  styleUrl: './history-view.component.scss',
})
export class HistoryViewComponent implements OnInit {
  matches: MatchHistoryMatch[] = [];
  filteredMatches: MatchHistoryMatch[] = [];
  isLoading: boolean = true;
  hasError: boolean = false;
  errorMessage: string = '';
  showMyMatchesOnly: boolean = false;
  private apiBaseUrl: string = environment.apiUrl;

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
        this.applyFilter(); // Apply filter after loading matches
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

  getEloChangeClass(eloChange: number): string {
    if (eloChange > 0) {
      return 'elo-gain';
    } else if (eloChange < 0) {
      return 'elo-loss';
    }
    return '';
  }

  formatEloChange(eloChange: number): string {
    if (eloChange > 0) {
      return `+${eloChange}`;
    }
    return eloChange.toString();
  }

  retry(): void {
    this.loadMatchHistory();
  }

  trackByMatchNumber(index: number, match: MatchHistoryMatch): string {
    return match.matchNumber;
  }

  applyFilter(): void {
    if (this.showMyMatchesOnly) {
      const currentUser = this.authService.getCurrentUser();
      if (currentUser) {
        this.filteredMatches = this.matches.filter(match => 
          match.players.some(player => player.steamId === currentUser.steamId)
        );
      } else {
        this.filteredMatches = [];
      }
    } else {
      this.filteredMatches = [...this.matches];
    }
  }

  onFilterChange(): void {
    this.applyFilter();
  }

  isUserLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }
}
