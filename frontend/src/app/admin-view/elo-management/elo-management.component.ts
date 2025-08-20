import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-elo-management',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './elo-management.component.html',
  styleUrls: ['./elo-management.component.scss']
})
export class EloManagementComponent {
  isRecalculating = false;
  lastRecalculation: string | null = null;

  constructor(
    private authService: AuthService,
    private http: HttpClient
  ) {}

  recalculateAllElo(): void {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) return;

    if (!confirm('Are you sure you want to recalculate all player ELO ratings? This will reset and recalculate ELO for all players based on completed match history. This action cannot be undone.')) {
      return;
    }

    this.isRecalculating = true;

    this.http.post(`${environment.apiUrl}/recalculateAllElo`, {}, {
      headers: {
        'Authorization': `Bearer ${currentUser.sessionToken}`,
        'Content-Type': 'application/json'
      }
    }).subscribe({
      next: (response: any) => {
        console.log('ELO recalculation completed:', response);
        this.isRecalculating = false;
        this.lastRecalculation = new Date().toLocaleString();
        alert('ELO recalculation completed successfully!');
      },
      error: (error) => {
        console.error('Error recalculating ELO:', error);
        this.isRecalculating = false;
        let errorMessage = 'Failed to recalculate ELO ratings.';
        
        if (error.status === 403) {
          errorMessage = 'Admin access required to recalculate ELO.';
        } else if (error.error?.error) {
          errorMessage = error.error.error;
        }
        
        alert(errorMessage);
      }
    });
  }
}
