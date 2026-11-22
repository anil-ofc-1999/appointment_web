import { Page, expect, test } from '@playwright/test';

import {
  SEED_ADMIN,
  bookAsMe,
  createDoctorAccount,
  login,
  loginAsNewPatient,
} from './support/auth';
import { clinicDate, clinicInstant } from './support/dates';
import { EVERY_DAY, createE2eDoctors } from './support/db';

/**
 * Responsive layout: every page and tab at 4 screen widths. A page fails when anything
 * sticks out sideways (horizontal scroll), the usual sign of a broken phone layout.
 * Screenshots are attached to the HTML report (npm run e2e:report) for a visual check.
 */
const WIDTHS = [
  { name: 'phone', width: 360, height: 780 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
];

const RUN = `Zr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SPEC = `E2E Responsive ${RUN}`;
const DOC = `Dr. Responsive ${RUN} With A Rather Long Name`;
const DAY = clinicDate(2);

let ids: Awaited<ReturnType<typeof createE2eDoctors>>;

test.beforeAll(async () => {
  if (ids) return; // beforeAll may run again in the same worker
  ids = await createE2eDoctors([
    {
      name: SPEC,
      doctors: [{ name: DOC, fee: 1250.5, schedule: EVERY_DAY, bio: 'Long bio. '.repeat(20) }],
    },
  ]);
});

// Viewports are set per check; the separate "mobile" project would only repeat this.
test.beforeEach(() => {
  test.skip(test.info().project.name === 'mobile', 'covered by the widths below');
});

async function checkAllWidths(page: Page, label: string) {
  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(150); // let the layout settle
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const wide = [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
        .filter((el) => !el.closest('.table-wrap')) // tables scroll inside their own box
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
      return { scroll: doc.scrollWidth - doc.clientWidth, wide };
    });
    await test.info().attach(`${label} @ ${size.name} ${size.width}px`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    expect(
      overflow.scroll,
      `${label} at ${size.width}px sticks out: ${overflow.wide.join(', ')}`,
    ).toBeLessThanOrEqual(0);
  }
}

test('public pages', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await checkAllWidths(page, 'home (guest)');

  await page.goto('/login');
  await checkAllWidths(page, 'login');

  await page.goto('/register');
  await checkAllWidths(page, 'register');
});

test('patient pages', async ({ page }) => {
  await loginAsNewPatient(page);
  await checkAllWidths(page, 'home (patient)');

  await page.goto(`/doctors?q=${encodeURIComponent(RUN)}`);
  await expect(page.getByTestId('doctor-card').first()).toBeVisible();
  await checkAllWidths(page, 'doctor search');

  await page.goto(`/doctors/${ids.doctors[DOC]}?date=${DAY}`);
  await expect(page.getByTestId('slot').first()).toBeVisible();
  await page.getByTestId('slot').first().click();
  await checkAllWidths(page, 'doctor detail + slot grid');

  await page.goto(`/doctors/${ids.doctors[DOC]}/book?startAt=${clinicInstant(DAY, '15:00')}`);
  await expect(page.getByTestId('booking-summary')).toBeVisible();
  await checkAllWidths(page, 'booking confirmation');

  const id = await bookAsMe(page, ids.doctors[DOC], clinicInstant(DAY, '16:00'));
  await page.goto('/appointments');
  await expect(page.getByTestId('appointment').first()).toBeVisible();
  await checkAllWidths(page, 'my appointments');

  await page.goto(`/appointments/${id}/reschedule`);
  await expect(page.getByTestId('slot').first()).toBeVisible();
  await checkAllWidths(page, 'reschedule');
});

test('doctor dashboard', async ({ page }) => {
  const doctor = await createDoctorAccount(
    page,
    ids.specializations[SPEC],
    `Dr. Dash ${RUN}`,
    EVERY_DAY,
  );
  await login(page, doctor.email, doctor.password);
  await expect(page.getByTestId('welcome')).toBeVisible();

  for (const tab of ['', '?tab=schedule', '?tab=leaves']) {
    await page.goto(`/dashboard${tab}`);
    await expect(page.getByRole('heading', { name: 'Doctor dashboard' })).toBeVisible();
    await checkAllWidths(page, `dashboard ${tab || 'appointments'}`);
  }
});

test('admin panel', async ({ page }) => {
  await login(page, SEED_ADMIN.email, SEED_ADMIN.password);
  await expect(page.getByTestId('welcome')).toBeVisible();

  for (const tab of ['', '?tab=doctors', '?tab=specializations']) {
    await page.goto(`/admin${tab}`);
    await expect(page.getByRole('heading', { name: 'Admin panel' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await checkAllWidths(page, `admin ${tab || 'appointments'}`);
  }
  await page.goto('/admin?tab=doctors');
  await page.getByRole('button', { name: 'Add doctor' }).click();
  await checkAllWidths(page, 'admin add-doctor form');
});
