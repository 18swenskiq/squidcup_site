import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

export interface QueueHistoryEntry {
  id: string;
  gameMode: string;
  mapSelectionMode: string;
  ranked: boolean;
  startTime: string;
  endTime: string;
  status: 'completed' | 'cancelled' | 'disbanded' | 'timeout' | 'error' | 'active';
  statusDescription: string;
  wasHost: boolean;
  finalPlayerCount: number;
  duration: string;
}

@Component({
  selector: 'app-queue-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './queue-history.component.html',
  styleUrl: './queue-history.component.scss'
})
export class QueueHistoryComponent implements OnInit {
  queueHistory: QueueHistoryEntry[] = [];
  isLoading = false;
  error: string | null = null;
  private apiBaseUrl: string = environment.apiUrl;

  constructor(private http: HttpClient, public authService: AuthService) {}

  ngOnInit(): void {
    this.loadQueueHistory();
  }

  private loadQueueHistory(): void {
    if (!this.authService.getCurrentUser()) {
      return;
    }

    this.isLoading = true;
    this.error = null;

    const currentUser = this.authService.getCurrentUser();
    const headers = {
      'Authorization': `Bearer ${currentUser?.sessionToken}`,
      'Content-Type': 'application/json'
    };

    this.http.get<{ queueHistory: QueueHistoryEntry[], total: number }>(`${this.apiBaseUrl}/queueHistory`, { headers })
      .subscribe({
        next: (response) => {
          console.log('Queue history loaded:', response);
          this.queueHistory = response.queueHistory;
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error loading queue history:', error);
          this.error = 'Failed to load queue history. Please try again later.';
          this.isLoading = false;
          
          // Fall back to mock data for now if API fails
          this.queueHistory = this.getMockQueueHistory();
        }
      });
  }

  private getMockQueueHistory(): QueueHistoryEntry[] {
    // Mock data for demonstration
    const now = new Date();
    const mockData: QueueHistoryEntry[] = [
      {
        id: 'q1',
        gameMode: '1v1',
        mapSelectionMode: 'random',
        ranked: false,
        startTime: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(now.getTime() - 0.5 * 60 * 60 * 1000).toISOString(),
        status: 'completed',
        statusDescription: 'Queue filled and lobby was created',
        wasHost: true,
        finalPlayerCount: 2,
        duration: '30m'
      },
      {
        id: 'q2',
        gameMode: 'turf_war',
        mapSelectionMode: 'random',
        ranked: false,
        startTime: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(now.getTime() - 1.5 * 60 * 60 * 1000).toISOString(),
        status: 'completed',
        statusDescription: 'Queue filled and lobby was created',
        wasHost: true,
        finalPlayerCount: 8,
        duration: '30m'
      },
      {
        id: 'q3',
        gameMode: 'ranked_battles',
        mapSelectionMode: 'vote',
        ranked: true,
        startTime: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(now.getTime() - 3.5 * 60 * 60 * 1000).toISOString(),
        status: 'cancelled',
        statusDescription: 'You left the queue',
        wasHost: false,
        finalPlayerCount: 3,
        duration: '30m'
      },
      {
        id: 'q4',
        gameMode: 'splat_zones',
        mapSelectionMode: 'host_choice',
        ranked: false,
        startTime: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
        status: 'disbanded',
        statusDescription: 'Host disbanded the queue',
        wasHost: false,
        finalPlayerCount: 4,
        duration: '1h'
      },
      {
        id: 'q5',
        gameMode: 'tower_control',
        mapSelectionMode: 'random',
        ranked: true,
        startTime: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString(),
        status: 'timeout',
        statusDescription: 'Queue timed out after 1 hour',
        wasHost: true,
        finalPlayerCount: 2,
        duration: '1h'
      }
    ];

    return mockData;
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'completed':
        return 'status-completed';
      case 'cancelled':
        return 'status-cancelled';
      case 'disbanded':
        return 'status-disbanded';
      case 'timeout':
        return 'status-timeout';
      case 'error':
        return 'status-error';
      default:
        return 'status-unknown';
    }
  }

  getRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      return `${diffDays}d ago`;
    }
  }

  formatGameMode(gameMode: string): string {
    return gameMode.replace(/_/g, ' ').toUpperCase();
  }

  formatMapSelectionMode(mode: string): string {
    switch (mode) {
      case 'host_choice':
        return 'Host Choice';
      case 'random':
        return 'Random';
      case 'vote':
        return 'Vote';
      default:
        return mode;
    }
  }
}
