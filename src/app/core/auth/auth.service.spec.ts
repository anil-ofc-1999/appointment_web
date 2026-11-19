import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { apiError, fakeJwt, loginResponse, testUser } from '../../../testing/fake-jwt';
import { Session } from './auth.models';
import { AuthService, SESSION_STORAGE_KEY, tokenExpiry } from './auth.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { auth: TestBed.inject(AuthService), http: TestBed.inject(HttpTestingController) };
}

const stored = () => localStorage.getItem(SESSION_STORAGE_KEY);

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('tokenExpiry', () => {
  it('reads exp (seconds) and returns milliseconds', () => {
    const token = fakeJwt(60);
    const exp = tokenExpiry(token);

    expect(exp).not.toBeNull();
    expect(Math.abs((exp as number) - (Date.now() + 60_000))).toBeLessThan(2000);
  });

  it.each([
    ['not a JWT', 'abc'],
    ['bad base64', 'a.!!!.c'],
    ['no exp claim', `x.${btoa(JSON.stringify({ sub: '1' }))}.y`],
    ['exp as text', `x.${btoa(JSON.stringify({ exp: 'soon' }))}.y`],
  ])('returns null for %s', (_label, token) => {
    expect(tokenExpiry(token)).toBeNull();
  });
});

describe('AuthService.login (FR-1.5)', () => {
  it('posts the credentials and stores the session', () => {
    const { auth, http } = setup();
    let user;
    auth.login({ email: 'asha.reddy@example.com', password: 'Password123' }).subscribe((u) => {
      user = u;
    });

    const req = http.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'asha.reddy@example.com', password: 'Password123' });
    req.flush(loginResponse());

    expect(user).toEqual(testUser);
    expect(auth.isLoggedIn()).toBe(true);
    expect(auth.user()).toEqual(testUser);
    expect(auth.token()).toMatch(/^ey/);
    expect(JSON.parse(stored() as string).user.email).toBe(testUser.email);
    http.verify();
  });

  it('never stores the password', () => {
    const { auth, http } = setup();
    auth.login({ email: testUser.email, password: 'Password123' }).subscribe();
    http.expectOne('/api/v1/auth/login').flush(loginResponse());

    expect(stored()).not.toContain('Password123');
  });

  it('stays logged out when the API rejects the login', () => {
    const { auth, http } = setup();
    let failed = false;
    auth.login({ email: testUser.email, password: 'wrong' }).subscribe({
      error: () => (failed = true),
    });

    http
      .expectOne('/api/v1/auth/login')
      .flush(apiError('INVALID_CREDENTIALS', 'Email or password is incorrect.'), {
        status: 401,
        statusText: 'Unauthorized',
      });

    expect(failed).toBe(true);
    expect(auth.isLoggedIn()).toBe(false);
    expect(stored()).toBeNull();
  });

  it('fails and stays logged out when the token has no expiry', () => {
    const { auth, http } = setup();
    let error: Error | undefined;
    auth.login({ email: testUser.email, password: 'Password123' }).subscribe({
      error: (e: Error) => (error = e),
    });

    http.expectOne('/api/v1/auth/login').flush(loginResponse('not-a-jwt'));

    expect(error?.message).toContain('invalid token');
    expect(auth.isLoggedIn()).toBe(false);
  });
});

describe('AuthService.register (FR-1.1)', () => {
  it('posts the form and does NOT log in', () => {
    const { auth, http } = setup();
    let user;
    auth
      .register({ name: 'Asha Reddy', email: testUser.email, password: 'Password123' })
      .subscribe((u) => (user = u));

    const req = http.expectOne('/api/v1/auth/register');
    expect(req.request.method).toBe('POST');
    req.flush({ user: testUser }, { status: 201, statusText: 'Created' });

    expect(user).toEqual(testUser);
    expect(auth.isLoggedIn()).toBe(false);
    http.verify();
  });

  it('passes the API error to the caller (409 EMAIL_TAKEN)', () => {
    const { auth, http } = setup();
    let status = 0;
    auth
      .register({ name: 'Asha', email: testUser.email, password: 'Password123' })
      .subscribe({ error: (e: { status: number }) => (status = e.status) });

    http
      .expectOne('/api/v1/auth/register')
      .flush(apiError('EMAIL_TAKEN', 'exists'), { status: 409, statusText: 'Conflict' });

    expect(status).toBe(409);
  });
});

describe('AuthService session handling (FR-1.6)', () => {
  const session = (secondsFromNow: number): Session => ({
    accessToken: fakeJwt(secondsFromNow),
    expiresAt: Date.now() + secondsFromNow * 1000,
    user: testUser,
  });

  it('restores a valid session after a page reload', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session(600)));

    const { auth } = setup();

    expect(auth.isLoggedIn()).toBe(true);
    expect(auth.user()?.name).toBe('Asha Reddy');
  });

  it('drops an expired session on reload', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session(-5)));

    const { auth } = setup();

    expect(auth.isLoggedIn()).toBe(false);
    expect(stored()).toBeNull();
  });

  it.each([
    ['broken JSON', '{not json'],
    ['missing token', JSON.stringify({ expiresAt: Date.now() + 1000, user: testUser })],
    ['missing user', JSON.stringify({ accessToken: 'x', expiresAt: Date.now() + 1000 })],
  ])('ignores a corrupt stored session (%s)', (_label, raw) => {
    localStorage.setItem(SESSION_STORAGE_KEY, raw);

    const { auth } = setup();

    expect(auth.isLoggedIn()).toBe(false);
  });

  it('logs out by itself when the token expires while the app is open', () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session(60)));
      const { auth } = setup();
      expect(auth.token()).not.toBeNull();

      vi.advanceTimersByTime(61_000);

      expect(auth.token()).toBeNull();
      expect(auth.isLoggedIn()).toBe(false);
      expect(stored()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('logout clears memory and storage', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session(600)));
    const { auth } = setup();

    auth.logout();

    expect(auth.user()).toBeNull();
    expect(auth.token()).toBeNull();
    expect(stored()).toBeNull();
  });
});
