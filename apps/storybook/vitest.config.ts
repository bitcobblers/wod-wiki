import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { CODEMIRROR_SINGLETON_DEPS, workspaceAliases } from './aliases.ts';

const rootDir = path.resolve(import.meta.dirname, '../..');

const resolveConfig = {
  dedupe: ['react', 'react-dom', ...CODEMIRROR_SINGLETON_DEPS],
  alias: workspaceAliases(rootDir),
};

// Two projects: the storybook browser runner (one test per story) and a
// node runner for plain unit tests under test/ (e.g. the gallery manifest
// coverage guard, which needs no DOM and no browser).
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          react(),
          storybookTest({
            configDir: path.resolve(import.meta.dirname, '.storybook'),
          }),
        ],
        resolve: resolveConfig,
        optimizeDeps: {
          include: [
            'nuqs/adapters/testing',
            '@codemirror/search',
            '@ui-sdk/react/alert-dialog',
            '@ui-sdk/react/button',
            '@ui-sdk/react/calendar',
            '@ui-sdk/react/collapsible',
            '@ui-sdk/react/combobox',
            '@ui-sdk/react/dialog',
            '@ui-sdk/react/drawer',
            '@ui-sdk/react/field',
            '@ui-sdk/react/input',
            '@ui-sdk/react/label',
            '@ui-sdk/react/menu',
            '@ui-sdk/react/overlays',
            '@ui-sdk/react/popover',
            '@ui-sdk/react/primitive',
            '@ui-sdk/react/progress',
            '@ui-sdk/react/segmented-control',
            '@ui-sdk/react/select',
            '@ui-sdk/react/separator',
            '@ui-sdk/react/switch',
            '@ui-sdk/react/tabs',
            '@ui-sdk/react/textarea',
            '@ui-sdk/react/toast',
          ],
        },
        test: {
          name: 'storybook-workbench',
          browser: {
            enabled: true,
            instances: [{ browser: 'chromium' }],
            provider: playwright(),
            headless: true,
          },
          setupFiles: [path.resolve(import.meta.dirname, '.storybook/vitest.setup.ts')],
        },
      },
      {
        resolve: resolveConfig,
        test: {
          name: 'app-unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: [path.resolve(import.meta.dirname, 'test/setup.ts')],
          include: ['test/**/*.{test,spec}.{ts,tsx}'],
          exclude: [...configDefaults.exclude, '**/*.regression.test.{ts,tsx}'],
        },
      },
    ],
  },
});
