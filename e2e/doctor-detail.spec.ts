import { Page, expect, test } from '@playwright/test';

import { bookAsOtherPatient, loginAsNewPatient, newPatient, registerViaApi } from './support/auth';
import { clinicDate, clinicInstant, dayOfWeek } from './support/dates';
import { EVERY_DAY, createE2eDoctors } from './support/db';

/**
 * Screen 3 — Doctor detail + date picker + slot grid (FR-3.3 to FR-3.5, FR-4.3),
 * end to end with the real API and database, using real dates relative to today.
 */
const RUN = `Zd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SPEC = `E2E Detail ${RUN}`;
const OPEN = `Dr. Open ${RUN}`; // works every day
const ONE_DAY = `Dr. Oneday ${RUN}`; // works only on TOMORROW's weekday
const ON_LEAVE = `Dr. Leave ${RUN}`; // every day, but on leave TOMORROW
const RETIRED = `Dr. Retired ${RUN}`; // inactive

const TOMORROW = clinicDate(1);
const DAY_AFTER = clinicDate(2);

let ids: Awaited<ReturnType<typeof createE2eDoctors>>['doctors'];

test.beforeAll(async () => {
  // Playwright can run beforeAll again in the same worker: create the data only once.
  if (ids) return;
  ({ doctors: ids } = await createE2eDoctors([
    {
      name: SPEC,
      doctors: [
        { name: OPEN, fee: 750, bio: 'General physician.', schedule: EVERY_DAY },
        {
          name: ONE_DAY,
          slotMinutes: 15,
          schedule: [{ dayOfWeek: dayOfWeek(TOMORROW), startTime: '10:00', endTime: '11:00' }],
        },
        { name: ON_LEAVE, schedule: EVERY_DAY, leaves: [TOMORROW] },
        { name: RETIRED, schedule: EVERY_DAY, isActive: false },
      ],
    },
  ]));
});

const slotButton = (page: Page, time: string) =>
  page.getByTestId('slot').filter({ hasText: new RegExp(`^\\s*${time}`) });

async function openDoctor(page: Page, name: string, date?: string) {
  await page.goto(`/doctors/${ids[name]}${date ? `?date=${date}` : ''}`);
  await expect(page.getByTestId('doctor-profile')).toBeVisible();
}

test.describe('Doctor detail — positive scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsNewPatient(page);
  });

  test('opens from the search list with the doctor profile', async ({ page }) => {
    await page.goto(`/doctors?q=${encodeURIComponent(OPEN)}`);

    await page.getByRole('link', { name: `View available slots for ${OPEN}` }).click();

    await expect(page).toHaveURL(new RegExp(`/doctors/${ids[OPEN]}$`));
    await expect(page.getByTestId('doctor-profile')).toContainText(OPEN);
    await expect(page.getByTestId('doctor-profile')).toContainText('₹750');
    await expect(page.getByTestId('doctor-profile')).toContainText('General physician.');
  });

  test('shows tomorrow’s slots grouped by part of the day', async ({ page }) => {
    await openDoctor(page, OPEN, TOMORROW);

    // 09:00–13:00 and 14:00–21:00 with 30-minute slots = 8 + 14
    await expect(page.getByTestId('slot')).toHaveCount(22);
    await expect(page.getByTestId('slots-summary')).toHaveText('22 of 22 slots available');
    await expect(page.locator('.slots h3')).toHaveText(['Morning', 'Afternoon', 'Evening']);
  });

  test('15-minute doctor: 4 slots in one hour (FR-3.4)', async ({ page }) => {
    await openDoctor(page, ONE_DAY, TOMORROW);

    await expect(page.getByTestId('slot')).toHaveText(['10:00', '10:15', '10:30', '10:45']);
  });

  test('picking a day button loads that day and keeps it after a reload', async ({ page }) => {
    await openDoctor(page, ONE_DAY);

    await page.locator(`.day[data-date="${TOMORROW}"]`).click();

    await expect(page).toHaveURL(new RegExp(`date=${TOMORROW}`));
    await expect(page.getByTestId('slot')).toHaveCount(4);

    await page.reload();
    await expect(page.locator(`.day[data-date="${TOMORROW}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('slot')).toHaveCount(4);
  });

  test('the date picker allows today .. today + 30 days (FR-4.3)', async ({ page }) => {
    await openDoctor(page, OPEN);

    const input = page.getByLabel('Or pick a date (up to 30 days ahead)');
    await expect(input).toHaveAttribute('min', clinicDate(0));
    await expect(input).toHaveAttribute('max', clinicDate(30));

    await input.fill(clinicDate(20));
    await expect(page).toHaveURL(new RegExp(`date=${clinicDate(20)}`));
    await expect(page.getByTestId('slot').first()).toBeVisible();
  });

  test('choosing a free slot selects it and enables "Continue to booking"', async ({ page }) => {
    await openDoctor(page, OPEN, TOMORROW);
    const continueButton = page.getByRole('button', { name: 'Continue to booking' });
    await expect(continueButton).toBeDisabled();

    await slotButton(page, '10:30').click();

    await expect(slotButton(page, '10:30')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('selected-slot')).toContainText('10:30');
    await expect(continueButton).toBeEnabled();
  });

  test('changing the day clears the chosen slot', async ({ page }) => {
    await openDoctor(page, OPEN, TOMORROW);
    await slotButton(page, '10:30').click();

    await page.locator(`.day[data-date="${DAY_AFTER}"]`).click();

    await expect(page.getByTestId('selected-slot')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue to booking' })).toBeDisabled();
  });

  test('"Back to doctors" returns to the list', async ({ page }) => {
    await openDoctor(page, OPEN);

    await page.getByRole('link', { name: '← Back to doctors' }).click();

    await expect(page).toHaveURL(/\/doctors$/);
  });
});

test.describe('Doctor detail — negative scenarios', () => {
  test('a slot booked by someone else is shown as Booked and cannot be chosen (FR-4.4)', async ({
    page,
  }) => {
    await bookAsOtherPatient(page, ids[ONE_DAY], clinicInstant(TOMORROW, '10:15'));
    await loginAsNewPatient(page);
    await openDoctor(page, ONE_DAY, TOMORROW);

    const booked = slotButton(page, '10:15');
    await expect(booked).toBeDisabled();
    await expect(booked).toContainText('Booked');
    await expect(page.getByTestId('slots-summary')).toHaveText('3 of 4 slots available');
  });

  test.describe('logged in', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsNewPatient(page);
    });

    test('doctor on leave: explains, no slots (FR-3.3)', async ({ page }) => {
      await openDoctor(page, ON_LEAVE, TOMORROW);

      await expect(page.getByTestId('on-leave')).toContainText(
        `${ON_LEAVE} is on leave on this day`,
      );
      await expect(page.getByTestId('slot')).toHaveCount(0);
    });

    test('a day without schedule: "No slots on this day"', async ({ page }) => {
      await openDoctor(page, ONE_DAY, DAY_AFTER);

      await expect(page.getByTestId('no-slots')).toBeVisible();
    });

    test('a date more than 30 days ahead in the URL falls back to today', async ({ page }) => {
      await openDoctor(page, OPEN, clinicDate(31));

      await expect(page.locator(`.day[data-date="${clinicDate(0)}"]`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    test('a past date in the URL falls back to today', async ({ page }) => {
      await openDoctor(page, OPEN, clinicDate(-3));

      await expect(page.getByTestId('slots-heading')).not.toContainText(clinicDate(-3));
      await expect(page.locator(`.day[data-date="${clinicDate(0)}"]`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    test('an inactive doctor shows "Doctor not found" (FR-2.3)', async ({ page }) => {
      await page.goto(`/doctors/${ids[RETIRED]}`);

      await expect(page.getByTestId('doctor-not-found')).toContainText('Doctor not found');
      await page.getByRole('link', { name: 'Find another doctor' }).click();
      await expect(page).toHaveURL(/\/doctors$/);
    });

    test('an unknown id and a non-number id show "Doctor not found"', async ({ page }) => {
      await page.goto('/doctors/99999999');
      await expect(page.getByTestId('doctor-not-found')).toBeVisible();

      await page.goto('/doctors/abc');
      await expect(page.getByTestId('doctor-not-found')).toBeVisible();
    });

    test('slots fail to load: error and "Try again" recovers', async ({ page }) => {
      await page.route('**/slots?**', (route) => route.fulfill({ status: 500, body: 'oops' }));
      await page.goto(`/doctors/${ids[ONE_DAY]}?date=${TOMORROW}`);
      await expect(page.getByTestId('slots-error')).toContainText('Something went wrong');

      await page.unroute('**/slots?**');
      await page.getByRole('button', { name: 'Try again' }).click();

      await expect(page.getByTestId('slot')).toHaveCount(4);
    });

    test('a booked slot cannot be booked through the API either (409)', async ({ page }) => {
      await bookAsOtherPatient(page, ids[OPEN], clinicInstant(DAY_AFTER, '15:00'));
      const me = newPatient();
      await registerViaApi(page, me);
      const login = await page.request.post('/api/v1/auth/login', {
        data: { email: me.email, password: me.password },
      });
      const token = (await login.json()).accessToken as string;

      const res = await page.request.post('/api/v1/appointments', {
        data: { doctorId: ids[OPEN], startAt: clinicInstant(DAY_AFTER, '15:00') },
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status()).toBe(409);
    });
  });

  test('a guest is sent to login and comes back to the doctor', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);
    await page.goto(`/doctors/${ids[OPEN]}?date=${TOMORROW}`);
    await expect(page).toHaveURL(/\/login\?returnUrl=/);

    await page.getByLabel('Email').fill(patient.email);
    await page.getByLabel('Password', { exact: true }).fill(patient.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page).toHaveURL(new RegExp(`/doctors/${ids[OPEN]}\\?date=${TOMORROW}$`));
    await expect(page.getByTestId('slot').first()).toBeVisible();
  });
});
