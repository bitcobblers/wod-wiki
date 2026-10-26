// Baseline-aware TypeScript gate for the playground app.
//
// `bun x tsc --noEmit` emits hundreds of pre-existing diagnostics that are
// tracked as follow-up work (see typecheck:playground's skip message). This
// gate fails only when a diagnostic that is NEW relative to the checked-in
// baseline appears — line/column moves and resolved diagnostics never fail
// the gate, but tsc execution errors and unparseable output always do.
//
// Regenerate the baseline after an intentional cleanup:
//   bun scripts/check-playground-types.mjs --update-baseline

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const BASELINE_VERSION = 1
export const TSC_ARGS = [
  'x',
  'tsc',
  '--noEmit',
  '--pretty',
  'false',
  '-p',
  'apps/playground/tsconfig.json',
]

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DEFAULT_BASELINE_PATH = fileURLToPath(
  new URL('./baselines/playground-types.json', import.meta.url),
)

const DIAGNOSTIC_RE = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/
const CONTINUATION_RE = /^\s+\S/

export class ParseError extends Error {
  constructor(line) {
    super(`Unexpected tsc output line: ${JSON.stringify(line)}`)
    this.name = 'ParseError'
  }
}

/**
 * Parse `bun x tsc --pretty false` stdout into diagnostics keyed by
 * relative file + TS code + message (line/column stripped so moves are
 * invisible). Multi-line messages keep their continuation lines verbatim.
 * Any output that is neither a diagnostic nor a continuation line throws.
 */
export function parseTscDiagnostics(output) {
  const lines = output.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop() // trailing newline only
  const diagnostics = []
  for (const line of lines) {
    const match = DIAGNOSTIC_RE.exec(line)
    if (match) {
      const [, file, lineNo, colNo, severity, code, message] = match
      diagnostics.push({
        file: relativePath(file),
        line: Number(lineNo),
        column: Number(colNo),
        severity,
        code,
        message,
      })
      continue
    }
    const last = diagnostics.at(-1)
    if (last && CONTINUATION_RE.test(line)) {
      last.message += `\n${line.trimEnd()}`
      continue
    }
    throw new ParseError(line)
  }
  return diagnostics
}

function relativePath(file) {
  // tsc prints paths relative to the repo root for our invocation; keep
  // relative ones verbatim and only relativize absolute ones.
  return isAbsolute(file) ? relative(REPO_ROOT, file) : file
}

/** Multiset of diagnostics: `${file}|${code}|${message}` -> count. */
export function toDiagnosticCounts(diagnostics) {
  const counts = {}
  for (const d of diagnostics) {
    const key = `${d.file}|${d.code}|${d.message}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

/**
 * Compare current counts against the baseline counts. Keys present in
 * current beyond their baseline multiplicity are NEW (fail); keys whose
 * baseline multiplicity exceeds current are RESOLVED (reported, pass).
 */
export function compareDiagnostics(current, baseline) {
  const added = []
  let newCount = 0
  for (const [key, count] of Object.entries(current)) {
    const extra = count - (baseline[key] ?? 0)
    if (extra > 0) {
      added.push({ key, count: extra })
      newCount += extra
    }
  }
  const resolved = []
  let resolvedCount = 0
  for (const [key, count] of Object.entries(baseline)) {
    const missing = count - (current[key] ?? 0)
    if (missing > 0) {
      resolved.push({ key, count: missing })
      resolvedCount += missing
    }
  }
  return {
    added: added.sort((a, b) => a.key.localeCompare(b.key)),
    resolved: resolved.sort((a, b) => a.key.localeCompare(b.key)),
    newCount,
    resolvedCount,
    currentCount: Object.values(current).reduce((sum, n) => sum + n, 0),
  }
}

export function loadBaseline(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (raw.version !== BASELINE_VERSION || typeof raw.diagnostics !== 'object' || raw.diagnostics === null) {
    throw new Error(`Baseline ${path} has unsupported shape (version=${raw.version})`)
  }
  return raw.diagnostics
}

export function saveBaseline(path, counts) {
  const sorted = Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  )
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify(
      { version: BASELINE_VERSION, total: Object.values(sorted).reduce((s, n) => s + n, 0), diagnostics: sorted },
      null,
      2,
    ) + '\n',
  )
}

function executeTsc() {
  const result = spawnSync('bun', TSC_ARGS, { cwd: REPO_ROOT, encoding: 'utf8' })
  if (result.error) throw new Error(`Failed to launch tsc: ${result.error.message}`)
  if (result.stderr) throw new Error(`tsc wrote to stderr:\n${result.stderr}`)
  // tsc exits 0 (clean) or 2 (diagnostics emitted); anything else is a
  // config/execution failure and must never read as baseline success.
  if (result.status !== 0 && result.status !== 2) {
    throw new Error(`tsc exited ${result.status}:\n${result.stdout}`)
  }
  return result.stdout
}

/**
 * CLI core. `execute` and `baselinePath` are injectable for tests.
 * Returns the process exit code: nonzero only for new diagnostics or
 * execution/parse failures.
 */
export function main({
  argv = [],
  execute = executeTsc,
  baselinePath = DEFAULT_BASELINE_PATH,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const updateBaseline = argv.includes('--update-baseline')
  let diagnostics
  try {
    diagnostics = parseTscDiagnostics(execute())
  } catch (err) {
    stderr(`check-playground-types: FAILED — ${err.message}`)
    return 1
  }
  const counts = toDiagnosticCounts(diagnostics)
  if (updateBaseline) {
    saveBaseline(baselinePath, counts)
    stdout(`check-playground-types: baseline updated — ${Object.values(counts).reduce((s, n) => s + n, 0)} diagnostics in ${baselinePath}`)
    return 0
  }
  let baseline
  try {
    baseline = loadBaseline(baselinePath)
  } catch (err) {
    stderr(`check-playground-types: FAILED — cannot load baseline: ${err.message}`)
    return 1
  }
  const { added, resolved, newCount, resolvedCount, currentCount } = compareDiagnostics(counts, baseline)
  for (const { key, count } of added.slice(0, 20)) {
    const [file, code, ...rest] = key.split('|')
    stderr(`NEW (${count}×) ${file} ${code}: ${rest.join('|')}`)
  }
  stdout(
    `check-playground-types: ${newCount} new, ${resolvedCount} resolved, ${currentCount} current`,
  )
  if (newCount > 0) {
    stderr(
      newCount > 20
        ? `check-playground-types: FAILED — ${newCount} new diagnostics (first 20 shown). Fix them or regenerate with --update-baseline.`
        : `check-playground-types: FAILED — fix new diagnostics or regenerate with --update-baseline.`,
    )
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main({ argv: process.argv.slice(2) })
}
