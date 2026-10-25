#!/usr/bin/env bun
/**
 * Per-file isolated test runner.
 *
 * Bun runs every test file in a single shared process, and `mock.module(...)`
 * registers a *process-global* override that cannot be un-registered (neither
 * `mock.restore()` nor re-mocking in `afterAll` undoes it in Bun 1.3.x). Several
 * playground test files globally replace shared modules (react-router-dom,
 * playgroundDB, IndexedDBService) with partial stubs, which then leak into every
 * later file and cause order-dependent failures.
 *
 * Running each test file in its own process eliminates that entire class of
 * cross-file pollution: every file gets a clean module registry and its own
 * mocks. See docs/playground-failing-tests-analysis.md for the full analysis.
 *
 * Usage: bun tests/run-isolated.ts <dir> [--preload <file>]
 */
import { Glob } from 'bun';
import { resolve, sep } from 'path';
import os from 'os';

const args = process.argv.slice(2);
let preload = './tests/unit-setup.ts';
let maxWorkers = 16;
let dirs: string[] = [];
const excludes: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--preload' && i + 1 < args.length) {
    preload = args[i + 1];
    i++;
  } else if (args[i] === '--workers' && i + 1 < args.length) {
    maxWorkers = Number(args[i + 1]);
    if (!Number.isInteger(maxWorkers) || maxWorkers < 1) throw new Error('--workers must be a positive integer');
    i++;
  } else if (args[i] === '--exclude' && i + 1 < args.length) {
    excludes.push(args[i + 1]);
    i++;
  } else if (!args[i].startsWith('--')) {
    dirs.push(args[i]);
  }
}
if (dirs.length === 0) dirs = ['./src', './app'];

const glob = new Glob('**/*.{test,spec}.{ts,tsx}');
const filesSet = new Set<string>();
for (const targetDir of dirs) {
  for await (const f of glob.scan({ cwd: targetDir, absolute: true })) {
    filesSet.add(f);
  }
}
const excludedPaths = excludes.map(exclude => resolve(exclude));
const files = Array.from(filesSet)
  .filter(file => !excludedPaths.some(exclude => file === exclude || file.startsWith(exclude + sep)))
  .sort();

if (files.length === 0) {
  console.error(`No test files found under ${dirs.join(', ')}`);
  process.exit(1);
}

const concurrency = Math.max(1, Math.min(maxWorkers, os.cpus().length || 4));
console.log(`Running ${files.length} test file(s) in isolated processes (${concurrency} parallel workers, preload: ${preload})\n`);

let totalPass = 0;
let totalFail = 0;
let totalSkip = 0;
const failedFiles: string[] = [];
const countRe = /^\s*(\d+)\s+(pass|fail|skip)\s*$/;

let fileIndex = 0;
async function worker() {
  while (fileIndex < files.length) {
    const idx = fileIndex++;
    const file = files[idx];
    const rel = file.replace(resolve(process.cwd()) + '/', '');
    const proc = Bun.spawn(['bun', 'test', file, '--preload', preload, '--timeout', '20000'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ stdout: string; stderr: string; exitCode: number }>((res) => {
      timeoutHandle = setTimeout(() => {
        try { proc.kill(); } catch {}
        res({ stdout: '', stderr: `Test timed out after 45 seconds: ${rel}`, exitCode: 1 });
      }, 45_000);
    });

    const runPromise = Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]).then(([stdout, stderr, exitCode]) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      return { stdout, stderr, exitCode };
    });

    const { stdout, stderr, exitCode } = await Promise.race([runPromise, timeoutPromise]);
    const raw = stdout + stderr;
    const out = raw.replace(/\x1b\[[0-9;]*m/g, '');
    let pass = 0;
    let fail = 0;
    let skip = 0;
    for (const line of out.split('\n')) {
      const m = line.match(countRe);
      if (!m) continue;
      const n = Number(m[1]);
      if (m[2] === 'pass') pass = n;
      else if (m[2] === 'fail') fail = n;
      else if (m[2] === 'skip') skip = n;
    }

    totalPass += pass;
    totalFail += fail;
    totalSkip += skip;

    const ok = exitCode === 0 && fail === 0;
    const status = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`${status}  ${rel}  (${pass} pass, ${fail} fail${skip ? `, ${skip} skip` : ''})`);

    if (!ok) {
      failedFiles.push(rel);
      process.stdout.write(out.endsWith('\n') ? out : out + '\n');
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

console.log('\n' + '─'.repeat(60));
console.log(`Totals: ${totalPass} pass, ${totalFail} fail, ${totalSkip} skip across ${files.length} files`);
if (failedFiles.length > 0) {
  console.log(`\nFailed files (${failedFiles.length}):`);
  for (const f of failedFiles) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('All files passed.');
