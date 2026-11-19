import { Page, expect } from '@playwright/test';

export const PASSWORD = 'Password123';

/** Unique test email per call; matches the cleanup pattern e2e-%@example.com. */
export function uniqueEmail(label = 'user'): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `e2e-${label}-${Date.now()}-${random}@example.com`;
}

export interface NewPatient {
  name: string;
  email: string;
  phone?: string;
  password: string;
}

export function newPatient(overrides: Partial<NewPatient> = {}): NewPatient {
  return { name: 'E2E Patient', email: uniqueEmail(), password: PASSWORD, ...overrides };
}

/** Fills and submits the register form. */
export async function fillRegister(page: Page, patient: NewPatient, confirm = patient.password) {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(patient.name);
  await page.getByLabel('Email').fill(patient.email);
  if (patient.phone) await page.getByLabel('Phone').fill(patient.phone);
  await page.getByLabel('Password', { exact: true }).fill(patient.password);
  await page.getByLabel('Confirm password').fill(confirm);
  await page.getByRole('button', { name: 'Create account' }).click();
}

/** Creates an account through the API (faster than the UI when it is not under test). */
export async function registerViaApi(page: Page, patient: NewPatient): Promise<void> {
  const res = await page.request.post('/api/v1/auth/register', { data: patient });
  expect(res.status(), await res.text()).toBe(201);
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

/**
 * Registers a fresh patient and logs in through the UI.
 * For tests where login itself is not under test.
 */
export async function loginAsNewPatient(page: Page): Promise<NewPatient> {
  const patient = newPatient();
  await registerViaApi(page, patient);
  await login(page, patient.email, patient.password);
  await expect(page.getByTestId('welcome')).toBeVisible();
  return patient;
}
