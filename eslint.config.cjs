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
    'no-empty-import': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          emptyImport: 'Empty named import declaration is unused.',
        },
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            if (
              node.specifiers.length === 0 &&
              /^import\s+(?:type\s+)?\{\s*\}/.test(context.sourceCode.getText(node))
            ) {
              context.report({ node, messageId: 'emptyImport' });
            }
          },
        };
      },
    },
    'no-trailing-continue': {
      meta: {
        type: 'suggestion',
        schema: [],
        messages: {
          unnecessaryContinue: "'continue' is unnecessary as the last statement in a loop.",
        },
      },
      create(context) {
        const LOOP_TYPES = new Set([
          'ForStatement',
          'ForInStatement',
          'ForOfStatement',
          'WhileStatement',
          'DoWhileStatement',
        ]);
        function isTailOfEnclosingLoop(stmt) {
          let cur = stmt;
          while (cur.parent) {
            const p = cur.parent;
            if (p.type === 'BlockStatement') {
              if (p.body[p.body.length - 1] !== cur) return false;
              cur = p;
            } else if (p.type === 'IfStatement' && p.consequent === cur && !p.alternate) {
              cur = p;
            } else if (LOOP_TYPES.has(p.type) && p.body === cur) {
              return true;
            } else {
              return false;
            }
          }
          return false;
        }
        return {
          ContinueStatement(node) {
            if (!node.label && isTailOfEnclosingLoop(node)) {
              context.report({ node, messageId: 'unnecessaryContinue' });
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
      // Async & Promise safety — enforced as 'error' across all packages, apps, E2E, and scripts.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          ignoreVoid: true,
          allowForKnownSafeCalls: [
            { from: 'package', name: ['describe', 'it', 'suite', 'test'], package: 'node:test' },
          ],
        },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'error',
      'no-return-await': 'off',
      '@typescript-eslint/return-await': ['error', 'error-handling-correctness-only'],
      // TypeScript hygiene & deprecated APIs — enforced as 'error' everywhere.
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/no-unnecessary-type-arguments': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/no-deprecated': 'error',
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
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
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
      // console.warn/error are the sanctioned diagnostic channels in library code;
      // console.log/info/debug are disallowed in production package sources.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-fallthrough': 'error',
      'no-constant-condition': 'error',
      'no-useless-escape': 'error',
      // Dead assignments, control-flow & comma expressions
      'no-useless-assignment': 'error',
      'no-sequences': ['error', { allowInParentheses: false }],
      'no-unreachable-loop': 'error',
      'wod-wiki/protected-abstract-constructor': 'error',
      'wod-wiki/no-empty-import': 'error',
      'wod-wiki/no-trailing-continue': 'error',
      // RegExp hygiene
      'regexp/no-useless-non-capturing-group': 'error',
      'regexp/prefer-character-class': ['error', { minAlternatives: 2 }],
      'regexp/no-dupe-characters-character-class': 'error',
      // JSDoc signature parity
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
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
    // Unit test suites retain legacy `any` in mocks/spies as warnings while all
    // production sources enforce `no-explicit-any: 'error'`.
    files: [
      '**/tests/**/*.ts',
      '**/tests/**/*.tsx',
      '**/test/**/*.ts',
      '**/test/**/*.tsx',
      '**/__tests__/**/*.ts',
      '**/__tests__/**/*.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Playground app configuration: allow console diagnostics and disable
    // boolean-literal-compare while Playground tsconfig sets strictNullChecks: false.
    files: [
      'apps/playground/src/**/*.ts',
      'apps/playground/src/**/*.tsx',
      'apps/playground/app/**/*.ts',
      'apps/playground/app/**/*.tsx',
      'apps/playground/tests/**/*.ts',
      'apps/playground/tests/**/*.tsx',
    ],
    rules: {
      ...(isTypedLint ? { '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off' } : {}),
      'no-console': 'off',
    },
  },
  {
    // Package test harnesses, CLI check scripts, and repo scripts write to stdout via console.log.
    files: ['packages/*/tests/**/*.ts', 'apps/api/check.ts', 'scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Architecture guard for the app-support component tree — enforced as 'error'.
    files: ['apps/playground/src/components/**/*.ts', 'apps/playground/src/components/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
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
    // Playwright E2E suite & configs: enforce web-first assertions and pointer
    // hit-testing as hard errors.
    files: ['e2e/**/*.ts', 'playwright*.config.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': [
        'error',
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
