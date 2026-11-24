import { Page, expect, test } from '@playwright/test';

import {
  SEED_ADMIN,
  bookAsMe,
  bookAsOtherPatient,
  login,
  loginAsNewPatient,
  myToken,
} from './support/auth';
import { clinicDate, clinicInstant } from './support/dates';
import { EVERY_DAY, appointmentsOf, createE2eDoctors, insertAppointment } from './support/db';

/**
 * Screen 5 — My Appointments (FR-6.1) with cancel (FR-5.1, FR-5.3) and reschedule (FR-5.2),
 * end to end with the real API and database.
 */
const RUN = `Zm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SPEC = `E2E Mine ${RUN}`;
const DOC_A = `Dr. Alpha ${RUN}`;
const DOC_B = `Dr. Beta ${RUN}`;

const D2 = clinicDate(2);
const D3 = clinicDate(3);
const D4 = clinicDate(4);

let ids: Record<string, number>;

test.beforeAll(async () => {
  if (ids) return; // beforeAll may run again in the same worker
  ({ doctors: ids } = await createE2eDoctors([
    {
      name: SPEC,
      doctors: [
        { name: DOC_A, schedule: EVERY_DAY },
        { name: DOC_B, schedule: EVERY_DAY },
      ],
    },
  ]));
});

const cards = (page: Page) => page.getByTestId('appointment');
const card = (page: Page, text: string) => cards(page).filter({ hasText: text });
const slotButton = (page: Page, time: string) =>
  page.getByTestId('slot').filter({ hasText: new RegExp(`^\\s*${time}`) });

test.describe('My appointments — positive scenarios', () => {
  test('a new patient sees an empty list with a link to find a doctor', async ({ page }) => {
    await loginAsNewPatient(page);

    await page
      .getByRole('navigation', { name: 'Account' })
      .getByRole('link', { name: 'My appointments' })
      .click();

    await expect(page.getByTestId('no-appointments')).toContainText('no upcoming appointments');
    await page.getByTestId('no-appointments').getByRole('link', { name: 'Find a doctor' }).click();
    await expect(page).toHaveURL(/\/doctors$/);
  });

  test('upcoming appointments are listed soonest first with full details', async ({ page }) => {
    await loginAsNewPatient(page);
    await bookAsMe(page, ids[DOC_B], clinicInstant(D4, '15:00'));
    await bookAsMe(page, ids[DOC_A], clinicInstant(D2, '10:30'));

    await page.goto('/appointments');

    await expect(page.getByRole('tab', { name: 'Upcoming (2)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(cards(page).locator('h2')).toHaveText([DOC_A, DOC_B]);
    await expect(cards(page).first()).toContainText(SPEC);
    await expect(cards(page).first()).toContainText('at 10:30');
    await expect(cards(page).first().getByTestId('status')).toHaveText('Booked');
  });

  test('cancel: asks first, then moves the appointment to Past and frees the slot', async ({
    page,
  }) => {
    const patient = await loginAsNewPatient(page);
    await bookAsMe(page, ids[DOC_A], clinicInstant(D3, '11:00'));
    await page.goto('/appointments');

    await card(page, DOC_A).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('confirm-cancel')).toHaveText('Cancel this appointment?');
    await page.getByRole('button', { name: 'Yes, cancel' }).click();

    await expect(page.getByTestId('notice')).toContainText(`with ${DOC_A}`);
    await expect(page.getByTestId('no-appointments')).toBeVisible();
    await page.getByRole('tab', { name: 'Past (1)' }).click();
    await expect(cards(page).getByTestId('status')).toHaveText('Cancelled');
    expect(await appointmentsOf(patient.email)).toEqual([{ status: 'CANCELLED', count: 1 }]);

    await page.goto(`/doctors/${ids[DOC_A]}?date=${D3}`);
    await expect(slotButton(page, '11:00')).toBeEnabled(); // FR-5.3
  });

  test('"No, keep it" leaves the appointment booked', async ({ page }) => {
    const patient = await loginAsNewPatient(page);
    await bookAsMe(page, ids[DOC_A], clinicInstant(D3, '12:00'));
    await page.goto('/appointments');

    await card(page, DOC_A).getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'No, keep it' }).click();

    await expect(card(page, DOC_A).getByTestId('status')).toHaveText('Booked');
    expect(await appointmentsOf(patient.email)).toEqual([{ status: 'BOOKED', count: 1 }]);
  });

  test('reschedule: pick a new time, the old one is released (FR-5.2)', async ({ page }) => {
    const patient = await loginAsNewPatient(page);
    await bookAsMe(page, ids[DOC_B], clinicInstant(D2, '16:00'));
    await page.goto('/appointments');

    await card(page, DOC_B).getByRole('link', { name: 'Reschedule' }).click();

    await expect(page.getByTestId('current-appointment')).toContainText(`${DOC_B}`);
    await expect(slotButton(page, '16:00')).toContainText('Your time');
    await expect(slotButton(page, '16:00')).toBeDisabled();

    await page.locator(`.day[data-date="${D3}"]`).click();
    await slotButton(page, '17:30').click();
    await expect(page.getByTestId('new-time')).toContainText('17:30');
    await page.getByRole('button', { name: 'Confirm new time' }).click();

    await expect(page).toHaveURL(/\/appointments\?rescheduled=\d+/);
    await expect(page.getByTestId('notice')).toHaveText('Your appointment was rescheduled.');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('at 17:30');
    expect(await appointmentsOf(patient.email)).toEqual([
      { status: 'BOOKED', count: 1 },
      { status: 'CANCELLED', count: 1 },
    ]);

    await page.goto(`/doctors/${ids[DOC_B]}?date=${D2}`);
    await expect(slotButton(page, '16:00')).toBeEnabled();
  });

  test('Past shows completed and missed visits newest first', async ({ page }) => {
    const patient = await loginAsNewPatient(page);
    const day = 24 * 60 * 60 * 1000;
    await insertAppointment(patient.email, ids[DOC_A], new Date(Date.now() - 5 * day), 'COMPLETED');
    await insertAppointment(patient.email, ids[DOC_B], new Date(Date.now() - 2 * day), 'NO_SHOW');

    await page.goto('/appointments?tab=past');

    await expect(cards(page).getByTestId('status')).toHaveText(['Missed', 'Completed']);
    await expect(cards(page).first().getByRole('button')).toHaveCount(0);
  });
});

test.describe('My appointments — negative scenarios', () => {
  test('less than 2 hours before: no Cancel / Reschedule, explains why (FR-5.1)', async ({
    page,
  }) => {
    const patient = await loginAsNewPatient(page);
    await insertAppointment(patient.email, ids[DOC_A], new Date(Date.now() + 60 * 60 * 1000));

    await page.goto('/appointments');

    await expect(card(page, DOC_A).getByTestId('locked')).toContainText('less than 2 hours');
    await expect(card(page, DOC_A).getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(card(page, DOC_A).getByRole('link', { name: 'Reschedule' })).toHaveCount(0);
  });

  test('the API also refuses a cancel less than 2 hours before', async ({ page }) => {
    const patient = await loginAsNewPatient(page);
    const id = await insertAppointment(
      patient.email,
      ids[DOC_A],
      new Date(Date.now() + 30 * 60 * 1000),
    );

    const res = await page.request.post(`/api/v1/appointments/${id}/cancel`, {
      headers: { Authorization: `Bearer ${await myToken(page)}` },
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('CHANGE_WINDOW_PASSED');
  });

  test('cancelled in another tab meanwhile: clear message instead of a crash', async ({ page }) => {
    await loginAsNewPatient(page);
    const id = await bookAsMe(page, ids[DOC_B], clinicInstant(D4, '10:00'));
    await page.goto('/appointments');
    // The list must be on screen BEFORE the "other tab" cancels; otherwise the page may
    // load after the cancel and (correctly) show no Cancel button at all.
    await expect(card(page, DOC_B).getByRole('button', { name: 'Cancel' })).toBeVisible();

    await page.request.post(`/api/v1/appointments/${id}/cancel`, {
      headers: { Authorization: `Bearer ${await myToken(page)}` },
    });
    await card(page, DOC_B).getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Yes, cancel' }).click();

    await expect(page.getByTestId('action-error')).toContainText('can no longer be changed');
  });

  test('reschedule to a slot someone else just took: message, booking kept', async ({ page }) => {
    const patient = await loginAsNewPatient(page);
    const id = await bookAsMe(page, ids[DOC_A], clinicInstant(D2, '09:00'));
    await page.goto(`/appointments/${id}/reschedule?date=${D4}`);
    await slotButton(page, '20:00').click();

    await bookAsOtherPatient(page, ids[DOC_A], clinicInstant(D4, '20:00'));
    await page.getByRole('button', { name: 'Confirm new time' }).click();

    await expect(page.getByTestId('reschedule-error')).toContainText('someone has just booked');
    await expect(slotButton(page, '20:00')).toContainText('Booked'); // grid refreshed
    expect(await appointmentsOf(patient.email)).toEqual([{ status: 'BOOKED', count: 1 }]);
  });

  test('reschedule to a day where I already see this doctor: refused (FR-4.5)', async ({
    page,
  }) => {
    await loginAsNewPatient(page);
    const id = await bookAsMe(page, ids[DOC_B], clinicInstant(D2, '10:00'));
    await bookAsMe(page, ids[DOC_B], clinicInstant(D3, '10:00'));
    await page.goto(`/appointments/${id}/reschedule?date=${D3}`);

    await slotButton(page, '14:00').click();
    await page.getByRole('button', { name: 'Confirm new time' }).click();

    await expect(page.getByTestId('reschedule-error')).toContainText('Only one per day');
  });

  test('a locked appointment cannot be rescheduled by URL', async ({ page }) => {
    const patient = await loginAsNewPatient(page);
    const id = await insertAppointment(
      patient.email,
      ids[DOC_A],
      new Date(Date.now() + 60 * 60 * 1000),
    );

    await page.goto(`/appointments/${id}/reschedule`);

    await expect(page.getByTestId('reschedule-locked')).toContainText('can no longer be changed');
  });

  test("someone else's appointment by URL: 'Appointment not found'", async ({ page }) => {
    const otherPatient = await loginAsNewPatient(page);
    const id = await bookAsMe(page, ids[DOC_A], clinicInstant(D4, '11:00'));
    await page.getByRole('button', { name: 'Log out' }).click();
    expect(otherPatient.email).toBeTruthy();

    await loginAsNewPatient(page);
    await page.goto(`/appointments/${id}/reschedule`);

    await expect(page.getByTestId('reschedule-not-found')).toBeVisible();
  });

  test('an admin cannot open My appointments (patients only)', async ({ page }) => {
    await login(page, SEED_ADMIN.email, SEED_ADMIN.password);
    await expect(page.getByTestId('welcome')).toBeVisible();

    await page.goto('/appointments');

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page
        .getByRole('navigation', { name: 'Account' })
        .getByRole('link', { name: 'My appointments' }),
    ).toHaveCount(0);
  });

  test('server down while loading: error and "Try again"', async ({ page }) => {
    await loginAsNewPatient(page);
    await page.route('**/api/v1/appointments/me', (route) => route.abort('connectionrefused'));

    await page.goto('/appointments');
    await expect(page.getByTestId('appointments-error')).toContainText('Cannot reach the server');

    await page.unroute('**/api/v1/appointments/me');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('no-appointments')).toBeVisible();
  });
});
