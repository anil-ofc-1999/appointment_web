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

/** Removes all E2E test users (they never have appointments). */
export function deleteE2eUsers(): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query('DELETE FROM users WHERE email LIKE $1', [E2E_EMAIL_LIKE]);
    return res.rowCount ?? 0;
  });
}

/** Disables an account, like an admin would (used for the ACCOUNT_DISABLED scenario). */
export function disableUser(email: string): Promise<void> {
  return withClient(async (client) => {
    await client.query('UPDATE users SET is_active = false WHERE email = $1', [email]);
  });
}
