import { Locator, Page, expect, test } from '@playwright/test';

import { SEED_ADMIN, createDoctorAccount, login, loginAsNewPatient } from './support/auth';
import { createE2eDoctors } from './support/db';

/**
 * D-36: the admin edits a doctor's weekly working hours (Admin → Doctors → Working hours),
 * end to end. Uses its own e2e doctor; never the seed doctors.
 */
const RUN = `Zh${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SPEC = `E2E Hours ${RUN}`;
const MONDAY_ONLY = [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }];

let specId: number;
let ready = false;

test.beforeAll(async () => {
  if (ready) return; // beforeAll may run again in the same worker
  ready = true;
  ({
    specializations: { [SPEC]: specId },
  } = await createE2eDoctors([{ name: SPEC, doctors: [] }]));
});

/** Picks a dropdown value, then closes the phone's picker (see doctor-dashboard.spec). */
async function choose(scope: Locator, label: string, value: string) {
  const field = scope.getByLabel(label, { exact: true });
  await field.selectOption(value);
  await field.blur();
}

/** Keyboard press: on the emulated phone, taps after a dropdown land one row off. */
async function activate(button: Locator) {
  await button.focus();
  await button.press('Enter');
}

async function openHours(page: Page, doctorName: string) {
  await login(page, SEED_ADMIN.email, SEED_ADMIN.password);
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.goto('/admin?tab=doctors');
  const card = page.getByTestId('admin-doctor').filter({ hasText: doctorName });
  await card.getByRole('button', { name: 'Working hours' }).click();
  const panel = card.getByTestId('hours-panel');
  await expect(panel.getByTestId('schedule-day')).toHaveCount(7);
  return panel;
}

test.describe('Admin working hours — positive', () => {
  test('admin adds hours; the doctor sees the same hours on their dashboard', async ({
    page,
    browser,
  }) => {
    const name = `Dr. Aaahours ${RUN}a`;
    const doctor = await createDoctorAccount(page, specId, name, MONDAY_ONLY);
    const panel = await openHours(page, name);
    await expect(panel.getByTestId('block')).toHaveText(['09:00–12:00 ✕']);

    await choose(panel, 'Day', '3'); // Wednesday
    await choose(panel, 'From', '14:00');
    await choose(panel, 'To', '18:00');
    await activate(panel.getByRole('button', { name: 'Add', exact: true }));
    await activate(panel.getByRole('button', { name: 'Save schedule' }));

    await expect(panel.getByTestId('schedule-message')).toHaveText(
      'Schedule saved. Existing bookings are kept.',
    );
    const other = await browser.newContext();
    const doctorPage = await other.newPage();
    await login(doctorPage, doctor.email, doctor.password);
    await expect(doctorPage.getByTestId('welcome')).toBeVisible();
    await doctorPage.goto('/dashboard?tab=schedule');
    const wednesday = doctorPage.locator('[data-testid="schedule-day"][data-day="3"]');
    await expect(wednesday.getByTestId('block')).toHaveText(['14:00–18:00 ✕']);
    await other.close();
  });

  test('removing all hours hides the doctor from booking (no slots)', async ({ page }) => {
    const name = `Dr. Aaahours ${RUN}b`;
    const doctor = await createDoctorAccount(page, specId, name, MONDAY_ONLY);
    const panel = await openHours(page, name);

    await panel.getByRole('button', { name: 'Remove Monday 09:00 to 12:00' }).click();
    await panel.getByRole('button', { name: 'Save schedule' }).click();
    await expect(panel.getByTestId('schedule-message')).toContainText('Schedule saved');

    await page.getByRole('button', { name: 'Log out' }).click();
    await loginAsNewPatient(page);
    const res = await page.request.get(`/api/v1/doctors/${doctor.id}/slots?date=2030-01-07`, {
      headers: {
        Authorization: `Bearer ${await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('appointment.session') ?? '{}').accessToken as string,
        )}`,
      },
    });
    expect((await res.json()).slots ?? []).toEqual([]);
  });
});

test.describe('Admin working hours — negative', () => {
  test('an overlapping block is refused before saving', async ({ page }) => {
    const name = `Dr. Aaahours ${RUN}c`;
    await createDoctorAccount(page, specId, name, MONDAY_ONLY);
    const panel = await openHours(page, name);

    await choose(panel, 'Day', '1');
    await choose(panel, 'From', '11:00');
    await choose(panel, 'To', '13:00');
    await activate(panel.getByRole('button', { name: 'Add', exact: true }));

    await expect(panel.getByTestId('block-error')).toHaveText(
      'This overlaps another block on Monday.',
    );
    await expect(panel.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
  });

  test('a doctor cannot change another doctor’s hours through the API (403)', async ({ page }) => {
    const a = await createDoctorAccount(page, specId, `Dr. Aaahours ${RUN}d`, MONDAY_ONLY);
    const b = await createDoctorAccount(page, specId, `Dr. Aaahours ${RUN}e`, MONDAY_ONLY);

    const res = await page.request.put(`/api/v1/doctors/${b.id}/schedule`, {
      data: { blocks: [] },
      headers: { Authorization: `Bearer ${a.token}` },
    });

    expect(res.status()).toBe(403);
  });
});
