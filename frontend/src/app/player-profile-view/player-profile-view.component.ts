import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { PageHeaderComponent } from '../page-header/page-header.component';

export interface PlayerProfileData {
  steamId: string;
  username: string;
  avatarUrl?: string;
  countryCode?: string;
  stateCode?: string;
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

    // TODO: Replace with actual API call to get player profile data
    // For now, just simulate loading with placeholder data
    setTimeout(() => {
      // Simulate placeholder player data
      this.playerData = {
        steamId: this.steamId,
        username: `Player_${this.steamId.substring(this.steamId.length - 8)}`, // Use last 8 chars of steam ID
        avatarUrl: 'https://avatars.steamstatic.com/b5bd56c1aa4644a474a2e4972be27ef9e82e517e_full.jpg', // Placeholder avatar
        countryCode: 'US',
        stateCode: 'CA'
      };
      this.isLoading = false;
    }, 1000);
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
