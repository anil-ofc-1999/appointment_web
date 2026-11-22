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

/** Logs in through the API and returns the access token (for setting up data). */
export async function tokenViaApi(page: Page, email: string, password: string): Promise<string> {
  const res = await page.request.post('/api/v1/auth/login', { data: { email, password } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).accessToken as string;
}

/** Another patient books a slot through the API, so the slot shows as BOOKED. */
export async function bookAsOtherPatient(page: Page, doctorId: number, startAt: string) {
  const other = newPatient();
  await registerViaApi(page, other);
  const token = await tokenViaApi(page, other.email, other.password);
  const res = await page.request.post('/api/v1/appointments', {
    data: { doctorId, startAt },
    headers: { Authorization: `Bearer ${token}` },
  });
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

/** Seed accounts (prisma/seed.js in appointment_node_API; local test data only). */
export const SEED_ADMIN = { email: 'admin@example.com', password: 'Password123' };

/** The access token of the user logged in on this page. */
export function myToken(page: Page): Promise<string> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('appointment.session') ?? '{}').accessToken as string,
  );
}

/** Books through the API as the user logged in on this page; returns the appointment id. */
export async function bookAsMe(page: Page, doctorId: number, startAt: string): Promise<number> {
  const res = await page.request.post('/api/v1/appointments', {
    data: { doctorId, startAt },
    headers: { Authorization: `Bearer ${await myToken(page)}` },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).appointment.id as number;
}

export interface DoctorAccount {
  id: number;
  name: string;
  email: string;
  password: string;
  token: string;
}

/**
 * Creates a doctor account the way an admin does (POST /doctors as the seed admin) and
 * gives it a weekly schedule. The email matches the E2E cleanup pattern.
 */
export async function createDoctorAccount(
  page: Page,
  specializationId: number,
  name: string,
  schedule: { dayOfWeek: number; startTime: string; endTime: string }[],
): Promise<DoctorAccount> {
  const adminToken = await tokenViaApi(page, SEED_ADMIN.email, SEED_ADMIN.password);
  const email = uniqueEmail('doctor');
  const res = await page.request.post('/api/v1/doctors', {
    data: { name, email, password: PASSWORD, specializationId, fee: 500, slotMinutes: 30 },
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(res.status(), await res.text()).toBe(201);
  const id = (await res.json()).doctor.id as number;
  const token = await tokenViaApi(page, email, PASSWORD);
  const put = await page.request.put('/api/v1/doctors/me/schedule', {
    data: { blocks: schedule },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(put.status(), await put.text()).toBe(200);
  return { id, name, email, password: PASSWORD, token };
}
