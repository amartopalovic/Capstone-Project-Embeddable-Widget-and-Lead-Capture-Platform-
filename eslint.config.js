// @ts-check
// Root ESLint flat config. Every workspace is linted through this one entry
// point, using the shared rules in @lcp/config.

import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import shared from '@lcp/config/eslint';

export default defineConfig([
  globalIgnores(['**/dist/**', '**/build/**', '**/coverage/**', '**/node_modules/**']),
  shared,
  {
    // Repository scripts are Node programs run directly by a person or by CI,
    // outside every workspace's tsconfig, so they need Node's globals declared
    // here rather than inheriting a browser or workspace environment.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // The widget runtime must never assume a DOM-framework runtime or Node
    // globals; it is browser-only, framework-free code (blueprint section 8.1).
    files: ['packages/widget-runtime/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['react', 'react-dom', 'node:*'] }],
    },
  },
]);
