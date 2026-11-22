import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';

/** Shape of GET /health from appointment_node_API (NFR-7). */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  uptimeSeconds: number;
  timestamp: string;
}

export type ApiStatus = 'ok' | 'degraded' | 'unreachable';

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  /** API status: `ok`, `degraded` (API up, DB down -> 503) or `unreachable`. */
  status(): Observable<ApiStatus> {
    return this.http.get<HealthResponse>('/health').pipe(
      map((res) => res.status),
      catchError((err: { status?: number; error?: Partial<HealthResponse> }) =>
        of<ApiStatus>(
          err.status === 503 && err.error?.status === 'degraded' ? 'degraded' : 'unreachable',
        ),
      ),
    );
  }
}
