import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

import {
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  Session,
  User,
} from './auth.models';

export const SESSION_STORAGE_KEY = 'appointment.session';

/** Reads the `exp` claim (seconds) from a JWT. Returns null if the token is malformed. */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly session = signal<Session | null>(this.restore());

  readonly user = computed<User | null>(() => this.session()?.user ?? null);
  readonly isLoggedIn = computed(() => this.session() !== null);

  /** FR-1.1: creates a PATIENT account. Does not log in. */
  register(request: RegisterRequest): Observable<User> {
    return this.http
      .post<{ user: User }>('/api/v1/auth/register', request)
      .pipe(map((res) => res.user));
  }

  /** FR-1.5: logs in and keeps the token until it expires (FR-1.6). */
  login(request: LoginRequest): Observable<User> {
    return this.http.post<LoginResponse>('/api/v1/auth/login', request).pipe(
      tap((res) => this.saveLogin(res)),
      map((res) => res.user),
    );
  }

  /**
   * D-32: changes the logged-in user's password. The API signs out every older session
   * and returns a fresh token, which replaces the current one so this tab stays logged in.
   */
  changePassword(request: ChangePasswordRequest): Observable<User> {
    return this.http.post<LoginResponse>('/api/v1/auth/change-password', request).pipe(
      tap((res) => this.saveLogin(res)),
      map((res) => res.user),
    );
  }

  private saveLogin(res: LoginResponse): void {
    const expiresAt = tokenExpiry(res.accessToken);
    if (expiresAt === null) throw new Error('Login returned an invalid token.');
    this.save({ accessToken: res.accessToken, expiresAt, user: res.user });
  }

  logout(): void {
    this.save(null);
  }

  /** Current token, or null when logged out or expired (expired sessions are cleared). */
  token(): string | null {
    const current = this.session();
    if (!current) return null;
    if (current.expiresAt <= Date.now()) {
      this.logout();
      return null;
    }
    return current.accessToken;
  }

  private save(session: Session | null): void {
    this.session.set(session);
    try {
      if (session) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Storage can be blocked (private mode). The session still works for this tab.
    }
  }

  private restore(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw) as Partial<Session>;
      const valid =
        typeof session.accessToken === 'string' &&
        typeof session.expiresAt === 'number' &&
        session.expiresAt > Date.now() &&
        typeof session.user?.id === 'number';
      if (valid) return session as Session;
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Corrupt or blocked storage -> start logged out.
    }
    return null;
  }
}
