import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {
  private readonly ADMIN_STEAM_ID = '76561198041569692';

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean> {
    return this.authService.currentUser$.pipe(
      map(user => {
        if (!user) {
          this.router.navigate(['/']);
          return false;
        }
        
        // Use server-verified Steam ID from profile if available, otherwise fall back to localStorage Steam ID
        const steamId = user.profile?.steamId || user.steamId;
        
        if (steamId === this.ADMIN_STEAM_ID) {
          return true;
        } else {
          console.log('Admin access denied. User Steam ID:', steamId, 'Required:', this.ADMIN_STEAM_ID);
          this.router.navigate(['/']);
          return false;
        }
      })
    );
  }
}
