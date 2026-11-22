import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { testUser } from '../../../testing/fake-jwt';
import { AuthService } from '../../core/auth/auth.service';
import { ApiStatus, HealthService } from '../../core/health.service';
import { Home } from './home';

async function render(status: ApiStatus, user = testUser as typeof testUser | null) {
  TestBed.configureTestingModule({
    imports: [Home],
    providers: [
      provideRouter([]),
      { provide: HealthService, useValue: { status: () => of(status) } },
      { provide: AuthService, useValue: { user: () => user } },
    ],
  });
  const fixture = TestBed.createComponent(Home);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('Home', () => {
  it('shows "online" when the API is up', async () => {
    const el = await render('ok');
    expect(el.querySelector('[role="status"]')?.textContent).toContain('online');
  });

  it('degraded (database down): asks to try again later, no technical words', async () => {
    const el = await render('degraded');
    const text = el.querySelector('[role="status"]')?.textContent ?? '';
    expect(text).toContain('try again in a few minutes');
    expect(text).not.toContain('database');
  });

  it('unreachable (free server waking up): says it is starting up, no developer hints', async () => {
    const el = await render('unreachable');
    const text = el.querySelector('[role="status"]')?.textContent ?? '';
    expect(text).toContain('starting up');
    expect(text).not.toContain('npm');
  });

  it('shows the 3 "how it works" steps and the illustration', async () => {
    const el = await render('ok', null);
    const steps = [...el.querySelectorAll('.features h2')].map((h) => h.textContent?.trim());
    expect(steps).toEqual(['Find a doctor', 'Pick a free slot', 'Booked']);
    expect(el.querySelector('img.hero-art')?.getAttribute('src')).toBe('hero.svg');
  });

  it('welcomes a logged-in user by name', async () => {
    const el = await render('ok');
    expect(el.querySelector('[data-testid="welcome"]')?.textContent).toContain('Asha Reddy');
    expect(el.querySelector('a[href="/doctors"]')?.textContent).toContain('Find a doctor');
  });

  it('invites a guest to log in or register', async () => {
    const el = await render('ok', null);
    expect(el.querySelector('[data-testid="welcome"]')).toBeNull();
    expect(el.querySelector('a[href="/register"]')?.textContent).toContain('Create an account');
    expect(el.querySelector('a[href="/login"]')?.textContent).toContain('Log in');
  });
});
