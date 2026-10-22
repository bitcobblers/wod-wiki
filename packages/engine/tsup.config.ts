import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/react.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
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
  ],
});
