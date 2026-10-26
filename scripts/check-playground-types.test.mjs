import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  ParseError,
  compareDiagnostics,
  loadBaseline,
  main,
  parseTscDiagnostics,
  saveBaseline,
  toDiagnosticCounts,
} from './check-playground-types.mjs'

const TSC_LINE_A =
  'apps/playground/app/widget.ts(12,34): error TS2339: Property \'end\' does not exist on type \'ScrollStage\'.'
const TSC_LINE_A_MOVED =
  'apps/playground/app/widget.ts(400,5): error TS2339: Property \'end\' does not exist on type \'ScrollStage\'.'
const TSC_LINE_B =
  'apps/playground/app/other.ts(1,1): error TS2307: Cannot find module \'x\' or its corresponding type declarations.'
const TSC_LINE_C =
  'apps/playground/app/multi.ts(3,7): error TS2345: Argument of type \'A\' is not assignable to parameter of type \'B\'.'
const TSC_LINE_C_CONTINUATION = '  Property \'q\' is missing in type \'A\' but required in type \'B\'.'
const TSC_LINE_WARNING =
  'apps/playground/app/warn.ts(2,2): warning TS6133: \'x\' is declared but its value is never read.'

describe('parseTscDiagnostics', () => {
  it('parses file/line/column/code/message and continuation lines', () => {
    const [diag] = parseTscDiagnostics(`${TSC_LINE_C}\n${TSC_LINE_C_CONTINUATION}\n`)
    expect(diag).toEqual({
      file: 'apps/playground/app/multi.ts',
      line: 3,
      column: 7,
      severity: 'error',
      code: 'TS2345',
      message: `Argument of type 'A' is not assignable to parameter of type 'B'.\n${TSC_LINE_C_CONTINUATION}`,
    })
  })

  it('parses warnings as well as errors', () => {
    const [diag] = parseTscDiagnostics(TSC_LINE_WARNING)
    expect(diag.severity).toBe('warning')
    expect(diag.code).toBe('TS6133')
  })

  it('throws on malformed output', () => {
    expect(() => parseTscDiagnostics('total garbage line')).toThrow(ParseError)
    expect(() => parseTscDiagnostics(`${TSC_LINE_A}\nunexpected trailer`)).toThrow(ParseError)
  })

  it('throws on a leading continuation with no preceding diagnostic', () => {
    expect(() => parseTscDiagnostics(TSC_LINE_C_CONTINUATION)).toThrow(ParseError)
  })
})

describe('compareDiagnostics', () => {
  it('ignores line/column moves for the same file/code/message', () => {
    const baseline = toDiagnosticCounts(parseTscDiagnostics(TSC_LINE_A))
    const current = toDiagnosticCounts(parseTscDiagnostics(TSC_LINE_A_MOVED))
    const result = compareDiagnostics(current, baseline)
    expect(result.newCount).toBe(0)
    expect(result.resolvedCount).toBe(0)
  })

  it('flags a new file/code/message as new', () => {
    const baseline = toDiagnosticCounts(parseTscDiagnostics(TSC_LINE_A))
    const current = toDiagnosticCounts(parseTscDiagnostics(`${TSC_LINE_A}\n${TSC_LINE_B}`))
    const result = compareDiagnostics(current, baseline)
    expect(result.newCount).toBe(1)
    expect(result.added[0].key).toContain('apps/playground/app/other.ts|TS2307|')
  })

  it('flags duplicate additions beyond baseline multiplicity', () => {
    const baseline = toDiagnosticCounts(parseTscDiagnostics(TSC_LINE_A))
    const current = toDiagnosticCounts(parseTscDiagnostics(`${TSC_LINE_A}\n${TSC_LINE_A_MOVED}`))
    const result = compareDiagnostics(current, baseline)
    expect(result.newCount).toBe(1)
    expect(result.added[0]).toEqual({
      key: `apps/playground/app/widget.ts|TS2339|Property 'end' does not exist on type 'ScrollStage'.`,
      count: 1,
    })
  })

  it('reports resolved diagnostics without failing', () => {
    const baseline = toDiagnosticCounts(parseTscDiagnostics(`${TSC_LINE_A}\n${TSC_LINE_B}`))
    const current = toDiagnosticCounts(parseTscDiagnostics(TSC_LINE_A))
    const result = compareDiagnostics(current, baseline)
    expect(result.newCount).toBe(0)
    expect(result.resolvedCount).toBe(1)
    expect(result.resolved[0].key).toContain('apps/playground/app/other.ts|TS2307|')
  })
})

describe('main (CLI behavior)', () => {
  let dir
  let baselinePath
  let outLines
  let errLines
  const io = () => ({ stdout: (m) => outLines.push(m), stderr: (m) => errLines.push(m) })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pg-types-'))
    baselinePath = join(dir, 'baseline.json')
    outLines = []
    errLines = []
  })

  it('--update-baseline writes the baseline and prints the total', () => {
    const exit = main({
      argv: ['--update-baseline'],
      baselinePath,
      execute: () => `${TSC_LINE_A}\n${TSC_LINE_A_MOVED}\n${TSC_LINE_B}\n`,
      ...io(),
    })
    expect(exit).toBe(0)
    const saved = JSON.parse(readFileSync(baselinePath, 'utf8'))
    expect(saved.version).toBe(1)
    expect(saved.total).toBe(3)
    expect(outLines[0]).toContain('3 diagnostics')
  })

  it('exits 0 when current diagnostics match the baseline', () => {
    saveBaseline(baselinePath, toDiagnosticCounts(parseTscDiagnostics(TSC_LINE_A)))
    const exit = main({ baselinePath, execute: () => `${TSC_LINE_A_MOVED}\n`, ...io() })
    expect(exit).toBe(0)
    expect(outLines[0]).toBe('check-playground-types: 0 new, 0 resolved, 1 current')
  })

  it('exits 1 and prints new diagnostics when one appears', () => {
    saveBaseline(baselinePath, toDiagnosticCounts(parseTscDiagnostics(TSC_LINE_A)))
    const exit = main({ baselinePath, execute: () => `${TSC_LINE_A}\n${TSC_LINE_B}\n`, ...io() })
    expect(exit).toBe(1)
    expect(errLines.some((m) => m.includes('NEW (1×)') && m.includes('TS2307'))).toBe(true)
    expect(outLines[0]).toBe('check-playground-types: 1 new, 0 resolved, 2 current')
  })

  it('exits 0 and reports resolved diagnostics', () => {
    saveBaseline(baselinePath, toDiagnosticCounts(parseTscDiagnostics(`${TSC_LINE_A}\n${TSC_LINE_B}`)))
    const exit = main({ baselinePath, execute: () => `${TSC_LINE_A}\n`, ...io() })
    expect(exit).toBe(0)
    expect(outLines[0]).toBe('check-playground-types: 0 new, 1 resolved, 1 current')
  })

  it('exits 1 loudly on tsc execution failure', () => {
    const exit = main({
      baselinePath,
      execute: () => {
        throw new Error('tsc exited 1: bad config')
      },
      ...io(),
    })
    expect(exit).toBe(1)
    expect(errLines[0]).toContain('tsc exited 1')
  })

  it('exits 1 loudly on unparseable tsc output', () => {
    const exit = main({ baselinePath, execute: () => '???\n', ...io() })
    expect(exit).toBe(1)
    expect(errLines[0]).toContain('Unexpected tsc output line')
  })

  it('round-trips through loadBaseline', () => {
    const counts = toDiagnosticCounts(parseTscDiagnostics(`${TSC_LINE_C}\n${TSC_LINE_C_CONTINUATION}\n`))
    saveBaseline(baselinePath, counts)
    expect(loadBaseline(baselinePath)).toEqual(counts)
  })
})
