// Flat config for ESLint 10 — unifies the former .eslintrc.json + .eslintignore
// (wod-wiki side) and .eslintrc.json (wod-wiki-engine side) after the merge.
const js = require('@eslint/js');
const globals = require('globals');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const reactHooks = require('eslint-plugin-react-hooks');
const storybook = require('eslint-plugin-storybook');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/storybook-static/**',
      '**/.github/**',
      '**/*.cjs',
      '**/*.mjs',
      '**/*.js',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      storybook,
    },
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off', // TypeScript owns undefined-name checking; eslint no-undef false-positives on ambient types
      'no-redeclare': 'off', // TypeScript function overloads false-positive on core no-redeclare
      '@typescript-eslint/no-redeclare': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // console.warn/error are the sanctioned diagnostic channels (no logger
      // utility exists in this repo); console.log/info/debug stay flagged so
      // stray debugging output is caught.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-fallthrough': 'warn',
      'no-constant-condition': 'warn',
      'no-useless-escape': 'warn',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='require']",
          message: 'Use ES module import instead of require().',
        },
      ],
    },
  },
  {
    // Playground app carries pre-migration lint debt (never previously gated).
    // Soften the known-debt rules here; packages/ and apps/storybook stay strict.
    files: [
      'apps/playground/src/**/*.ts',
      'apps/playground/src/**/*.tsx',
      'apps/playground/app/**/*.ts',
      'apps/playground/app/**/*.tsx',
      'apps/playground/tests/**/*.ts',
      'apps/playground/tests/**/*.tsx',
    ],
    rules: {
      'no-restricted-imports': 'warn',
      'no-restricted-syntax': 'warn',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'warn',
      // Playground is an app, not a library: console diagnostics are expected.
      'no-console': 'off',
    },
  },
  {
    // Architecture guard for the app-support component tree. Patterns are the
    // pre-migration 'error' rules downgraded to 'warn': nine call sites still
    // violate them and semantics-preserving reroutes are follow-up work.
    files: ['apps/playground/src/components/**/*.ts', 'apps/playground/src/components/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['**/runtime/**', '!**/views/runtime/**'],
              allowTypeImports: true,
              message: 'Do not import directly from runtime/ in components/. Import from @/hooks/useRuntimeTimer or @/hooks/useRuntimeParser instead.',
            },
            {
              group: ['**/services/**'],
              allowTypeImports: true,
              message: 'Do not import directly from services/ in components/. Import from @/hooks/useWorkbenchServices or @/hooks/useCastSignaling instead.',
            },
            {
              group: ['**/parser/**'],
              allowTypeImports: true,
              message: 'Do not import directly from parser/ in components/. Import from @/hooks/useRuntimeParser instead.',
            },
          ],
        },
      ],
    },
  },
  {
    // Playwright E2E suite & configs: allow test runner console output and
    // surface anti-patterns (fixed waitForTimeout sleeps, DOM evaluate clicks)
    // as warnings on legacy specs while keeping zero-error lint enforcement.
    files: ['e2e/**/*.ts', 'playwright*.config.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': [
        'warn',
        {
          selector: "CallExpression[callee.name='require']",
          message: 'Use ES module import instead of require().',
        },
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message:
            'Avoid fixed waitForTimeout sleeps in Playwright specs; prefer web-first expect() assertions or expect.poll().',
        },
        {
          selector:
            "CallExpression[callee.property.name='evaluate'] CallExpression[callee.property.name='click']",
          message:
            'Avoid DOM element.click() inside evaluate(); use Playwright pointer .click() so hit-testing is verified.',
        },
      ],
    },
  },
];
