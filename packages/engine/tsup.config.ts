import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/wod.ts'],
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
    '@bitcobblers/wod-wiki-storage/sql',
    '@bitcobblers/wod-wiki-storage/sql/node',
    '@libsql/client',
    '@libsql/client/web',
    // Server-only Bun APIs (Bun.serve, lazy Bun.SQL) resolve at runtime, never bundled.
    'bun',
  ],
  esbuildOptions(options, context) {
    if (context.format === 'esm') {
      // ESM output has no native require — the CLI's lazy `require('node:…')`
      // calls (fs/path/crypto) run through a createRequire shim. CJS keeps
      // its native require, so the banner stays ESM-only.
      options.banner = {
        js: "import { createRequire as __wodCreateRequire } from 'module';\n" +
          "if (typeof globalThis.require === 'undefined') {\n" +
          '  try { globalThis.require = __wodCreateRequire(import.meta.url); } catch {}\n' +
          '}',
      };
    }
  },
});
