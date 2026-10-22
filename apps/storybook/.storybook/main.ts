import { fileURLToPath } from "node:url";
import path, { dirname } from 'node:path';
import type { StorybookConfig } from '@storybook/react-vite';
import { CODEMIRROR_SINGLETON_DEPS, workspaceAliases } from '../aliases.ts';

const rootDir = path.resolve(import.meta.dirname, '../../..');

const config: StorybookConfig = {
  stories: [
    '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)',
  ],
  staticDirs: ['../public', { from: '../../playground/public/seed', to: '/seed' }],
  addons: [
    getAbsolutePath("@storybook/addon-docs"),
    getAbsolutePath("@storybook/addon-vitest"),
    getAbsolutePath("@storybook/addon-a11y"),
  ],
  framework: {
    name: getAbsolutePath("@storybook/react-vite"),
    options: {
      builder: {
        viteConfigPath: path.resolve(import.meta.dirname, '../vite.config.ts'),
      },
    },
  },
  typescript: {
    reactDocgen: false,
  },
  viteFinal: async (config) => {
    config.build = config.build || {};
    config.build.chunkSizeWarningLimit = 2000;
    config.resolve = config.resolve || {};
    config.resolve.dedupe = Array.from(
      new Set([...(config.resolve.dedupe || []), 'react', 'react-dom', ...CODEMIRROR_SINGLETON_DEPS])
    );
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      ...workspaceAliases(rootDir),
    };
    return config;
  },
};

export default config;

function getAbsolutePath(value: string): any {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
