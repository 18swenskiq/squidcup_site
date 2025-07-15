import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { AuthService } from '../services/auth.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface GameServer {
  id: string;
  ip: string;
  port: number;
  location: string;
  rconPassword: string;
  defaultPassword: string;
  maxPlayers: number;
  nickname: string;
}

export interface NewGameServer {
  ip: string;
  port: number;
  location: string;
  rconPassword: string;
  defaultPassword: string;
  maxPlayers: number;
  nickname: string;
}

@Component({
  selector: 'app-admin-view',
  standalone: true,
  imports: [PageHeaderComponent, CommonModule, FormsModule],
  templateUrl: './admin-view.component.html',
  styleUrl: './admin-view.component.scss',
})
export class AdminViewComponent implements OnInit {
  servers: GameServer[] = [];
  isLoading = false;
  editingServer: GameServer | null = null;
  
  newServer: NewGameServer = {
    ip: '',
    port: 27015,
    location: '',
    rconPassword: '',
    defaultPassword: '',
    maxPlayers: 32,
    nickname: ''
  };

  constructor(
    private authService: AuthService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.loadServers();
  }

  loadServers(): void {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) return;

    this.http.get<GameServer[]>(`${environment.apiUrl}/servers`, {
      headers: {
        'Authorization': `Bearer ${currentUser.sessionToken}`
      }
    }).subscribe({
      next: (servers) => {
        this.servers = servers;
      },
      error: (error) => {
        console.error('Error loading servers:', error);
      }
    });
  }

  addServer(): void {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) return;

    this.isLoading = true;
    
    this.http.post<GameServer>(`${environment.apiUrl}/addServer`, this.newServer, {
      headers: {
        'Authorization': `Bearer ${currentUser.sessionToken}`,
        'Content-Type': 'application/json'
      }
    }).subscribe({
      next: (server) => {
        this.servers.push(server);
        this.resetForm();
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error adding server:', error);
        this.isLoading = false;
      }
    });
  }

  editServer(server: GameServer): void {
    this.editingServer = { ...server };
  }

  updateServer(): void {
    if (!this.editingServer) return;
    
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) return;

    this.isLoading = true;
    
    this.http.put<GameServer>(`${environment.apiUrl}/servers/${this.editingServer.id}`, this.editingServer, {
      headers: {
        'Authorization': `Bearer ${currentUser.sessionToken}`,
        'Content-Type': 'application/json'
      }
    }).subscribe({
      next: (updatedServer) => {
        const index = this.servers.findIndex(s => s.id === updatedServer.id);
        if (index !== -1) {
          this.servers[index] = updatedServer;
        }
        this.cancelEdit();
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error updating server:', error);
        this.isLoading = false;
      }
    });
  }

  cancelEdit(): void {
    this.editingServer = null;
  }

  deleteServer(serverId: string): void {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser || !serverId) return;

    if (confirm('Are you sure you want to delete this server?')) {
      this.http.delete(`${environment.apiUrl}/deleteServer/${serverId}`, {
        headers: {
          'Authorization': `Bearer ${currentUser.sessionToken}`
        }
      }).subscribe({
        next: () => {
          this.servers = this.servers.filter(s => s.id !== serverId);
        },
        error: (error) => {
          console.error('Error deleting server:', error);
        }
      });
    }
  }

  trackByServerId(index: number, server: GameServer): string {
    return server.id || index.toString();
  }

  private resetForm(): void {
    this.newServer = {
      ip: '',
      port: 27015,
      location: '',
      rconPassword: '',
      defaultPassword: '',
      maxPlayers: 32,
      nickname: ''
    };
  }
}
