import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface QueueWithUserInfo {
  id: string;
  hostSteamId: string;
  hostName: string;
  gameMode: string;
  mapSelectionMode: string;
  serverId: string;
  hasPassword: boolean;
  ranked: boolean;
  startTime: string;
  joiners: Array<{
    steamId: string;
    name: string;
    joinTime: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface AllQueuesResponse {
  queues: QueueWithUserInfo[];
  total: number;
}

@Component({
  selector: 'app-queue-management',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './queue-management.component.html',
  styleUrls: ['./queue-management.component.scss']
})
export class QueueManagementComponent implements OnInit {
  queues: QueueWithUserInfo[] = [];
  isLoadingQueues = false;

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadQueues();
    }
  }

  loadQueues(): void {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser || !isPlatformBrowser(this.platformId)) return;

    this.isLoadingQueues = true;
    
    this.http.get<AllQueuesResponse>(`${environment.apiUrl}/allQueues`, {
      headers: {
        'Authorization': `Bearer ${currentUser.sessionToken}`
      }
    }).subscribe({
      next: (response) => {
        this.queues = response.queues;
        this.isLoadingQueues = false;
      },
      error: (error) => {
        console.error('Error loading queues:', error);
        this.isLoadingQueues = false;
      }
    });
  }

  getTotalPlayers(): number {
    return this.queues.reduce((total, queue) => total + queue.joiners.length + 1, 0);
  }

  trackByQueueId(index: number, queue: QueueWithUserInfo): string {
    return queue.id || index.toString();
  }

  removeQueue(queueId: string): void {
    console.log('Remove queue:', queueId);
    if (confirm('Are you sure you want to remove this queue? This action cannot be undone.')) {
      console.log('Queue removal not yet implemented');
    }
  }

  viewQueueDetails(queue: QueueWithUserInfo): void {
    console.log('View queue details:', queue);
    alert(`Queue Details:\n\nHost: ${queue.hostName}\nPlayers: ${queue.joiners.length + 1}\nCreated: ${this.formatDate(queue.createdAt)}`);
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }

  getTimeSinceCreation(createdAt: string): string {
    const now = new Date();
    const created = new Date(createdAt);
    const diffMs = now.getTime() - created.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hours ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} days ago`;
  }
}
