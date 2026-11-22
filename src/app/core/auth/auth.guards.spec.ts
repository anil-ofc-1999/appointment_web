import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';

import { loginResponse, testUser } from '../../../testing/fake-jwt';
import { Role } from './auth.models';
import { authGuard, guestGuard, roleGuard, safeReturnUrl } from './auth.guards';
import { AuthService } from './auth.service';

function setup(role: Role | null) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  if (role) {
    TestBed.inject(AuthService).login({ email: 'a@example.com', password: 'x' }).subscribe();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/auth/login')
      .flush(loginResponse(undefined, { ...testUser, role }));
  }
}

function runGuard(guard: CanActivateFn, url = '/appointments') {
  const result = TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
  return result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : result;
}

afterEach(() => localStorage.clear());

describe('authGuard', () => {
  it('lets a logged-in user in', () => {
    setup('PATIENT');
    expect(runGuard(authGuard)).toBe(true);
  });

  it('sends a guest to /login and remembers where they wanted to go', () => {
    setup(null);
    expect(runGuard(authGuard, '/appointments?tab=past')).toBe(
      '/login?returnUrl=%2Fappointments%3Ftab%3Dpast',
    );
  });
});

describe('guestGuard', () => {
  it('lets a guest open login / register', () => {
    setup(null);
    expect(runGuard(guestGuard)).toBe(true);
  });

  it('sends a logged-in user to the home page', () => {
    setup('PATIENT');
    expect(runGuard(guestGuard)).toBe('/');
  });
});

describe('roleGuard', () => {
  it('lets an allowed role in', () => {
    setup('ADMIN');
    expect(runGuard(roleGuard('ADMIN'))).toBe(true);
  });

  it('accepts any of several roles', () => {
    setup('DOCTOR');
    expect(runGuard(roleGuard('ADMIN', 'DOCTOR'))).toBe(true);
  });

  it('sends a wrong role home', () => {
    setup('PATIENT');
    expect(runGuard(roleGuard('ADMIN'))).toBe('/');
  });

  it('sends a guest home', () => {
    setup(null);
    expect(runGuard(roleGuard('PATIENT'))).toBe('/');
  });
});

describe('safeReturnUrl (no open redirects)', () => {
  it.each([
    ['/appointments', '/appointments'],
    ['/doctors/3?date=2030-01-08', '/doctors/3?date=2030-01-08'],
  ])('keeps the in-app path %s', (input, expected) => {
    expect(safeReturnUrl(input)).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['missing', undefined],
    ['null', null],
    ['an external URL', 'https://evil.example.com'],
    ['a protocol-relative URL', '//evil.example.com'],
    ['a backslash trick', '/\\evil.example.com'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['the login page (loop)', '/login?returnUrl=/x'],
    ['the register page', '/register'],
  ])('falls back to / for %s', (_label, input) => {
    expect(safeReturnUrl(input)).toBe('/');
  });
});
