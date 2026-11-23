import { expect, test } from '@playwright/test';

import { login, loginAsNewPatient } from './support/auth';

/**
 * D-32: change password, end to end (real API + database).
 * Only fresh e2e-* patients are used — never the seed accounts.
 */

const NEW_PASSWORD = 'BetterPass2030';

async function changePassword(
  page: import('@playwright/test').Page,
  current: string,
  next: string,
  confirm = next,
) {
  await page.getByLabel('Current password').fill(current);
  await page.getByLabel('New password', { exact: true }).fill(next);
  await page.getByLabel('Confirm new password').fill(confirm);
  await page.getByRole('button', { name: 'Change password' }).click();
}

test.describe('Change password — positive', () => {
  test('a patient changes the password from the top bar and stays logged in', async ({ page }) => {
    const patient = await loginAsNewPatient(page);

    await page.getByRole('link', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/account\/password$/);
    await changePassword(page, patient.password, NEW_PASSWORD);

    await expect(page.getByTestId('password-changed')).toHaveText(
      'Your password has been changed.',
    );
    await expect(page.getByLabel('Current password')).toHaveValue('');
    // Still logged in with the fresh token: a protected page loads.
    await page.getByRole('link', { name: 'My appointments' }).click();
    await expect(page.getByRole('heading', { name: 'My appointments' })).toBeVisible();
  });

  test('afterwards only the new password logs in', async ({ page }) => {
    const patient = await loginAsNewPatient(page);
    await page.goto('/account/password');
    await changePassword(page, patient.password, NEW_PASSWORD);
    await expect(page.getByTestId('password-changed')).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();

    await login(page, patient.email, patient.password);
    await expect(page.getByTestId('form-error')).toHaveText('Email or password is incorrect.');

    await login(page, patient.email, NEW_PASSWORD);
    await expect(page.getByTestId('welcome')).toBeVisible();
  });

  test('another device that was logged in is signed out', async ({ page, browser }) => {
    const patient = await loginAsNewPatient(page);
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await login(otherPage, patient.email, patient.password);
    await expect(otherPage.getByTestId('welcome')).toBeVisible();
    // Tokens carry whole seconds; make sure the change happens in a later second.
    await page.waitForTimeout(1100);

    await page.goto('/account/password');
    await changePassword(page, patient.password, NEW_PASSWORD);
    await expect(page.getByTestId('password-changed')).toBeVisible();

    await otherPage.goto('/appointments');
    await expect(otherPage).toHaveURL(/\/login\?.*reason=expired/);
    await expect(otherPage.getByTestId('reason-message')).toBeVisible();
    await other.close();
  });

  test('the eye buttons show each password field on its own', async ({ page }) => {
    await loginAsNewPatient(page);
    await page.goto('/account/password');
    const current = page.getByLabel('Current password');
    await current.fill('Secret123');

    await page.getByRole('button', { name: 'Show password' }).first().click();

    await expect(current).toHaveAttribute('type', 'text');
    await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute(
      'type',
      'password',
    );
  });
});

test.describe('Change password — negative', () => {
  test('wrong current password is refused and the old password still works', async ({ page }) => {
    const patient = await loginAsNewPatient(page);
    await page.goto('/account/password');

    await changePassword(page, 'NotMyPassword1', NEW_PASSWORD);

    await expect(page.getByTestId('form-error')).toHaveText('Your current password is incorrect.');
    await expect(page.locator('#current-password-error')).toHaveText(
      'Current password is incorrect.',
    );
    await page.getByRole('button', { name: 'Log out' }).click();
    await login(page, patient.email, patient.password);
    await expect(page.getByTestId('welcome')).toBeVisible();
  });

  test('weak, mismatching or unchanged new passwords are caught before sending', async ({
    page,
  }) => {
    const patient = await loginAsNewPatient(page);
    await page.goto('/account/password');
    let calls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/auth/change-password')) calls += 1;
    });

    await changePassword(page, patient.password, 'onlyletters');
    await expect(page.locator('#new-password-error')).toHaveText(
      'Password must contain at least one number.',
    );

    await changePassword(page, patient.password, NEW_PASSWORD, 'Different123');
    await expect(page.locator('#confirm-password-error')).toHaveText('Passwords do not match.');

    await changePassword(page, patient.password, patient.password);
    await expect(page.locator('#new-password-error')).toHaveText(
      'The new password must be different from the current one.',
    );
    expect(calls).toBe(0);
  });

  test('a guest is sent to the login page', async ({ page }) => {
    await page.goto('/account/password');

    await expect(page).toHaveURL(/\/login/);
  });
});
