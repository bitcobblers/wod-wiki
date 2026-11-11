import { defineConfig } from 'tsup';

const runtimeOnly = process.env.TSUP_RUNTIME_ONLY === '1';

export default defineConfig({
  entry: ['src/index.ts', 'src/sql/index.ts', 'src/sql/node.ts', 'src/idb/index.ts'],
  format: runtimeOnly ? ['esm'] : ['esm', 'cjs'],
  dts: !runtimeOnly,
  sourcemap: !runtimeOnly,
  clean: true,
  // Core validation is runtime code; language types stay external.
  external: [
    '@bitcobblers/wod-wiki-core',
    '@bitcobblers/wod-wiki-lang',
    '@bitcobblers/wod-wiki-wql',
    '@libsql/client',
    '@libsql/client/web',
    'bun',
    'idb',
  ],
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
  treeshake: true,
  target: 'es2022',
});
