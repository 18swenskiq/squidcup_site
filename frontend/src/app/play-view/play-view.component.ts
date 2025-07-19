import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { interval, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthService } from '../services/auth.service';
import { GameServer, UserQueueStatus, Queue, ViewState, ActiveQueue } from './play-view.interfaces';
import { QueueHistoryComponent } from '../components/queue-history/queue-history.component';

@Component({
  selector: 'app-play-view',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule, QueueHistoryComponent],
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
        },
        error: (error) => {
          console.error('Error fetching initial user queue status:', error);
          this.isLoadingUserQueue = false;
          this.updateViewState();
        }
      });
  }

  private startUserQueueStatusPolling(): void {
    this.userQueueSubscription = interval(3000) // Poll every 3 seconds
      .pipe(
        switchMap(() => {
          const headers = this.authService.getAuthHeaders();
          return this.http.get<UserQueueStatus>(`${this.apiBaseUrl}/userQueue`, { headers });
        })
      )
      .subscribe({
        next: (status) => {
          this.userQueueStatus = status;
          this.updateViewState();
        },
        error: (error) => {
          console.error('Error fetching user queue status:', error);
        }
      });
  }

  private updateViewState(): void {
    if (this.userQueueStatus?.inQueue) {
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
    
    // Logic to join a queue
    console.log('Joining queue:', this.selectedQueue);
    
    // If the queue has a password, prompt for it before joining
    if (this.selectedQueue.hasPassword) {
      const password = prompt('This queue requires a password:');
      if (!password) {
        return; // User cancelled the password prompt
      }
      
      // Join the queue with the provided password
      this.http.post(`${this.apiBaseUrl}/joinQueue/${this.selectedQueue.id}`, { password }).subscribe({
        next: (response) => {
          console.log('Joined queue successfully', response);
        },
        error: (error) => {
          console.error('Error joining queue', error);
          alert('Failed to join queue. Incorrect password.');
        }
      });
    } else {
      // Join the queue without password
      this.http.post(`${this.apiBaseUrl}/joinQueue/${this.selectedQueue.id}`, {}).subscribe({
        next: (response) => {
          console.log('Joined queue successfully', response);
        },
        error: (error) => {
          console.error('Error joining queue', error);
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
    this.queueSubscription = interval(5000) // Poll every 5 seconds
      .pipe(
        switchMap(() => this.http.get<Queue[]>(`${this.apiBaseUrl}/activeQueues`))
      )
      .subscribe({
        next: (queues) => {
          this.activeQueues = queues;
          // If the selected queue is no longer in the list, deselect it
          if (this.selectedQueue && !queues.some(q => q.id === this.selectedQueue?.id)) {
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
      case 'wingman': return 4;
      case '3v3': return 6;
      case '5v5': return 10;
      default: return 0;
    }
  }
}
