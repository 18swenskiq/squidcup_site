import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
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

@Component({
  selector: 'app-player-profile-view',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent],
  templateUrl: './player-profile-view.component.html',
  styleUrls: ['./player-profile-view.component.scss']
})
export class PlayerProfileViewComponent implements OnInit {
  steamId: string = '';
  isLoading: boolean = true;
  error: string | null = null;
  
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
      this.loadPlayerProfile();
    });
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
