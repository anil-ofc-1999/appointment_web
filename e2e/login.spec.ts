import { expect, test } from '@playwright/test';

import { PASSWORD, login, newPatient, registerViaApi, uniqueEmail } from './support/auth';
import { disableUser } from './support/db';

/** Screen 1 — Login (FR-1.5 to FR-1.7), end to end with the real API. */

test.describe('Login — positive scenarios', () => {
  test('logs in, shows the user in the top bar, and logs out', async ({ page }) => {
    const patient = newPatient({ name: 'Asha Reddy' });
    await registerViaApi(page, patient);

    await login(page, patient.email, patient.password);

    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('welcome')).toHaveText('Welcome, Asha Reddy');
    await expect(page.getByTestId('current-user')).toHaveText('Asha Reddy');

    await page.getByRole('button', { name: 'Log out' }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('current-user')).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Log in' }),
    ).toBeVisible();
  });

  test('email is case-insensitive and spaces are ignored', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);

    await login(page, `  ${patient.email.toUpperCase()} `, patient.password);

    await expect(page.getByTestId('welcome')).toBeVisible();
  });

  test('stays logged in after a page reload', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await login(page, patient.email, patient.password);
    await expect(page.getByTestId('welcome')).toBeVisible();

    await page.reload();

    await expect(page.getByTestId('current-user')).toHaveText(patient.name);
  });

  test('after logout, a reload stays logged out', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await login(page, patient.email, patient.password);
    await page.getByRole('button', { name: 'Log out' }).click();

    await page.reload();

    await expect(page.getByTestId('current-user')).toHaveCount(0);
  });

  test('the token from login works on a protected API (/me)', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await login(page, patient.email, patient.password);
    await expect(page.getByTestId('welcome')).toBeVisible();

    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('appointment.session') ?? '{}').accessToken as string,
    );
    const res = await page.request.get('/api/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    expect((await res.json()).user.email).toBe(patient.email);
  });

  test('can log in with the keyboard only (NFR-9)', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await page.goto('/login');

    await page.getByLabel('Email').focus();
    await page.keyboard.type(patient.email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(patient.password);
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('welcome')).toBeVisible();
  });

  test('a logged-in user who opens /login or /register is sent home', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await login(page, patient.email, patient.password);
    await expect(page.getByTestId('welcome')).toBeVisible();

    await page.goto('/login');
    await expect(page).toHaveURL('/');

    await page.goto('/register');
    await expect(page).toHaveURL('/');
  });
});

test.describe('Login — negative scenarios', () => {
  test('wrong password and unknown email show the SAME message (no enumeration)', async ({
    page,
  }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);

    await login(page, patient.email, 'WrongPass99');
    const wrongPassword = await page.getByTestId('form-error').textContent();

    await login(page, uniqueEmail('nobody'), 'WrongPass99');
    const unknownEmail = await page.getByTestId('form-error').textContent();

    expect(wrongPassword?.trim()).toBe('Email or password is incorrect.');
    expect(unknownEmail).toBe(wrongPassword);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('current-user')).toHaveCount(0);
  });

  test('password is case-sensitive', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);

    await login(page, patient.email, PASSWORD.toLowerCase());

    await expect(page.getByTestId('form-error')).toHaveText('Email or password is incorrect.');
  });

  test('a disabled account cannot log in', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await disableUser(patient.email);

    await login(page, patient.email, patient.password);

    await expect(page.getByTestId('form-error')).toContainText('This account is disabled');
    await expect(page.getByTestId('current-user')).toHaveCount(0);
  });

  test('a session is ended when the account is disabled after login (FR-1.7)', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await login(page, patient.email, patient.password);
    await expect(page.getByTestId('welcome')).toBeVisible();
    await disableUser(patient.email);

    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('appointment.session') ?? '{}').accessToken as string,
    );
    const res = await page.request.get('/api/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(401);
  });

  test('empty fields show errors and send nothing', async ({ page }) => {
    let calls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/auth/login')) calls += 1;
    });
    await page.goto('/login');

    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.locator('#login-email-error')).toHaveText('This field is required.');
    await expect(page.locator('#login-password-error')).toHaveText('This field is required.');
    expect(calls).toBe(0);
  });

  test('an invalid email format is caught before calling the API', async ({ page }) => {
    await login(page, 'asha@', PASSWORD);

    await expect(page.locator('#login-email-error')).toHaveText('Enter a valid email address.');
  });

  test('an expired saved session is treated as logged out (FR-1.6)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem(
        'appointment.session',
        JSON.stringify({
          accessToken: 'x.y.z',
          expiresAt: Date.now() - 1000,
          user: { id: 1, name: 'Old User', email: 'old@example.com', phone: null, role: 'PATIENT' },
        }),
      ),
    );

    await page.reload();

    await expect(page.getByTestId('current-user')).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Log in' }),
    ).toBeVisible();
  });

  test('an external returnUrl is ignored after login (no open redirect)', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await page.goto('/login?returnUrl=https://evil.example.com');

    await page.getByLabel('Email').fill(patient.email);
    await page.getByLabel('Password', { exact: true }).fill(patient.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page).toHaveURL('/');
  });

  test('a protected API call without a token returns 401', async ({ page }) => {
    const res = await page.request.get('/api/v1/me');

    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });
});
