import { defineConfig } from 'tsup';

const runtimeOnly = process.env.TSUP_RUNTIME_ONLY === '1';

const shared = {
  format: (runtimeOnly ? ['esm'] : ['esm', 'cjs']) as ('esm' | 'cjs')[],
  dts: !runtimeOnly,
  sourcemap: !runtimeOnly,
  outExtension({ format }: { format: 'esm' | 'cjs' | 'iife' }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
  treeshake: true,
  target: 'es2022' as const,
};

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts'],
    clean: true,
  },
  {
    ...shared,
    entry: ['src/testing.ts'],
    clean: false,
  },
]);
