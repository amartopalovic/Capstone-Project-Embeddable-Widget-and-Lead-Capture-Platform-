import { defineConfig } from 'vitest/config';

/**
 * Root Vitest configuration.
 *
 * Vitest 4 removed `test.workspace`; multi-package setups are declared with
 * `test.projects`, verified against the current Vitest documentation.
 *
 * Only workspaces that actually have tests are listed. Adding a project for a
 * workspace with no tests would produce a passing result that proves nothing,
 * which is the kind of false evidence this project explicitly avoids.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          root: './apps/server',
          environment: 'node',
          include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
        },
      },
    ],
  },
});
