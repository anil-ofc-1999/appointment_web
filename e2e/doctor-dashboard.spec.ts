import { Locator, Page, expect, test } from '@playwright/test';

import {
  DoctorAccount,
  bookAsMe,
  createDoctorAccount,
  login,
  loginAsNewPatient,
  newPatient,
  registerViaApi,
} from './support/auth';
import { clinicDate, clinicInstant } from './support/dates';
import { EVERY_DAY, createE2eDoctors, insertAppointment } from './support/db';

/**
 * Screen 6 — Doctor dashboard (FR-6.2, FR-5.4, FR-3.1 to FR-3.3), end to end.
 * Every test gets its own doctor account (created like an admin would).
 */
const RUN = `Zx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SPEC = `E2E Dash ${RUN}`;
const TOMORROW = clinicDate(1);
const D3 = clinicDate(3);

let specializationId: number;

test.beforeAll(async () => {
  if (specializationId) return; // beforeAll may run again in the same worker
  const { specializations } = await createE2eDoctors([{ name: SPEC, doctors: [] }]);
  specializationId = specializations[SPEC];
});

let counter = 0;
async function newDoctor(page: Page): Promise<DoctorAccount> {
  counter += 1;
  return createDoctorAccount(page, specializationId, `Dr. Dash${counter} ${RUN}`, EVERY_DAY);
}

async function loginAsDoctor(page: Page, doctor: DoctorAccount) {
  await login(page, doctor.email, doctor.password);
  await expect(page.getByTestId('welcome')).toBeVisible();
}

/** A patient (in a separate request context) books a slot of this doctor. */
async function patientBooks(page: Page, doctorId: number, startAt: string): Promise<string> {
  const patient = newPatient({ name: `Pat ${Math.random().toString(36).slice(2, 6)}` });
  await registerViaApi(page, patient);
  const loginRes = await page.request.post('/api/v1/auth/login', {
    data: { email: patient.email, password: patient.password },
  });
  const token = (await loginRes.json()).accessToken as string;
  const res = await page.request.post('/api/v1/appointments', {
    data: { doctorId, startAt },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status(), await res.text()).toBe(201);
  return patient.name;
}

/** Picks a dropdown value, then closes the phone's picker (a real tap elsewhere does that). */
async function choose(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.selectOption(value);
  await field.blur();
}

/**
 * Presses a button with the keyboard (focus + Enter). On the emulated phone, after a
 * dropdown was used the visual viewport is shifted, so taps land one row off — an
 * emulation artefact (layout measured correct). The button's own logic still runs.
 */
async function activate(button: Locator) {
  await button.focus();
  await button.press('Enter');
}

const rows = (page: Page) => page.getByTestId('day-row');
const row = (page: Page, text: string) => rows(page).filter({ hasText: text });

test.describe('Doctor dashboard — appointments (positive)', () => {
  test('a doctor opens the dashboard from the top bar', async ({ page }) => {
    const doctor = await newDoctor(page);
    await loginAsDoctor(page, doctor);

    await page
      .getByRole('navigation', { name: 'Account' })
      .getByRole('link', { name: 'Dashboard' })
      .click();

    await expect(page.getByRole('heading', { name: 'Doctor dashboard' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Appointments' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('tomorrow’s bookings appear with patient names, in time order', async ({ page }) => {
    const doctor = await newDoctor(page);
    const late = await patientBooks(page, doctor.id, clinicInstant(TOMORROW, '17:00'));
    const early = await patientBooks(page, doctor.id, clinicInstant(TOMORROW, '09:30'));
    await loginAsDoctor(page, doctor);

    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Next day →' }).click();

    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0)).toContainText('09:30');
    await expect(rows(page).nth(0)).toContainText(early);
    await expect(rows(page).nth(1)).toContainText(late);
    await expect(page.getByTestId('day-summary')).toHaveText('2 appointment(s), 2 still booked');
  });

  test('a future appointment cannot be closed yet ("After HH:MM")', async ({ page }) => {
    const doctor = await newDoctor(page);
    await patientBooks(page, doctor.id, clinicInstant(TOMORROW, '10:00'));
    await loginAsDoctor(page, doctor);

    await page.goto(`/dashboard?date=${TOMORROW}`);

    await expect(row(page, '10:00').getByTestId('not-started')).toHaveText('After 10:00');
    await expect(row(page, '10:00').getByRole('button')).toHaveCount(0);
  });

  test('an appointment that started can be marked Completed (FR-5.4)', async ({ page }) => {
    const doctor = await newDoctor(page);
    const patient = await loginAsNewPatient(page);
    await page.getByRole('button', { name: 'Log out' }).click();
    // Started 30 minutes ago (inserted directly: the API never books the past).
    await insertAppointment(patient.email, doctor.id, new Date(Date.now() - 30 * 60 * 1000));
    await loginAsDoctor(page, doctor);

    await page.goto('/dashboard');
    await row(page, patient.name).getByRole('button', { name: 'Completed' }).click();

    await expect(row(page, patient.name).getByTestId('row-status')).toHaveText('Completed');
    await expect(row(page, patient.name).getByRole('button')).toHaveCount(0);
  });

  test('an appointment that started can be marked No-show', async ({ page }) => {
    const doctor = await newDoctor(page);
    const patient = await loginAsNewPatient(page);
    await page.getByRole('button', { name: 'Log out' }).click();
    await insertAppointment(patient.email, doctor.id, new Date(Date.now() - 10 * 60 * 1000));
    await loginAsDoctor(page, doctor);

    await page.goto('/dashboard');
    await row(page, patient.name).getByRole('button', { name: 'No-show' }).click();

    await expect(row(page, patient.name).getByTestId('row-status')).toHaveText('No-show');
  });

  test('a cancelled appointment is shown as Cancelled, without buttons', async ({ page }) => {
    const doctor = await newDoctor(page);
    await loginAsNewPatient(page);
    const id = await bookAsMe(page, doctor.id, clinicInstant(D3, '11:00'));
    await page.request.post(`/api/v1/appointments/${id}/cancel`, {
      headers: {
        Authorization: `Bearer ${await page.evaluate(() => JSON.parse(localStorage.getItem('appointment.session') ?? '{}').accessToken)}`,
      },
    });
    await page.getByRole('button', { name: 'Log out' }).click();
    await loginAsDoctor(page, doctor);

    await page.goto(`/dashboard?date=${D3}`);

    await expect(rows(page).getByTestId('row-status')).toHaveText('Cancelled');
    await expect(rows(page).getByRole('button')).toHaveCount(0);
  });
});

test.describe('Doctor dashboard — weekly schedule', () => {
  test('changing the hours changes what patients can book (FR-3.1)', async ({ page }) => {
    const doctor = await newDoctor(page);
    await loginAsDoctor(page, doctor);
    await page.goto('/dashboard?tab=schedule');

    // Remove every block of tomorrow's weekday, then add 08:00–09:00.
    const weekday = new Date(`${TOMORROW}T00:00:00Z`).getUTCDay();
    const day = page.locator(`[data-testid="schedule-day"][data-day="${weekday}"]`);
    const blocks = day.getByTestId('block');
    await expect(blocks).toHaveCount(2); // wait until the saved schedule is shown
    const count = await blocks.count();
    for (let left = count - 1; left >= 0; left -= 1) {
      await blocks.first().getByRole('button').click();
      await expect(blocks).toHaveCount(left); // wait for the page to redraw
    }
    await page.getByLabel('Day', { exact: true }).selectOption(String(weekday));
    await choose(page, 'From', '08:00');
    await choose(page, 'To', '09:00');
    await activate(page.getByRole('button', { name: 'Add', exact: true }));
    await expect(page.getByTestId('unsaved')).toBeVisible();
    await activate(page.getByRole('button', { name: 'Save schedule' }));

    await expect(page.getByTestId('schedule-message')).toHaveText(
      'Schedule saved. Existing bookings are kept.',
    );
    const slots = await page.request.get(`/api/v1/doctors/${doctor.id}/slots?date=${TOMORROW}`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
    });
    expect((await slots.json()).slots.map((s: { time: string }) => s.time)).toEqual([
      '08:00',
      '08:30',
    ]);
  });

  test('an overlapping block is refused before saving (FR-3.2)', async ({ page }) => {
    const doctor = await newDoctor(page);
    await loginAsDoctor(page, doctor);
    await page.goto('/dashboard?tab=schedule');

    await choose(page, 'Day', '1');
    await choose(page, 'From', '10:00');
    await choose(page, 'To', '11:00');
    await activate(page.getByRole('button', { name: 'Add', exact: true }));

    await expect(page.getByTestId('block-error')).toContainText('overlaps another block on Monday');
    await expect(page.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
  });

  test('"Discard" brings back the saved schedule', async ({ page }) => {
    const doctor = await newDoctor(page);
    await loginAsDoctor(page, doctor);
    await page.goto('/dashboard?tab=schedule');
    const sunday = page.locator('[data-testid="schedule-day"][data-day="0"]');
    await expect(sunday.getByTestId('block')).toHaveCount(2);

    await sunday.getByTestId('block').first().getByRole('button').click();
    await expect(sunday.getByTestId('block')).toHaveCount(1);
    await activate(page.getByRole('button', { name: 'Discard' }));

    await expect(sunday.getByTestId('block')).toHaveCount(2);
  });
});

test.describe('Doctor dashboard — leave days', () => {
  test('adding a leave day removes that day’s slots for patients (FR-3.3)', async ({ page }) => {
    const doctor = await newDoctor(page);
    await loginAsDoctor(page, doctor);
    await page.goto('/dashboard?tab=leaves');

    await page.getByLabel('Leave date').fill(D3);
    await page.getByRole('button', { name: 'Add leave day' }).click();

    await expect(page.getByTestId('leave-message')).toContainText('is now a leave day.');
    await expect(page.locator(`[data-testid="leave"][data-date="${D3}"]`)).toBeVisible();

    await page.goto(`/doctors/${doctor.id}?date=${D3}`);
    await expect(page.getByTestId('on-leave')).toBeVisible();
  });

  test('warns when bookings already exist on that day', async ({ page }) => {
    const doctor = await newDoctor(page);
    await patientBooks(page, doctor.id, clinicInstant(D3, '10:00'));
    await loginAsDoctor(page, doctor);
    await page.goto('/dashboard?tab=leaves');

    await page.getByLabel('Leave date').fill(D3);
    await page.getByRole('button', { name: 'Add leave day' }).click();

    await expect(page.getByTestId('leave-message')).toContainText(
      '1 existing booking(s) on that day are kept',
    );
  });

  test('the same leave day twice is refused', async ({ page }) => {
    const doctor = await newDoctor(page);
    await loginAsDoctor(page, doctor);
    await page.goto('/dashboard?tab=leaves');
    await page.getByLabel('Leave date').fill(TOMORROW);
    await page.getByRole('button', { name: 'Add leave day' }).click();
    await expect(page.locator(`[data-testid="leave"][data-date="${TOMORROW}"]`)).toBeVisible();

    await page.getByLabel('Leave date').fill(TOMORROW);
    await page.getByRole('button', { name: 'Add leave day' }).click();

    await expect(page.getByTestId('leave-message')).toHaveText('This date is already a leave day.');
  });

  test('removing a leave day makes it a working day again', async ({ page }) => {
    const doctor = await newDoctor(page);
    await loginAsDoctor(page, doctor);
    await page.goto('/dashboard?tab=leaves');
    await page.getByLabel('Leave date').fill(TOMORROW);
    await page.getByRole('button', { name: 'Add leave day' }).click();
    await expect(page.getByTestId('leave')).toHaveCount(1);

    await page.getByTestId('leave').getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByTestId('leave-message')).toContainText('is a working day again');
    await expect(page.getByTestId('no-leaves')).toBeVisible();
  });
});

test.describe('Doctor dashboard — access', () => {
  test('a patient cannot open the dashboard', async ({ page }) => {
    await loginAsNewPatient(page);

    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/$/);
  });

  test('a guest is sent to login', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fdashboard/);
  });
});
