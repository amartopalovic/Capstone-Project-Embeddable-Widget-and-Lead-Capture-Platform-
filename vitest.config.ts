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
          name: 'unit-runtime',
          root: './packages/widget-runtime',
          // Node, not a DOM emulator: what is unit-tested here is decision
          // logic, and the browser behaviour it feeds is covered by Playwright
          // against the real second origin rather than a simulated one.
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
          // Integration specs live alongside the unit ones but need real
          // Mongo, Redis, and Mailpit, so they are a separate project.
          exclude: ['tests/**/*.integration.test.ts', 'node_modules/**'],
        },
      },
      {
        test: {
          name: 'integration-server',
          root: './apps/server',
          environment: 'node',
          include: ['tests/**/*.integration.test.ts'],
          testTimeout: 180_000,
          hookTimeout: 180_000,
          // Auth integration specs share one Mailpit instance and drive a
          // shared clock, so they run one file at a time.
          fileParallelism: false,
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
