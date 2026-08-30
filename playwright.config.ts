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
  /**
   * Migrations, before the servers start (blueprint 9.3, 16.2).
   *
   * Blueprint 9.3 forbids running migrations on boot, so the server does not,
   * and until Stage 13 nothing else did either - the end-to-end database had
   * been a migration behind since Stage 12b and nothing noticed. See
   * `e2e/global-setup.ts`.
   */
  globalSetup: './e2e/global-setup.ts',
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
      /**
       * The demo sandbox, on its own port. This is what makes the widget tests
       * cross-origin rather than a same-origin simulation of one.
       *
       * BUILT and previewed rather than run from the dev server, since Stage 13.
       * The sandbox ships `style-src 'self'` with no `'unsafe-inline'` - the
       * strictest page policy in the product, and the proof that the widget
       * runtime installs cleanly on a site with a real Content Security Policy.
       * Vite's dev server injects every stylesheet as an inline `<style>`
       * element, which that policy correctly refuses, so the dev server cannot
       * serve this application as it is actually deployed. Testing the built
       * artifact is both more faithful and the only way to exercise the real
       * policy; the build takes well under a second.
       */
      command:
        'node ../../node_modules/vite/bin/vite.js build && node ../../node_modules/vite/bin/vite.js preview --port 5174 --strictPort',
      cwd: 'apps/demo',
      url: `http://localhost:${String(DEMO_PORT)}`,
      reuseExistingServer: process.env['CI'] === undefined,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
