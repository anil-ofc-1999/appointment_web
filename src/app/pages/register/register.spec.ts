import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { apiError, testUser } from '../../../testing/fake-jwt';
import { AuthService } from '../../core/auth/auth.service';
import { Register } from './register';

interface Page {
  fixture: ComponentFixture<Register>;
  http: HttpTestingController;
  navigate: ReturnType<typeof vi.spyOn>;
  el: HTMLElement;
  type(id: string, value: string): void;
  submit(): Promise<void>;
  error(id: string): string | undefined;
}

async function render(): Promise<Page> {
  localStorage.clear();
  TestBed.configureTestingModule({
    imports: [Register],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(Register);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;

  return {
    fixture,
    el,
    http: TestBed.inject(HttpTestingController),
    navigate,
    type(id, value) {
      const input = el.querySelector<HTMLInputElement>(`#register-${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
    },
    async submit() {
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    },
    error: (id) => el.querySelector(`#register-${id}-error`)?.textContent?.trim(),
  };
}

const VALID = {
  name: 'Asha Reddy',
  email: 'asha.reddy@example.com',
  phone: '',
  password: 'Password123',
  confirm: 'Password123',
};

async function fill(page: Page, overrides: Partial<typeof VALID> = {}) {
  const values = { ...VALID, ...overrides };
  for (const [id, value] of Object.entries(values)) page.type(id, value);
  await page.fixture.whenStable();
}

afterEach(() => localStorage.clear());

describe('Register page — rendering & accessibility', () => {
  it('has a label for every input (NFR-9)', async () => {
    const page = await render();

    for (const id of ['name', 'email', 'phone', 'password', 'confirm']) {
      expect(page.el.querySelector(`label[for="register-${id}"]`), id).not.toBeNull();
    }
  });

  it('marks phone as optional and explains the password rules', async () => {
    const page = await render();

    expect(page.el.querySelector('label[for="register-phone"]')?.textContent).toContain('optional');
    expect(page.el.querySelector('#register-password-hint')?.textContent).toContain(
      'At least 8 characters',
    );
  });

  it('links to the login page', async () => {
    const page = await render();

    expect(page.el.querySelector('a[href="/login"]')).not.toBeNull();
  });
});

describe('Register page — positive scenarios', () => {
  it('creates the account and goes to login with the email pre-filled', async () => {
    const page = await render();
    await fill(page);
    await page.submit();

    const req = page.http.expectOne('/api/v1/auth/register');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'Asha Reddy',
      email: 'asha.reddy@example.com',
      password: 'Password123',
    });
    req.flush({ user: testUser }, { status: 201, statusText: 'Created' });
    await page.fixture.whenStable();

    expect(page.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { registered: 1, email: testUser.email },
    });
    expect(TestBed.inject(AuthService).isLoggedIn()).toBe(false);
  });

  it('sends the phone when given (trimmed)', async () => {
    const page = await render();
    await fill(page, { phone: '  +91 98765-43210 ' });
    await page.submit();

    expect(page.http.expectOne('/api/v1/auth/register').request.body.phone).toBe('+91 98765-43210');
  });

  it('does not send confirmPassword or an empty phone', async () => {
    const page = await render();
    await fill(page);
    await page.submit();

    const body = page.http.expectOne('/api/v1/auth/register').request.body;
    expect(body).not.toHaveProperty('confirmPassword');
    expect(body).not.toHaveProperty('phone');
  });

  it('trims the name and email', async () => {
    const page = await render();
    await fill(page, { name: '  Asha Reddy ', email: ' asha.reddy@example.com ' });
    await page.submit();

    const body = page.http.expectOne('/api/v1/auth/register').request.body;
    expect(body.name).toBe('Asha Reddy');
    expect(body.email).toBe('asha.reddy@example.com');
  });

  it('disables the button while creating the account', async () => {
    const page = await render();
    await fill(page);
    await page.submit();

    const button = page.el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Creating account');
    page.http.expectOne('/api/v1/auth/register').flush({ user: testUser });
  });
});

describe('Register page — negative scenarios (client-side validation)', () => {
  it('empty form: shows required errors and does not call the API', async () => {
    const page = await render();
    await page.submit();

    expect(page.error('name')).toBe('This field is required.');
    expect(page.error('email')).toBe('This field is required.');
    expect(page.error('password')).toBe('This field is required.');
    expect(page.error('confirm')).toBe('This field is required.');
    expect(page.error('phone')).toBeUndefined(); // phone is optional
    page.http.expectNone('/api/v1/auth/register');
  });

  it.each([
    ['name', { name: 'A' }, 'Name must be at least 2 characters.'],
    ['name', { name: 'a'.repeat(101) }, 'Name must be at most 100 characters.'],
    ['email', { email: 'asha.example.com' }, 'Enter a valid email address.'],
    ['phone', { phone: '12345' }, 'Enter a valid phone number'],
    ['phone', { phone: 'call me' }, 'Enter a valid phone number'],
    ['password', { password: 'abc1', confirm: 'abc1' }, 'Password must be at least 8 characters.'],
    [
      'password',
      { password: 'Passwordonly', confirm: 'Passwordonly' },
      'Password must contain at least one number.',
    ],
    [
      'password',
      { password: '12345678', confirm: '12345678' },
      'Password must contain at least one letter.',
    ],
    [
      'password',
      { password: `${'a'.repeat(72)}1`, confirm: `${'a'.repeat(72)}1` },
      'Password must be at most 72 characters.',
    ],
    ['confirm', { confirm: 'Password124' }, 'Passwords do not match.'],
  ])('%s: %j -> error', async (field, overrides, message) => {
    const page = await render();
    await fill(page, overrides);
    await page.submit();

    expect(page.error(field)).toContain(message);
    expect(page.el.querySelector(`#register-${field}`)?.getAttribute('aria-invalid')).toBe('true');
    page.http.expectNone('/api/v1/auth/register');
  });

  it('removes the error once the user fixes the field', async () => {
    const page = await render();
    await fill(page, { email: 'bad' });
    await page.submit();
    expect(page.error('email')).toBeDefined();

    page.type('email', 'asha.reddy@example.com');
    await page.fixture.whenStable();

    expect(page.error('email')).toBeUndefined();
  });
});

describe('Register page — negative scenarios (API errors)', () => {
  async function submitValid(page: Page) {
    await fill(page);
    await page.submit();
    return page.http.expectOne('/api/v1/auth/register');
  }

  it('email already registered (409): marks the email field and stays', async () => {
    const page = await render();
    (await submitValid(page)).flush(apiError('EMAIL_TAKEN', 'exists'), {
      status: 409,
      statusText: 'Conflict',
    });
    await page.fixture.whenStable();

    expect(page.error('email')).toBe('This email is already registered.');
    expect(page.el.querySelector('[data-testid="form-error"]')?.textContent).toContain(
      'Try logging in',
    );
    expect(page.navigate).not.toHaveBeenCalled();
  });

  it('server validation errors are shown under the right fields', async () => {
    const page = await render();
    (await submitValid(page)).flush(
      apiError('VALIDATION_ERROR', 'Some fields are invalid.', [
        { field: 'name', message: 'Name is not allowed.' },
        { field: 'password', message: 'Password is too common.' },
      ]),
      { status: 400, statusText: 'Bad Request' },
    );
    await page.fixture.whenStable();

    expect(page.error('name')).toBe('Name is not allowed.');
    expect(page.error('password')).toBe('Password is too common.');
  });

  it('server down: shows a connection message and lets the user retry', async () => {
    const page = await render();
    (await submitValid(page)).error(new ProgressEvent('error'));
    await page.fixture.whenStable();

    expect(page.el.querySelector('[data-testid="form-error"]')?.textContent).toContain(
      'Cannot reach the server',
    );
    expect(page.el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('unexpected 500: shows a generic message', async () => {
    const page = await render();
    (await submitValid(page)).flush('Internal error', { status: 500, statusText: 'Error' });
    await page.fixture.whenStable();

    expect(page.el.querySelector('[data-testid="form-error"]')?.textContent).toContain(
      'Something went wrong',
    );
  });
});
