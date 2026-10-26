#!/usr/bin/env node
// Machine-readable ticket reports for workmux validation flows.
// Reports always live in the MAIN checkout at
// .scratch/ticket-reports/<slug>/report.json so workmux cleanup of a linked
// worktree cannot lose them. Logs referenced via --log are copied into the
// ticket's logs/ directory for the same reason.
// Usage: bun scripts/ticket-report.mjs <init|accept|test|known|finalize> [flags]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COUNT_RE = /^\d+$/;

function fail(msg) {
  console.error(`ticket-report: error: ${msg}`);
  process.exit(1);
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    fail(`git ${args.join(' ')} failed: ${detail}`);
  }
}

// Main checkout = first entry of `git worktree list --porcelain`, regardless
// of the cwd being a linked worktree.
export function resolveMainRoot(cwd) {
  const out = git(cwd, ['worktree', 'list', '--porcelain']);
  const first = out.split('\n').find((l) => l.startsWith('worktree '));
  if (!first) fail('could not determine main worktree from `git worktree list --porcelain`');
  return first.slice('worktree '.length);
}

function headSha(cwd) {
  return git(cwd, ['rev-parse', 'HEAD']);
}

function changedFiles(cwd, base) {
  return git(cwd, ['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const multi = { spec: [], log: [] };
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!key.startsWith('--')) fail(`malformed argument: ${key}`);
    const name = key.slice(2);
    const value = rest[++i];
    if (value === undefined || value.startsWith('--')) fail(`missing value for ${key}`);
    if (name === 'spec' || name === 'log') multi[name].push(value);
    else if (flags[name] !== undefined) fail(`duplicate flag ${key}`);
    else flags[name] = value;
  }
  return { command, flags, multi };
}

function requireFlag(flags, name) {
  if (flags[name] === undefined || flags[name] === '') fail(`missing required --${name}`);
  return flags[name];
}

function requireCount(flags, name, { required }) {
  const raw = flags[name];
  if (raw === undefined) {
    if (required) fail(`missing required --${name}`);
    return 0;
  }
  if (!COUNT_RE.test(raw)) fail(`--${name} must be a non-negative integer, got "${raw}"`);
  return Number(raw);
}

function validateSlug(slug) {
  if (!SLUG_RE.test(slug)) {
    fail(`invalid ticket slug "${slug}" (lowercase letters, digits, and dashes only)`);
  }
}

function reportDir(mainRoot, slug) {
  return path.join(mainRoot, '.scratch', 'ticket-reports', slug);
}

function reportPath(mainRoot, slug) {
  return path.join(reportDir(mainRoot, slug), 'report.json');
}

function loadReport(mainRoot, slug) {
  const file = reportPath(mainRoot, slug);
  if (!fs.existsSync(file)) {
    fail(`no report for "${slug}" at ${file} — run init first`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveReport(mainRoot, slug, report) {
  fs.mkdirSync(reportDir(mainRoot, slug), { recursive: true });
  fs.writeFileSync(reportPath(mainRoot, slug), JSON.stringify(report, null, 2) + '\n');
}

function assertFile(label, file) {
  if (!fs.existsSync(file)) fail(`${label} file does not exist: ${file}`);
}

function copyLogs(mainRoot, slug, logs) {
  if (!logs.length) return [];
  const dir = path.join(reportDir(mainRoot, slug), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const copied = [];
  for (const log of logs) {
    assertFile('--log', log);
    const base = path.basename(log);
    let finalDest = path.join(dir, base);
    let collision = 0;
    while (fs.existsSync(finalDest)) {
      collision += 1;
      finalDest = path.join(dir, `${collision}-${base}`);
    }
    fs.copyFileSync(log, finalDest);
    copied.push(path.relative(reportDir(mainRoot, slug), finalDest));
  }
  return copied;
}

function cmdInit(mainRoot, cwd, flags) {
  const ticket = requireFlag(flags, 'ticket');
  const base = requireFlag(flags, 'base');
  validateSlug(ticket);
  if (fs.existsSync(reportPath(mainRoot, ticket))) {
    fail(`report already exists for "${ticket}"`);
  }
  saveReport(mainRoot, ticket, {
    schemaVersion: SCHEMA_VERSION,
    ticket,
    baseSha: git(cwd, ['rev-parse', base]),
    headSha: headSha(cwd),
    changedFiles: changedFiles(cwd, base),
    behavioralAcceptance: [],
    focusedTests: [],
    e2e: [],
    preExistingFailures: [],
  });
}

function cmdAccept(mainRoot, flags) {
  const ticket = requireFlag(flags, 'ticket');
  const text = requireFlag(flags, 'text');
  validateSlug(ticket);
  const report = loadReport(mainRoot, ticket);
  report.behavioralAcceptance.push(text);
  saveReport(mainRoot, ticket, report);
}

function cmdTest(mainRoot, cwd, flags, multi) {
  const ticket = requireFlag(flags, 'ticket');
  validateSlug(ticket);
  const kind = requireFlag(flags, 'kind');
  if (kind !== 'focused' && kind !== 'e2e') fail(`--kind must be "focused" or "e2e", got "${kind}"`);
  const command = requireFlag(flags, 'command');
  const passed = requireCount(flags, 'passed', { required: true });
  const failed = requireCount(flags, 'failed', { required: true });
  const skipped = requireCount(flags, 'skipped', { required: false });
  for (const spec of multi.spec) assertFile('--spec', spec);
  const report = loadReport(mainRoot, ticket);
  const entry = { kind, command, passed, failed, skipped };
  if (multi.spec.length) entry.specs = multi.spec.map((s) => path.resolve(s));
  const logs = copyLogs(mainRoot, ticket, multi.log);
  if (logs.length) entry.logs = logs;
  (kind === 'focused' ? report.focusedTests : report.e2e).push(entry);
  saveReport(mainRoot, ticket, report);
}

function cmdKnown(mainRoot, flags) {
  const ticket = requireFlag(flags, 'ticket');
  const text = requireFlag(flags, 'text');
  validateSlug(ticket);
  const report = loadReport(mainRoot, ticket);
  report.preExistingFailures.push(text);
  saveReport(mainRoot, ticket, report);
}

function summarize(tests) {
  return tests.reduce(
    (acc, t) => ({
      passed: acc.passed + t.passed,
      failed: acc.failed + t.failed,
      skipped: acc.skipped + t.skipped,
    }),
    { passed: 0, failed: 0, skipped: 0 },
  );
}

function fmtSummary(label, s) {
  return `${label}: ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped`;
}

function cmdFinalize(mainRoot, cwd, flags) {
  const ticket = requireFlag(flags, 'ticket');
  validateSlug(ticket);
  const report = loadReport(mainRoot, ticket);
  report.headSha = headSha(cwd);
  if (report.baseSha) report.changedFiles = changedFiles(cwd, report.baseSha);
  const problems = [];
  if (!report.baseSha) problems.push('baseSha is missing');
  if (!report.headSha) problems.push('headSha is missing');
  if (!report.behavioralAcceptance.length) problems.push('at least one behavioral acceptance is required');
  if (!report.focusedTests.length && !report.e2e.length) problems.push('at least one test result is required');
  if (problems.length) fail(`cannot finalize "${ticket}": ${problems.join('; ')}`);
  saveReport(mainRoot, ticket, report);

  const lines = [
    `# Ticket Report: ${ticket}`,
    '',
    `- Base: ${report.baseSha}`,
    `- Head: ${report.headSha}`,
    `- Changed files (${report.changedFiles.length}): ${report.changedFiles.join(', ') || 'none'}`,
    '',
    '## Behavioral Acceptance',
    ...report.behavioralAcceptance.map((a) => `- [ ] ${a}`),
    '',
  ];
  for (const [label, tests] of [['Focused Tests', report.focusedTests], ['E2E', report.e2e]]) {
    lines.push(`## ${label}`, ...tests.map(
      (t) => `- \`${t.command}\` — ${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped` +
        (t.specs?.length ? ` (${t.specs.length} specs)` : '') +
        (t.logs?.length ? ` [logs: ${t.logs.join(', ')}]` : ''),
    ), '');
  }
  lines.push(
    '## Pre-existing Failures',
    ...report.preExistingFailures.map((f) => `- ${f}`),
  );
  const mdPath = path.join(reportDir(mainRoot, ticket), 'REPORT.md');
  fs.writeFileSync(mdPath, lines.join('\n') + '\n');

  const focused = summarize(report.focusedTests);
  const e2e = summarize(report.e2e);
  console.log(mdPath);
  console.log(fmtSummary('focused', focused));
  console.log(fmtSummary('e2e', e2e));
  console.log(`acceptance: ${report.behavioralAcceptance.length}, known failures: ${report.preExistingFailures.length}`);
}

export function run(argv, cwd = process.cwd()) {
  const { command, flags, multi } = parseArgs(argv);
  const mainRoot = resolveMainRoot(cwd);
  switch (command) {
    case 'init': cmdInit(mainRoot, cwd, flags); break;
    case 'accept': cmdAccept(mainRoot, flags); break;
    case 'test': cmdTest(mainRoot, cwd, flags, multi); break;
    case 'known': cmdKnown(mainRoot, flags); break;
    case 'finalize': cmdFinalize(mainRoot, cwd, flags); break;
    default: fail(`unknown command "${command ?? ''}" — expected init|accept|test|known|finalize`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    run(process.argv.slice(2));
  } catch (err) {
    if (err && err.code === 'ENOENT' && err.path === 'git') fail('git is required');
    fail(err.message);
  }
}
