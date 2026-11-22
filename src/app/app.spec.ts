import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { loginResponse, testUser } from '../testing/fake-jwt';
import { App } from './app';
import { AuthService } from './core/auth/auth.service';

async function render(loggedIn: boolean) {
  localStorage.clear();
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  }).compileComponents();
  if (loggedIn) {
    TestBed.inject(AuthService).login({ email: 'a@example.com', password: 'x' }).subscribe();
    TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/login').flush(loginResponse());
  }
  const fixture = TestBed.createComponent(App);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

afterEach(() => localStorage.clear());

describe('App shell', () => {
  it('renders the brand link in the top bar', async () => {
    const { el } = await render(false);

    expect(el.querySelector('.brand')?.textContent).toContain('Doctor Appointments');
  });

  it('shows Log in and Register links to guests', async () => {
    const { el } = await render(false);

    expect(el.querySelector('a[href="/login"]')).not.toBeNull();
    expect(el.querySelector('a[href="/register"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="current-user"]')).toBeNull();
  });

  it('shows the user name and a Log out button when logged in', async () => {
    const { el } = await render(true);

    expect(el.querySelector('[data-testid="current-user"]')?.textContent).toContain('Asha Reddy');
    expect(el.querySelector('a[href="/login"]')).toBeNull();
  });

  it('shows "Find a doctor" only to logged-in users', async () => {
    const { el } = await render(true);
    expect(el.querySelector('nav a[href="/doctors"]')?.textContent).toContain('Find a doctor');
  });

  it('hides "Find a doctor" from guests', async () => {
    const { el } = await render(false);
    expect(el.querySelector('nav a[href="/doctors"]')).toBeNull();
  });

  it('Log out clears the session and goes to the login page', async () => {
    const { fixture, el } = await render(true);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    el.querySelector<HTMLButtonElement>('.nav-button')!.click();
    await fixture.whenStable();

    expect(TestBed.inject(AuthService).isLoggedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login']);
    expect(el.querySelector('a[href="/login"]')).not.toBeNull();
  });
});

describe('App shell — patient links', () => {
  it('shows "My appointments" to a logged-in patient', async () => {
    const { el } = await render(true);
    expect(el.querySelector('nav a[href="/appointments"]')?.textContent).toContain(
      'My appointments',
    );
  });
});

describe('App shell — doctor links', () => {
  it('a doctor sees "Dashboard" and not "My appointments"', async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    TestBed.inject(AuthService).login({ email: 'd@example.com', password: 'x' }).subscribe();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/auth/login')
      .flush(loginResponse(undefined, { ...testUser, role: 'DOCTOR' }));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('nav a[href="/dashboard"]')?.textContent).toContain('Dashboard');
    expect(el.querySelector('nav a[href="/appointments"]')).toBeNull();
  });
});
