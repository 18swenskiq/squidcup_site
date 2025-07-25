import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { interval, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthService } from '../services/auth.service';
import { GameServer, UserQueueStatus, Queue, ViewState, ActiveQueue, UserActiveQueue, LobbyData } from './play-view.interfaces';
import { QueueHistoryComponent } from '../components/queue-history/queue-history.component';
import { LobbyComponent } from '../components/lobby/lobby.component';

@Component({
  selector: 'app-play-view',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule, QueueHistoryComponent, LobbyComponent],
  templateUrl: './play-view.component.html',
  styleUrl: './play-view.component.scss'
})
export class PlayViewComponent implements OnInit, OnDestroy {
  queueForm!: FormGroup;
  availableServers: GameServer[] = [];
  activeQueues: Queue[] = [];
  selectedQueue: Queue | null = null;
  userQueueStatus: UserQueueStatus | null = null;
  isLoadingUserQueue: boolean = true;
  viewState: ViewState = {
    showStartQueue: true,
    showJoinQueue: true,
    showLobby: false
  };
  
  // Timeout functionality
  isTimedOut: boolean = false;
  private lastUserQueueResponse: string = '';
  private lastResponseTime: number = Date.now();
  private readonly TIMEOUT_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
  private readonly POLLING_INTERVAL = 5000; // 5 seconds
  
  private queueSubscription?: Subscription;
  private userQueueSubscription?: Subscription;
  private apiBaseUrl: string = environment.apiUrl;

  constructor(private fb: FormBuilder, private http: HttpClient, public authService: AuthService) {}

  ngOnInit(): void {
    this.initForm();
    if (this.isLoggedIn) {
      this.checkInitialUserQueueStatus();
      this.startUserQueueStatusPolling();
    } else {
      this.isLoadingUserQueue = false;
    }
    this.startQueuePolling();
  }

  ngOnDestroy(): void {
    if (this.queueSubscription) {
      this.queueSubscription.unsubscribe();
    }
    if (this.userQueueSubscription) {
      this.userQueueSubscription.unsubscribe();
    }
    // Reset timeout state on component destroy
    this.isTimedOut = false;
  }

  private initForm(): void {
    this.queueForm = this.fb.group({
      gameMode: ['', Validators.required],
      mapSelectionMode: ['', Validators.required],
      server: [{ value: '', disabled: true }, Validators.required],
      password: [''],
      ranked: [true]
    });
  }

  get isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  private checkInitialUserQueueStatus(): void {
    const headers = this.authService.getAuthHeaders();
    this.http.get<UserQueueStatus>(`${this.apiBaseUrl}/userQueue`, { headers })
      .subscribe({
        next: (status) => {
          this.userQueueStatus = status;
          this.isLoadingUserQueue = false;
          this.updateViewState();
          
          // Initialize response tracking
          this.lastUserQueueResponse = JSON.stringify(status);
          this.lastResponseTime = Date.now();
        },
        error: (error) => {
          console.error('Error fetching initial user queue status:', error);
          this.isLoadingUserQueue = false;
          this.updateViewState();
        }
      });
  }

  private startUserQueueStatusPolling(): void {
    this.userQueueSubscription = interval(this.POLLING_INTERVAL)
      .pipe(
        switchMap(() => {
          const headers = this.authService.getAuthHeaders();
          return this.http.get<UserQueueStatus>(`${this.apiBaseUrl}/userQueue`, { headers });
        })
      )
      .subscribe({
        next: (status) => {
          const responseString = JSON.stringify(status);
          
          // Check if response has changed
          if (responseString !== this.lastUserQueueResponse) {
            this.lastUserQueueResponse = responseString;
            this.lastResponseTime = Date.now();
            this.isTimedOut = false; // Reset timeout state if response changes
          } else {
            // Check if we've exceeded the timeout duration
            const timeSinceLastChange = Date.now() - this.lastResponseTime;
            if (timeSinceLastChange >= this.TIMEOUT_DURATION && !this.isTimedOut) {
              this.isTimedOut = true;
              this.stopPolling();
            }
          }
          
          this.userQueueStatus = status;
          this.updateViewState();
        },
        error: (error) => {
          console.error('Error fetching user queue status:', error);
        }
      });
  }

  private updateViewState(): void {
    if (this.userQueueStatus?.inQueue || this.userQueueStatus?.inLobby) {
      this.viewState = {
        showStartQueue: false,
        showJoinQueue: false,
        showLobby: true
      };
    } else {
      this.viewState = {
        showStartQueue: true,
        showJoinQueue: true,
        showLobby: false
      };
    }
  }

  private stopPolling(): void {
    if (this.userQueueSubscription) {
      this.userQueueSubscription.unsubscribe();
      this.userQueueSubscription = undefined;
    }
  }

  restartPolling(): void {
    this.isTimedOut = false;
    this.lastResponseTime = Date.now();
    this.startUserQueueStatusPolling();
  }

  onGameModeChange(): void {
    const gameMode = this.queueForm.get('gameMode')?.value;

    this.queueForm.controls['server'].reset({ value: '', disabled: true });
    this.availableServers = [];

    if (gameMode) {
      // Fetch servers based on selected game mode
      this.http.get<GameServer[]>(`${this.apiBaseUrl}servers?gamemode=${gameMode}`).subscribe(servers => {
        this.availableServers = servers;
        this.queueForm.get('server')?.enable();
      });
    }
  }

  startQueue(): void {
    if (this.queueForm.valid) {
      const headers = this.authService.getAuthHeaders();
      this.http.post(`${this.apiBaseUrl}/startQueue`, this.queueForm.value, { headers }).subscribe({
        next: (response) => {
          console.log('Queue started successfully', response);
          // The user queue status polling will automatically update the view
        },
        error: (error) => {
          console.error('Error starting queue', error);
          // You might want to show an error message
        }
      });
    }
  }

  selectQueue(queue: Queue): void {
    this.selectedQueue = queue;
  }

  joinQueue(): void {
    if (!this.selectedQueue) return;
    
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      alert('You must be logged in to join a queue.');
      return;
    }
    
    const headers = {
      'Authorization': `Bearer ${currentUser.sessionToken}`,
      'Content-Type': 'application/json'
    };
    
    // Logic to join a queue
    console.log('Joining queue:', this.selectedQueue);
    
    // If the queue has a password, prompt for it before joining
    if (this.selectedQueue.hasPassword) {
      const password = prompt('This queue requires a password:');
      if (!password) {
        return; // User cancelled the password prompt
      }
      
      // Join the queue with the provided password
      this.http.post(`${this.apiBaseUrl}/joinQueue`, { 
        queueId: this.selectedQueue.id, 
        password 
      }, { headers }).subscribe({
        next: (response) => {
          console.log('Joined queue successfully', response);
          alert('Successfully joined the queue!');
          this.selectedQueue = null; // Clear selection
        },
        error: (error) => {
          console.error('Error joining queue', error);
          let errorMessage = 'Failed to join queue.';
          if (error.status === 403 && error.error?.error) {
            errorMessage = error.error.error;
          } else if (error.status === 400 && error.error?.error) {
            errorMessage = error.error.error;
          }
          alert(errorMessage);
        }
      });
    } else {
      // Join the queue without password
      this.http.post(`${this.apiBaseUrl}/joinQueue`, { 
        queueId: this.selectedQueue.id 
      }, { headers }).subscribe({
        next: (response) => {
          console.log('Joined queue successfully', response);
          alert('Successfully joined the queue!');
          this.selectedQueue = null; // Clear selection
        },
        error: (error) => {
          console.error('Error joining queue', error);
          let errorMessage = 'Failed to join queue.';
          if (error.status === 403 && error.error?.error) {
            errorMessage = error.error.error;
          } else if (error.status === 400 && error.error?.error) {
            errorMessage = error.error.error;
          }
          alert(errorMessage);
        }
      });
    }
  }

  leaveQueue(): void {
    if (!this.userQueueStatus?.queue) return;
    
    // Show confirmation dialog if user is host
    if (this.userQueueStatus.isHost) {
      const confirmed = confirm('You are the host. Leaving will disband the entire queue for all players. Are you sure you want to continue?');
      if (!confirmed) {
        return;
      }
    }
    
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) return;
    
    const headers = {
      'Authorization': `Bearer ${currentUser.sessionToken}`,
      'Content-Type': 'application/json'
    };
    
    this.http.post(`${this.apiBaseUrl}/leaveQueue`, {}, { headers }).subscribe({
      next: (response: any) => {
        console.log('Left queue successfully', response);
        
        if (response.wasHost) {
          alert('Queue has been disbanded successfully.');
        } else {
          alert('You have left the queue successfully.');
        }
        
        // The user queue status polling will automatically update the view
      },
      error: (error) => {
        console.error('Error leaving queue', error);
        
        // Show user-friendly error message
        let errorMessage = 'Failed to leave queue. Please try again.';
        if (error.status === 400 && error.error?.error) {
          errorMessage = error.error.error;
        }
        alert(errorMessage);
      }
    });
  }

  private startQueuePolling(): void {
    this.queueSubscription = interval(this.POLLING_INTERVAL) // Poll every 5 seconds
      .pipe(
        switchMap(() => this.http.get<{queues: ActiveQueue[]}>(`${this.apiBaseUrl}/activeQueues`))
      )
      .subscribe({
        next: (response) => {
          // Map ActiveQueue to Queue format for the UI
          this.activeQueues = response.queues.map(aq => ({
            id: aq.queueId,
            host: aq.host,
            gameMode: aq.gameMode,
            players: `${aq.players}/${aq.maxPlayers}`,
            server: aq.server,
            map: '', // Not provided by backend yet
            hasPassword: aq.hasPassword,
            ranked: aq.ranked
          }));
          // If the selected queue is no longer in the list, deselect it
          if (this.selectedQueue && !this.activeQueues.some(q => q.id === this.selectedQueue?.id)) {
            this.selectedQueue = null;
          }
        },
        error: (error) => {
          console.error('Error fetching queues', error);
        }
      });
  }

  getQueueDuration(): string {
    if (!this.userQueueStatus?.queue?.startTime) return '';
    
    const startTime = new Date(this.userQueueStatus.queue.startTime);
    const now = new Date();
    const duration = now.getTime() - startTime.getTime();
    
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  getJoinersCount(): number {
    return this.userQueueStatus?.queue?.joiners.length || 0;
  }

  getMaxPlayers(): number {
    if (!this.userQueueStatus?.queue?.gameMode) return 0;
    
    switch (this.userQueueStatus.queue.gameMode) {
      case '1v1': return 2;
      case 'wingman': return 4;
      case '3v3': return 6;
      case '5v5': return 10;
      default: return 0;
    }
  }
}
