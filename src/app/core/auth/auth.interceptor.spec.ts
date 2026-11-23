import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { apiError, fakeJwt, loginResponse } from '../../../testing/fake-jwt';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

function setup({ loggedIn }: { loggedIn: boolean }) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  const http = TestBed.inject(HttpClient);
  const backend = TestBed.inject(HttpTestingController);
  const auth = TestBed.inject(AuthService);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

  if (loggedIn) {
    auth.login({ email: 'a@example.com', password: 'Password123' }).subscribe();
    backend.expectOne('/api/v1/auth/login').flush(loginResponse(fakeJwt(3600)));
  }
  return { http, backend, auth, navigate };
}

afterEach(() => localStorage.clear());

describe('authInterceptor (FR-1.7)', () => {
  it('adds the Bearer token to API calls when logged in', () => {
    const { http, backend, auth } = setup({ loggedIn: true });

    http.get('/api/v1/me').subscribe();

    const req = backend.expectOne('/api/v1/me');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${auth.token()}`);
  });

  it('sends no token when logged out', () => {
    const { http, backend } = setup({ loggedIn: false });

    http.get('/api/v1/specializations').subscribe();

    expect(backend.expectOne('/api/v1/specializations').request.headers.has('Authorization')).toBe(
      false,
    );
  });

  it('never sends the token to login / register', () => {
    const { http, backend } = setup({ loggedIn: true });

    http.post('/api/v1/auth/register', {}).subscribe();

    expect(backend.expectOne('/api/v1/auth/register').request.headers.has('Authorization')).toBe(
      false,
    );
  });

  it('DOES send the token to change-password (it needs the logged-in user)', () => {
    const { http, backend } = setup({ loggedIn: true });

    http.post('/api/v1/auth/change-password', {}).subscribe();

    expect(
      backend.expectOne('/api/v1/auth/change-password').request.headers.get('Authorization'),
    ).toMatch(/^Bearer /);
  });

  it('a 401 from change-password (session revoked) logs out and goes to login', () => {
    const { http, backend, auth, navigate } = setup({ loggedIn: true });

    http.post('/api/v1/auth/change-password', {}).subscribe({ error: () => undefined });
    backend
      .expectOne('/api/v1/auth/change-password')
      .flush(apiError('TOKEN_EXPIRED', 'changed'), { status: 401, statusText: 'Unauthorized' });

    expect(auth.isLoggedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: expect.objectContaining({ reason: 'expired' }),
    });
  });

  it.each(['/health', 'https://other.example.com/api/v1/me'])(
    'never sends the token outside our API (%s)',
    (url) => {
      const { http, backend } = setup({ loggedIn: true });

      http.get(url).subscribe();

      expect(backend.expectOne(url).request.headers.has('Authorization')).toBe(false);
    },
  );

  it('does not send an expired token', () => {
    vi.useFakeTimers();
    try {
      const { http, backend } = setup({ loggedIn: true });
      vi.advanceTimersByTime(3601_000);

      http.get('/api/v1/me').subscribe();

      expect(backend.expectOne('/api/v1/me').request.headers.has('Authorization')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('on 401 TOKEN_EXPIRED: logs out and goes to login with reason=expired', () => {
    const { http, backend, auth, navigate } = setup({ loggedIn: true });
    let status = 0;

    http.get('/api/v1/me').subscribe({ error: (e: { status: number }) => (status = e.status) });
    backend
      .expectOne('/api/v1/me')
      .flush(apiError('TOKEN_EXPIRED', 'expired'), { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401); // the caller still sees the error
    expect(auth.isLoggedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/', reason: 'expired' },
    });
  });

  it('on any other 401: logs out with reason=login-required', () => {
    const { http, backend, navigate } = setup({ loggedIn: true });

    http.get('/api/v1/me').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/me').flush(apiError('UNAUTHORIZED', 'Login required.'), {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/', reason: 'login-required' },
    });
  });

  it.each([403, 409, 500])('keeps the user logged in on %i', (status) => {
    const { http, backend, auth, navigate } = setup({ loggedIn: true });

    http.get('/api/v1/doctors').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/doctors').flush(apiError('X', 'x'), { status, statusText: 'x' });

    expect(auth.isLoggedIn()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not redirect on a 401 from login itself (wrong password)', () => {
    const { http, backend, navigate } = setup({ loggedIn: false });

    http.post('/api/v1/auth/login', {}).subscribe({ error: () => undefined });
    backend
      .expectOne('/api/v1/auth/login')
      .flush(apiError('INVALID_CREDENTIALS', 'x'), { status: 401, statusText: 'Unauthorized' });

    expect(navigate).not.toHaveBeenCalled();
  });
});
