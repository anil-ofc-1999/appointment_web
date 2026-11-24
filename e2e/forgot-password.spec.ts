import { Page, expect, test } from '@playwright/test';

import { login, newPatient, registerViaApi, uniqueEmail } from './support/auth';
import { createResetLink, openResetLinks } from './support/db';

/**
 * D-37: forgot password, end to end (real API + database). E2E runs do not really send
 * emails, so the link is created in the database the same way the API does.
 */
const NEW_PASSWORD = 'FreshPass2030';

async function setNewPassword(page: Page, password = NEW_PASSWORD, confirm = password) {
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password').fill(confirm);
  await page.getByRole('button', { name: 'Save new password' }).click();
}

test.describe('Forgot password — positive', () => {
  test('"Forgot password?" on login asks for the email and creates a link', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await page.goto('/login');

    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByLabel('Email').fill(patient.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();

    await expect(page.getByTestId('reset-sent')).toContainText(
      `If an account exists for ${patient.email}`,
    );
    expect(await openResetLinks(patient.email)).toBe(1);
  });

  test('the link sets a new password; then only the new password logs in', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    const token = await createResetLink(patient.email);

    await page.goto(`/reset-password?token=${token}`);
    await setNewPassword(page);

    await expect(page).toHaveURL(/\/login\?reason=password-reset/);
    await expect(page.getByTestId('reason-message')).toContainText('password has been changed');
    await login(page, patient.email, patient.password);
    await expect(page.getByTestId('form-error')).toHaveText('Email or password is incorrect.');
    await login(page, patient.email, NEW_PASSWORD);
    await expect(page.getByTestId('welcome')).toBeVisible();
  });
});

test.describe('Forgot password — negative', () => {
  test('an unknown email gets the same answer (no hint that it is not registered)', async ({
    page,
  }) => {
    const email = uniqueEmail('nobody');
    await page.goto('/forgot-password');

    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();

    await expect(page.getByTestId('reset-sent')).toContainText(`If an account exists for ${email}`);
  });

  test('a link works only once', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    const token = await createResetLink(patient.email);
    await page.goto(`/reset-password?token=${token}`);
    await setNewPassword(page);
    await expect(page).toHaveURL(/reason=password-reset/);

    await page.goto(`/reset-password?token=${token}`);
    await setNewPassword(page, 'AnotherPass2030');

    await expect(page.getByTestId('invalid-link')).toContainText('expired or was already used');
    await page.getByRole('link', { name: 'Ask for a new link' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });

  test('an expired link is refused and the old password still works', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    const token = await createResetLink(patient.email, { minutesValid: -1 });

    await page.goto(`/reset-password?token=${token}`);
    await setNewPassword(page);

    await expect(page.getByTestId('invalid-link')).toBeVisible();
    await login(page, patient.email, patient.password);
    await expect(page.getByTestId('welcome')).toBeVisible();
  });

  test('a page opened without a token shows "ask for a new link"', async ({ page }) => {
    await page.goto('/reset-password');

    await expect(page.getByTestId('invalid-link')).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
  });

  test('mismatching new passwords are caught before sending', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    const token = await createResetLink(patient.email);
    await page.goto(`/reset-password?token=${token}`);
    let calls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/auth/reset-password')) calls += 1;
    });

    await setNewPassword(page, NEW_PASSWORD, 'Different2030');

    await expect(page.locator('#reset-confirm-new-error')).toHaveText('Passwords do not match.');
    expect(calls).toBe(0);
    expect(await openResetLinks(patient.email)).toBe(1); // link still usable
  });
});
