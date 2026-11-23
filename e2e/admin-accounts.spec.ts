import { Page, expect, test } from '@playwright/test';

import { SEED_ADMIN, login, newPatient, registerViaApi } from './support/auth';
import { EVERY_DAY, createE2eDoctors } from './support/db';

/**
 * D-35: admin resets a doctor's / patient's password (Admin → Accounts), end to end.
 * Only e2e-* accounts are reset — never the seed accounts.
 */
const RUN = `Zp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SPEC = `E2E Accounts ${RUN}`;
const DOC = `Dr. Aaaccounts ${RUN}`; // "Aaa" keeps it on the first page of the admin list
const TEMP = 'TempPass2030x';

let created = false;
test.beforeAll(async () => {
  if (created) return; // beforeAll may run again in the same worker
  created = true;
  await createE2eDoctors([{ name: SPEC, doctors: [{ name: DOC, schedule: EVERY_DAY }] }]);
});

async function loginAsAdmin(page: Page, query = '') {
  await login(page, SEED_ADMIN.email, SEED_ADMIN.password);
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.goto(`/admin${query}`);
}

async function setNewPassword(page: Page, password = TEMP, confirm = password) {
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password').fill(confirm);
  await page.getByRole('button', { name: 'Set new password' }).click();
}

test.describe('Admin reset password — positive', () => {
  test('admin resets a patient; the patient logs in with the new password only', async ({
    page,
    browser,
  }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await loginAsAdmin(page, '?tab=accounts');

    await page.getByLabel('Account email').fill(patient.email);
    await setNewPassword(page);

    await expect(page.getByTestId('reset-done')).toHaveText(
      `New password set for ${patient.name} (patient).`,
    );
    const other = await browser.newContext();
    const patientPage = await other.newPage();
    await login(patientPage, patient.email, patient.password);
    await expect(patientPage.getByTestId('form-error')).toHaveText(
      'Email or password is incorrect.',
    );
    await login(patientPage, patient.email, TEMP);
    await expect(patientPage.getByTestId('welcome')).toBeVisible();
    await other.close();
  });

  test('"Reset password" on a doctor card opens Accounts with the email filled in', async ({
    page,
  }) => {
    await loginAsAdmin(page, '?tab=doctors');
    const card = page.getByTestId('admin-doctor').filter({ hasText: DOC });

    await card.getByRole('button', { name: 'Reset password' }).click();

    await expect(page).toHaveURL(/tab=accounts/);
    await expect(page.getByRole('tab', { name: 'Accounts' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const email = await page.getByLabel('Account email').inputValue();
    expect(email).toMatch(/^e2e-.*@example\.com$/);
    await setNewPassword(page);
    await expect(page.getByTestId('reset-done')).toContainText(`${DOC} (doctor)`);
  });
});

test.describe('Admin reset password — negative', () => {
  test('an admin account is refused; the admin password does not change', async ({ page }) => {
    await loginAsAdmin(page, '?tab=accounts');

    await page.getByLabel('Account email').fill(SEED_ADMIN.email);
    await setNewPassword(page);

    await expect(page.getByTestId('form-error')).toContainText(
      'Admins use the Change password page',
    );
    await page.getByRole('button', { name: 'Log out' }).click();
    await login(page, SEED_ADMIN.email, SEED_ADMIN.password);
    await expect(page.getByTestId('welcome')).toBeVisible();
  });

  test('an unknown email gets a clear message', async ({ page }) => {
    await loginAsAdmin(page, '?tab=accounts');

    await page.getByLabel('Account email').fill(`e2e-nobody-${RUN.toLowerCase()}@example.com`);
    await setNewPassword(page);

    await expect(page.getByTestId('form-error')).toHaveText('No account with this email.');
  });

  test('mismatching passwords are caught before sending', async ({ page }) => {
    await loginAsAdmin(page, '?tab=accounts');
    let calls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/users/reset-password')) calls += 1;
    });

    await page.getByLabel('Account email').fill('someone@example.com');
    await setNewPassword(page, TEMP, 'Different2030');

    await expect(page.locator('#reset-confirm-error')).toHaveText('Passwords do not match.');
    expect(calls).toBe(0);
  });

  test('a patient cannot open the admin panel at all', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await login(page, patient.email, patient.password);
    await expect(page.getByTestId('welcome')).toBeVisible();

    await page.goto('/admin?tab=accounts');

    await expect(page).not.toHaveURL(/\/admin/);
  });
});
