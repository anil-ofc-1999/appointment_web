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
  it('shows connected when the API is up', async () => {
    const el = await render('ok');
    expect(el.querySelector('[role="status"]')?.textContent).toContain('connected');
  });

  it('warns when the database is down', async () => {
    const el = await render('degraded');
    expect(el.querySelector('[role="status"]')?.textContent).toContain('database is down');
  });

  it('tells the user how to start the API when it is unreachable', async () => {
    const el = await render('unreachable');
    expect(el.querySelector('[role="status"]')?.textContent).toContain('npm run dev');
  });

  it('welcomes a logged-in user by name', async () => {
    const el = await render('ok');
    expect(el.querySelector('[data-testid="welcome"]')?.textContent).toContain('Asha Reddy');
  });

  it('invites a guest to log in or register', async () => {
    const el = await render('ok', null);
    expect(el.querySelector('[data-testid="welcome"]')).toBeNull();
    expect(el.querySelector('a[href="/register"]')).not.toBeNull();
  });
});
