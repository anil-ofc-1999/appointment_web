import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { AuthService } from './auth.service';

/** Login and register never need a token, and a 401 there is a normal answer. */
const isAuthCall = (url: string) => url.startsWith('/api/v1/auth/');

/**
 * Adds `Authorization: Bearer <token>` to API calls (FR-1.7).
 * When the API says the token is no longer valid (401), logs out and sends the
 * user to the login page, coming back to the same page afterwards.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!req.url.startsWith('/api/') || isAuthCall(req.url)) return next(req);

  const token = auth.token();
  const request = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(request).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        const code = (err.error as { error?: { code?: string } } | null)?.error?.code;
        auth.logout();
        void router.navigate(['/login'], {
          queryParams: {
            returnUrl: router.url,
            reason: code === 'TOKEN_EXPIRED' ? 'expired' : 'login-required',
          },
        });
      }
      return throwError(() => err);
    }),
  );
};
