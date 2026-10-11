import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/sql/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Kept external so the runtime dist imports them as declared dependencies:
  // type-only core/lang, WQL matchers (sql subpath), libsql (sql subpath).
  external: [
    '@bitcobblers/wod-wiki-core',
    '@bitcobblers/wod-wiki-lang',
    '@bitcobblers/wod-wiki-wql',
    '@libsql/client',
    '@libsql/client/web',
  ],
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
  treeshake: true,
  target: 'es2022',
});
