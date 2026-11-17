#!/usr/bin/env bun
/**
 * Bidirectional Ontology <-> Code Changeset & Alignment Engine
 *
 * Subcommands:
 *   propose [--base <ref>] [--staged] [--slug <slug>] [--author <name>]
 *   list [--status <status>] [--json]
 *   approve <id> [--by <name>]
 *   reject <id> [--by <name>] [--reason <text>]
 *   apply <id> [--approve] [--by <name>] [--skip-sync]
 *   sync-from-ontology [--base <ref>] [--changeset <id>] [--dry-run] [--json]
 */

import { execSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'

export type ChangesetStatus =
  | 'pending_approval'
  | 'approved'
  | 'applied'
  | 'rejected'

export type ChangeCategory =
  | 'domain_model'
  | 'lang_metrics'
  | 'wql'
  | 'engine'
  | 'test_ids'
  | 'webmcp_tools'
  | 'routes'
  | 'e2e_specs'
  | 'other'

export interface FileChange {
  path: string
  status: 'A' | 'M' | 'D' | 'R'
  category: ChangeCategory
  addedSymbols: string[]
  removedSymbols: string[]
  addedMetrics: string[]
  addedTestIds: string[]
  addedTestIdPairs?: Array<{ key: string; value: string }>
  addedTools: string[]
  addedRoutes: string[]
}

export interface ImpactAnalysis {
  affectedOntologyModules: string[]
  affectedCodeTargets: string[]
  affectedE2eSpecs: string[]
  requiresCodegen: boolean
  requiresValidation: boolean
  summary: string
}

export interface ChangesetMetadata {
  id: string
  slug: string
  status: ChangesetStatus
  createdAt: string
  author: string
  baseRef: string
  approvedBy?: string
  approvedAt?: string
  appliedAt?: string
  rejectedBy?: string
  rejectedAt?: string
  rejectionReason?: string
  impactSummary?: string
  trigPath: string
  mdPath: string
}

export interface ProposeOptions {
  rootDir?: string
  changesetsDir?: string
  baseRef?: string
  staged?: boolean
  slug?: string
  author?: string
  fileChanges?: FileChange[]
  now?: Date
}

export interface ApproveOptions {
  rootDir?: string
  changesetsDir?: string
  by?: string
  now?: Date
}

export interface RejectOptions {
  rootDir?: string
  changesetsDir?: string
  by?: string
  reason?: string
  now?: Date
}

export interface ApplyOptions {
  rootDir?: string
  changesetsDir?: string
  approve?: boolean
  by?: string
  skipSync?: boolean
  now?: Date
  commandRunner?: CommandRunner
}

export interface SyncCheckResult {
  name: string
  command: string
  status: 'passed' | 'failed' | 'skipped'
  output?: string
}

export interface AlignmentReport {
  changedOntologyFiles: string[]
  checks: SyncCheckResult[]
  updatedCodeFiles: string[]
  codeFilesRequiringReview: string[]
  ok: boolean
}

export interface SyncOptions {
  rootDir?: string
  baseRef?: string
  changesetId?: string
  changesetsDir?: string
  dryRun?: boolean
  commandRunner?: CommandRunner
}

export type CommandRunner = (
  cmd: string,
  cwd: string,
) => { ok: boolean; output: string }

const DEFAULT_ROOT = join(import.meta.dirname, '..', '..')

function getChangesetsDir(rootDir: string, override?: string): string {
  return override ?? join(rootDir, 'ontology', 'changesets')
}

function defaultCommandRunner(
  cmd: string,
  cwd: string,
): { ok: boolean; output: string } {
  const res = spawnSync('bash', ['-lc', cmd], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim()
  return { ok: res.status === 0, output }
}

function escapeTurtleString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')
}

function sanitizeSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'code-sync'
}

function sanitizeIriSegment(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '_')
}

function formatTimestampForId(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    'Z',
  ].join('')
}

export function categorizeFile(filePath: string): ChangeCategory {
  const norm = filePath.replace(/\\/g, '/')
  if (norm.startsWith('packages/lang/src/metrics') || norm.startsWith('packages/lang/src/')) {
    return 'lang_metrics'
  }
  if (norm.startsWith('packages/core/src/')) {
    return 'domain_model'
  }
  if (norm.startsWith('packages/wql/src/')) {
    return 'wql'
  }
  if (
    norm.startsWith('packages/engine/src/agent/') ||
    norm.startsWith('apps/playground/app/agent/')
  ) {
    return 'webmcp_tools'
  }
  if (norm.startsWith('packages/engine/src/')) {
    return 'engine'
  }
  if (
    norm === 'apps/playground/src/lib/testIds.ts' ||
    norm === 'e2e/contracts/TestIdContract.ts'
  ) {
    return 'test_ids'
  }
  if (
    norm === 'apps/playground/src/lib/routes.ts' ||
    norm.startsWith('apps/playground/app/')
  ) {
    return 'routes'
  }
  if (norm.startsWith('e2e/specs/') || norm.startsWith('e2e/live-app/')) {
    return 'e2e_specs'
  }
  return 'other'
}

export function extractDiffSignals(
  filePath: string,
  diffText: string,
): Omit<FileChange, 'path' | 'status' | 'category'> {
  const addedSymbols = new Set<string>()
  const removedSymbols = new Set<string>()
  const addedMetrics = new Set<string>()
  const addedTestIds = new Set<string>()
  const addedTestIdPairs = new Map<string, string>()
  const addedTools = new Set<string>()
  const addedRoutes = new Set<string>()

  const symbolRe =
    /^([+-])\s*export\s+(?:async\s+)?(?:interface|class|type|enum|function|const)\s+([A-Za-z0-9_]+)/
  const metricRe = /^\+\s*(?:MetricType\.|['"]([a-z][a-zA-Z0-9_]+)['"]\s*:)/
  const testIdRe = /^\+\s*([A-Za-z0-9_]+)\s*:\s*['"]([a-z0-9-]+)['"]/
  const toolRe = /^\+\s*name\s*:\s*['"]([a-z0-9_.-]+)['"]/
  const routeRe = /^\+\s*([A-Za-z0-9_]+)\s*:\s*['"](\/[^'"]*)['"]/

  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue

    const symMatch = symbolRe.exec(line)
    if (symMatch) {
      if (symMatch[1] === '+') addedSymbols.add(symMatch[2]!)
      else removedSymbols.add(symMatch[2]!)
    }

    if (filePath.includes('metrics')) {
      const mMatch = metricRe.exec(line)
      if (mMatch && mMatch[1]) addedMetrics.add(mMatch[1])
    }

    if (filePath.includes('testIds') || filePath.includes('TestIdContract')) {
      const tMatch = testIdRe.exec(line)
      if (tMatch && tMatch[1] && tMatch[2]) {
        addedTestIds.add(tMatch[2])
        addedTestIdPairs.set(tMatch[2], tMatch[1])
      }
    }

    if (filePath.includes('agent')) {
      const toolMatch = toolRe.exec(line)
      if (toolMatch && toolMatch[1]) addedTools.add(toolMatch[1])
    }

    if (filePath.includes('routes')) {
      const rMatch = routeRe.exec(line)
      if (rMatch && rMatch[2]) addedRoutes.add(rMatch[2])
    }
  }

  // Symbols that appear in both '+' and '-' of the same file diff were modified in place, not removed.
  for (const sym of addedSymbols) {
    removedSymbols.delete(sym)
  }

  return {
    addedSymbols: [...addedSymbols].sort(),
    removedSymbols: [...removedSymbols].sort(),
    addedMetrics: [...addedMetrics].sort(),
    addedTestIds: [...addedTestIds].sort(),
    addedTestIdPairs: [...addedTestIds]
      .sort()
      .map((value) => ({ key: addedTestIdPairs.get(value) ?? value, value })),
    addedTools: [...addedTools].sort(),
    addedRoutes: [...addedRoutes].sort(),
  }
}

export function collectGitChanges(
  rootDir: string,
  options: { baseRef?: string; staged?: boolean },
): FileChange[] {
  const diffArgs = options.baseRef
    ? ['diff', '--name-status', options.baseRef]
    : options.staged
      ? ['diff', '--cached', '--name-status']
      : ['diff', '--name-status', 'HEAD']

  let rawStatus: string
  try {
    rawStatus = execSync(`git ${diffArgs.join(' ')}`, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    rawStatus = ''
  }

  const entries: Array<{ status: 'A' | 'M' | 'D' | 'R'; path: string }> = []
  const seen = new Set<string>()

  for (const line of rawStatus.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    const rawCode = parts[0]?.[0] ?? 'M'
    const status = (
      ['A', 'M', 'D', 'R'].includes(rawCode) ? rawCode : 'M'
    ) as 'A' | 'M' | 'D' | 'R'
    const filePath = (parts[2] ?? parts[1] ?? '').trim()
    if (!filePath || filePath.startsWith('ontology/changesets/')) continue
    seen.add(filePath)
    entries.push({ status, path: filePath })
  }

  if (!options.baseRef && !options.staged) {
    try {
      const untracked = execSync('git ls-files --others --exclude-standard', {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
      for (const line of untracked.split('\n')) {
        const filePath = line.trim()
        if (!filePath || seen.has(filePath) || filePath.startsWith('ontology/changesets/')) {
          continue
        }
        seen.add(filePath)
        entries.push({ status: 'A', path: filePath })
      }
    } catch {
      // ignore if not in a git repo
    }
  }

  const changes: FileChange[] = []
  for (const entry of entries) {
    const category = categorizeFile(entry.path)
    // Skip pure docs or unrelated files unless they are in tracked code/e2e areas
    if (
      category === 'other' &&
      !entry.path.startsWith('packages/') &&
      !entry.path.startsWith('apps/') &&
      !entry.path.startsWith('e2e/')
    ) {
      continue
    }

    let diffText: string
    try {
      if (entry.status === 'A' && existsSync(join(rootDir, entry.path))) {
        const content = readFileSync(join(rootDir, entry.path), 'utf8')
        diffText = content
          .split('\n')
          .map((l) => `+${l}`)
          .join('\n')
      } else {
        const refArg = options.baseRef
          ? options.baseRef
          : options.staged
            ? '--cached'
            : 'HEAD'
        diffText = execSync(`git diff -U0 ${refArg} -- "${entry.path}"`, {
          cwd: rootDir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      }
    } catch {
      diffText = ''
    }

    const signals = extractDiffSignals(entry.path, diffText)
    changes.push({
      path: entry.path,
      status: entry.status,
      category,
      ...signals,
    })
  }

  return changes
}

function collectKnownOntologyTerms(rootDir: string): Set<string> {
  const terms = new Set<string>()
  const ontDir = join(rootDir, 'ontology')
  if (!existsSync(ontDir)) return terms

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'changesets' || entry.name === 'examples') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.ttl') || entry.name.endsWith('.trig')) {
        const text = readFileSync(full, 'utf8')
        const re = /\b(?:wod|code|bridge|qa):([A-Za-z0-9_-]+)/g
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) !== null) {
          terms.add(m[1]!)
        }
      }
    }
  }
  walk(ontDir)
  return terms
}

export function analyzeImpact(files: FileChange[]): ImpactAnalysis {
  const modules = new Set<string>()
  const targets = new Set<string>()
  const specs = new Set<string>()
  let requiresCodegen = false
  let requiresValidation = false

  for (const f of files) {
    switch (f.category) {
      case 'domain_model':
        modules.add('ontology/core/')
        targets.add(f.path)
        requiresCodegen = true
        requiresValidation = true
        break
      case 'lang_metrics':
        modules.add('ontology/lang/metrics.ttl')
        targets.add(f.path)
        requiresCodegen = true
        requiresValidation = true
        break
      case 'wql':
        modules.add('ontology/wql/queries.ttl')
        targets.add(f.path)
        requiresCodegen = true
        requiresValidation = true
        break
      case 'engine':
        modules.add('ontology/engine/')
        modules.add('ontology/core/')
        targets.add(f.path)
        requiresValidation = true
        break
      case 'test_ids':
        modules.add('ontology/code/')
        modules.add('ontology/bridge/')
        targets.add('apps/playground/src/lib/testIds.ts')
        targets.add('e2e/contracts/TestIdContract.ts')
        requiresValidation = true
        break
      case 'webmcp_tools':
        modules.add('ontology/code/')
        modules.add('ontology/bridge/')
        targets.add('packages/engine/src/agent/manifest.ts')
        targets.add('apps/playground/app/agent/uiToolSpecs.ts')
        requiresValidation = true
        break
      case 'routes':
        modules.add('ontology/app/')
        modules.add('ontology/code/')
        targets.add('apps/playground/src/lib/routes.ts')
        requiresValidation = true
        break
      case 'e2e_specs':
        modules.add('ontology/qa/')
        modules.add('ontology/bridge/')
        specs.add(f.path)
        requiresValidation = true
        break
      default:
        targets.add(f.path)
    }
  }

  const modList = [...modules].sort()
  const summary =
    files.length === 0
      ? 'No tracked code changes detected.'
      : `${files.length} changed file(s) impacting ${modList.length > 0 ? modList.join(', ') : 'code graph'}`

  return {
    affectedOntologyModules: modList,
    affectedCodeTargets: [...targets].sort(),
    affectedE2eSpecs: [...specs].sort(),
    requiresCodegen,
    requiresValidation,
    summary,
  }
}

function buildProposedTriples(
  files: FileChange[],
  knownTerms: Set<string>,
): {
  addedDomain: string[]
  removedDomain: string[]
  addedCode: string[]
  removedCode: string[]
  addedBridge: string[]
  removedBridge: string[]
} {
  const addedDomain: string[] = []
  const removedDomain: string[] = []
  const addedCode: string[] = []
  const removedCode: string[] = []
  const addedBridge: string[] = []
  const removedBridge: string[] = []

  for (const f of files) {
    const fileId = `code:file_${sanitizeIriSegment(f.path)}`
    if (f.status === 'D') {
      removedCode.push(
        `  ${fileId} a code:File ;\n    code:filePath "${escapeTurtleString(f.path)}" .`,
      )
    } else {
      addedCode.push(
        `  ${fileId} a code:File ;\n    code:filePath "${escapeTurtleString(f.path)}" .`,
      )
    }

    for (const sym of f.addedSymbols) {
      const symId = `code:sym_${sanitizeIriSegment(f.path)}_${sanitizeIriSegment(sym)}`
      addedCode.push(
        `  ${symId} a code:Symbol ;\n    code:symbolName "${escapeTurtleString(sym)}" ;\n    code:scipId "${escapeTurtleString(f.path)}#${escapeTurtleString(sym)}" ;\n    code:definedIn ${fileId} .`,
      )
      if (
        (f.category === 'domain_model' ||
          f.category === 'lang_metrics' ||
          f.category === 'wql') &&
        !knownTerms.has(sym)
      ) {
        addedDomain.push(
          `  wod:${sanitizeIriSegment(sym)} a owl:Class ;\n    rdfs:label "${escapeTurtleString(sym)}" ;\n    rdfs:comment "Proposed from ${escapeTurtleString(f.path)}" .`,
        )
        addedBridge.push(
          `  ${symId} bridge:implementsDomainClass wod:${sanitizeIriSegment(sym)} .`,
        )
      }
    }

    for (const sym of f.removedSymbols) {
      const symId = `code:sym_${sanitizeIriSegment(f.path)}_${sanitizeIriSegment(sym)}`
      removedCode.push(
        `  ${symId} a code:Symbol ;\n    code:symbolName "${escapeTurtleString(sym)}" ;\n    code:scipId "${escapeTurtleString(f.path)}#${escapeTurtleString(sym)}" .`,
      )
    }

    for (const metric of f.addedMetrics) {
      if (!knownTerms.has(metric)) {
        addedDomain.push(
          `  wod:${sanitizeIriSegment(metric)} a wod:Metric ;\n    rdfs:label "${escapeTurtleString(metric)}" .`,
        )
      }
    }

    const tidPairs =
      f.addedTestIdPairs ??
      f.addedTestIds.map((value) => ({
        key: value.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
        value,
      }))
    for (const tid of tidPairs) {
      const tidId = `code:testid_${sanitizeIriSegment(tid.value)}`
      addedCode.push(
        `  ${tidId} a code:TestId ;\n    code:testIdKey "TEST_IDS.${escapeTurtleString(tid.key)}" ;\n    code:testIdValue "${escapeTurtleString(tid.value)}" ;\n    code:definedIn ${fileId} .`,
      )
    }

    for (const tool of f.addedTools) {
      const toolId = `code:tool_${sanitizeIriSegment(tool)}`
      addedCode.push(
        `  ${toolId} a code:WebMcpTool ;\n    code:toolName "${escapeTurtleString(tool)}" ;\n    code:definedIn ${fileId} .`,
      )
    }

    for (const route of f.addedRoutes) {
      const routeId = `code:route_${sanitizeIriSegment(route)}`
      addedCode.push(
        `  ${routeId} a code:Route ;\n    code:routePath "${escapeTurtleString(route)}" ;\n    code:definedIn ${fileId} .`,
      )
    }

    if (f.category === 'e2e_specs') {
      const specId = `qa:spec_${sanitizeIriSegment(f.path)}`
      addedBridge.push(
        `  ${specId} bridge:specFile ${fileId} ;\n    bridge:touches ${fileId} .`,
      )
    }
  }

  return {
    addedDomain,
    removedDomain,
    addedCode,
    removedCode,
    addedBridge,
    removedBridge,
  }
}

function renderTrig(
  meta: ChangesetMetadata,
  triples: ReturnType<typeof buildProposedTriples>,
): string {
  const lines: string[] = [
    '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix owl: <http://www.w3.org/2002/07/owl#> .',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    '@prefix prov: <http://www.w3.org/ns/prov#> .',
    '@prefix wod: <https://wod.wiki/ontology#> .',
    '@prefix code: <https://wod.wiki/ontology/code#> .',
    '@prefix bridge: <https://wod.wiki/ontology/bridge#> .',
    '@prefix qa: <https://wod.wiki/ontology/qa#> .',
    '@prefix changeset: <https://wod.wiki/ontology/changeset#> .',
    '',
    `# Ontology Changeset: ${meta.id}`,
    '',
    `<urn:wod:changeset:${meta.id}> {`,
    `  <urn:wod:changeset:${meta.id}> a changeset:OntologyChangeset , prov:Activity ;`,
    `    changeset:id "${escapeTurtleString(meta.id)}" ;`,
    `    changeset:slug "${escapeTurtleString(meta.slug)}" ;`,
    `    changeset:status "${meta.status}" ;`,
    `    changeset:baseRef "${escapeTurtleString(meta.baseRef)}" ;`,
    `    prov:generatedAtTime "${meta.createdAt}"^^xsd:dateTime ;`,
    `    prov:wasAttributedTo "${escapeTurtleString(meta.author)}" ;`,
    `    changeset:impactSummary "${escapeTurtleString(meta.impactSummary ?? '')}" .`,
    '}',
    '',
  ]

  const emitGraph = (suffix: string, label: string, body: string[]) => {
    if (body.length === 0) return
    lines.push(`# ${label}`)
    lines.push(`<urn:wod:changeset:${meta.id}:${suffix}> {`)
    lines.push(...body)
    lines.push('}')
    lines.push('')
  }

  emitGraph('added:domain', 'Proposed :domain additions', triples.addedDomain)
  emitGraph('removed:domain', 'Proposed :domain removals', triples.removedDomain)
  emitGraph('added:code', 'Proposed :code additions', triples.addedCode)
  emitGraph('removed:code', 'Proposed :code removals', triples.removedCode)
  emitGraph('added:bridge', 'Proposed :bridge additions', triples.addedBridge)
  emitGraph('removed:bridge', 'Proposed :bridge removals', triples.removedBridge)

  return lines.join('\n')
}

function renderMarkdownSummary(
  meta: ChangesetMetadata,
  files: FileChange[],
  impact: ImpactAnalysis,
  triples: ReturnType<typeof buildProposedTriples>,
): string {
  const lines: string[] = [
    `# Ontology Changeset: \`${meta.id}\``,
    '',
    `- **Status**: \`${meta.status}\``,
    `- **Slug**: \`${meta.slug}\``,
    `- **Author**: \`${meta.author}\``,
    `- **Created**: \`${meta.createdAt}\``,
    `- **Base Ref**: \`${meta.baseRef}\``,
  ]

  if (meta.approvedBy) {
    lines.push(`- **Approved By**: \`${meta.approvedBy}\` at \`${meta.approvedAt}\``)
  }
  if (meta.appliedAt) {
    lines.push(`- **Applied At**: \`${meta.appliedAt}\``)
  }
  if (meta.rejectedBy) {
    lines.push(
      `- **Rejected By**: \`${meta.rejectedBy}\` at \`${meta.rejectedAt}\`${meta.rejectionReason ? ` (${meta.rejectionReason})` : ''}`,
    )
  }

  lines.push('', '## Impact Analysis', '', impact.summary, '')
  if (impact.affectedOntologyModules.length > 0) {
    lines.push('### Affected Ontology Modules')
    for (const m of impact.affectedOntologyModules) lines.push(`- \`${m}\``)
    lines.push('')
  }
  if (impact.affectedCodeTargets.length > 0) {
    lines.push('### Affected Code Targets')
    for (const t of impact.affectedCodeTargets) lines.push(`- \`${t}\``)
    lines.push('')
  }
  if (impact.affectedE2eSpecs.length > 0) {
    lines.push('### Affected E2E Specs')
    for (const s of impact.affectedE2eSpecs) lines.push(`- \`${s}\``)
    lines.push('')
  }

  lines.push('## Changed Files', '')
  if (files.length === 0) {
    lines.push('_No code changes detected._', '')
  } else {
    for (const f of files) {
      const details: string[] = []
      if (f.addedSymbols.length) details.push(`+symbols: ${f.addedSymbols.join(', ')}`)
      if (f.removedSymbols.length) details.push(`-symbols: ${f.removedSymbols.join(', ')}`)
      if (f.addedMetrics.length) details.push(`+metrics: ${f.addedMetrics.join(', ')}`)
      if (f.addedTestIds.length) details.push(`+testIds: ${f.addedTestIds.join(', ')}`)
      if (f.addedTools.length) details.push(`+tools: ${f.addedTools.join(', ')}`)
      if (f.addedRoutes.length) details.push(`+routes: ${f.addedRoutes.join(', ')}`)
      lines.push(
        `- [${f.status}] \`${f.path}\` (\`${f.category}\`)${details.length ? ` — ${details.join('; ')}` : ''}`,
      )
    }
    lines.push('')
  }

  lines.push(
    '## Proposed Triple Counts',
    '',
    `- \`:domain\`: +${triples.addedDomain.length} / -${triples.removedDomain.length}`,
    `- \`:code\`: +${triples.addedCode.length} / -${triples.removedCode.length}`,
    `- \`:bridge\`: +${triples.addedBridge.length} / -${triples.removedBridge.length}`,
    '',
    '## Approval & Apply Workflow',
    '',
    '```bash',
    `# 1. Review ${relative(DEFAULT_ROOT, meta.trigPath)} and approve:`,
    `bun run ontology:changeset approve ${meta.id}`,
    '',
    '# 2. Apply approved changeset into canonical ontology/bridge:',
    `bun run ontology:changeset apply ${meta.id}`,
    '```',
    '',
  )

  return lines.join('\n')
}

export function proposeChangeset(options: ProposeOptions = {}): {
  metadata: ChangesetMetadata
  files: FileChange[]
  impact: ImpactAnalysis
} {
  const rootDir = options.rootDir ?? DEFAULT_ROOT
  const changesetsDir = getChangesetsDir(rootDir, options.changesetsDir)
  mkdirSync(changesetsDir, { recursive: true })

  const now = options.now ?? new Date()
  const slug = sanitizeSlug(options.slug ?? 'code-to-ontology')
  const id = `${formatTimestampForId(now)}-${slug}`
  const baseRef = options.baseRef ?? (options.staged ? 'STAGED' : 'HEAD')
  const author =
    options.author ?? process.env.GIT_AUTHOR_NAME ?? process.env.USER ?? 'agent'

  const files =
    options.fileChanges ??
    collectGitChanges(rootDir, {
      baseRef: options.baseRef,
      staged: options.staged,
    })

  const knownTerms = collectKnownOntologyTerms(rootDir)
  const impact = analyzeImpact(files)
  const triples = buildProposedTriples(files, knownTerms)

  const trigPath = join(changesetsDir, `${id}.trig`)
  const mdPath = join(changesetsDir, `${id}.md`)

  const metadata: ChangesetMetadata = {
    id,
    slug,
    status: 'pending_approval',
    createdAt: now.toISOString(),
    author,
    baseRef,
    impactSummary: impact.summary,
    trigPath,
    mdPath,
  }

  writeFileSync(trigPath, renderTrig(metadata, triples), 'utf8')
  writeFileSync(mdPath, renderMarkdownSummary(metadata, files, impact, triples), 'utf8')

  return { metadata, files, impact }
}

function parseChangesetTrig(trigPath: string): ChangesetMetadata {
  const content = readFileSync(trigPath, 'utf8')
  const extract = (pred: string): string | undefined => {
    const re = new RegExp(`${pred}\\s+"([^"]*)"`)
    return re.exec(content)?.[1]
  }
  const id =
    extract('changeset:id') ??
    trigPath.split('/').pop()!.replace(/\.trig$/, '')
  const slug = extract('changeset:slug') ?? id
  const status = (extract('changeset:status') ??
    'pending_approval') as ChangesetStatus
  const createdAt = extract('prov:generatedAtTime') ?? ''
  const author = extract('prov:wasAttributedTo') ?? 'unknown'
  const baseRef = extract('changeset:baseRef') ?? 'HEAD'
  const approvedBy = extract('changeset:approvedBy')
  const approvedAt = extract('changeset:approvedAt')
  const appliedAt = extract('changeset:appliedAt')
  const rejectedBy = extract('changeset:rejectedBy')
  const rejectedAt = extract('changeset:rejectedAt')
  const rejectionReason = extract('changeset:rejectionReason')
  const impactSummary = extract('changeset:impactSummary')

  return {
    id,
    slug,
    status,
    createdAt,
    author,
    baseRef,
    approvedBy,
    approvedAt,
    appliedAt,
    rejectedBy,
    rejectedAt,
    rejectionReason,
    impactSummary,
    trigPath,
    mdPath: trigPath.replace(/\.trig$/, '.md'),
  }
}

function resolveChangesetPath(
  idOrPrefix: string,
  changesetsDir: string,
): string {
  if (!existsSync(changesetsDir)) {
    throw new Error(`Changesets directory does not exist: ${changesetsDir}`)
  }
  const exact = join(changesetsDir, `${idOrPrefix}.trig`)
  if (existsSync(exact)) return exact

  const matches = readdirSync(changesetsDir)
    .filter((f) => f.endsWith('.trig') && f.startsWith(idOrPrefix))
    .sort()
  if (matches.length === 1) {
    return join(changesetsDir, matches[0]!)
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous changeset id "${idOrPrefix}" matched: ${matches.join(', ')}`,
    )
  }
  throw new Error(`Changeset not found: ${idOrPrefix}`)
}

function updateTrigMetadata(
  trigPath: string,
  status: ChangesetStatus,
  extraTriples: string[],
): void {
  let content = readFileSync(trigPath, 'utf8')
  content = content.replace(
    /changeset:status\s+"[^"]*"/,
    `changeset:status "${status}"`,
  )
  if (extraTriples.length > 0) {
    // Insert extra predicates before the closing " ." of the metadata resource
    const metaCloseRe = /(changeset:impactSummary\s+"[^"]*")\s*\./
    if (metaCloseRe.test(content)) {
      content = content.replace(
        metaCloseRe,
        `$1 ;\n${extraTriples.map((t) => `    ${t}`).join(' ;\n')} .`,
      )
    }
  }
  writeFileSync(trigPath, content, 'utf8')
}

function updateMarkdownStatus(mdPath: string, status: ChangesetStatus): void {
  if (!existsSync(mdPath)) return
  let content = readFileSync(mdPath, 'utf8')
  content = content.replace(
    /^- \*\*Status\*\*: `[^`]*`/m,
    `- **Status**: \`${status}\``,
  )
  writeFileSync(mdPath, content, 'utf8')
}

export function listChangesets(
  options: {
    rootDir?: string
    changesetsDir?: string
    status?: ChangesetStatus
  } = {},
): ChangesetMetadata[] {
  const rootDir = options.rootDir ?? DEFAULT_ROOT
  const changesetsDir = getChangesetsDir(rootDir, options.changesetsDir)
  if (!existsSync(changesetsDir)) return []

  const items = readdirSync(changesetsDir)
    .filter((f) => f.endsWith('.trig'))
    .sort()
    .map((f) => parseChangesetTrig(join(changesetsDir, f)))

  if (options.status) {
    return items.filter((item) => item.status === options.status)
  }
  return items
}

export function approveChangeset(
  id: string,
  options: ApproveOptions = {},
): ChangesetMetadata {
  const rootDir = options.rootDir ?? DEFAULT_ROOT
  const changesetsDir = getChangesetsDir(rootDir, options.changesetsDir)
  const trigPath = resolveChangesetPath(id, changesetsDir)
  const meta = parseChangesetTrig(trigPath)

  if (meta.status === 'applied') {
    throw new Error(`Changeset "${meta.id}" is already applied.`)
  }

  const now = (options.now ?? new Date()).toISOString()
  const by = options.by ?? process.env.USER ?? 'reviewer'

  updateTrigMetadata(trigPath, 'approved', [
    `changeset:approvedBy "${escapeTurtleString(by)}"`,
    `changeset:approvedAt "${now}"^^xsd:dateTime`,
  ])
  updateMarkdownStatus(meta.mdPath, 'approved')

  return parseChangesetTrig(trigPath)
}

export function rejectChangeset(
  id: string,
  options: RejectOptions = {},
): ChangesetMetadata {
  const rootDir = options.rootDir ?? DEFAULT_ROOT
  const changesetsDir = getChangesetsDir(rootDir, options.changesetsDir)
  const trigPath = resolveChangesetPath(id, changesetsDir)
  const meta = parseChangesetTrig(trigPath)

  if (meta.status === 'applied') {
    throw new Error(`Changeset "${meta.id}" is already applied and cannot be rejected.`)
  }

  const now = (options.now ?? new Date()).toISOString()
  const by = options.by ?? process.env.USER ?? 'reviewer'
  const extras = [
    `changeset:rejectedBy "${escapeTurtleString(by)}"`,
    `changeset:rejectedAt "${now}"^^xsd:dateTime`,
  ]
  if (options.reason) {
    extras.push(`changeset:rejectionReason "${escapeTurtleString(options.reason)}"`)
  }

  updateTrigMetadata(trigPath, 'rejected', extras)
  updateMarkdownStatus(meta.mdPath, 'rejected')

  return parseChangesetTrig(trigPath)
}

function extractAddedGraphBlocks(trigContent: string): string[] {
  const blocks: string[] = []
  const graphRe =
    /<urn:wod:changeset:[^:>]+:added:(?:domain|code|bridge)>\s*\{([\s\S]*?)\n\}/g
  let m: RegExpExecArray | null
  while ((m = graphRe.exec(trigContent)) !== null) {
    const body = m[1]?.trim()
    if (body) blocks.push(body)
  }
  return blocks
}

export function applyChangeset(
  id: string,
  options: ApplyOptions = {},
): { metadata: ChangesetMetadata; mergedInto: string; syncReport?: AlignmentReport } {
  const rootDir = options.rootDir ?? DEFAULT_ROOT
  const changesetsDir = getChangesetsDir(rootDir, options.changesetsDir)
  const trigPath = resolveChangesetPath(id, changesetsDir)
  let meta = parseChangesetTrig(trigPath)

  if (meta.status === 'applied') {
    throw new Error(`Changeset "${meta.id}" is already applied.`)
  }

  if (meta.status !== 'approved') {
    if (options.approve) {
      meta = approveChangeset(meta.id, {
        rootDir,
        changesetsDir,
        by: options.by,
        now: options.now,
      })
    } else {
      throw new Error(
        `Refusing to apply changeset "${meta.id}": status is "${meta.status}", expected "approved". Run "bun run ontology:changeset approve ${meta.id}" first or pass --approve.`,
      )
    }
  }

  const trigContent = readFileSync(trigPath, 'utf8')
  const addedBlocks = extractAddedGraphBlocks(trigContent)
  const now = (options.now ?? new Date()).toISOString()

  const canonicalAppliedPath = join(
    rootDir,
    'ontology',
    'bridge',
    'changesets-applied.ttl',
  )
  mkdirSync(join(rootDir, 'ontology', 'bridge'), { recursive: true })

  const header = [
    '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix owl: <http://www.w3.org/2002/07/owl#> .',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    '@prefix prov: <http://www.w3.org/ns/prov#> .',
    '@prefix wod: <https://wod.wiki/ontology#> .',
    '@prefix code: <https://wod.wiki/ontology/code#> .',
    '@prefix bridge: <https://wod.wiki/ontology/bridge#> .',
    '@prefix qa: <https://wod.wiki/ontology/qa#> .',
    '',
    '# Canonical triples merged from approved ontology changesets.',
    '',
  ].join('\n')

  let existing = existsSync(canonicalAppliedPath)
    ? readFileSync(canonicalAppliedPath, 'utf8')
    : header

  const marker = `# --- Applied changeset: ${meta.id} (${now}) ---`
  if (!existing.includes(`# --- Applied changeset: ${meta.id} `)) {
    const addition =
      addedBlocks.length > 0
        ? `\n${marker}\n${addedBlocks.join('\n\n')}\n`
        : `\n${marker}\n# (No added triples)\n`
    existing = existing.trimEnd() + '\n' + addition
    writeFileSync(canonicalAppliedPath, existing, 'utf8')
  }

  updateTrigMetadata(trigPath, 'applied', [
    `changeset:appliedAt "${now}"^^xsd:dateTime`,
  ])
  updateMarkdownStatus(meta.mdPath, 'applied')

  const updatedMeta = parseChangesetTrig(trigPath)

  let syncReport: AlignmentReport | undefined
  if (!options.skipSync) {
    syncReport = syncFromOntology({
      rootDir,
      changesetId: meta.id,
      changesetsDir,
      commandRunner: options.commandRunner,
    })
  }

  return {
    metadata: updatedMeta,
    mergedInto: relative(rootDir, canonicalAppliedPath),
    syncReport,
  }
}

function mapOntologyFileToCodeTargets(ontFile: string): string[] {
  const norm = ontFile.replace(/\\/g, '/')
  if (norm.startsWith('ontology/lang/')) {
    return [
      'packages/lang/src/metrics/',
      'packages/lang/src/parser/',
      'packages/lang/src/dialects/',
    ]
  }
  if (norm.startsWith('ontology/core/')) {
    return ['packages/core/src/models/', 'packages/engine/src/runtime/']
  }
  if (norm.startsWith('ontology/wql/')) {
    return ['packages/wql/src/']
  }
  if (norm.startsWith('ontology/app/')) {
    return ['apps/playground/app/', 'apps/playground/src/']
  }
  if (norm.startsWith('ontology/code/')) {
    return [
      'apps/playground/src/lib/testIds.ts',
      'e2e/contracts/TestIdContract.ts',
      'packages/engine/src/agent/manifest.ts',
    ]
  }
  if (norm.startsWith('ontology/bridge/') || norm.startsWith('ontology/qa/')) {
    return ['e2e/specs/', 'e2e/live-app/', 'docs/qa-walkthrough/']
  }
  if (norm.startsWith('ontology/shapes/')) {
    return ['ontology/examples/', 'packages/core/src/models/']
  }
  return ['packages/core/src/models/']
}

export function syncFromOntology(options: SyncOptions = {}): AlignmentReport {
  const rootDir = options.rootDir ?? DEFAULT_ROOT
  const runner = options.commandRunner ?? defaultCommandRunner
  const changedOntologyFiles = new Set<string>()

  if (options.changesetId) {
    changedOntologyFiles.add('ontology/bridge/changesets-applied.ttl')
  }

  try {
    const refArg = options.baseRef ?? 'HEAD'
    const diffOut = execSync(`git diff --name-only ${refArg} -- ontology/`, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    for (const line of diffOut.split('\n')) {
      const f = line.trim()
      if (f && !f.startsWith('ontology/changesets/')) {
        changedOntologyFiles.add(f)
      }
    }
  } catch {
    // ignore if not a git repo
  }

  const pkgPath = join(rootDir, 'package.json')
  let pkgScripts: Record<string, string> = {}
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      pkgScripts = pkg.scripts ?? {}
    } catch {
      pkgScripts = {}
    }
  }

  const candidateChecks: Array<{ name: string; command: string; available: boolean }> = [
    {
      name: 'ontology:validate',
      command: pkgScripts['ontology:validate']
        ? 'bun run ontology:validate'
        : 'bash ontology/validate.sh',
      available:
        Boolean(pkgScripts['ontology:validate']) ||
        existsSync(join(rootDir, 'ontology', 'validate.sh')),
    },
    {
      name: 'ontology:codegen',
      command: 'bun run ontology:codegen',
      available: Boolean(pkgScripts['ontology:codegen']),
    },
    {
      name: 'ontology:build',
      command: 'bun run ontology:build',
      available: Boolean(pkgScripts['ontology:build']),
    },
    {
      name: 'check:test-ids',
      command: 'bun run check:test-ids',
      available: Boolean(pkgScripts['check:test-ids']),
    },
    {
      name: 'check:agent-parity',
      command: 'bun run check:agent-parity',
      available: Boolean(pkgScripts['check:agent-parity']),
    },
  ]

  const checks: SyncCheckResult[] = []
  let ok = true

  for (const check of candidateChecks) {
    if (!check.available || options.dryRun) {
      checks.push({
        name: check.name,
        command: check.command,
        status: 'skipped',
      })
      continue
    }
    const res = runner(check.command, rootDir)
    if (!res.ok) ok = false
    checks.push({
      name: check.name,
      command: check.command,
      status: res.ok ? 'passed' : 'failed',
      output: res.output,
    })
  }

  const codeTargets = new Set<string>()
  for (const ontFile of changedOntologyFiles) {
    for (const target of mapOntologyFileToCodeTargets(ontFile)) {
      codeTargets.add(target)
    }
  }

  const updatedCodeFiles: string[] = []
  if (
    checks.some((c) => c.name === 'ontology:codegen' && c.status === 'passed')
  ) {
    updatedCodeFiles.push('ontology/generated/')
  }
  if (
    checks.some((c) => c.name === 'ontology:build' && c.status === 'passed')
  ) {
    updatedCodeFiles.push('ontology/generated/unified-dataset.trig')
  }

  return {
    changedOntologyFiles: [...changedOntologyFiles].sort(),
    checks,
    updatedCodeFiles,
    codeFilesRequiringReview: [...codeTargets].sort(),
    ok,
  }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1]
  }
  return undefined
}

function printUsage(): void {
  console.log(`Usage: bun scripts/ontology/changeset.ts <command> [options]

Commands:
  propose [--base <ref>] [--staged] [--slug <slug>] [--author <name>]
  list [--status <pending_approval|approved|applied|rejected>] [--json]
  approve <id> [--by <name>]
  reject <id> [--by <name>] [--reason <text>]
  apply <id> [--approve] [--by <name>] [--skip-sync]
  sync-from-ontology [--base <ref>] [--changeset <id>] [--dry-run] [--json]`)
}

function main(): void {
  const args = process.argv.slice(2)
  const cmd = args[0]

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printUsage()
    process.exit(0)
  }

  try {
    if (cmd === 'propose') {
      const res = proposeChangeset({
        baseRef: getFlagValue(args, '--base'),
        staged: args.includes('--staged'),
        slug: getFlagValue(args, '--slug'),
        author: getFlagValue(args, '--author'),
      })
      console.log(`Proposed changeset: ${res.metadata.id}`)
      console.log(`  Status: ${res.metadata.status}`)
      console.log(`  TriG:   ${relative(DEFAULT_ROOT, res.metadata.trigPath)}`)
      console.log(`  Review: ${relative(DEFAULT_ROOT, res.metadata.mdPath)}`)
      console.log(`  Impact: ${res.impact.summary}`)
      return
    }

    if (cmd === 'list') {
      const status = getFlagValue(args, '--status') as ChangesetStatus | undefined
      const items = listChangesets({ status })
      if (args.includes('--json')) {
        console.log(JSON.stringify(items, null, 2))
        return
      }
      if (items.length === 0) {
        console.log('No ontology changesets found.')
        return
      }
      for (const item of items) {
        console.log(
          `${item.id}  [${item.status}]  author=${item.author}  ${item.impactSummary ?? ''}`,
        )
      }
      return
    }

    if (cmd === 'approve') {
      const id = args[1]
      if (!id || id.startsWith('-')) {
        throw new Error('Missing changeset <id>.')
      }
      const meta = approveChangeset(id, { by: getFlagValue(args, '--by') })
      console.log(`Approved changeset: ${meta.id} (by ${meta.approvedBy})`)
      return
    }

    if (cmd === 'reject') {
      const id = args[1]
      if (!id || id.startsWith('-')) {
        throw new Error('Missing changeset <id>.')
      }
      const meta = rejectChangeset(id, {
        by: getFlagValue(args, '--by'),
        reason: getFlagValue(args, '--reason'),
      })
      console.log(`Rejected changeset: ${meta.id}`)
      return
    }

    if (cmd === 'apply') {
      const id = args[1]
      if (!id || id.startsWith('-')) {
        throw new Error('Missing changeset <id>.')
      }
      const res = applyChangeset(id, {
        approve: args.includes('--approve'),
        by: getFlagValue(args, '--by'),
        skipSync: args.includes('--skip-sync'),
      })
      console.log(`Applied changeset: ${res.metadata.id}`)
      console.log(`  Merged into: ${res.mergedInto}`)
      if (res.syncReport) {
        console.log(`  Alignment ok: ${res.syncReport.ok}`)
      }
      return
    }

    if (cmd === 'sync-from-ontology') {
      const report = syncFromOntology({
        baseRef: getFlagValue(args, '--base'),
        changesetId: getFlagValue(args, '--changeset'),
        dryRun: args.includes('--dry-run'),
      })
      if (args.includes('--json')) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        console.log('# Ontology -> Code Alignment Report')
        console.log(`Changed ontology files: ${report.changedOntologyFiles.length}`)
        for (const f of report.changedOntologyFiles) console.log(`  - ${f}`)
        console.log('Checks:')
        for (const c of report.checks) {
          console.log(`  - ${c.name}: ${c.status}`)
        }
        if (report.codeFilesRequiringReview.length > 0) {
          console.log('Code areas requiring alignment review:')
          for (const f of report.codeFilesRequiringReview) console.log(`  - ${f}`)
        }
      }
      if (!report.ok) process.exit(1)
      return
    }

    throw new Error(`Unknown command: ${cmd}`)
  } catch (err) {
    console.error(
      `[ontology:changeset] ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }
}

if (import.meta.main) {
  main()
}
