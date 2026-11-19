import { Page, expect, test } from '@playwright/test';

import { loginAsNewPatient, newPatient, registerViaApi } from './support/auth';
import { createE2eDoctors } from './support/db';

/**
 * Screen 2 — Doctor search (FR-2.3 to FR-2.5), end to end with the real API and database.
 * Each run creates its own doctors whose names contain a unique RUN code, and searches
 * for that code — so the tests never depend on (or touch) the seed doctors.
 */
// Unique per worker (each parallel worker creates its own data).
const RUN = `Zq${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CARDIO = `E2E Cardio ${RUN}`;
const DERMA = `E2E Derma ${RUN}`;
const RETIRED = `E2E Retired ${RUN}`; // inactive specialization

const ARJUN = `Dr. Arjun ${RUN} Rao`;
const MEERA = `Dr. Meera ${RUN} Iyer`;
const KIRAN = `Dr. Kiran ${RUN} Shah`;
const LAKSHMI = `Dr. Lakshmi ${RUN} Rao`;
const HIDDEN = `Dr. Hidden ${RUN} Inactive`;
const RETIRED_DOC = `Dr. Old ${RUN} Spec`;
/** 11 extra doctors in one specialization, to get 2 pages (10 per page). */
const MANY = Array.from(
  { length: 11 },
  (_, i) => `Dr. Page${String(i + 1).padStart(2, '0')} ${RUN}`,
);
const PAGED = `E2E Paged ${RUN}`;

let ids: Awaited<ReturnType<typeof createE2eDoctors>>;

test.beforeAll(async () => {
  ids = await createE2eDoctors([
    {
      name: CARDIO,
      doctors: [
        { name: ARJUN, fee: 800 },
        { name: MEERA, bio: 'Heart specialist with 10 years of experience.' },
        { name: HIDDEN, isActive: false },
      ],
    },
    { name: DERMA, doctors: [{ name: KIRAN, slotMinutes: 15 }, { name: LAKSHMI }] },
    { name: RETIRED, isActive: false, doctors: [{ name: RETIRED_DOC }] },
    { name: PAGED, doctors: MANY.map((name) => ({ name })) },
  ]);
});

const cards = (page: Page) => page.getByTestId('doctor-card').locator('h2');
const searchBox = (page: Page) => page.getByLabel('Doctor name');
const specialization = (page: Page) => page.getByLabel('Specialization');

async function search(page: Page, text: string) {
  await searchBox(page).fill(text);
  await searchBox(page).press('Enter');
}

test.describe('Doctor search — positive scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsNewPatient(page);
  });

  test('opens from the top bar and lists doctors', async ({ page }) => {
    await page
      .getByRole('navigation', { name: 'Account' })
      .getByRole('link', { name: 'Find a doctor' })
      .click();

    await expect(page).toHaveURL(/\/doctors$/);
    await expect(page.getByRole('heading', { name: 'Find a doctor' })).toBeVisible();
    await expect(page.getByTestId('result-count')).toContainText('found');
    await expect(cards(page).first()).toBeVisible();
  });

  test('searches by part of a name, in any case', async ({ page }) => {
    await page.goto('/doctors');

    await search(page, `${RUN.toUpperCase()} rao`);

    await expect(cards(page)).toHaveText([ARJUN, LAKSHMI]);
    await expect(page.getByTestId('result-count')).toHaveText('2 doctors found');
  });

  test('searches while typing (no Enter needed)', async ({ page }) => {
    await page.goto('/doctors');

    await searchBox(page).fill(`Meera ${RUN}`); // no Enter: results come after a short pause

    await expect(cards(page)).toHaveText([MEERA]);
    await expect(page).toHaveURL(new RegExp(`q=Meera`));
  });

  test('filters by specialization', async ({ page }) => {
    await page.goto('/doctors');

    await specialization(page).selectOption({ label: DERMA });

    await expect(cards(page)).toHaveText([KIRAN, LAKSHMI]);
    await expect(page).toHaveURL(new RegExp(`specializationId=${ids.specializations[DERMA]}`));
  });

  test('combines specialization and name', async ({ page }) => {
    await page.goto('/doctors');
    await specialization(page).selectOption({ label: DERMA });
    await expect(cards(page)).toHaveCount(2);

    await search(page, `${RUN} Rao`);

    await expect(cards(page)).toHaveText([LAKSHMI]);
    await expect(page.getByTestId('result-count')).toHaveText('1 doctor found');
  });

  test('shows specialization, fee, slot length and bio on the card', async ({ page }) => {
    await page.goto('/doctors');
    await search(page, RUN);

    const arjun = page.getByTestId('doctor-card').filter({ hasText: ARJUN });
    await expect(arjun).toContainText(CARDIO);
    await expect(arjun).toContainText('₹800');
    await expect(arjun).toContainText('30 min slots');

    const kiran = page.getByTestId('doctor-card').filter({ hasText: KIRAN });
    await expect(kiran).toContainText('15 min slots');

    const meera = page.getByTestId('doctor-card').filter({ hasText: MEERA });
    await expect(meera).toContainText('Heart specialist');
  });

  test('each card links to that doctor', async ({ page }) => {
    await page.goto('/doctors');
    await search(page, `Meera ${RUN}`);

    await expect(
      page.getByRole('link', { name: `View available slots for ${MEERA}` }),
    ).toHaveAttribute('href', `/doctors/${ids.doctors[MEERA]}`);
  });

  test('pages through results with Next and Previous', async ({ page }) => {
    await page.goto(`/doctors?specializationId=${ids.specializations[PAGED]}`);

    await expect(page.getByTestId('result-count')).toHaveText('11 doctors found');
    await expect(cards(page)).toHaveCount(10);
    await expect(page.getByTestId('page-info')).toHaveText('Page 1 of 2');
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await page.getByRole('button', { name: 'Next' }).click();

    await expect(cards(page)).toHaveText([MANY[10]]);
    await expect(page.getByTestId('page-info')).toHaveText('Page 2 of 2');
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();

    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(cards(page)).toHaveCount(10);
  });

  test('keeps the search after a reload and with the Back button', async ({ page }) => {
    await page.goto('/doctors');
    await search(page, `${RUN} Shah`);
    await expect(cards(page)).toHaveText([KIRAN]);

    await page.reload();
    await expect(searchBox(page)).toHaveValue(`${RUN} Shah`);
    await expect(cards(page)).toHaveText([KIRAN]);

    await specialization(page).selectOption({ label: CARDIO });
    await expect(page.getByTestId('no-results')).toBeVisible();

    await page.goBack();
    await expect(cards(page)).toHaveText([KIRAN]);
  });

  test('"Clear filters" shows everyone again', async ({ page }) => {
    await page.goto(`/doctors?q=${RUN}&specializationId=${ids.specializations[CARDIO]}`);
    await expect(cards(page)).toHaveCount(2);

    await page.getByRole('button', { name: 'Clear filters' }).click();

    await expect(page).toHaveURL(/\/doctors$/);
    await expect(searchBox(page)).toHaveValue('');
    await expect(specialization(page)).toHaveValue('');
  });
});

test.describe('Doctor search — negative scenarios', () => {
  test('a guest is sent to login, and comes back after logging in', async ({ page }) => {
    const patient = newPatient();
    await registerViaApi(page, patient);

    await page.goto(`/doctors?q=${RUN}`);
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fdoctors%3Fq%3D/);

    await page.getByLabel('Email').fill(patient.email);
    await page.getByLabel('Password', { exact: true }).fill(patient.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page).toHaveURL(new RegExp(`/doctors\\?q=${RUN}$`));
    await expect(searchBox(page)).toHaveValue(RUN);
    await expect(cards(page).first()).toBeVisible();
  });

  test.describe('logged in', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsNewPatient(page);
    });

    test('a name that matches nobody shows "No doctors found"', async ({ page }) => {
      await page.goto('/doctors');

      await search(page, `nobody ${RUN}`);

      await expect(page.getByTestId('no-results')).toContainText(
        `No doctors found for “nobody ${RUN}”`,
      );
      await page.getByRole('button', { name: 'Show all doctors' }).click();
      await expect(cards(page).first()).toBeVisible();
    });

    test('an inactive doctor is not shown (FR-2.3)', async ({ page }) => {
      await page.goto('/doctors');

      await search(page, `Hidden ${RUN}`);

      await expect(page.getByTestId('no-results')).toBeVisible();
    });

    test('an inactive specialization is not in the dropdown, and its doctors are hidden', async ({
      page,
    }) => {
      await page.goto('/doctors');
      await expect(specialization(page).locator('option', { hasText: CARDIO })).toHaveCount(1);
      await expect(specialization(page).locator('option', { hasText: RETIRED })).toHaveCount(0);

      await search(page, `Old ${RUN}`);
      await expect(page.getByTestId('no-results')).toBeVisible();

      await page.goto(`/doctors?specializationId=${ids.specializations[RETIRED]}`);
      await expect(page.getByTestId('no-results')).toBeVisible();
    });

    test('% and _ are searched as plain text, not wildcards', async ({ page }) => {
      await page.goto('/doctors');

      await search(page, '%');
      await expect(page.getByTestId('no-results')).toBeVisible();

      await search(page, '_');
      await expect(page.getByTestId('no-results')).toBeVisible();
    });

    test('SQL-looking text is just a search with no results', async ({ page }) => {
      await page.goto('/doctors');

      await search(page, "' OR 1=1 --");

      await expect(page.getByTestId('no-results')).toBeVisible();
    });

    test('a search of only spaces shows all doctors', async ({ page }) => {
      await page.goto('/doctors');

      await search(page, '     ');

      await expect(page).toHaveURL(/\/doctors$/);
      await expect(cards(page).first()).toBeVisible();
    });

    test('the search box stops at 100 characters', async ({ page }) => {
      await page.goto('/doctors');

      await searchBox(page).fill('a'.repeat(150));

      await expect(searchBox(page)).toHaveValue('a'.repeat(100));
    });

    test('broken values in the URL are ignored instead of breaking the page', async ({ page }) => {
      await page.goto('/doctors?page=-5&specializationId=abc');

      await expect(page.getByTestId('result-count')).toBeVisible();
      await expect(page.getByTestId('search-error')).toHaveCount(0);
    });

    test('a page number past the end offers to go back to page 1', async ({ page }) => {
      await page.goto(`/doctors?specializationId=${ids.specializations[DERMA]}&page=50`);

      await expect(page.getByTestId('page-out-of-range')).toBeVisible();
      await page.getByRole('button', { name: 'Go to the first page' }).click();
      await expect(cards(page)).toHaveText([KIRAN, LAKSHMI]);
    });

    test('server down: shows an error and "Try again" recovers', async ({ page }) => {
      await page.goto('/doctors');
      await expect(cards(page).first()).toBeVisible();

      await page.route('**/api/v1/doctors?**', (route) => route.abort('connectionrefused'));
      await search(page, RUN);
      await expect(page.getByTestId('search-error')).toContainText('Cannot reach the server');

      await page.unroute('**/api/v1/doctors?**');
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(cards(page).first()).toBeVisible();
    });

    test('server error 500: shows a friendly message', async ({ page }) => {
      await page.route('**/api/v1/doctors?**', (route) =>
        route.fulfill({ status: 500, body: 'Internal Server Error' }),
      );

      await page.goto('/doctors');

      await expect(page.getByTestId('search-error')).toContainText('Something went wrong');
    });

    test('specializations fail to load: name search still works', async ({ page }) => {
      await page.route('**/api/v1/specializations', (route) => route.fulfill({ status: 503 }));

      await page.goto('/doctors');
      await expect(page.getByTestId('specializations-error')).toBeVisible();

      await search(page, `Kiran ${RUN}`);
      await expect(cards(page)).toHaveText([KIRAN]);
    });

    test('session expired while searching: sent to login with a message', async ({ page }) => {
      await page.goto('/doctors');
      await expect(cards(page).first()).toBeVisible();

      await page.route('**/api/v1/doctors?**', (route) =>
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'TOKEN_EXPIRED', message: 'expired' } }),
        }),
      );
      await search(page, RUN);

      await expect(page).toHaveURL(/\/login\?.*reason=expired/);
      await expect(page.getByTestId('reason-message')).toContainText('session has expired');
    });
  });
});
