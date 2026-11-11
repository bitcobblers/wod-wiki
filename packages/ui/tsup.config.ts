import { defineConfig } from 'tsup';

const runtimeOnly = process.env.TSUP_RUNTIME_ONLY === '1';

export default defineConfig({
  entry: ['src/index.ts', 'src/extensions/index.ts'],
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
    'react',
    'react-dom',
    'recharts',
    'lucide-react',
    '@codemirror/autocomplete',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr'
  ]
});
