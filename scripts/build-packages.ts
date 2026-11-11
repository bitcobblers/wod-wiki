#!/usr/bin/env bun
/**
 * Workspace package builder with two modes:
 *  - default (`bun scripts/build-packages.ts`): builds ESM + CJS + `.d.ts`
 *    across the package dependency DAG so independent branches (`ui` alongside
 *    `storage -> engine -> tools`) compile concurrently with maximum CPU usage.
 *  - `--runtime` (`bun scripts/build-packages.ts --runtime`): sets
 *    `TSUP_RUNTIME_ONLY=1` (ESM only, `dts: false`, `sourcemap: false`) and
 *    builds all 7 packages concurrently (~1.6s total) for runtime-only consumers.
 */
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const runtimeOnly = process.argv.includes('--runtime');

const PACKAGE_DEPS: Record<string, readonly string[]> = {
  core: [],
  lang: ['core'],
  wql: ['core', 'lang'],
  storage: ['core', 'lang', 'wql'],
  ui: ['core', 'lang', 'wql'],
  engine: ['core', 'lang', 'wql', 'storage'],
  tools: ['core', 'lang', 'wql', 'storage', 'engine'],
};

const ALL_PACKAGES = Object.keys(PACKAGE_DEPS);

async function buildOne(pkg: string): Promise<void> {
  const cwd = resolve(ROOT, 'packages', pkg);
  const proc = Bun.spawn([process.execPath, 'run', 'build'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ...(runtimeOnly ? { TSUP_RUNTIME_ONLY: '1' } : {}),
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    process.stderr.write(`\n[build-packages] packages/${pkg} failed (exit ${exitCode}):\n${stdout}${stderr}\n`);
    throw new Error(`packages/${pkg} build failed with exit code ${exitCode}`);
  }
}

const t0 = performance.now();
if (runtimeOnly) {
  await Promise.all(ALL_PACKAGES.map(buildOne));
} else {
  const inflight = new Map<string, Promise<void>>();
  const launch = (pkg: string): Promise<void> => {
    const existing = inflight.get(pkg);
    if (existing) return existing;
    const task = Promise.all((PACKAGE_DEPS[pkg] ?? []).map(launch)).then(() => buildOne(pkg));
    inflight.set(pkg, task);
    return task;
  };
  await Promise.all(ALL_PACKAGES.map(launch));
}

const elapsedSec = ((performance.now() - t0) / 1000).toFixed(2);
console.log(
  `[build-packages] Built ${ALL_PACKAGES.length} packages (${runtimeOnly ? 'runtime-only ESM' : 'full ESM+CJS+DTS'}) in ${elapsedSec}s`,
);
