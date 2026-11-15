import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyChangeset,
  approveChangeset,
  listChangesets,
  proposeChangeset,
  rejectChangeset,
  syncFromOntology,
  type FileChange,
} from './changeset'

describe('ontology changeset engine', () => {
  let tempRoot: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'wod-changeset-test-'))
    writeFileSync(
      join(tempRoot, 'package.json'),
      JSON.stringify({
        name: 'test-repo',
        scripts: {
          'ontology:validate': 'echo ok',
          'ontology:codegen': 'echo ok',
          'ontology:build': 'echo ok',
          'check:test-ids': 'echo ok',
          'check:agent-parity': 'echo ok',
        },
      }),
    )
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  const sampleChanges: FileChange[] = [
    {
      path: 'packages/core/src/models/TempoTarget.ts',
      status: 'A',
      category: 'domain_model',
      addedSymbols: ['TempoTarget'],
      removedSymbols: [],
      addedMetrics: [],
      addedTestIds: [],
      addedTools: [],
      addedRoutes: [],
    },
    {
      path: 'apps/playground/src/lib/testIds.ts',
      status: 'M',
      category: 'test_ids',
      addedSymbols: [],
      removedSymbols: [],
      addedMetrics: [],
      addedTestIds: ['tempo-target-badge'],
      addedTools: [],
      addedRoutes: [],
    },
    {
      path: 'e2e/specs/workout/tempo-target.md',
      status: 'A',
      category: 'e2e_specs',
      addedSymbols: [],
      removedSymbols: [],
      addedMetrics: [],
      addedTestIds: [],
      addedTools: [],
      addedRoutes: [],
    },
  ]

  it('propose creates a pending_approval .trig changeset graph and .md summary', () => {
    const res = proposeChangeset({
      rootDir: tempRoot,
      slug: 'tempo-target',
      author: 'test-agent',
      baseRef: 'main',
      fileChanges: sampleChanges,
      now: new Date('2026-11-14T12:00:00Z'),
    })

    expect(res.metadata.status).toBe('pending_approval')
    expect(res.metadata.id).toBe('20261114T120000Z-tempo-target')
    expect(existsSync(res.metadata.trigPath)).toBe(true)
    expect(existsSync(res.metadata.mdPath)).toBe(true)

    const trig = readFileSync(res.metadata.trigPath, 'utf8')
    expect(trig).toContain('changeset:status "pending_approval"')
    expect(trig).toContain('prov:wasAttributedTo "test-agent"')
    expect(trig).toContain('wod:TempoTarget a owl:Class')
    expect(trig).toContain('code:testid_tempo-target-badge a code:TestId')
    expect(trig).toContain('bridge:implementsDomainClass wod:TempoTarget')

    // Validate TriG syntax with rapper if available
    const rapper = spawnSync('rapper', ['-i', 'trig', '-c', res.metadata.trigPath], {
      encoding: 'utf8',
    })
    if (rapper.error == null) {
      expect(rapper.status).toBe(0)
    }

    const md = readFileSync(res.metadata.mdPath, 'utf8')
    expect(md).toContain('pending_approval')
    expect(md).toContain('TempoTarget.ts')
    expect(md).toContain('ontology/core/')
  })

  it('apply blocks unapproved changesets', () => {
    const res = proposeChangeset({
      rootDir: tempRoot,
      slug: 'blocked-change',
      fileChanges: sampleChanges,
      now: new Date('2026-11-14T12:01:00Z'),
    })

    expect(() =>
      applyChangeset(res.metadata.id, {
        rootDir: tempRoot,
        skipSync: true,
      }),
    ).toThrow(/Refusing to apply changeset/)

    const listed = listChangesets({ rootDir: tempRoot })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.status).toBe('pending_approval')
  })

  it('reject marks changeset rejected and blocks apply', () => {
    const res = proposeChangeset({
      rootDir: tempRoot,
      slug: 'rejected-change',
      fileChanges: sampleChanges,
      now: new Date('2026-11-14T12:02:00Z'),
    })

    const rejected = rejectChangeset(res.metadata.id, {
      rootDir: tempRoot,
      by: 'reviewer',
      reason: 'Needs domain model split',
    })
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectionReason).toBe('Needs domain model split')

    expect(() =>
      applyChangeset(res.metadata.id, {
        rootDir: tempRoot,
        skipSync: true,
      }),
    ).toThrow(/Refusing to apply changeset/)
  })

  it('approve followed by apply merges triples, marks applied, and runs alignment sync', () => {
    const res = proposeChangeset({
      rootDir: tempRoot,
      slug: 'approved-change',
      fileChanges: sampleChanges,
      now: new Date('2026-11-14T12:03:00Z'),
    })

    const approved = approveChangeset(res.metadata.id, {
      rootDir: tempRoot,
      by: 'human-reviewer',
      now: new Date('2026-11-14T12:04:00Z'),
    })
    expect(approved.status).toBe('approved')
    expect(approved.approvedBy).toBe('human-reviewer')

    const ranCommands: string[] = []
    const applied = applyChangeset(res.metadata.id, {
      rootDir: tempRoot,
      now: new Date('2026-11-14T12:05:00Z'),
      commandRunner: (cmd) => {
        ranCommands.push(cmd)
        return { ok: true, output: 'ok' }
      },
    })

    expect(applied.metadata.status).toBe('applied')
    expect(applied.mergedInto).toBe('ontology/bridge/changesets-applied.ttl')
    expect(applied.syncReport?.ok).toBe(true)
    expect(ranCommands).toContain('bun run ontology:validate')
    expect(ranCommands).toContain('bun run ontology:codegen')
    expect(ranCommands).toContain('bun run ontology:build')
    expect(ranCommands).toContain('bun run check:test-ids')
    expect(ranCommands).toContain('bun run check:agent-parity')

    const mergedPath = join(tempRoot, applied.mergedInto)
    expect(existsSync(mergedPath)).toBe(true)
    const mergedTtl = readFileSync(mergedPath, 'utf8')
    expect(mergedTtl).toContain('wod:TempoTarget a owl:Class')

    // Validate merged Turtle syntax with rapper if available
    const rapper = spawnSync('rapper', ['-i', 'turtle', '-c', mergedPath], {
      encoding: 'utf8',
    })
    if (rapper.error == null) {
      expect(rapper.status).toBe(0)
    }
  })

  it('apply with --approve flag approves and applies in one explicit step', () => {
    const res = proposeChangeset({
      rootDir: tempRoot,
      slug: 'inline-approve',
      fileChanges: sampleChanges,
      now: new Date('2026-11-14T12:06:00Z'),
    })

    const applied = applyChangeset(res.metadata.id, {
      rootDir: tempRoot,
      approve: true,
      by: 'human-cli',
      skipSync: true,
    })

    expect(applied.metadata.status).toBe('applied')
    expect(applied.metadata.approvedBy).toBe('human-cli')
  })

  it('syncFromOntology reports checks and code targets', () => {
    const report = syncFromOntology({
      rootDir: tempRoot,
      changesetId: 'test-id',
      commandRunner: () => ({ ok: true, output: 'ok' }),
    })

    expect(report.ok).toBe(true)
    expect(report.changedOntologyFiles).toContain(
      'ontology/bridge/changesets-applied.ttl',
    )
    expect(report.codeFilesRequiringReview).toContain('e2e/specs/')
  })
})
