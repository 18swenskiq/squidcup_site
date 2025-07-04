import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface User {
  steamId: string;
  sessionToken: string;
  lastLogin?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

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
        this.currentUserSubject.next({
          steamId,
          sessionToken
        });
      }
    }
  }

  loginWithSteam(): void {
    // Only redirect in browser environment
    if (isPlatformBrowser(this.platformId)) {
      window.location.href = `${environment.apiUrl}/auth/steam`;
    }
  }

  handleLoginCallback(token: string, steamId: string): void {
    // Store session information only in browser environment
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('sessionToken', token);
      localStorage.setItem('steamId', steamId);
    }
    
    this.currentUserSubject.next({
      steamId,
      sessionToken: token
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
  }

  isLoggedIn(): boolean {
    return this.currentUserSubject.value !== null;
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }
}
