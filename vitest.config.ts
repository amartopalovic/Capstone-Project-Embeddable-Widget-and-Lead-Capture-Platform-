import { defineConfig } from 'vitest/config';

/**
 * Root Vitest configuration.
 *
 * Vitest 4 removed `test.workspace`; multi-package setups use `test.projects`.
 *
 * Unit and integration projects are separated deliberately. Unit projects need
 * no infrastructure and therefore run anywhere, including a CI job with no
 * services. Integration projects require a real MongoDB replica set and Redis,
 * so they run in their own job with those services started.
 *
 * Only workspaces that actually have tests are listed. A project for a
 * workspace with no tests would report a pass that proves nothing.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit-contracts',
          root: './packages/contracts',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'unit-server',
          root: './apps/server',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration-database',
          root: './packages/database',
          environment: 'node',
          include: ['tests/**/*.integration.test.ts'],
          // Integration tests share one MongoDB deployment; each file gets its
          // own randomly named database, so files may still run in parallel.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
