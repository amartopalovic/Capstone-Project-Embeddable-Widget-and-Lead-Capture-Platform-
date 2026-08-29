import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests (blueprint 18.3).
 *
 * These run against the REAL stack: the Express server, the built React
 * application, MongoDB, Redis, and Mailpit. Nothing is stubbed, because the
 * point is to prove the journey works through actual UI interaction rather
 * than re-asserting what the integration tests already cover at the API level.
 *
 * Start the infrastructure first:
 *   docker compose up -d --wait mongo redis mailpit
 * The two `webServer` entries below then boot the API and the web app.
 */

const WEB_PORT = 5173;
const API_PORT = 3000;
/** The second origin. Cross-origin widget behaviour is only real with one. */
const DEMO_PORT = 5174;

export const DEMO_ORIGIN = `http://localhost:${String(DEMO_PORT)}`;

export default defineConfig({
  testDir: './e2e/tests',
  // Auth journeys share one Mailpit inbox and one throttle key space per IP,
  // so they run serially rather than racing each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: process.env['CI'] === undefined ? [['list']] : [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${String(WEB_PORT)}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // Invoked as `node <binary>` rather than `npm run`, because npm runs
      // scripts through cmd.exe, which splits the PATH on the `&` in this
      // repository path. See README section 5.4.
      command: 'node ../../node_modules/tsx/dist/cli.mjs src/index.ts',
      cwd: 'apps/server',
      url: `http://localhost:${String(API_PORT)}/health/live`,
      reuseExistingServer: process.env['CI'] === undefined,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        // The app is served from the web origin, so email links must point
        // there rather than at the API.
        APP_BASE_URL: `http://localhost:${String(WEB_PORT)}`,
        MONGODB_URI: 'mongodb://localhost:27017/leadcapture_e2e?directConnection=true',
        MONGODB_DB_NAME: 'leadcapture_e2e',
        REDIS_URL: 'redis://localhost:6379',
        REDIS_KEY_PREFIX: 'lcp:e2e',
        EMAIL_PROVIDER: 'mailpit',
        MAILPIT_SMTP_HOST: 'localhost',
        MAILPIT_SMTP_PORT: '1025',
      },
    },
    {
      command: 'node ../../node_modules/vite/bin/vite.js',
      cwd: 'apps/web',
      url: `http://localhost:${String(WEB_PORT)}`,
      reuseExistingServer: process.env['CI'] === undefined,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The demo sandbox, on its own port. This is what makes the widget tests
      // cross-origin rather than a same-origin simulation of one.
      command: 'node ../../node_modules/vite/bin/vite.js',
      cwd: 'apps/demo',
      url: `http://localhost:${String(DEMO_PORT)}`,
      reuseExistingServer: process.env['CI'] === undefined,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
