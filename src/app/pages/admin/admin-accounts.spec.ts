import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { apiError, testUser } from '../../../testing/fake-jwt';
import { AdminAccounts } from './admin-accounts';
import { AdminPanel } from './admin-panel';

interface Page {
  fixture: ComponentFixture<AdminAccounts>;
  http: HttpTestingController;
  el: HTMLElement;
  type(id: string, value: string): void;
  submit(): Promise<void>;
  error(id: string): string | undefined;
  text(testId: string): string | undefined;
}

async function render(email = ''): Promise<Page> {
  TestBed.configureTestingModule({
    imports: [AdminAccounts],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(AdminAccounts);
  if (email) fixture.componentRef.setInput('email', email);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    el,
    http: TestBed.inject(HttpTestingController),
    type(id, value) {
      const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
    },
    async submit() {
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    },
    error: (id) => el.querySelector(`#${id}-error`)?.textContent?.trim(),
    text: (testId) => el.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim(),
  };
}

async function fill(page: Page, overrides: Record<string, string> = {}) {
  const values = {
    'reset-email': 'asha.reddy@example.com',
    'reset-password': 'TempPass2030',
    'reset-confirm': 'TempPass2030',
    ...overrides,
  };
  for (const [id, value] of Object.entries(values)) page.type(id, value);
  await page.fixture.whenStable();
}

afterEach(() => TestBed.inject(HttpTestingController).verify());

describe('Admin — accounts: reset password (D-35) — positive', () => {
  it('labels every input and has eye buttons on both password fields', async () => {
    const page = await render();

    for (const id of ['reset-email', 'reset-password', 'reset-confirm']) {
      expect(page.el.querySelector(`label[for="${id}"]`), id).not.toBeNull();
    }
    expect(
      [...page.el.querySelectorAll('.password-toggle')].map((t) => t.getAttribute('aria-controls')),
    ).toEqual(['reset-password', 'reset-confirm']);
  });

  it('the email is pre-filled when opened from a doctor card', async () => {
    const page = await render('meera@example.com');

    expect(page.el.querySelector<HTMLInputElement>('#reset-email')?.value).toBe(
      'meera@example.com',
    );
  });

  it('sends email + new password, shows who was reset and clears the form', async () => {
    const page = await render();
    await fill(page);
    await page.submit();

    const req = page.http.expectOne('/api/v1/users/reset-password');
    expect(req.request.body).toEqual({
      email: 'asha.reddy@example.com',
      newPassword: 'TempPass2030',
    });
    req.flush({ user: testUser });
    await page.fixture.whenStable();

    expect(page.text('reset-done')).toBe('New password set for Asha Reddy (patient).');
    expect(page.el.querySelector<HTMLInputElement>('#reset-password')?.value).toBe('');
    expect(page.el.querySelector<HTMLInputElement>('#reset-email')?.value).toBe('');
  });

  it('trims spaces around the email', async () => {
    const page = await render();
    await fill(page, { 'reset-email': '  asha.reddy@example.com ' });
    await page.submit();

    expect(page.http.expectOne('/api/v1/users/reset-password').request.body.email).toBe(
      'asha.reddy@example.com',
    );
  });
});

describe('Admin — accounts: reset password — negative', () => {
  it('empty form: 3 required errors, nothing sent', async () => {
    const page = await render();
    await page.submit();

    for (const id of ['reset-email', 'reset-password', 'reset-confirm']) {
      expect(page.error(id), id).toBe('This field is required.');
    }
    page.http.expectNone('/api/v1/users/reset-password');
  });

  it.each([
    [{ 'reset-email': 'not-an-email' }, 'reset-email', 'Enter a valid email address.'],
    [
      { 'reset-password': 'short1', 'reset-confirm': 'short1' },
      'reset-password',
      'Password must be at least 8 characters.',
    ],
    [{ 'reset-confirm': 'TempPass2031' }, 'reset-confirm', 'Passwords do not match.'],
  ])('%j -> %s: %s', async (overrides, id, message) => {
    const page = await render();
    await fill(page, overrides);
    await page.submit();

    expect(page.error(id)).toBe(message);
    page.http.expectNone('/api/v1/users/reset-password');
  });

  it('unknown email (404): clear message', async () => {
    const page = await render();
    await fill(page);
    await page.submit();
    page.http
      .expectOne('/api/v1/users/reset-password')
      .flush(apiError('USER_NOT_FOUND', 'x'), { status: 404, statusText: 'Not Found' });
    await page.fixture.whenStable();

    expect(page.text('form-error')).toBe('No account with this email.');
    expect(page.text('reset-done')).toBeUndefined();
  });

  it('an admin account (403): explains admins use Change password', async () => {
    const page = await render();
    await fill(page, { 'reset-email': 'admin@example.com' });
    await page.submit();
    page.http
      .expectOne('/api/v1/users/reset-password')
      .flush(apiError('FORBIDDEN', 'x'), { status: 403, statusText: 'Forbidden' });
    await page.fixture.whenStable();

    expect(page.text('form-error')).toContain('Admins use the Change password page');
  });

  it('a double submit sends one request', async () => {
    const page = await render();
    await fill(page);
    await page.submit();
    await page.submit();

    expect(page.http.match('/api/v1/users/reset-password')).toHaveLength(1);
    page.http.match('/api/v1/users/reset-password').forEach((r) => r.flush({ user: testUser }));
  });
});

describe('Admin panel — Accounts tab', () => {
  it('?tab=accounts&email= opens the tab with the email filled in', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'admin', component: AdminPanel }], withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin?tab=accounts&email=meera@example.com', AdminPanel);
    const el = harness.routeNativeElement as HTMLElement;

    expect(el.querySelector('#tab-accounts')?.getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector<HTMLInputElement>('#reset-email')?.value).toBe('meera@example.com');
    expect(TestBed.inject(Router).url).toContain('tab=accounts');
  });
});
