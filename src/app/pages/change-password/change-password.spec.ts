import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { apiError, fakeJwt, loginResponse } from '../../../testing/fake-jwt';
import { AuthService } from '../../core/auth/auth.service';
import { ChangePassword } from './change-password';

interface Page {
  fixture: ComponentFixture<ChangePassword>;
  http: HttpTestingController;
  el: HTMLElement;
  type(id: string, value: string): void;
  submit(): Promise<void>;
  error(id: string): string | undefined;
  text(selector: string): string | undefined;
}

async function render(): Promise<Page> {
  localStorage.clear();
  TestBed.configureTestingModule({
    imports: [ChangePassword],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(ChangePassword);
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
    text: (selector) => el.querySelector(selector)?.textContent?.trim(),
  };
}

const VALID = {
  'current-password': 'Password123',
  'new-password': 'BetterPass9',
  'confirm-password': 'BetterPass9',
};

async function fill(page: Page, overrides: Partial<Record<keyof typeof VALID, string>> = {}) {
  for (const [id, value] of Object.entries({ ...VALID, ...overrides })) page.type(id, value);
  await page.fixture.whenStable();
}

afterEach(() => localStorage.clear());

describe('Change password page — rendering & accessibility', () => {
  it('has a label and an eye button for each of the 3 password inputs', async () => {
    const page = await render();

    for (const id of ['current-password', 'new-password', 'confirm-password']) {
      expect(page.el.querySelector(`label[for="${id}"]`), id).not.toBeNull();
      expect(page.el.querySelector(`#${id}`)?.getAttribute('type'), id).toBe('password');
    }
    expect(
      [...page.el.querySelectorAll('.password-toggle')].map((t) => t.getAttribute('aria-controls')),
    ).toEqual(['current-password', 'new-password', 'confirm-password']);
  });

  it('uses the right autocomplete hints for password managers', async () => {
    const page = await render();

    expect(page.el.querySelector('#current-password')?.getAttribute('autocomplete')).toBe(
      'current-password',
    );
    expect(page.el.querySelector('#new-password')?.getAttribute('autocomplete')).toBe(
      'new-password',
    );
  });

  it('the eye button shows only its own field', async () => {
    const page = await render();
    page.el.querySelectorAll<HTMLButtonElement>('.password-toggle')[1].click();
    await page.fixture.whenStable();

    expect(page.el.querySelector('#new-password')?.getAttribute('type')).toBe('text');
    expect(page.el.querySelector('#current-password')?.getAttribute('type')).toBe('password');
  });
});

describe('Change password page — positive', () => {
  it('sends current + new password (not the confirmation) and shows success', async () => {
    const page = await render();
    await fill(page);
    await page.submit();

    const req = page.http.expectOne('/api/v1/auth/change-password');
    expect(req.request.body).toEqual({
      currentPassword: 'Password123',
      newPassword: 'BetterPass9',
    });
    req.flush(loginResponse(fakeJwt()));
    await page.fixture.whenStable();

    expect(page.text('[data-testid="password-changed"]')).toBe('Your password has been changed.');
    expect(TestBed.inject(AuthService).isLoggedIn()).toBe(true);
  });

  it('clears the form after success so the passwords are not left on screen', async () => {
    const page = await render();
    await fill(page);
    await page.submit();
    page.http.expectOne('/api/v1/auth/change-password').flush(loginResponse(fakeJwt()));
    await page.fixture.whenStable();

    for (const id of Object.keys(VALID)) {
      expect(page.el.querySelector<HTMLInputElement>(`#${id}`)?.value, id).toBe('');
    }
    expect(page.el.querySelector('.field-error')).toBeNull();
  });

  it('disables the button while saving', async () => {
    const page = await render();
    await fill(page);
    await page.submit();

    const button = page.el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Changing password');
    page.http.expectOne('/api/v1/auth/change-password').flush(loginResponse(fakeJwt()));
  });
});

describe('Change password page — negative (client-side)', () => {
  it('empty form: 3 required errors and no API call', async () => {
    const page = await render();
    await page.submit();

    for (const id of ['current-password', 'new-password', 'confirm-password']) {
      expect(page.error(id), id).toBe('This field is required.');
    }
    page.http.expectNone('/api/v1/auth/change-password');
  });

  it.each([
    ['abc1', 'Password must be at least 8 characters.'],
    ['OnlyLetters', 'Password must contain at least one number.'],
    ['12345678', 'Password must contain at least one letter.'],
  ])('weak new password %s -> %s', async (weak, message) => {
    const page = await render();
    await fill(page, { 'new-password': weak, 'confirm-password': weak });
    await page.submit();

    expect(page.error('new-password')).toBe(message);
    expect(page.el.querySelector('#new-password')?.getAttribute('aria-invalid')).toBe('true');
    page.http.expectNone('/api/v1/auth/change-password');
  });

  it('confirmation must match', async () => {
    const page = await render();
    await fill(page, { 'confirm-password': 'BetterPass8' });
    await page.submit();

    expect(page.error('confirm-password')).toBe('Passwords do not match.');
    page.http.expectNone('/api/v1/auth/change-password');
  });

  it('new password must differ from the current one', async () => {
    const page = await render();
    await fill(page, { 'new-password': 'Password123', 'confirm-password': 'Password123' });
    await page.submit();

    expect(page.error('new-password')).toBe(
      'The new password must be different from the current one.',
    );
    page.http.expectNone('/api/v1/auth/change-password');
  });
});

describe('Change password page — negative (API errors)', () => {
  async function submitValid(page: Page) {
    await fill(page);
    await page.submit();
    return page.http.expectOne('/api/v1/auth/change-password');
  }

  it('wrong current password: shown under that field and as an alert; no success', async () => {
    const page = await render();
    (await submitValid(page)).flush(
      apiError('WRONG_PASSWORD', 'x', [
        { field: 'currentPassword', message: 'Current password is incorrect.' },
      ]),
      { status: 400, statusText: 'Bad Request' },
    );
    await page.fixture.whenStable();

    expect(page.error('current-password')).toBe('Current password is incorrect.');
    expect(page.text('[data-testid="form-error"]')).toBe('Your current password is incorrect.');
    expect(page.el.querySelector('[data-testid="password-changed"]')).toBeNull();
  });

  it('too many attempts (429): asks the user to wait', async () => {
    const page = await render();
    (await submitValid(page)).flush(apiError('TOO_MANY_REQUESTS', 'x'), {
      status: 429,
      statusText: 'Too Many Requests',
    });
    await page.fixture.whenStable();

    expect(page.text('[data-testid="form-error"]')).toContain('wait a minute');
  });

  it('server down: connection message, button usable again', async () => {
    const page = await render();
    (await submitValid(page)).error(new ProgressEvent('error'));
    await page.fixture.whenStable();

    expect(page.text('[data-testid="form-error"]')).toContain('Cannot reach the server');
    expect(page.el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('a double submit sends only one request', async () => {
    const page = await render();
    await fill(page);
    await page.submit();
    await page.submit();

    expect(page.http.match('/api/v1/auth/change-password')).toHaveLength(1);
  });
});
