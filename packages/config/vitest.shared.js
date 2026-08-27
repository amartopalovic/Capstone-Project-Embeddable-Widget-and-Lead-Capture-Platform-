// Shared Vitest defaults for every workspace project.
//
// Vitest 4 removed `test.workspace`; multi-package setups are declared through
// `test.projects` in the root config, and each project reuses these defaults.

/** @type {import('vitest/node').TestProjectConfiguration['test']} */
export const sharedTestDefaults = {
  include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  clearMocks: true,
  restoreMocks: true,
  passWithNoTests: true,
};

export default sharedTestDefaults;
