import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/sql/index.ts', 'src/sql/node.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Core validation is runtime code; language types stay external.
  external: [
    '@bitcobblers/wod-wiki-core',
    '@bitcobblers/wod-wiki-lang',
    '@bitcobblers/wod-wiki-wql',
    '@libsql/client',
    '@libsql/client/web',
    'bun',
  ],
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
  treeshake: true,
  target: 'es2022',
});
