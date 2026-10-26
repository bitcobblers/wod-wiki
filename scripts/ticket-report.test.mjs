// Focused tests for scripts/ticket-report.mjs. Uses real temporary git repos
// and worktrees — proves main-checkout path selection and log copying without
// mocking report contents.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI = path.resolve(import.meta.dir, 'ticket-report.mjs');

let tmp;
let mainRoot;
let linkedRoot;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function run(args, cwd = linkedRoot) {
  const proc = Bun.spawnSync(['bun', CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function reportFile(slug) {
  return path.join(mainRoot, '.scratch', 'ticket-reports', slug, 'report.json');
}

function readReport(slug) {
  return JSON.parse(fs.readFileSync(reportFile(slug), 'utf8'));
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-report-'));
  mainRoot = path.join(tmp, 'repo');
  fs.mkdirSync(mainRoot);
  git(mainRoot, ['init', '-q', '-b', 'main']);
  git(mainRoot, ['config', 'user.email', 'test@example.com']);
  git(mainRoot, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(mainRoot, 'a.txt'), 'one\n');
  git(mainRoot, ['add', '.']);
  git(mainRoot, ['commit', '-qm', 'base']);
  // Second commit on main so base...HEAD has a real diff in the worktree.
  fs.writeFileSync(path.join(mainRoot, 'b.txt'), 'two\n');
  git(mainRoot, ['add', '.']);
  git(mainRoot, ['commit', '-qm', 'second']);
  const base = git(mainRoot, ['rev-parse', 'HEAD~1']);
  linkedRoot = path.join(tmp, 'linked');
  git(mainRoot, ['worktree', 'add', '-q', linkedRoot, '-b', 'feat/x']);
  fs.writeFileSync(path.join(linkedRoot, 'c.txt'), 'three\n');
  git(linkedRoot, ['add', '.']);
  git(linkedRoot, ['commit', '-qm', 'work']);
  globalThis.__base = base;
});

afterEach(() => {
  git(mainRoot, ['worktree', 'remove', '--force', linkedRoot]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('path selection and init', () => {
  it('writes the report into the MAIN checkout even when invoked from a linked worktree', () => {
    const res = run(['init', '--ticket', 'wod-1', '--base', globalThis.__base]);
    expect(res.code).toBe(0);
    expect(fs.existsSync(reportFile('wod-1'))).toBe(true);
    expect(fs.existsSync(path.join(linkedRoot, '.scratch'))).toBe(false);
    const report = readReport('wod-1');
    expect(report.schemaVersion).toBe(1);
    expect(report.ticket).toBe('wod-1');
    expect(report.baseSha).toBe(globalThis.__base);
    expect(report.headSha).toBe(git(linkedRoot, ['rev-parse', 'HEAD']));
    expect(report.changedFiles).toEqual(['b.txt', 'c.txt']);
    expect(report.behavioralAcceptance).toEqual([]);
    expect(report.focusedTests).toEqual([]);
    expect(report.e2e).toEqual([]);
    expect(report.preExistingFailures).toEqual([]);
  });

  it('works when invoked from the main checkout directly', () => {
    const res = run(['init', '--ticket', 'wod-2', '--base', globalThis.__base], mainRoot);
    expect(res.code).toBe(0);
    expect(fs.existsSync(reportFile('wod-2'))).toBe(true);
  });
  it('resolves a symbolic base ref to its commit SHA', () => {
    const res = run(['init', '--ticket', 'wod-ref', '--base', 'main']);
    expect(res.code).toBe(0);
    expect(readReport('wod-ref').baseSha).toBe(git(mainRoot, ['rev-parse', 'main']));
  });

});

describe('accept / test / known', () => {
  beforeEach(() => {
    run(['init', '--ticket', 'wod-1', '--base', globalThis.__base]);
  });

  it('appends behavioral acceptance criteria', () => {
    const res = run(['accept', '--ticket', 'wod-1', '--text', 'timer pauses on stop']);
    expect(res.code).toBe(0);
    expect(readReport('wod-1').behavioralAcceptance).toEqual(['timer pauses on stop']);
  });

  it('records focused test results with counts and specs', () => {
    const spec = path.join(tmp, 'Timer.test.ts');
    fs.writeFileSync(spec, '// spec\n');
    const res = run([
      'test', '--ticket', 'wod-1', '--kind', 'focused',
      '--command', 'bun test src/runtime', '--passed', '12', '--failed', '1', '--skipped', '3',
      '--spec', spec,
    ]);
    expect(res.code).toBe(0);
    const [entry] = readReport('wod-1').focusedTests;
    expect(entry).toMatchObject({ kind: 'focused', command: 'bun test src/runtime', passed: 12, failed: 1, skipped: 3 });
    expect(entry.specs).toEqual([spec]);
    expect(entry.logs).toBeUndefined();
    expect(readReport('wod-1').e2e).toEqual([]);
  });

  it('treats nonzero failed counts as data, not a CLI error', () => {
    const res = run([
      'test', '--ticket', 'wod-1', '--kind', 'e2e',
      '--command', 'bun run test:e2e', '--passed', '0', '--failed', '4',
    ]);
    expect(res.code).toBe(0);
    expect(readReport('wod-1').e2e[0].failed).toBe(4);
  });

  it('copies log files into the ticket logs/ directory', () => {
    const log = path.join(tmp, 'vitest.log');
    fs.writeFileSync(log, 'failure output\n');
    const res = run([
      'test', '--ticket', 'wod-1', '--kind', 'focused',
      '--command', 'bun run test', '--passed', '9', '--failed', '0', '--log', log,
    ]);
    expect(res.code).toBe(0);
    const ticketDir = path.join(mainRoot, '.scratch', 'ticket-reports', 'wod-1');
    expect(fs.readFileSync(path.join(ticketDir, 'logs', 'vitest.log'), 'utf8')).toBe('failure output\n');
    expect(readReport('wod-1').focusedTests[0].logs).toEqual(['logs/vitest.log']);
  });
  it('keeps every log when names and generated suffixes collide', () => {
    const log = path.join(tmp, 'vitest.log');
    fs.writeFileSync(log, 'new output\n');
    const ticketDir = path.join(mainRoot, '.scratch', 'ticket-reports', 'wod-1');
    fs.mkdirSync(path.join(ticketDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(ticketDir, 'logs', 'vitest.log'), 'old output\n');
    fs.writeFileSync(path.join(ticketDir, 'logs', '0-vitest.log'), 'older output\n');
    const args = ['test', '--ticket', 'wod-1', '--kind', 'focused', '--command', 'x', '--passed', '0', '--failed', '0', '--log', log];
    expect(run(args).code).toBe(0);
    expect(run(args).code).toBe(0);
    const entries = readReport('wod-1').focusedTests;
    expect(entries[0].logs).toEqual(['logs/1-vitest.log']);
    expect(entries[1].logs).toEqual(['logs/2-vitest.log']);
    expect(fs.readFileSync(path.join(ticketDir, 'logs', '0-vitest.log'), 'utf8')).toBe('older output\n');
  });


  it('appends pre-existing failures without failing', () => {
    const res = run(['known', '--ticket', 'wod-1', '--text', '4 module failures pre-exist on main']);
    expect(res.code).toBe(0);
    expect(readReport('wod-1').preExistingFailures).toEqual(['4 module failures pre-exist on main']);
  });
});

describe('finalize', () => {
  it('refreshes head, requires content, writes compact REPORT.md, prints path and counts', () => {
    run(['init', '--ticket', 'wod-1', '--base', globalThis.__base]);
    expect(run(['finalize', '--ticket', 'wod-1']).code).toBe(1); // no acceptance/test yet

    run(['accept', '--ticket', 'wod-1', '--text', 'run flow works']);
    run(['known', '--ticket', 'wod-1', '--text', 'flaky seed sync']);
    const res = run(['finalize', '--ticket', 'wod-1']);
    expect(res.code).toBe(1); // still no tests

    run(['test', '--ticket', 'wod-1', '--kind', 'focused', '--command', 'bun run test', '--passed', '5', '--failed', '0']);
    run(['test', '--ticket', 'wod-1', '--kind', 'e2e', '--command', 'bun run test:e2e', '--passed', '2', '--failed', '1']);
    const done = run(['finalize', '--ticket', 'wod-1']);
    expect(done.code).toBe(0);
    const mdPath = path.join(mainRoot, '.scratch', 'ticket-reports', 'wod-1', 'REPORT.md');
    expect(done.stdout).toContain(mdPath);
    expect(done.stdout).toContain('focused: 5 passed, 0 failed, 0 skipped');
    expect(done.stdout).toContain('e2e: 2 passed, 1 failed, 0 skipped');
    expect(done.stdout).toContain('acceptance: 1, known failures: 1');

    const md = fs.readFileSync(mdPath, 'utf8');
    expect(md).toContain('# Ticket Report: wod-1');
    expect(md).toContain('- [ ] run flow works');
    expect(md).toContain('- `bun run test` — 5 passed, 0 failed, 0 skipped');
    expect(md).toContain('- flaky seed sync');
    const report = readReport('wod-1');
    expect(report.headSha).toBe(git(linkedRoot, ['rev-parse', 'HEAD']));
  });
});

describe('validation errors', () => {
  it('rejects invalid slugs and path traversal', () => {
    for (const slug of ['WOD-1', 'wod_1', 'wod 1', '../escape', 'a/b']) {
      const res = run(['init', '--ticket', slug, '--base', globalThis.__base]);
      expect(res.code).toBe(1);
      expect(res.stderr).toContain('invalid ticket slug');
    }
  });

  it('rejects negative and non-numeric counts', () => {
    run(['init', '--ticket', 'wod-1', '--base', globalThis.__base]);
    for (const bad of ['-1', 'two', '1.5']) {
      const res = run(['test', '--ticket', 'wod-1', '--kind', 'focused', '--command', 'x', '--passed', bad, '--failed', '0']);
      expect(res.code).toBe(1);
      expect(res.stderr).toContain('non-negative integer');
    }
  });

  it('rejects missing spec and log files', () => {
    run(['init', '--ticket', 'wod-1', '--base', globalThis.__base]);
    const spec = run(['test', '--ticket', 'wod-1', '--kind', 'focused', '--command', 'x', '--passed', '0', '--failed', '0', '--spec', path.join(tmp, 'nope.spec.ts')]);
    expect(spec.code).toBe(1);
    expect(spec.stderr).toContain('does not exist');
    const log = run(['test', '--ticket', 'wod-1', '--kind', 'focused', '--command', 'x', '--passed', '0', '--failed', '0', '--log', path.join(tmp, 'nope.log')]);
    expect(log.code).toBe(1);
    expect(log.stderr).toContain('does not exist');
  });
  it('includes git stderr when the base ref is invalid', () => {
    const res = run(['init', '--ticket', 'wod-1', '--base', 'definitely-not-a-ref']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('git rev-parse definitely-not-a-ref failed');
    expect(res.stderr).toContain('definitely-not-a-ref');
  });


  it('rejects malformed commands, bad kinds, duplicates, and unknown tickets', () => {
    run(['init', '--ticket', 'wod-1', '--base', globalThis.__base]);
    expect(run(['bogus']).code).toBe(1);
    expect(run(['accept', '--ticket', 'wod-1']).code).toBe(1); // missing --text
    expect(run(['accept', '--ticket', 'wod-1', '--text']).code).toBe(1); // missing value
    const bad = run(['test', '--ticket', 'wod-1', '--kind', 'visual', '--command', 'x', '--passed', '0', '--failed', '0']);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('--kind must be');
    const dup = run(['accept', '--ticket', 'wod-1', '--text', 'a', '--text', 'b']);
    expect(dup.code).toBe(1);
    expect(dup.stderr).toContain('duplicate flag');
    const unknown = run(['accept', '--ticket', 'missing', '--text', 'x']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('run init first');
  });
});
