import { Page, expect, test } from '@playwright/test';

import { SEED_ADMIN, bookAsOtherPatient, login, loginAsNewPatient } from './support/auth';
import { clinicDate, clinicInstant } from './support/dates';
import { EVERY_DAY, appointmentsOf, createE2eDoctors } from './support/db';

/**
 * Screen 4 — Booking confirmation (FR-4.1 to FR-4.7), the whole patient journey,
 * end to end with the real API and database.
 */
const RUN = `Zb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SPEC = `E2E Booking ${RUN}`;
const DOC = `Dr. Book ${RUN}`;
const OTHER = `Dr. Second ${RUN}`;

const TOMORROW = clinicDate(1);
const DAY2 = clinicDate(2);

let ids: Record<string, number>;

test.beforeAll(async () => {
  // Playwright can run beforeAll again in the same worker: create the data only once.
  if (ids) return;
  ({ doctors: ids } = await createE2eDoctors([
    {
      name: SPEC,
      doctors: [
        { name: DOC, fee: 650, schedule: EVERY_DAY },
        { name: OTHER, schedule: EVERY_DAY },
      ],
    },
  ]));
});

const slotButton = (page: Page, time: string) =>
  page.getByTestId('slot').filter({ hasText: new RegExp(`^\\s*${time}`) });

/** Doctor detail -> slot -> "Continue to booking". */
async function pickSlot(page: Page, doctor: string, date: string, time: string) {
  await page.goto(`/doctors/${ids[doctor]}?date=${date}`);
  await slotButton(page, time).click();
  await page.getByRole('button', { name: 'Continue to booking' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your appointment' })).toBeVisible();
}

test.describe('Booking — positive scenarios', () => {
  test('full journey: search → doctor → slot → confirm → booked', async ({ page }) => {
    const patient = await loginAsNewPatient(page);

    await page
      .getByRole('navigation', { name: 'Account' })
      .getByRole('link', { name: 'Find a doctor' })
      .click();
    await page.getByLabel('Doctor name').fill(DOC);
    await page.getByRole('link', { name: `View available slots for ${DOC}` }).click();
    await page.locator(`.day[data-date="${TOMORROW}"]`).click();
    await slotButton(page, '10:30').click();
    await page.getByRole('button', { name: 'Continue to booking' }).click();

    const summary = page.getByTestId('booking-summary');
    await expect(summary).toContainText(DOC);
    await expect(summary).toContainText(SPEC);
    await expect(summary).toContainText('10:30 (30 minutes)');
    await expect(summary).toContainText('₹650');

    await page.getByRole('button', { name: 'Confirm booking' }).click();

    await expect(page.getByTestId('booking-success')).toContainText('Appointment booked');
    await expect(page.getByTestId('booked-status')).toHaveText('BOOKED');
    expect(await appointmentsOf(patient.email)).toEqual([{ status: 'BOOKED', count: 1 }]);
  });

  test('after booking, the slot shows as Booked for everyone (FR-4.4)', async ({ page }) => {
    await loginAsNewPatient(page);
    await pickSlot(page, DOC, DAY2, '11:00');
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByTestId('booking-success')).toBeVisible();

    await page.goto(`/doctors/${ids[DOC]}?date=${DAY2}`);

    await expect(slotButton(page, '11:00')).toBeDisabled();
    await expect(slotButton(page, '11:00')).toContainText('Booked');
  });

  test('"Back" returns to the same doctor and date', async ({ page }) => {
    await loginAsNewPatient(page);
    await pickSlot(page, DOC, DAY2, '16:00');

    await page.getByRole('link', { name: 'Back' }).click();

    await expect(page).toHaveURL(new RegExp(`/doctors/${ids[DOC]}\\?date=${DAY2}$`));
  });

  test('"Book another" goes back to the doctor list', async ({ page }) => {
    await loginAsNewPatient(page);
    await pickSlot(page, OTHER, TOMORROW, '17:00');
    await page.getByRole('button', { name: 'Confirm booking' }).click();

    await page.getByRole('link', { name: 'Book another' }).click();

    await expect(page).toHaveURL(/\/doctors$/);
  });

  test('a double click books only once', async ({ page }) => {
    const patient = await loginAsNewPatient(page);
    await pickSlot(page, OTHER, DAY2, '18:00');

    await page.getByRole('button', { name: 'Confirm booking' }).dblclick();

    await expect(page.getByTestId('booking-success')).toBeVisible();
    expect(await appointmentsOf(patient.email)).toEqual([{ status: 'BOOKED', count: 1 }]);
  });
});

test.describe('Booking — negative scenarios', () => {
  test('someone else books the slot first: clear message and "Choose another slot"', async ({
    page,
  }) => {
    const patient = await loginAsNewPatient(page);
    await pickSlot(page, DOC, TOMORROW, '12:00');

    await bookAsOtherPatient(page, ids[DOC], clinicInstant(TOMORROW, '12:00'));
    await page.getByRole('button', { name: 'Confirm booking' }).click();

    await expect(page.getByTestId('booking-error')).toContainText(
      'someone has just booked this slot',
    );
    await expect(page.getByRole('button', { name: 'Confirm booking' })).toBeDisabled();
    expect(await appointmentsOf(patient.email)).toEqual([]);

    await page.getByRole('link', { name: 'Choose another slot' }).click();
    await expect(slotButton(page, '12:00')).toBeDisabled();
  });

  test('a second booking with the same doctor the same day is refused (FR-4.5)', async ({
    page,
  }) => {
    const patient = await loginAsNewPatient(page);
    await pickSlot(page, OTHER, TOMORROW, '09:00');
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByTestId('booking-success')).toBeVisible();

    await pickSlot(page, OTHER, TOMORROW, '20:00');
    await page.getByRole('button', { name: 'Confirm booking' }).click();

    await expect(page.getByTestId('booking-error')).toContainText('Only one per day');
    await expect(page.getByRole('link', { name: 'See my appointments' })).toBeVisible();
    expect(await appointmentsOf(patient.email)).toEqual([{ status: 'BOOKED', count: 1 }]);
  });

  test('an admin cannot book (FR-4.1): explains, no button to press', async ({ page }) => {
    await login(page, SEED_ADMIN.email, SEED_ADMIN.password);
    await expect(page.getByTestId('welcome')).toBeVisible();

    await page.goto(`/doctors/${ids[DOC]}/book?startAt=${clinicInstant(DAY2, '19:00')}`);

    await expect(page.getByTestId('not-patient')).toContainText('Only patients can book');
    await expect(page.getByRole('button', { name: 'Confirm booking' })).toBeDisabled();
  });

  test.describe('logged in patient', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsNewPatient(page);
    });

    test('a link with a past time: "This slot cannot be booked"', async ({ page }) => {
      await page.goto(
        `/doctors/${ids[DOC]}/book?startAt=${clinicInstant(clinicDate(-1), '10:00')}`,
      );

      await expect(page.getByTestId('invalid-slot')).toContainText('This slot cannot be booked');
    });

    test('a link more than 30 days ahead: "This slot cannot be booked"', async ({ page }) => {
      await page.goto(
        `/doctors/${ids[DOC]}/book?startAt=${clinicInstant(clinicDate(40), '10:00')}`,
      );

      await expect(page.getByTestId('invalid-slot')).toBeVisible();
    });

    test('a hand-made link to a time the doctor does not work: refused by the API', async ({
      page,
    }) => {
      await page.goto(`/doctors/${ids[DOC]}/book?startAt=${clinicInstant(DAY2, '13:30')}`);
      await page.getByRole('button', { name: 'Confirm booking' }).click();

      await expect(page.getByTestId('booking-error')).toContainText('does not work at this time');
    });

    test('a broken link (no time) offers to choose a slot', async ({ page }) => {
      await page.goto(`/doctors/${ids[DOC]}/book`);

      await page.getByRole('link', { name: 'Choose a slot' }).click();
      await expect(page).toHaveURL(new RegExp(`/doctors/${ids[DOC]}$`));
    });

    test('an unknown doctor: "Doctor not found"', async ({ page }) => {
      await page.goto(`/doctors/99999999/book?startAt=${clinicInstant(DAY2, '10:00')}`);

      await expect(page.getByTestId('booking-doctor-not-found')).toBeVisible();
    });

    test('server down while confirming: message, then retry works', async ({ page }) => {
      await pickSlot(page, DOC, DAY2, '20:30');
      await page.route('**/api/v1/appointments', (route) => route.abort('connectionrefused'));

      await page.getByRole('button', { name: 'Confirm booking' }).click();
      await expect(page.getByTestId('booking-error')).toContainText('Cannot reach the server');

      await page.unroute('**/api/v1/appointments');
      await page.getByRole('button', { name: 'Confirm booking' }).click();
      await expect(page.getByTestId('booking-success')).toBeVisible();
    });
  });

  test('a guest opening a booking link must log in first', async ({ page }) => {
    await page.goto(`/doctors/${ids[DOC]}/book?startAt=${clinicInstant(DAY2, '10:00')}`);

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fdoctors/);
  });
});
