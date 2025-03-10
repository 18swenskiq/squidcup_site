import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { interval, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

interface Queue {
  id: string;
  host: string;
  gameMode: string;
  players: string;
  server: string;
  map: string;
  hasPassword: boolean;
  ranked: boolean;
}

@Component({
  selector: 'app-play-view',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule],
  templateUrl: './play-view.component.html',
  styleUrl: './play-view.component.scss'
})
export class PlayViewComponent implements OnInit, OnDestroy {
  queueForm!: FormGroup;
  availableMaps: string[] = [];
  availableServers: string[] = [];
  activeQueues: Queue[] = [];
  selectedQueue: Queue | null = null;
  private queueSubscription?: Subscription;

  constructor(private fb: FormBuilder, private http: HttpClient) {}

  ngOnInit(): void {
    this.initForm();
    this.startQueuePolling();
  }

  ngOnDestroy(): void {
    if (this.queueSubscription) {
      this.queueSubscription.unsubscribe();
    }
  }

  private initForm(): void {
    this.queueForm = this.fb.group({
      gameMode: ['', Validators.required],
      map: [{ value: '', disabled: true }, Validators.required],
      server: [{ value: '', disabled: true }, Validators.required],
      password: [''],
      ranked: [true]
    });
  }

  onGameModeChange(): void {
    const gameMode = this.queueForm.get('gameMode')?.value;
    if (gameMode) {
      // Fetch maps based on selected game mode
      this.http.get<string[]>(`placeholder.api/maps?gamemode=${gameMode}`).subscribe(maps => {
        this.availableMaps = maps;
        this.queueForm.get('map')?.enable();
      });

      // Fetch servers based on selected game mode
      this.http.get<string[]>(`placeholder.api/servers?gamemode=${gameMode}`).subscribe(servers => {
        this.availableServers = servers;
        this.queueForm.get('server')?.enable();
      });
    }
  }

  startQueue(): void {
    if (this.queueForm.valid) {
      this.http.post('placeholder.api/startQueue', this.queueForm.value).subscribe({
        next: (response) => {
          console.log('Queue started successfully', response);
          // Handle successful queue start
        },
        error: (error) => {
          console.error('Error starting queue', error);
          // Handle error
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
      this.http.post(`placeholder.api/joinQueue/${this.selectedQueue.id}`, { password }).subscribe({
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
      this.http.post(`placeholder.api/joinQueue/${this.selectedQueue.id}`, {}).subscribe({
        next: (response) => {
          console.log('Joined queue successfully', response);
        },
        error: (error) => {
          console.error('Error joining queue', error);
        }
      });
    }
  }

  private startQueuePolling(): void {
    this.queueSubscription = interval(5000) // Poll every 5 seconds
      .pipe(
        switchMap(() => this.http.get<Queue[]>('placeholder.api/activeQueues'))
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
}
