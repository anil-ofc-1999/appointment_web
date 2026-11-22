import { expect, test } from '@playwright/test';

import { PASSWORD, fillRegister, newPatient, registerViaApi, uniqueEmail } from './support/auth';

/** Screen 1 — Register (FR-1.1 to FR-1.3, FR-1.8), end to end with the real API. */

test.describe('Register — positive scenarios', () => {
  test('a new patient registers and lands on login with the email filled in', async ({ page }) => {
    const patient = newPatient();

    await fillRegister(page, patient);

    await expect(page).toHaveURL(/\/login\?registered=1/);
    await expect(page.getByTestId('registered-message')).toHaveText(
      'Account created. Please log in.',
    );
    await expect(page.getByLabel('Email')).toHaveValue(patient.email);
    await expect(page.getByTestId('current-user')).toHaveCount(0); // not logged in yet
  });

  test('registers with an optional phone number', async ({ page }) => {
    await fillRegister(page, newPatient({ phone: '+91 98765-43210' }));

    await expect(page).toHaveURL(/\/login\?registered=1/);
  });

  test('email is saved in lower case (FR-1.2)', async ({ page }) => {
    const email = uniqueEmail('case');
    await fillRegister(page, newPatient({ email: email.toUpperCase() }));

    await expect(page.getByLabel('Email')).toHaveValue(email);
  });

  test('the new account can log in right away', async ({ page }) => {
    const patient = newPatient({ name: 'Ravi Teja' });
    await fillRegister(page, patient);
    await expect(page.getByTestId('registered-message')).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill(patient.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByTestId('welcome')).toHaveText('Welcome, Ravi Teja');
    await expect(page.getByText('patient', { exact: true })).toBeVisible();
  });

  test('the eye buttons show and hide each password, and the form still works', async ({
    page,
  }) => {
    const patient = newPatient();
    await page.goto('/register');
    const password = page.locator('#register-password');
    const confirm = page.locator('#register-confirm');
    await password.fill(patient.password);
    await confirm.fill(patient.password);

    const eyes = page.getByRole('button', { name: 'Show password' });
    await expect(eyes).toHaveCount(2);
    await eyes.first().click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(confirm).toHaveAttribute('type', 'password');
    await expect(page).toHaveURL(/\/register$/); // the eye does not submit

    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  test('login page eye button reveals the typed password', async ({ page }) => {
    await page.goto('/login');
    const password = page.locator('#login-password');
    await password.fill('Secret123');

    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue('Secret123');
    await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('Register — negative scenarios', () => {
  test('empty form shows required errors and sends nothing', async ({ page }) => {
    let calls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/auth/register')) calls += 1;
    });
    await page.goto('/register');

    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.locator('.field-error')).toHaveCount(4);
    await expect(page.getByLabel('Full name')).toHaveAttribute('aria-invalid', 'true');
    expect(calls).toBe(0);
    await expect(page).toHaveURL(/\/register$/);
  });

  test('weak password is rejected with the rule that is missing (FR-1.3)', async ({ page }) => {
    await fillRegister(page, newPatient({ password: 'onlyletters' }));

    await expect(page.locator('#register-password-error')).toHaveText(
      'Password must contain at least one number.',
    );
    await expect(page).toHaveURL(/\/register$/);
  });

  test('short password is rejected', async ({ page }) => {
    await fillRegister(page, newPatient({ password: 'abc123' }));

    await expect(page.locator('#register-password-error')).toHaveText(
      'Password must be at least 8 characters.',
    );
  });

  test('passwords that do not match are rejected', async ({ page }) => {
    await fillRegister(page, newPatient(), 'Different123');

    await expect(page.locator('#register-confirm-error')).toHaveText('Passwords do not match.');
  });

  test('invalid email and phone are rejected', async ({ page }) => {
    await fillRegister(page, newPatient({ email: 'not-an-email', phone: 'abc' }));

    await expect(page.locator('#register-email-error')).toHaveText('Enter a valid email address.');
    await expect(page.locator('#register-phone-error')).toContainText('Enter a valid phone number');
  });

  test('an email that is already registered is rejected (FR-1.2)', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);

    await fillRegister(page, { ...patient, email: patient.email.toUpperCase() });

    await expect(page.locator('#register-email-error')).toHaveText(
      'This email is already registered.',
    );
    await expect(page.getByTestId('form-error')).toContainText('Try logging in');
    await expect(page).toHaveURL(/\/register$/);
  });

  test('a role sent to the API is ignored — always PATIENT (FR-1.8)', async ({ page }) => {
    const res = await page.request.post('/api/v1/auth/register', {
      data: { name: 'Sneaky', email: uniqueEmail('role'), password: PASSWORD, role: 'ADMIN' },
    });

    expect(res.status()).toBe(201);
    expect((await res.json()).user.role).toBe('PATIENT');
  });
});
