import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Role } from './auth.models';
import { AuthService } from './auth.service';

/** Pages that need a logged-in user. Sends guests to /login and back afterwards. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.token()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Pages only for guests (login, register). Logged-in users go to the home page. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.token() ? inject(Router).createUrlTree(['/']) : true;
};

/** Pages for some roles only (FR-1.7). Use after authGuard. */
export const roleGuard =
  (...roles: Role[]): CanActivateFn =>
  () => {
    const role = inject(AuthService).user()?.role;
    return role && roles.includes(role) ? true : inject(Router).createUrlTree(['/']);
  };

/**
 * Only allow same-app paths as the "return to" page, so a crafted link like
 * /login?returnUrl=https://evil.example cannot redirect users off the site.
 */
export function safeReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  if (value.startsWith('/login') || value.startsWith('/register')) return '/';
  return value;
}
