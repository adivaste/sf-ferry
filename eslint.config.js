import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'docs/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Surfaces dead code — unused imports, variables, and args (underscore-
      // prefixed args are deliberately ignored, e.g. blessed callbacks).
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The codebase intentionally swallows best-effort failures (corrupt cache,
      // prefs, terminal teardown) with a commented empty catch.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
