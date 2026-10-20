import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/wod.ts', 'src/server/app.ts'],
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
    '@bitcobblers/wod-wiki-storage/idb',
    '@bitcobblers/wod-wiki-engine',
    '@libsql/client',
    '@libsql/client/web',
    'bun',
    'fake-indexeddb',
  ],
  esbuildOptions(options, context) {
    if (context.format === 'esm') {
      options.banner = {
        js: "import { createRequire as __wodCreateRequire } from 'module';\n" +
          "if (typeof globalThis.require === 'undefined') {\n" +
          '  try { globalThis.require = __wodCreateRequire(import.meta.url); } catch {}\n' +
          '}',
      };
    }
  },
});
