import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface User {
  steamId: string; // Steam ID from localStorage (for backward compatibility)
  sessionToken: string;
  lastLogin?: string;
  profile?: {
    steamId?: string; // Server-verified Steam ID from profile endpoint
    name: string;
    avatar: string;
    loccountrycode?: string;
    locstatecode?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();
  
  private authLoadingSubject = new BehaviorSubject<boolean>(true);
  public authLoading$ = this.authLoadingSubject.asObservable();

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    // Check for existing session on service initialization
    this.checkExistingSession();
  }

  private checkExistingSession(): void {
    // Only access localStorage in browser environment
    if (isPlatformBrowser(this.platformId)) {
      const sessionToken = localStorage.getItem('sessionToken');
      const steamId = localStorage.getItem('steamId');
      
      if (sessionToken && steamId) {
        // Extract numeric Steam ID from OpenID URL if needed
        const numericSteamId = this.extractSteamIdFromOpenId(steamId);
        
        const user: User = {
          steamId: numericSteamId,
          sessionToken
        };
        this.currentUserSubject.next(user);
        
        // Fetch user profile for existing session
        this.fetchUserProfile(sessionToken).subscribe({
          next: (profile) => {
            const updatedUser: User = {
              ...user,
              profile: profile
            };
            this.currentUserSubject.next(updatedUser);
            console.log('Existing user profile loaded:', profile);
            this.authLoadingSubject.next(false); // Profile loaded, stop loading
          },
          error: (error) => {
            console.error('Failed to load existing user profile:', error);
            // If profile fails with 401, session is invalid - log user out
            if (error.status === 401) {
              console.log('Session expired, logging user out');
              this.clearSession();
            }
            // For other errors, keep them logged in but without profile data
            this.authLoadingSubject.next(false); // Profile failed, stop loading
          }
        });
      } else {
        // No existing session, stop loading immediately
        this.authLoadingSubject.next(false);
      }
    } else {
      // Not in browser, stop loading
      this.authLoadingSubject.next(false);
    }
  }

  private extractSteamIdFromOpenId(steamId: string): string {
    // If it's already a numeric Steam ID, return as is
    if (/^\d+$/.test(steamId)) {
      return steamId;
    }
    
    // Extract from OpenID URL format: https://steamcommunity.com/openid/id/76561198041569692
    const match = steamId.match(/\/id\/(\d+)$/);
    if (match && match[1]) {
      return match[1];
    }
    
    // If no match found, return the original value
    console.warn('Could not extract Steam ID from:', steamId);
    return steamId;
  }

  loginWithSteam(): void {
    // Only redirect in browser environment
    if (isPlatformBrowser(this.platformId)) {
      const loginUrl = `${environment.apiUrl}/auth/steam`;
      console.log('Steam login - redirecting to:', loginUrl);
      window.location.href = loginUrl;
    } else {
      console.error('Steam login attempted in non-browser environment');
    }
  }

  handleLoginCallback(token: string, steamId: string): void {
    console.log('Steam login callback received:', { token: token?.substring(0, 10) + '...', steamId });
    
    // Extract numeric Steam ID from OpenID URL if needed
    const numericSteamId = this.extractSteamIdFromOpenId(steamId);
    console.log('Extracted Steam ID:', numericSteamId);
    
    // Store session information only in browser environment
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('sessionToken', token);
      localStorage.setItem('steamId', numericSteamId);
      console.log('Session stored in localStorage');
    }
    
    const user: User = {
      steamId: numericSteamId,
      sessionToken: token
    };
    
    this.currentUserSubject.next(user);
    
    // Fetch user profile after login
    this.authLoadingSubject.next(true); // Start loading for profile fetch
    this.fetchUserProfile(token).subscribe({
      next: (profile) => {
        const updatedUser: User = {
          ...user,
          profile: profile
        };
        this.currentUserSubject.next(updatedUser);
        console.log('User profile loaded:', profile);
        this.authLoadingSubject.next(false); // Profile loaded, stop loading
      },
      error: (error) => {
        console.error('Failed to load user profile:', error);
        // If profile fails with 401, session is invalid - log user out
        if (error.status === 401) {
          console.log('Session invalid after login, logging user out');
          this.clearSession();
        }
        // For other errors, keep them logged in but without profile data
        this.authLoadingSubject.next(false); // Profile failed, stop loading
      }
    });
    
    console.log('User logged in successfully');
  }

  private fetchUserProfile(sessionToken: string): Observable<any> {
    return this.http.get(`${environment.apiUrl}/profile`, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });
  }

  logout(): Observable<any> {
    let sessionToken = '';
    
    // Get session token only in browser environment
    if (isPlatformBrowser(this.platformId)) {
      sessionToken = localStorage.getItem('sessionToken') || '';
    }
    
    return new Observable(observer => {
      if (sessionToken) {
        this.http.post(`${environment.apiUrl}/auth/logout`, { sessionToken })
          .subscribe({
            next: (response) => {
              this.clearSession();
              observer.next(response);
              observer.complete();
            },
            error: (error) => {
              // Clear session even if API call fails
              this.clearSession();
              observer.error(error);
            }
          });
      } else {
        this.clearSession();
        observer.next({ message: 'No active session' });
        observer.complete();
      }
    });
  }

  private clearSession(): void {
    // Clear localStorage only in browser environment
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('steamId');
    }
    this.currentUserSubject.next(null);
    this.authLoadingSubject.next(false); // Clear loading state when session is cleared
  }

  isLoggedIn(): boolean {
    return this.currentUserSubject.value !== null;
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  isAdmin(): boolean {
    const currentUser = this.getCurrentUser();
    if (!currentUser) {
      return false;
    }
    
    // Use server-verified Steam ID from profile if available, otherwise fall back to localStorage Steam ID
    const steamId = currentUser.profile?.steamId || currentUser.steamId;
    return steamId === '76561198041569692';
  }

  refreshUserProfile(): Observable<any> {
    const currentUser = this.getCurrentUser();
    if (!currentUser) {
      return new Observable(observer => {
        observer.error({ message: 'No user logged in' });
      });
    }

    return this.fetchUserProfile(currentUser.sessionToken).pipe(
      tap((profile: any) => {
        const updatedUser: User = {
          ...currentUser,
          profile: profile
        };
        this.currentUserSubject.next(updatedUser);
        console.log('User profile refreshed:', profile);
      }),
      catchError((error: any) => {
        console.error('Failed to refresh user profile:', error);
        if (error.status === 401) {
          console.log('Session expired during refresh, logging user out');
          this.clearSession();
        }
        throw error;
      })
    );
  }

  getAuthHeaders(): { [header: string]: string } {
    const currentUser = this.getCurrentUser();
    if (!currentUser || !currentUser.sessionToken) {
      return {};
    }

    return {
      'Authorization': `Bearer ${currentUser.sessionToken}`,
      'Content-Type': 'application/json'
    };
  }
}
