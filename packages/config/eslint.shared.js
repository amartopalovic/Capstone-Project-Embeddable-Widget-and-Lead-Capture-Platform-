// @ts-check
// Shared flat ESLint configuration for every workspace.
//
// Uses ESLint core defineConfig rather than the tseslint.config helper, which
// typescript-eslint now documents as deprecated in favour of defineConfig.

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export const sharedIgnores = globalIgnores([
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/node_modules/**',
  '**/*.d.ts',
]);

export const sharedTypeScript = defineConfig({
  files: ['**/*.{ts,tsx,mts,cts}'],
  extends: [js.configs.recommended, tseslint.configs.recommended, prettier],
  rules: {
    // Unused identifiers are an error, with a deliberate underscore escape hatch
    // for intentionally unused parameters in adapter signatures.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': 'error',
    eqeqeq: ['error', 'always'],
    'no-console': 'off',
  },
});

export const sharedJavaScript = defineConfig({
  files: ['**/*.{js,mjs,cjs}'],
  extends: [js.configs.recommended, prettier],
});

/** Every workspace spreads this, then adds its own overrides. */
export default defineConfig([sharedIgnores, sharedJavaScript, sharedTypeScript]);
