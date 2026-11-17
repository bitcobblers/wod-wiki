// Flat config for ESLint 10 — unifies syntax/AST linting (`bun run lint`) and
// opt-in type-aware linting (`ESLINT_TYPED=1` via `bun run lint:typed`) aligned
// with Qodana static analysis categories.
const js = require('@eslint/js');
const globals = require('globals');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const reactHooks = require('eslint-plugin-react-hooks');
const storybook = require('eslint-plugin-storybook');
const regexpPlugin = require('eslint-plugin-regexp');
const jsdocMod = require('eslint-plugin-jsdoc');

const jsdocPlugin = jsdocMod.default || jsdocMod;
const isTypedLint = process.env.ESLINT_TYPED === '1';

const wodWikiPlugin = {
  rules: {
    'protected-abstract-constructor': {
      meta: {
        type: 'suggestion',
        schema: [],
        messages: {
          makeProtected: 'Abstract class constructor can be made protected.',
        },
      },
      create(context) {
        return {
          "ClassDeclaration[abstract=true] > ClassBody > MethodDefinition[kind='constructor']"(node) {
            if (node.accessibility !== 'protected' && node.accessibility !== 'private') {
              context.report({ node, messageId: 'makeProtected' });
            }
          },
        };
      },
    },
  },
};

const typedParserOptions = isTypedLint
  ? {
      project: [
        './tsconfig.eslint.json',
        './apps/playground/tsconfig.json',
        './apps/storybook/tsconfig.json',
        './apps/api/tsconfig.json',
        './e2e/tsconfig.json',
      ],
      tsconfigRootDir: __dirname,
    }
  : {};

const typedRules = isTypedLint
  ? {
      // Async & Promise safety (Qodana: ES6MissingAwait, JSIgnoredPromiseFromCall, ES6RedundantAwait)
      '@typescript-eslint/no-floating-promises': ['warn', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'warn',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'warn',
      'no-return-await': 'off',
      '@typescript-eslint/return-await': ['warn', 'in-try-catch'],
      // TypeScript hygiene & deprecated APIs (Qodana: TypeScriptFieldCanBeMadeReadonly,
      // TypeScriptRedundantGenericType, PointlessBooleanExpressionJS, JSDeprecatedSymbols)
      '@typescript-eslint/prefer-readonly': 'warn',
      '@typescript-eslint/no-unnecessary-type-arguments': 'warn',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'warn',
      '@typescript-eslint/no-deprecated': 'warn',
    }
  : {};

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/storybook-static/**',
      '**/.github/**',
      'ontology/generated/**',
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
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ...typedParserOptions,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      storybook,
      regexp: regexpPlugin,
      jsdoc: jsdocPlugin,
      'wod-wiki': wodWikiPlugin,
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
      // Dead assignments, control-flow & comma expressions (Qodana: JSUnusedAssignment,
      // CommaExpressionJS, LoopStatementThatDoesntLoopJS, TypeScriptAbstractClassConstructorCanBeMadeProtected)
      'no-useless-assignment': 'warn',
      'no-sequences': ['warn', { allowInParentheses: false }],
      'no-unreachable-loop': 'warn',
      'wod-wiki/protected-abstract-constructor': 'warn',
      // RegExp hygiene (Qodana: RegExpUnnecessaryNonCapturingGroup, RegExpSingleCharAlternation,
      // RegExpRedundantClassElement)
      'regexp/no-useless-non-capturing-group': 'warn',
      'regexp/prefer-character-class': 'warn',
      'regexp/no-dupe-characters-character-class': 'warn',
      // JSDoc signature parity (Qodana: JSCommentMatchesSignature)
      'jsdoc/check-param-names': ['warn', { checkDestructured: false }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='require']",
          message: 'Use ES module import instead of require().',
        },
      ],
      ...typedRules,
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
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      // Playground tsconfig sets strictNullChecks: false, where boolean | undefined
      // collapses to boolean and causes false positives in boolean-literal-compare.
      ...(isTypedLint ? { '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off' } : {}),
      // Playground is an app, not a library: console diagnostics are expected.
      'no-console': 'off',
    },
  },
  {
    // CLI tools and repo scripts intentionally write output to stdout via console.log.
    files: ['packages/tools/tests/**/*.ts', 'apps/api/check.ts', 'scripts/**/*.ts'],
    rules: {
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
