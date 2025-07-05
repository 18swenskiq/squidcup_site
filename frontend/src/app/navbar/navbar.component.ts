import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { AuthService, User } from '../services/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterModule, CommonModule],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
})
export class NavbarComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  private subscriptions: Subscription[] = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // Subscribe to current user changes
    this.subscriptions.push(
      this.authService.currentUser$.subscribe(user => {
        this.currentUser = user;
      })
    );

    // Check for login callback parameters
    this.route.queryParams.subscribe(params => {
      console.log('Route query params:', params);
      if (params['token'] && params['steamId']) {
        console.log('Steam login callback detected, processing...');
        this.authService.handleLoginCallback(params['token'], params['steamId']);
        // Clean up URL
        this.router.navigate(['/'], { replaceUrl: true });
      } else if (Object.keys(params).length > 0) {
        console.log('Query params present but no token/steamId found');
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  loginWithSteam(): void {
    console.log('Steam login button clicked');
    this.authService.loginWithSteam();
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => {
        console.log('Logged out successfully');
      },
      error: (error) => {
        console.error('Logout error:', error);
      }
    });
  }
}
