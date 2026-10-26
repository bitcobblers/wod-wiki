/**
 * wqlSearchSource — WQL-driven sources for the global Search Palette
 * (issue #834, decision #828).
 *
 * Asserts:
 *   1. Invalid WQL-intent drafts (':' prefix) yield no rows and never execute.
 *   2. :note results map to entry palette items (kind → category).
 *   3. Whole-Note text search preserves executor filtering and paging.
 *   4. :block hits map to entries via the synthesized note.
 *   5. Find-mode plain prose merges VERBATIM as a `text:` phrase into the
 *      live scope (context.scopeWql, else the route default); an empty draft
 *      restores that scope unfiltered — asserted through a corpus executor
 *      returning real entry identities, never forwarded-call echoes.
 *   6. scopedTextQuery merges/clears text occurrences, preserving scope,
 *      windows, and pipes (real parser/serializer round-trip).
 *   7. paletteTextFromWql extracts text terms (valid + salvaged invalid).
 *   8. withWqlText delegates with the extracted text, never raw WQL.
 *   9. searchPaletteQuery compiles to the unbounded global default.
 */
import { describe, expect, it, mock, afterEach } from 'bun:test'

import { parseQuery, isFindQuery, type ParsedFindQuery } from '@bitcobblers/wod-wiki-engine'
import type { FindQueryResult } from '@bitcobblers/wod-wiki-engine'
import type { BlockIndexRow, Note } from '@/types/storage'
import type { Entry } from '../lib/entryMapper'

// ── Service mock (spread real module so unlisted exports stay real) ─────────

/** The parsed query shape the pipeline hands the executor. */
type RunFindParsed = {
  raw?: string
  target?: string
  filters?: Array<{ key: string; negate?: boolean; values: Array<{ value: string }> }>
}

let runFindCalls: Array<{ raw?: string; target?: string }>
let runFindImpl: (parsed: RunFindParsed) => Promise<FindQueryResult>

mock.module('@/services/queryService', () => ({
  queryService: {
    runFind: mock((parsed: RunFindParsed) => {
      runFindCalls.push(parsed)
      return runFindImpl(parsed)
    }),
  },
}))

import {
  wqlSearchSource,
  paletteTextFromWql,
  withWqlText,
  scopedTextQuery,
  searchPaletteQuery,
  navigatePaletteResult,
  PALETTE_SEED_QUERY,
} from './wqlSearchSource'
import { writeRouteWqlConfig, clearRouteWqlConfig, PALETTE_ROUTE_ID } from '../lib/routeWqlConfig'

const JOURNAL_NOTE: Note = {
  id: 'journal/2026-07-30',
  title: 'Heavy Fran',
  createdAt: Date.parse('2026-07-30T10:00:00Z'),
  type: 'note',
  rawContent: 'Heavy training observations.', sourceRevision: 1, blocks: {},
} as Note

const STATIC_BLOCK: BlockIndexRow = {
  id: 'girl-wods/fran:s1:1',
  noteId: 'girl-wods/fran',
  blockId: 's1',
  blockVersion: 1,
  sourceRevision: 1, from: 0, to: 35,
  dataType: 'wod',
  rawContent: '21-15-9 Thrusters and Pull-ups',
  noteTitle: 'Fran',
  createdAt: Date.parse('2026-01-01T00:00:00Z'),
  isStatic: true,
  sourceId: 'collection:girl-wods',
}

const emptyResult = (raw: string): FindQueryResult => ({
  parsed: parseQuery(raw) as FindQueryResult['parsed'],
  notes: [],
  blocks: [],
  stages: { selected: 0, matched: 0 },
})

function setup(impl: (parsed: RunFindParsed) => Promise<FindQueryResult>) {
  runFindCalls = []
  runFindImpl = impl
}

describe('wqlSearchSource', () => {
  afterEach(() => {
    clearRouteWqlConfig(PALETTE_ROUTE_ID)
  })

  it('returns no rows for invalid WQL and never executes', async () => {
    setup(async parsed => emptyResult(parsed.raw ?? ''))
    // Multi-word text is a reachable composer state that fails the grammar.
    const results = await wqlSearchSource().search(':note{text:hello world} in all')
    expect(results).toEqual([])
    expect(runFindCalls).toEqual([])
  })

  it('maps :note results to journal entry items', async () => {
    setup(async parsed => {
      const result = emptyResult(parsed.raw ?? '')
      result.notes = [JOURNAL_NOTE]
      return result
    })
    const results = await wqlSearchSource().search(':note in journal')

    expect(results).toHaveLength(1)
    const item = results[0]!
    expect(item.id).toBe('entry:journal/2026-07-30')
    expect(item.label).toBe('Heavy Fran')
    expect(item.category).toBe('Journal')
    expect(item.type).toBe('entry')
    const entry = item.payload as Entry
    expect(entry.kind).toBe('note')
    expect(entry.sourceItem).toBe('journal/2026-07-30')
  })

  it('keeps whole-Note text filtering in one executor request', async () => {
    setup(async parsed => ({ ...emptyResult(parsed.raw ?? ''), notes: [JOURNAL_NOTE] }))
    const results = await wqlSearchSource().search(':note{text:fran} in all')
    expect(runFindCalls.map(c => c.raw)).toEqual([':note{text:fran} in all'])
    expect(results.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])
  })

  it('maps :block hits to session entries via the synthesized note', async () => {
    setup(async parsed => {
      const result = emptyResult(parsed.raw ?? '')
      result.blocks = [STATIC_BLOCK]
      return result
    })
    const results = await wqlSearchSource().search(':block{type:wod} in feeds')

    expect(results).toHaveLength(1)
    const item = results[0]!
    expect(item.id).toBe('entry:girl-wods/fran')
    expect(item.label).toBe('Fran')
    expect(item.category).toBe('Notebooks')
    const entry = item.payload as Entry
    expect(entry.kind).toBe('note')
    expect(entry.sourceCatalog).toBe('girl-wods')
  })

  it('finds body matches for plain words inside the live scope', async () => {
    setup(corpusExecutor([JOURNAL_ROW]))
    const results = await wqlSearchSource().search('pushup', { scopeWql: ':note in journal' })

    expect(results.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])
    expect(results[0]!.label).toBe('Heavy Fran')
  })

  it('keeps prose words like in/last/where and never matches outside the live scope', async () => {
    setup(corpusExecutor([JOURNAL_ROW]))
    const prose = await wqlSearchSource().search('workout in the park last week', { scopeWql: ':note in journal' })
    expect(prose.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])

    // The corpus is journal-only: a feeds scope fabricates nothing.
    const other = await wqlSearchSource().search('pushup', { scopeWql: ':note in feeds' })
    expect(other).toEqual([])
  })

  it('restores the scoped identities when the plain draft clears', async () => {
    setup(corpusExecutor([JOURNAL_ROW]))
    // A stale positive text that matches nothing must not survive a clear.
    const results = await wqlSearchSource().search('', { scopeWql: ':note{source:journal,text:nonsense}' })

    expect(results.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])
  })

  it('finds plain words in the configured route default scope, not a hardcoded one', async () => {
    // A block-target stored default: neither the seed scope (journal|
    // collection) nor a hardcoded ':note' head can produce this identity.
    await writeRouteWqlConfig(PALETTE_ROUTE_ID, { defaultWql: ':block{type:wod}' })
    setup(corpusExecutor([JOURNAL_ROW, FEED_ROW]))
    const results = await wqlSearchSource().search('ladder')

    expect(results.map(r => r.id)).toEqual([`entry:${FEED_ROW.note.id}`])
  })

  it('accepts multiword and quoted drafts as one phrase inside the scope', async () => {
    setup(corpusExecutor([JOURNAL_ROW]))
    const multiword = await wqlSearchSource().search('pushup fran', { scopeWql: ':note in journal' })
    expect(multiword.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])

    const quoted = await wqlSearchSource().search('"pushup fran"', { scopeWql: ':note in journal' })
    expect(quoted.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])
  })
})

/** Fixture corpus row: a note plus the body text its blocks carry. */
interface CorpusRow {
  note: Note
  body: string
  source: string
}

const JOURNAL_ROW: CorpusRow = {
  note: JOURNAL_NOTE,
  body: 'remediated workout in the park last week where pushup fran showed up',
  source: 'journal',
}

const FEED_ROW: CorpusRow = {
  note: { id: 'feeds/feed-a/2026-01-01/note-0', title: 'Feed note', createdAt: 1, type: 'note', sourceId: 'feed:feeds/feed-a/2026-01-01/note-0', rawContent: 'pushup ladder', sourceRevision: 1, blocks: {} },
  body: 'pushup ladder',
  source: 'feeds',
}

/** Applies what the source sent — target, positive source scope, positive
 *  text terms — over the fixture corpus, so assertions see the identities
 *  real queries would return. */
function corpusExecutor(corpus: CorpusRow[]) {
  return async (parsed: RunFindParsed): Promise<FindQueryResult> => {
    const filters = parsed.filters ?? []
    const terms = filters
      .filter(f => f.key === 'text' && !f.negate)
      .flatMap(f => f.values.map(v => v.value))
    const sources = filters
      .filter(f => f.key === 'source' && !f.negate)
      .flatMap(f => f.values.map(v => v.value))
    const result = emptyResult(parsed.raw ?? '')
    const hits = corpus.filter(row =>
      (sources.length === 0 || sources.includes(row.source))
      && (terms.length === 0 || terms.every(t => row.note.title.includes(t) || row.body.includes(t))))
    if (parsed.target === 'note') result.notes = hits.map(h => h.note)
    if (parsed.target === 'block') {
      result.blocks = hits.map(h => ({ ...STATIC_BLOCK, noteId: h.note.id, noteTitle: h.note.title, sourceId: undefined, rawContent: h.body }))
    }
    return result
  }
}

/** Reparse helpers — scopedTextQuery assertions read the merged query's
 *  parsed identity, never its raw text. */
function findOf(raw: string): ParsedFindQuery | null {
  const parsed = parseQuery(raw)
  return !parsed.error && isFindQuery(parsed) ? parsed : null
}

function textFiltersOf(parsed: ParsedFindQuery): string[] {
  return parsed.filters
    .filter(f => f.key === 'text' && !f.negate)
    .flatMap(f => f.values.map(v => v.value))
}

function sourceValuesOf(parsed: ParsedFindQuery): string[] {
  return parsed.filters
    .filter(f => f.key === 'source' && !f.negate)
    .flatMap(f => f.values.map(v => v.value))
}

describe('scopedTextQuery', () => {
  it('quotes multiword terms and keeps the scope structure', () => {
    const merged = findOf(scopedTextQuery(findOf(PALETTE_SEED_QUERY)!, 'two words'))!
    expect(textFiltersOf(merged)).toEqual(['two words'])
    expect(sourceValuesOf(merged)).toEqual(['journal', 'feeds'])
    expect(merged.groupBy).toContain('date')
  })

  it('keeps prose words like in/last/where in the text value', () => {
    const merged = findOf(scopedTextQuery(findOf(PALETTE_SEED_QUERY)!, 'workout in the park last week where fran won'))!
    expect(textFiltersOf(merged)).toEqual(['workout in the park last week where fran won'])
  })

  it('replaces the positive text occurrence and keeps negations', () => {
    const scope = findOf(':note{text:old,!text:junk,source:journal}')!
    const merged = findOf(scopedTextQuery(scope, 'fran'))!
    expect(textFiltersOf(merged)).toEqual(['fran'])
    expect(merged.filters.some(f => f.key === 'text' && f.negate && f.values.some(v => v.value === 'junk'))).toBe(true)
  })

  it('drops the positive text occurrence for empty terms', () => {
    const scope = findOf(':note{text:old,source:journal}')!
    const merged = findOf(scopedTextQuery(scope, ''))!
    expect(textFiltersOf(merged)).toEqual([])
    expect(sourceValuesOf(merged)).toEqual(['journal'])
  })

  it('keeps windows and pipes from the scope', () => {
    const scope = findOf(':note in journal | order by date | limit 50')!
    const merged = findOf(scopedTextQuery(scope, 'pushup'))!
    expect(sourceValuesOf(merged)).toEqual(['journal'])
    expect(merged.pipes?.limit).toBe(50)
    expect(merged.pipes?.order).toBeDefined()
  })
})

describe('paletteTextFromWql', () => {
  it('extracts text filter values from valid queries', () => {
    expect(paletteTextFromWql(':note{text:fran, tags:girl} in all')).toBe('fran')
  })

  it('returns an empty string when the query has no text filter', () => {
    expect(paletteTextFromWql(':note in all')).toBe('')
  })

  it('salvages typed words from invalid (mid-edit) WQL', () => {
    expect(paletteTextFromWql(':note{text:hello world} in all')).toBe('hello world')
  })
})

describe('withWqlText', () => {
  it('delegates with the extracted text, never raw WQL', async () => {
    const seen: string[] = []
    const inner: PaletteDataSource = {
      id: 'inner',
      search: (q) => {
        seen.push(q)
        return [{ id: 'x', label: 'X' }]
      },
    }
    const adapted = withWqlText(inner)
    const results = await adapted.search(':note{text:fran} in all')

    expect(seen).toEqual(['fran'])
    expect(results).toHaveLength(1)
    expect(adapted.label).toBe(inner.label)
  })
})

describe('navigatePaletteResult', () => {
  it('navigates route items to their route', () => {
    const visited: string[] = []
    navigatePaletteResult(
      { id: 'construct:amrap', label: 'AMRAP', type: 'route', payload: { route: '/reference/amrap' } },
      to => visited.push(to),
    )
    expect(visited).toEqual(['/reference/amrap'])
  })

  it('navigates entry items to the entry deep-link', () => {
    const visited: string[] = []
    const entry = {
      id: 'girl-wods/fran',
      kind: 'note',
      sourceId: 'collection:girl-wods/fran',
      sourceCatalog: 'girl-wods',
      sourceItem: 'fran',
      title: 'Fran',
      date: null,
    } satisfies Entry
    navigatePaletteResult(
      { id: 'entry:girl-wods/fran', label: 'Fran', type: 'entry', payload: entry },
      to => visited.push(to),
    )
    expect(visited).toEqual(['/notebook/girl-wods/fran'])
  })

  it('ignores item types the global palette does not produce', () => {
    const visited: string[] = []
    navigatePaletteResult({ id: 'x', label: 'X', type: 'action' }, to => visited.push(to))
    expect(visited).toEqual([])
  })
})

describe('searchPaletteQuery', () => {
  afterEach(() => {
    clearRouteWqlConfig(PALETTE_ROUTE_ID)
  })

  it('seed is an executable inclusive find query grouped by date', () => {
    const parsed = parseQuery(searchPaletteQuery())
    expect(parsed.error).toBeUndefined()
    if (isFindQuery(parsed)) {
      const source = parsed.filters.find(f => f.key === 'source' && !f.negate)
      expect(source?.values.map(v => v.value)).toContain('journal')
      expect(parsed.groupBy).toContain('date')
    } else {
      throw new Error('palette seed must be a find query')
    }
  })

  it('uses the configured palette default when one is stored', async () => {
    await writeRouteWqlConfig(PALETTE_ROUTE_ID, { defaultWql: ':journal{} last 4w' })
    expect(searchPaletteQuery()).toBe(':journal{} last 4w')
  })

  it('falls back to the system seed when the stored default is only options', async () => {
    await writeRouteWqlConfig(PALETTE_ROUTE_ID, { typeOptions: ['notes'] })
    expect(searchPaletteQuery()).toBe(PALETTE_SEED_QUERY)
  })
})
