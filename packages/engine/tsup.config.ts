import { defineConfig } from 'tsup';

const runtimeOnly = process.env.TSUP_RUNTIME_ONLY === '1';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
    agent: 'src/agent/index.ts',
  },
  format: runtimeOnly ? ['esm'] : ['esm', 'cjs'],
  dts: !runtimeOnly,
  sourcemap: !runtimeOnly,
  clean: true,
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
  treeshake: true,
  target: 'es2022',
  external: [
    '@bitcobblers/wod-wiki-core',
    '@bitcobblers/wod-wiki-lang',
    '@bitcobblers/wod-wiki-wql',
    '@bitcobblers/wod-wiki-storage',
    'react',
    'react-dom',
    'zod',
  ],
});
