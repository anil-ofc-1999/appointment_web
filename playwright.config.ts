import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: real browser -> Angular app -> real API -> real PostgreSQL.
 *
 * Starts its OWN API (port 3100) and web server (port 4300), so it never clashes
 * with your normal `npm run dev` (3000) / `npm start` (4200).
 * The API is taken from ../appointment_node_API (override with API_DIR) and uses
 * that repo's .env database. Test users are named e2e-*@example.com and are
 * deleted before and after the run (e2e/global-setup.ts).
 */
const API_DIR = process.env['API_DIR'] ?? '../appointment_node_API';
const API_PORT = 3100;
const WEB_PORT = 4300;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node --env-file-if-exists=.env src/server.js',
      cwd: API_DIR,
      url: `http://localhost:${API_PORT}/health`,
      env: {
        PORT: String(API_PORT),
        // Many logins run in parallel from one IP; the 5/min limit has its own unit tests.
        LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
      },
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: `npx ng serve --port ${WEB_PORT} --proxy-config e2e/proxy.e2e.conf.json`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
    },
  ],
});
