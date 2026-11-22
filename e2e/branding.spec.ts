import { expect, test } from '@playwright/test';

/** App icon, background artwork and the public home page (no login needed). */

test('the browser tab uses our own SVG icon (not Angular’s default)', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'favicon.svg');
  const icon = await page.request.get('/favicon.svg');
  expect(icon.status()).toBe(200);
  expect(await icon.text()).toContain('<svg');
  expect((await page.request.get('/favicon.ico')).status()).not.toBe(200);
});

test('artwork files are served', async ({ page }) => {
  for (const file of ['/hero.svg', '/bg-pattern.svg']) {
    const res = await page.request.get(file);
    expect(res.status(), file).toBe(200);
  }
});

test('home page: logo, headline, calls to action and the 3 steps', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.brand img')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    "Book a doctor's appointment in minutes",
  );
  await expect(page.locator('.features h2')).toHaveText([
    'Find a doctor',
    'Pick a free slot',
    'Booked',
  ]);
  await expect(page.getByRole('status')).toContainText('online');

  await page.locator('.cta').getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/register$/);
});

test('login page: the card and its "Log in" button are visible on the background', async ({
  page,
}) => {
  await page.goto('/login');

  await expect(page.locator('.auth-card')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
  expect(background).toContain('bg-pattern.svg');
});
