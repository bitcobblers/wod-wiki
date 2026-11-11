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
import { describe, expect, it, afterEach } from 'bun:test'

import { parseQuery, isFindQuery, serialize, type AnyParsedQuery, type ParsedFindQuery } from '@bitcobblers/wod-wiki-engine'
import type { PaletteDataSource } from '@/components/organisms/command-palette/palette-types'
import type { Entry } from '../lib/entryMapper'

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

// ── Injected entry pipeline (no module mocks) ──────────────────────────────

/** The wql strings the source forwarded to the search pipeline. */
let searchInputs: string[]
let searchImpl: (wql: string) => Promise<Entry[]>

/** The source under test with the corpus-backed pipeline injected. */
const source = () =>
  wqlSearchSource({
    searchEntries: async (query: string | AnyParsedQuery) => {
      const wql = typeof query === 'string' ? query : serialize(query)
      searchInputs.push(wql)
      return searchImpl(wql)
    },
  })

function setup(impl: (wql: string) => Promise<Entry[]>) {
  searchInputs = []
  searchImpl = impl
}

const JOURNAL_ENTRY: Entry = {
  id: 'journal/2026-07-30',
  kind: 'note',
  sourceNotebook: 'journal',
  sourceNote: 'journal/2026-07-30',
  title: 'Heavy Fran',
  date: '2026-07-30',
}

const BLOCK_ENTRY: Entry = {
  id: 'girl-wods/fran',
  kind: 'note',
  sourceNotebook: 'girl-wods',
  sourceNote: 'girl-wods/fran',
  title: 'Fran',
  date: null,
}

describe('wqlSearchSource', () => {
  afterEach(() => {
    clearRouteWqlConfig(PALETTE_ROUTE_ID)
  })

  it('returns no rows for invalid WQL and never executes', async () => {
    setup(async () => {
      throw new Error('pipeline must not run for invalid drafts')
    })
    // Multi-word text is a reachable composer state that fails the grammar.
    const results = await source().search(':note{text:hello world} in all')
    expect(results).toEqual([])
    expect(searchInputs).toEqual([])
  })

  it('maps :note results to journal entry items', async () => {
    setup(async () => [JOURNAL_ENTRY])
    const results = await source().search(':note in journal')

    expect(results).toHaveLength(1)
    const item = results[0]!
    expect(item.id).toBe('entry:journal/2026-07-30')
    expect(item.label).toBe('Heavy Fran')
    expect(item.category).toBe('Journal')
    expect(item.type).toBe('entry')
    const entry = item.payload as Entry
    expect(entry.kind).toBe('note')
    expect(entry.sourceNote).toBe('journal/2026-07-30')
  })

  it('keeps whole-Note text filtering in one pipeline request', async () => {
    setup(async () => [JOURNAL_ENTRY])
    const results = await source().search(':note{text:fran} in all')
    expect(searchInputs).toEqual([':note{text:fran} in all'])
    expect(results.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])
  })

  it('maps :block hits to notebook entries', async () => {
    setup(async () => [BLOCK_ENTRY])
    const results = await source().search(':block{type:wod} in notebooks')

    expect(results).toHaveLength(1)
    const item = results[0]!
    expect(item.id).toBe('entry:girl-wods/fran')
    expect(item.label).toBe('Fran')
    expect(item.category).toBe('Notebooks')
    const entry = item.payload as Entry
    expect(entry.kind).toBe('note')
    expect(entry.sourceNotebook).toBe('girl-wods')
  })

  it('finds body matches for plain words inside the live scope', async () => {
    setup(corpusSearch([JOURNAL_ROW]))
    const results = await source().search('pushup', { scopeWql: ':note in journal' })

    expect(results.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])
    expect(results[0]!.label).toBe('Heavy Fran')
  })

  it('keeps prose words like in/last/where and never matches outside the live scope', async () => {
    setup(corpusSearch([JOURNAL_ROW]))
    const prose = await source().search('workout in the park last week', { scopeWql: ':note in journal' })
    expect(prose.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])

    // The corpus is journal-only: a feeds scope fabricates nothing.
    const other = await source().search('pushup', { scopeWql: ':note in notebooks' })
    expect(other).toEqual([])
  })

  it('restores the scoped identities when the plain draft clears', async () => {
    setup(corpusSearch([JOURNAL_ROW]))
    // A stale positive text that matches nothing must not survive a clear.
    const results = await source().search('', { scopeWql: ':note{source:journal,text:nonsense}' })

    expect(results.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])
  })

  it('finds plain words in the configured route default scope, not a hardcoded one', async () => {
    // A block-target stored default: neither the seed scope (journal|
    // collection) nor a hardcoded ':note' head can produce this identity.
    await writeRouteWqlConfig(PALETTE_ROUTE_ID, { defaultWql: ':block{type:wod}' })
    setup(corpusSearch([JOURNAL_ROW, FEED_ROW]))
    const results = await source().search('ladder')

    expect(results.map(r => r.id)).toEqual([`entry:${FEED_ROW.entry.id}`])
  })

  it('accepts multiword and quoted drafts as one phrase inside the scope', async () => {
    setup(corpusSearch([JOURNAL_ROW]))
    const multiword = await source().search('pushup fran', { scopeWql: ':note in journal' })
    expect(multiword.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])

    const quoted = await source().search('"pushup fran"', { scopeWql: ':note in journal' })
    expect(quoted.map(r => r.id)).toEqual(['entry:journal/2026-07-30'])
  })
})

/** Fixture corpus row: a pipeline Entry plus the body text behind it. */
interface CorpusRow {
  entry: Entry
  body: string
  source: string
}

const JOURNAL_ROW: CorpusRow = {
  entry: JOURNAL_ENTRY,
  body: 'remediated workout in the park last week where pushup fran showed up',
  source: 'journal',
}

const FEED_ROW: CorpusRow = {
  entry: {
    id: 'notebook/feed-a/2026-01-01/note-0',
    kind: 'note',
    sourceNotebook: 'feed-a',
    sourceNote: 'notebook/feed-a/2026-01-01/note-0',
    title: 'Feed note',
    date: null,
  },
  body: 'pushup ladder',
  source: 'feeds',
}

/** Applies what the source sent — target, positive source scope, positive
 *  text terms — over the fixture corpus, so assertions see the identities
 *  real queries would return. */
function corpusSearch(corpus: CorpusRow[]) {
  return async (wql: string): Promise<Entry[]> => {
    const parsed = parseQuery(wql)
    if (parsed.error || !isFindQuery(parsed)) return []
    const filters = parsed.filters
    const terms = filters
      .filter(f => f.key === 'text' && !f.negate)
      .flatMap(f => f.values.map(v => v.value))
    const sources = filters
      .filter(f => f.key === 'source' && !f.negate)
      .flatMap(f => f.values.map(v => v.value))
    const hits = corpus.filter(row =>
      (sources.length === 0 || sources.includes(row.source))
      && (terms.length === 0 || terms.every(t => row.entry.title.includes(t) || row.body.includes(t))))
    if (parsed.target !== 'note' && parsed.target !== 'block') return []
    return hits.map(h => h.entry)
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
    expect(sourceValuesOf(merged)).toEqual(['journal', 'notebooks'])
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
      sourceId: 'notebook:girl-wods/fran',
      sourceNotebook: 'girl-wods',
      sourceNote: 'fran',
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
