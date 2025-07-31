import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { interval, Subscription, of, EMPTY } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
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
  isStartingQueue: boolean = false;
  isJoiningQueue: boolean = false;
  isLoadingActiveQueues: boolean = false;
  isTransitioningToLobby: boolean = false;
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
      // Only start queue polling if user is not logged in (they can view queues but not join)
      this.startQueuePolling();
    }
    // Queue polling will be started conditionally based on user status in updateViewState()
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
          
          // Check if queue is full and transitioning to lobby
          if (status.inQueue && !status.inLobby && this.isQueueFull()) {
            this.isTransitioningToLobby = true;
          }
          
          this.updateViewState();
          
          // Start queue polling if user is not in a queue/lobby (can join other queues)
          if (!status.inQueue && !status.inLobby) {
            this.startQueuePolling();
          }
          
          // Initialize response tracking
          this.lastUserQueueResponse = JSON.stringify(status);
          this.lastResponseTime = Date.now();
        },
        error: (error) => {
          console.error('Error fetching initial user queue status:', error);
          this.isLoadingUserQueue = false;
          this.updateViewState();
          // On error, start queue polling to show available queues
          this.startQueuePolling();
        }
      });
  }

  private startUserQueueStatusPolling(): void {
    this.userQueueSubscription = interval(this.POLLING_INTERVAL)
      .pipe(
        switchMap(() => {
          const headers = this.authService.getAuthHeaders();
          return this.http.get<UserQueueStatus>(`${this.apiBaseUrl}/userQueue`, { headers })
            .pipe(
              catchError((error) => {
                console.error('Error fetching user queue status:', error);
                // Return EMPTY to skip this emission and keep the last successful state
                return EMPTY;
              })
            );
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
          
          // Check if queue is full and transitioning to lobby
          const wasTransitioning = this.isTransitioningToLobby;
          this.userQueueStatus = status;
          
          if (status.inQueue && !status.inLobby && this.isQueueFull()) {
            this.isTransitioningToLobby = true;
          } else if (status.inLobby || !status.inQueue) {
            this.isTransitioningToLobby = false;
          }
          
          this.updateViewState();
        }
      });
  }

  private updateViewState(): void {
    const wasInLobbyOrQueue = this.viewState.showLobby;
    
    if (this.userQueueStatus?.inQueue || this.userQueueStatus?.inLobby) {
      this.viewState = {
        showStartQueue: false,
        showJoinQueue: false,
        showLobby: true
      };
      
      // Stop active queue polling when user enters a queue/lobby (can't join other queues anyway)
      if (this.queueSubscription && !wasInLobbyOrQueue) {
        console.log('User entered queue/lobby - stopping active queue polling');
        this.queueSubscription.unsubscribe();
        this.queueSubscription = undefined;
        this.isLoadingActiveQueues = false;
      }
    } else {
      this.viewState = {
        showStartQueue: true,
        showJoinQueue: true,
        showLobby: false
      };
      
      // Start active queue polling when user leaves queue/lobby (can now join other queues)
      if (!this.queueSubscription && wasInLobbyOrQueue && this.isLoggedIn) {
        console.log('User left queue/lobby - starting active queue polling');
        this.startQueuePolling();
      }
    }
  }

  private stopPolling(): void {
    if (this.userQueueSubscription) {
      this.userQueueSubscription.unsubscribe();
      this.userQueueSubscription = undefined;
    }
    if (this.queueSubscription) {
      this.queueSubscription.unsubscribe();
      this.queueSubscription = undefined;
    }
  }

  restartPolling(): void {
    this.isTimedOut = false;
    this.lastResponseTime = Date.now();
    this.startUserQueueStatusPolling();
    
    // Only restart queue polling if user is not in a queue/lobby
    if (!this.userQueueStatus?.inQueue && !this.userQueueStatus?.inLobby) {
      this.startQueuePolling();
    }
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
    if (this.queueForm.valid && !this.isStartingQueue) {
      this.isStartingQueue = true;
      const headers = this.authService.getAuthHeaders();
      this.http.post(`${this.apiBaseUrl}/startQueue`, this.queueForm.value, { headers }).subscribe({
        next: (response) => {
          console.log('Queue started successfully', response);
          this.isStartingQueue = false;
          // The user queue status polling will automatically update the view
        },
        error: (error) => {
          console.error('Error starting queue', error);
          this.isStartingQueue = false;
          // You might want to show an error message
        }
      });
    }
  }

  selectQueue(queue: Queue): void {
    this.selectedQueue = queue;
  }

  joinQueue(): void {
    if (!this.selectedQueue || this.isJoiningQueue) return;
    
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      alert('You must be logged in to join a queue.');
      return;
    }
    
    this.isJoiningQueue = true;
    
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
        this.isJoiningQueue = false;
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
          this.isJoiningQueue = false;
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
          this.isJoiningQueue = false;
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
          this.isJoiningQueue = false;
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
          this.isJoiningQueue = false;
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
        switchMap(() => {
          this.isLoadingActiveQueues = true;
          return this.http.get<{queues: ActiveQueue[]}>(`${this.apiBaseUrl}/activeQueues`)
            .pipe(
              catchError((error) => {
                console.error('Error fetching active queues:', error);
                this.isLoadingActiveQueues = false;
                // Return EMPTY to skip this emission and keep the last successful queue list
                return EMPTY;
              })
            );
        })
      )
      .subscribe({
        next: (response) => {
          this.isLoadingActiveQueues = false;
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

  isQueueFull(): boolean {
    if (!this.userQueueStatus?.queue) return false;
    const currentPlayers = this.getJoinersCount() + 1; // +1 for host
    const maxPlayers = this.getMaxPlayers();
    return currentPlayers >= maxPlayers;
  }
}
