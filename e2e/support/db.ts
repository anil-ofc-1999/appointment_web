import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import pg from 'pg';

/** Every user created by E2E tests uses this pattern, so cleanup never touches real data. */
export const E2E_EMAIL_LIKE = 'e2e-%@example.com';

function databaseUrl(): string {
  if (!process.env['DATABASE_URL']) {
    const envFile = resolve(process.env['API_DIR'] ?? '../appointment_node_API', '.env');
    if (existsSync(envFile)) process.loadEnvFile(envFile);
  }
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set (and no API .env file was found).');
  return url;
}

async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Every specialization created by E2E tests starts with this, so cleanup never touches real data. */
export const E2E_SPECIALIZATION_LIKE = 'E2E %';

/**
 * Removes all E2E test data: doctors (their schedules/leaves cascade), users and
 * specializations. E2E data never has appointments.
 */
export function deleteE2eUsers(): Promise<number> {
  return withClient(async (client) => {
    const e2eUsers = 'SELECT id FROM users WHERE email LIKE $1';
    const e2eDoctors = `SELECT id FROM doctors WHERE user_id IN (${e2eUsers})`;
    // Appointments first (their audit rows cascade), then doctors, users, specializations.
    await client.query(`DELETE FROM appointment_audit WHERE changed_by IN (${e2eUsers})`, [
      E2E_EMAIL_LIKE,
    ]);
    await client.query(
      `DELETE FROM appointments WHERE patient_id IN (${e2eUsers}) OR doctor_id IN (${e2eDoctors})`,
      [E2E_EMAIL_LIKE],
    );
    await client.query(`DELETE FROM doctors WHERE user_id IN (${e2eUsers})`, [E2E_EMAIL_LIKE]);
    const res = await client.query('DELETE FROM users WHERE email LIKE $1', [E2E_EMAIL_LIKE]);
    await client.query('DELETE FROM specializations WHERE name LIKE $1', [E2E_SPECIALIZATION_LIKE]);
    return res.rowCount ?? 0;
  });
}

export interface E2eScheduleBlock {
  /** 0 = Sunday .. 6 = Saturday */
  dayOfWeek: number;
  startTime: string; // 'HH:MM'
  endTime: string;
}

export interface E2eDoctorInput {
  name: string;
  fee?: number;
  slotMinutes?: 15 | 30;
  bio?: string;
  isActive?: boolean;
  /** Weekly schedule (FR-3.1). Default: none. */
  schedule?: E2eScheduleBlock[];
  /** Leave dates 'YYYY-MM-DD' (FR-3.3). */
  leaves?: string[];
}

/** Every day of the week, 09:00–13:00 and 14:00–21:00. */
export const EVERY_DAY: E2eScheduleBlock[] = [0, 1, 2, 3, 4, 5, 6].flatMap((dayOfWeek) => [
  { dayOfWeek, startTime: '09:00', endTime: '13:00' },
  { dayOfWeek, startTime: '14:00', endTime: '21:00' },
]);

export interface E2eSpecializationInput {
  name: string;
  isActive?: boolean;
  doctors: E2eDoctorInput[];
}

/**
 * Creates specializations and doctors straight in the database, like an admin would.
 * Names must start with "E2E " (specializations) so cleanup can find them; doctor
 * accounts get e2e-*@example.com emails.
 */
export function createE2eDoctors(
  specs: E2eSpecializationInput[],
): Promise<{ specializations: Record<string, number>; doctors: Record<string, number> }> {
  return withClient(async (client) => {
    const specializations: Record<string, number> = {};
    const doctors: Record<string, number> = {};
    for (const spec of specs) {
      if (!spec.name.startsWith('E2E '))
        throw new Error('E2E specialization names start with "E2E "');
      const s = await client.query<{ id: number }>(
        'INSERT INTO specializations (name, is_active) VALUES ($1, $2) RETURNING id',
        [spec.name, spec.isActive ?? true],
      );
      specializations[spec.name] = s.rows[0].id;

      for (const d of spec.doctors) {
        const email = `e2e-doctor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
        const u = await client.query<{ id: number }>(
          `INSERT INTO users (name, email, password_hash, role, is_active, updated_at)
           VALUES ($1, $2, 'not-a-real-hash', 'DOCTOR', true, now()) RETURNING id`,
          [d.name, email],
        );
        const doc = await client.query<{ id: number }>(
          `INSERT INTO doctors (user_id, specialization_id, fee, slot_minutes, bio, is_active)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            u.rows[0].id,
            s.rows[0].id,
            d.fee ?? 500,
            d.slotMinutes ?? 30,
            d.bio ?? null,
            d.isActive ?? true,
          ],
        );
        const doctorId = doc.rows[0].id;
        doctors[d.name] = doctorId;
        for (const block of d.schedule ?? []) {
          await client.query(
            `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time)
             VALUES ($1, $2, $3, $4)`,
            [doctorId, block.dayOfWeek, block.startTime, block.endTime],
          );
        }
        for (const date of d.leaves ?? []) {
          await client.query('INSERT INTO doctor_leaves (doctor_id, leave_date) VALUES ($1, $2)', [
            doctorId,
            date,
          ]);
        }
      }
    }
    return { specializations, doctors };
  });
}

/** Disables an account, like an admin would (used for the ACCOUNT_DISABLED scenario). */
export function disableUser(email: string): Promise<void> {
  return withClient(async (client) => {
    await client.query('UPDATE users SET is_active = false WHERE email = $1', [email]);
  });
}

/** Number of appointments of a patient, by status (to check what really was saved). */
export function appointmentsOf(email: string): Promise<{ status: string; count: number }[]> {
  return withClient(async (client) => {
    const res = await client.query<{ status: string; count: string }>(
      `SELECT a.status, count(*) FROM appointments a JOIN users u ON u.id = a.patient_id
       WHERE u.email = $1 GROUP BY a.status ORDER BY a.status`,
      [email],
    );
    return res.rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  });
}

/** Inserts an appointment directly — for states the API cannot create (past, very soon). */
export function insertAppointment(
  patientEmail: string,
  doctorId: number,
  startAt: Date,
  status: 'BOOKED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' = 'BOOKED',
  minutes = 30,
): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query<{ id: number }>(
      `INSERT INTO appointments (doctor_id, patient_id, start_at, end_at, status, updated_at)
       SELECT $1, id, $2::timestamptz, $3::timestamptz, $4::"AppointmentStatus", now()
       FROM users WHERE email = $5 RETURNING id`,
      // ISO strings + explicit casts: in INSERT ... SELECT the parameter types are not
      // inferred from the columns, and a JS Date could lose its time zone.
      [
        doctorId,
        startAt.toISOString(),
        new Date(startAt.getTime() + minutes * 60_000).toISOString(),
        status,
        patientEmail,
      ],
    );
    return res.rows[0].id;
  });
}

/**
 * D-37: creates a "forgot password" link for an e2e user straight in the database, the way
 * the API does (only the SHA-256 of the token is stored). E2E runs do not really send
 * emails, so this stands in for opening the email. Returns the token for the link.
 */
export function createResetLink(
  email: string,
  { minutesValid = 30 }: { minutesValid?: number } = {},
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return withClient(async (client) => {
    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       SELECT id, $2, now() + make_interval(mins => $3) FROM users WHERE email = $1`,
      [email, hash, minutesValid],
    );
    return token;
  });
}

/** D-37: how many still-usable reset links an e2e user has. */
export function openResetLinks(email: string): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query(
      `SELECT count(*)::int AS n FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
       WHERE u.email = $1 AND t.used_at IS NULL AND t.expires_at > now()`,
      [email],
    );
    return res.rows[0].n as number;
  });
}
