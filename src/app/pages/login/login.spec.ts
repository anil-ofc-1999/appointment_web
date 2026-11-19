import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { apiError, loginResponse, testUser } from '../../../testing/fake-jwt';
import { AuthService } from '../../core/auth/auth.service';
import { Login } from './login';

interface Page {
  fixture: ComponentFixture<Login>;
  http: HttpTestingController;
  navigateByUrl: ReturnType<typeof vi.spyOn>;
  el: HTMLElement;
  type(id: string, value: string): void;
  submit(): Promise<void>;
  text(selector: string): string | undefined;
  submitButton(): HTMLButtonElement;
}

async function render(inputs: Record<string, string> = {}): Promise<Page> {
  localStorage.clear();
  TestBed.configureTestingModule({
    imports: [Login],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(Login);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  const navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;

  return {
    fixture,
    el,
    http: TestBed.inject(HttpTestingController),
    navigateByUrl,
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
    text: (selector) => el.querySelector(selector)?.textContent?.trim(),
    submitButton: () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!,
  };
}

async function fillAndSubmit(page: Page, email = testUser.email, password = 'Password123') {
  page.type('login-email', email);
  page.type('login-password', password);
  await page.submit();
}

async function failWith(page: Page, status: number, body: object) {
  page.http.expectOne('/api/v1/auth/login').flush(body, { status, statusText: 'Error' });
  await page.fixture.whenStable();
}

afterEach(() => localStorage.clear());

describe('Login page — rendering & accessibility', () => {
  it('has labelled email and password inputs (NFR-9)', async () => {
    const page = await render();

    expect(page.el.querySelector('label[for="login-email"]')?.textContent).toContain('Email');
    expect(page.el.querySelector('label[for="login-password"]')?.textContent).toContain('Password');
    expect(page.el.querySelector('#login-password')?.getAttribute('type')).toBe('password');
  });

  it('links to the register page', async () => {
    const page = await render();

    expect(page.el.querySelector('a[href="/register"]')).not.toBeNull();
  });

  it('can show and hide the password', async () => {
    const page = await render();
    const toggle = page.el.querySelector<HTMLButtonElement>('.btn-link')!;

    toggle.click();
    await page.fixture.whenStable();
    expect(page.el.querySelector('#login-password')?.getAttribute('type')).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    await page.fixture.whenStable();
    expect(page.el.querySelector('#login-password')?.getAttribute('type')).toBe('password');
  });
});

describe('Login page — positive scenarios', () => {
  it('logs in and goes to the home page', async () => {
    const page = await render();
    await fillAndSubmit(page);

    const req = page.http.expectOne('/api/v1/auth/login');
    expect(req.request.body).toEqual({ email: testUser.email, password: 'Password123' });
    req.flush(loginResponse());
    await page.fixture.whenStable();

    expect(TestBed.inject(AuthService).user()?.name).toBe('Asha Reddy');
    expect(page.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('trims spaces around the email but not the password', async () => {
    const page = await render();
    await fillAndSubmit(page, '  asha.reddy@example.com  ', ' Password123 ');

    expect(page.http.expectOne('/api/v1/auth/login').request.body).toEqual({
      email: 'asha.reddy@example.com',
      password: ' Password123 ',
    });
  });

  it('goes back to the page the user wanted (returnUrl)', async () => {
    const page = await render({ returnUrl: '/appointments' });
    await fillAndSubmit(page);
    page.http.expectOne('/api/v1/auth/login').flush(loginResponse());
    await page.fixture.whenStable();

    expect(page.navigateByUrl).toHaveBeenCalledWith('/appointments');
  });

  it('ignores an external returnUrl (open redirect protection)', async () => {
    const page = await render({ returnUrl: 'https://evil.example.com' });
    await fillAndSubmit(page);
    page.http.expectOne('/api/v1/auth/login').flush(loginResponse());
    await page.fixture.whenStable();

    expect(page.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('after registering: shows a success message and pre-fills the email', async () => {
    const page = await render({ registered: '1', email: 'new.patient@example.com' });

    expect(page.text('[data-testid="registered-message"]')).toContain('Account created');
    expect(page.el.querySelector<HTMLInputElement>('#login-email')?.value).toBe(
      'new.patient@example.com',
    );
  });

  it.each([
    ['expired', 'session has expired'],
    ['login-required', 'Please log in to continue'],
  ])('explains why the user was sent here (reason=%s)', async (reason, text) => {
    const page = await render({ reason });

    expect(page.text('[data-testid="reason-message"]')).toContain(text);
  });

  it('disables the button and shows progress while logging in', async () => {
    const page = await render();
    await fillAndSubmit(page);

    expect(page.submitButton().disabled).toBe(true);
    expect(page.submitButton().textContent).toContain('Logging in');

    page.http.expectOne('/api/v1/auth/login').flush(loginResponse());
    await page.fixture.whenStable();
    expect(page.submitButton().disabled).toBe(false);
  });
});

describe('Login page — negative scenarios', () => {
  it('shows "required" for empty fields and does not call the API', async () => {
    const page = await render();
    await page.submit();

    expect(page.text('#login-email-error')).toBe('This field is required.');
    expect(page.text('#login-password-error')).toBe('This field is required.');
    expect(page.el.querySelector('#login-email')?.getAttribute('aria-invalid')).toBe('true');
    page.http.expectNone('/api/v1/auth/login');
  });

  it('treats an email of only spaces as empty', async () => {
    const page = await render();
    await fillAndSubmit(page, '    ', 'Password123');

    expect(page.text('#login-email-error')).toBe('This field is required.');
    page.http.expectNone('/api/v1/auth/login');
  });

  it('rejects an invalid email format before calling the API', async () => {
    const page = await render();
    await fillAndSubmit(page, 'asha@', 'Password123');

    expect(page.text('#login-email-error')).toBe('Enter a valid email address.');
    page.http.expectNone('/api/v1/auth/login');
  });

  it('does not show errors before the user touches a field', async () => {
    const page = await render();

    expect(page.el.querySelector('.field-error')).toBeNull();
  });

  it('wrong email or password: shows a generic error and stays on the page', async () => {
    const page = await render();
    await fillAndSubmit(page, testUser.email, 'WrongPass99');
    await failWith(page, 401, apiError('INVALID_CREDENTIALS', 'Email or password is incorrect.'));

    expect(page.text('[data-testid="form-error"]')).toBe('Email or password is incorrect.');
    expect(page.el.querySelector('[data-testid="form-error"]')?.getAttribute('role')).toBe('alert');
    expect(page.navigateByUrl).not.toHaveBeenCalled();
    expect(TestBed.inject(AuthService).isLoggedIn()).toBe(false);
  });

  it('disabled account: shows a clear message', async () => {
    const page = await render();
    await fillAndSubmit(page);
    await failWith(page, 403, apiError('ACCOUNT_DISABLED', 'This account is disabled.'));

    expect(page.text('[data-testid="form-error"]')).toContain('This account is disabled');
  });

  it('too many attempts (429): asks the user to wait', async () => {
    const page = await render();
    await fillAndSubmit(page);
    await failWith(page, 429, apiError('TOO_MANY_REQUESTS', 'Too many login attempts.'));

    expect(page.text('[data-testid="form-error"]')).toContain('wait a minute');
  });

  it('server down: shows a connection message', async () => {
    const page = await render();
    await fillAndSubmit(page);
    page.http.expectOne('/api/v1/auth/login').error(new ProgressEvent('error'));
    await page.fixture.whenStable();

    expect(page.text('[data-testid="form-error"]')).toContain('Cannot reach the server');
    expect(page.submitButton().disabled).toBe(false);
  });

  it('server validation error: shows it under the field', async () => {
    const page = await render();
    await fillAndSubmit(page);
    await failWith(
      page,
      400,
      apiError('VALIDATION_ERROR', 'Some fields are invalid.', [
        { field: 'email', message: 'Email is required.' },
      ]),
    );

    expect(page.text('#login-email-error')).toBe('Email is required.');
  });

  it('clears the previous error when submitting again', async () => {
    const page = await render();
    await fillAndSubmit(page, testUser.email, 'WrongPass99');
    await failWith(page, 401, apiError('INVALID_CREDENTIALS', 'x'));

    await fillAndSubmit(page);
    expect(page.el.querySelector('[data-testid="form-error"]')).toBeNull();
    page.http.expectOne('/api/v1/auth/login').flush(loginResponse());
  });

  it('a double click sends only one request', async () => {
    const page = await render();
    page.type('login-email', testUser.email);
    page.type('login-password', 'Password123');

    await page.submit();
    await page.submit();

    expect(page.http.match('/api/v1/auth/login')).toHaveLength(1);
  });
});
