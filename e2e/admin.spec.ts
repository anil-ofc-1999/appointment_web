import { Page, expect, test } from '@playwright/test';

import {
  PASSWORD,
  SEED_ADMIN,
  bookAsOtherPatient,
  login,
  loginAsNewPatient,
  uniqueEmail,
} from './support/auth';
import { clinicDate, clinicInstant } from './support/dates';
import { EVERY_DAY, appointmentsOf, createE2eDoctors } from './support/db';

/**
 * Screen 7 — Admin panel (FR-2.1 to FR-2.3, FR-6.3, FR-5.5), end to end with the seed admin.
 * Everything created here is named "E2E ..." / e2e-*@example.com so cleanup removes it.
 */
const RUN = `Za${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SPEC = `E2E Admin ${RUN}`;
const DOC = `Dr. Aaadmin ${RUN}`; // "Aaa" keeps it on the first page of the admin list
const D2 = clinicDate(2);

let ids: Awaited<ReturnType<typeof createE2eDoctors>>;

test.beforeAll(async () => {
  if (ids) return; // beforeAll may run again in the same worker
  ids = await createE2eDoctors([{ name: SPEC, doctors: [{ name: DOC, schedule: EVERY_DAY }] }]);
});

async function loginAsAdmin(page: Page, tab?: string) {
  await login(page, SEED_ADMIN.email, SEED_ADMIN.password);
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.goto(`/admin${tab ? `?tab=${tab}` : ''}`);
}

const doctorCard = (page: Page, name: string) =>
  page.getByTestId('admin-doctor').filter({ hasText: name });
const specRow = (page: Page, name: string) =>
  page.getByTestId('admin-specialization').filter({ hasText: name });

test.describe('Admin — appointments (FR-6.3, FR-5.5)', () => {
  test('the admin opens the panel from the top bar', async ({ page }) => {
    await login(page, SEED_ADMIN.email, SEED_ADMIN.password);

    await page
      .getByRole('navigation', { name: 'Account' })
      .getByRole('link', { name: 'Admin' })
      .click();

    await expect(page.getByRole('heading', { name: 'Admin panel' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Appointments' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('filter by doctor and cancel a booking (any time)', async ({ page }) => {
    await bookAsOtherPatient(page, ids.doctors[DOC], clinicInstant(D2, '10:00'));
    await loginAsAdmin(page);

    await page.getByLabel('Doctor', { exact: true }).selectOption({ label: DOC });
    const row = page.getByTestId('admin-appointment').filter({ hasText: DOC }).first();
    await expect(row.getByTestId('status')).toHaveText('Booked');

    await row.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Yes, cancel' }).click();

    await expect(page.getByTestId('admin-notice')).toContainText('was cancelled');
    await page.getByLabel('Status').selectOption('CANCELLED');
    await expect(
      page.getByTestId('admin-appointment').filter({ hasText: DOC }).first(),
    ).toBeVisible();
  });

  test('"from" after "to" is refused with a message', async ({ page }) => {
    await loginAsAdmin(page);

    await page.getByLabel('From', { exact: true }).fill(clinicDate(5));
    await page.getByLabel('To', { exact: true }).fill(clinicDate(1));

    await expect(page.getByTestId('filter-error')).toHaveText('"From" must be on or before "To".');
  });
});

test.describe('Admin — doctors (FR-2.2, FR-2.3)', () => {
  test('adds a doctor who can then log in as DOCTOR', async ({ page }) => {
    const email = uniqueEmail('admin-made');
    const name = `Dr. Aaanew ${RUN}`;
    await loginAsAdmin(page, 'doctors');

    await page.getByRole('button', { name: 'Add doctor' }).click();
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Login email').fill(email);
    await page.getByLabel('First password').fill(PASSWORD);
    await page.getByLabel('Specialization').selectOption({ label: SPEC });
    await page.getByLabel('Fee (₹)').fill('725.50');
    await page.getByLabel('Slot length').selectOption('15');
    await page.getByRole('button', { name: 'Save doctor' }).click();

    await expect(page.getByTestId('doctors-notice')).toContainText(`${name} was added`);
    await expect(doctorCard(page, name)).toContainText('₹725.50');
    await expect(doctorCard(page, name)).toContainText('15 min');

    await page.getByRole('button', { name: 'Log out' }).click();
    await login(page, email, PASSWORD);
    await expect(
      page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Dashboard' }),
    ).toBeVisible();
  });

  test('a weak password and a used email are refused', async ({ page }) => {
    await loginAsAdmin(page, 'doctors');
    await page.getByRole('button', { name: 'Add doctor' }).click();
    await page.getByLabel('Full name').fill('Dr. Nope');
    await page.getByLabel('Login email').fill(SEED_ADMIN.email);
    await page.getByLabel('First password').fill('password');
    await page.getByLabel('Specialization').selectOption({ label: SPEC });
    await page.getByLabel('Fee (₹)').fill('500');

    await page.getByRole('button', { name: 'Save doctor' }).click();
    await expect(page.getByTestId('add-doctor-form')).toContainText('one number');

    await page.getByLabel('First password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Save doctor' }).click();
    await expect(page.getByTestId('add-doctor-form')).toContainText('This email is already used.');
  });

  test('deactivating hides the doctor from patients; activating brings them back', async ({
    browser,
  }) => {
    const { doctors } = await createE2eDoctors([
      {
        name: `E2E Toggle ${RUN}`,
        doctors: [{ name: `Dr. Aaatoggle ${RUN}`, schedule: EVERY_DAY }],
      },
    ]);
    expect(doctors).toBeTruthy();
    const adminPage = await browser.newPage();
    const patientPage = await browser.newPage();
    await loginAsAdmin(adminPage, 'doctors');
    await loginAsNewPatient(patientPage);
    const name = `Dr. Aaatoggle ${RUN}`;

    await doctorCard(adminPage, name).getByRole('button', { name: 'Deactivate' }).click();
    await expect(doctorCard(adminPage, name).getByTestId('doctor-state')).toHaveText('Inactive');

    await patientPage.goto(`/doctors?q=${encodeURIComponent(name)}`);
    await expect(patientPage.getByTestId('no-results')).toBeVisible();

    await doctorCard(adminPage, name).getByRole('button', { name: 'Activate' }).click();
    await expect(doctorCard(adminPage, name).getByTestId('doctor-state')).toHaveText('Active');
    await patientPage.reload();
    await expect(patientPage.getByTestId('doctor-card')).toHaveCount(1);
    await adminPage.close();
    await patientPage.close();
  });

  test('edits the fee', async ({ page }) => {
    await loginAsAdmin(page, 'doctors');

    await doctorCard(page, DOC).getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Fee (₹)').fill('1234');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(doctorCard(page, DOC)).toContainText('₹1,234');
  });
});

test.describe('Admin — specializations (FR-2.1)', () => {
  test('adds, renames and deactivates a specialization', async ({ browser }) => {
    const adminPage = await browser.newPage();
    const patientPage = await browser.newPage();
    const name = `E2E New ${RUN}`;
    const renamed = `E2E Renamed ${RUN}`;
    await loginAsAdmin(adminPage, 'specializations');
    await loginAsNewPatient(patientPage);

    await adminPage.getByLabel('New specialization').fill(name);
    await adminPage.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(adminPage.getByTestId('specializations-notice')).toHaveText(`${name} was added.`);

    await specRow(adminPage, name).getByRole('button', { name: 'Rename' }).click();
    await adminPage.getByLabel('Name', { exact: true }).fill(renamed);
    await adminPage.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(specRow(adminPage, renamed)).toBeVisible();

    await patientPage.goto('/doctors');
    await expect(
      patientPage.getByLabel('Specialization').locator('option', { hasText: renamed }),
    ).toHaveCount(1);

    await specRow(adminPage, renamed).getByRole('button', { name: 'Deactivate' }).click();
    await expect(specRow(adminPage, renamed).getByTestId('specialization-state')).toHaveText(
      'Inactive',
    );
    await patientPage.reload();
    await expect(
      patientPage.getByLabel('Specialization').locator('option', { hasText: renamed }),
    ).toHaveCount(0);
    await adminPage.close();
    await patientPage.close();
  });

  test('a duplicate name (other case) is refused', async ({ page }) => {
    await loginAsAdmin(page, 'specializations');

    await page.getByLabel('New specialization').fill(SPEC.toUpperCase());
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByTestId('specializations-notice')).toHaveText(
      'A specialization with this name already exists.',
    );
  });
});

test.describe('Admin — access', () => {
  test('a patient cannot open the admin panel', async ({ page }) => {
    const patient = await loginAsNewPatient(page);

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/$/);
    expect(await appointmentsOf(patient.email)).toEqual([]);
  });

  test('a guest is sent to login', async ({ page }) => {
    await page.goto('/admin');

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fadmin/);
  });
});
