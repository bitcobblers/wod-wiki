import { defineConfig } from 'tsup';

const runtimeOnly = process.env.TSUP_RUNTIME_ONLY === '1';

export default defineConfig({
  entry: ['src/index.ts', 'src/react.ts'],
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
    'react',
    'react-dom',
    '@codemirror/state',
    '@codemirror/language',
    '@codemirror/autocomplete',
    '@lezer/common',
    '@lezer/lr'
  ]
});
