/**
 * Entry action tests (#813 slice 10) — the pure helper that turns an Entry
 * into the URL the Open / Run / Compare row action should navigate to.
 * The LibraryRow consumes this; the test seam is the URL.
 */
import { describe, it, expect } from 'bun:test'
import { entryOpenHref, entryCompareHref, entryCanAddToToday, entryIsPlayground, entryNotebookHref } from './entryActions'
import { toEntry } from './entryMapper'
import type { Entry } from './entryMapper'
import type { Note } from '@/types/storage'

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'crossfit-girls/fran',
    kind: 'note',
    sourceNotebook: 'journal',
    sourceNote: 'crossfit-girls/fran',
    title: 'Fran',
    date: null,
    ...overrides,
  }
}

describe('entryOpenHref', () => {
  it('routes a playground Note to the playground editor deep-link', () => {
    expect(entryOpenHref(makeEntry({
      id: 'uuid-1',
      kind: 'note',
      sourceNotebook: 'playground',
      sourceNote: 'fran-experiment',
      sourceId: 'playground',
      date: null,
    }))).toBe('/playground/fran-experiment')
  })

  it('routes a guide Note to its page render', () => {
    expect(entryOpenHref(makeEntry({
      id: 'guide/syntax/basics',
      kind: 'note',
      sourceNotebook: 'guides',
      sourceNote: 'guide/syntax/basics',
      sourceId: 'guides:guide/syntax/basics',
      pageSlug: 'syntax/basics',
      date: null,
    }))).toBe('/page/syntax/basics')
  })

  it('routes a Note to the canonical single-note editor', () => {
    expect(entryOpenHref(makeEntry({
      id: 'note-uuid-1',
      kind: 'note',
      sourceNotebook: 'journal',
      sourceNote: 'note-uuid-1',
      date: '2026-07-15',
    }))).toBe('/note/note-uuid-1')
  })

  it('routes a page note to its /p page render', () => {
    expect(entryOpenHref(makeEntry({
      id: 'guide/syntax/basics',
      kind: 'note',
      sourceNotebook: 'guides',
      sourceNote: '/guide/syntax/basics',
      pageSlug: 'syntax/basics',
    }))).toBe('/page/syntax/basics')
  })

  it('opens named pages at pageSlug and never routes a UUID pageId', () => {
    expect(entryOpenHref(makeEntry({
      id: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      kind: 'note',
      sourceNotebook: 'journal',
      sourceNote: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      pageId: '1d2e3f4a-5b6c-4d8e-9f0a-1b2c3d4e5f6b',
      pageSlug: 'library-slug-smoke',
      date: null,
    }))).toBe('/page/library-slug-smoke')

    // Slug-less note: /notes/<uuid>, even with a hydrated UUID pageId present
    expect(entryOpenHref(makeEntry({
      id: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      kind: 'note',
      sourceNotebook: 'journal',
      sourceNote: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      pageId: '1d2e3f4a-5b6c-4d8e-9f0a-1b2c3d4e5f6b',
      date: null,
    }))).toBe('/note/0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e')
  })

  it('encodes slug segments individually', () => {
    expect(entryOpenHref(makeEntry({
      id: 'n-1',
      kind: 'note',
      sourceNotebook: 'journal',
      sourceNote: 'n-1',
      pageSlug: 'my page',
      date: null,
    }))).toBe('/page/my%20page')
  })

  it('routes dashboard corpus notes to /d/<slug> by sourcePath', () => {
    expect(entryOpenHref(makeEntry({
      id: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      kind: 'note',
      sourceNotebook: 'journal',
      sourceNote: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      sourcePath: 'markdown/dashboards/strength-blocks.md',
      date: null,
    }))).toBe('/dashboard/strength-blocks')
  })

  it('routes effort corpus notes to /e/<slug> by sourcePath', () => {
    expect(entryOpenHref(makeEntry({
      id: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      kind: 'note',
      sourceNotebook: 'journal',
      sourceNote: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      sourcePath: 'markdown/efforts/gymnastics/muscle-up.md',
      date: null,
    }))).toBe('/effort/muscle-up')
  })

  it('appends the block anchor to the open href', () => {
    expect(entryOpenHref(makeEntry({
      kind: 'note',
      sourceNotebook: 'crossfit-girls',
      sourceNote: 'fran',
      sourceId: 'notebook:crossfit-girls/fran',
      block: { blockId: 'sec 1', dataType: 'wod', preview: [] },
    }))).toBe('/notebook/crossfit-girls/fran#sec%201')
    expect(entryOpenHref(makeEntry({
      id: 'n-1',
      kind: 'note',
      sourceNotebook: 'journal',
      sourceNote: 'n-1',
      pageSlug: 'workout-plan',
      date: null,
      block: { blockId: 'seg-0', dataType: 'wod', preview: [] },
    }))).toBe('/page/workout-plan#seg-0')
  })

  it('routes a notebook item note to its /notebook deep-link', () => {
    expect(entryOpenHref(makeEntry({
      id: 'crossfit-girls/fran',
      kind: 'note',
      sourceId: 'notebook:crossfit-girls/fran',
      sourceNotebook: 'crossfit-girls',
      sourceNote: 'fran',
    }))).toBe('/notebook/crossfit-girls/fran')
  })

  it('routes a notebook landing note to the /notebook landing', () => {
    expect(entryOpenHref(makeEntry({
      id: 'crossfit-girls',
      kind: 'note',
      sourceId: 'notebook:crossfit-girls',
      sourceNotebook: 'crossfit-girls',
      sourceNote: '',
    }))).toBe('/notebook/crossfit-girls')
  })

  it('routes an Effort to the /e slug editor', () => {
    expect(entryOpenHref(makeEntry({
      id: 'grace',
      kind: 'effort',
    }))).toBe('/effort/grace')
  })

  it('routes an Effort by its registry slug when the id is not a slug', () => {
    expect(entryOpenHref(makeEntry({
      id: 'eff-uuid-1',
      kind: 'effort',
      effort: { slug: 'clean-and-jerk', label: 'Clean & Jerk' },
    }))).toBe('/effort/clean-and-jerk')
  })

  it('routes Equipment entries to the dedicated /equipment/<slug> route', () => {
    // Seed-corpus equipment note: the corpus slug is the route slug.
    expect(entryOpenHref(makeEntry({
      id: 'dumbbell',
      kind: 'equipment',
      sourceNotebook: 'equipment',
      sourceNote: 'dumbbell',
    }))).toBe('/equipment/dumbbell')

    // Custom (vault) equipment note keyed by composite id: strip the family
    // prefix — /equipment/<slug> is still the open route.
    expect(entryOpenHref(makeEntry({
      id: 'equipment/kettlebell',
      kind: 'equipment',
      sourceNotebook: 'equipment',
      sourceNote: 'equipment/kettlebell',
    }))).toBe('/equipment/kettlebell')

    // Unidentifiable slug falls back to the canonical note editor.
    expect(entryOpenHref(makeEntry({
      id: '0c9e6f2e-1111-4222-8333-444455556666',
      kind: 'equipment',
      sourceNotebook: 'equipment',
      sourceNote: '0c9e6f2e-1111-4222-8333-444455556666',
    }))).toBe('/note/0c9e6f2e-1111-4222-8333-444455556666')
  })

  it('routes Tag rows to the /t/:type/:tag direct route', () => {
    expect(entryOpenHref(makeEntry({
      id: 'tag/domain/running',
      kind: 'tag',
      sourceNotebook: 'tags',
      sourceNote: 'running',
    }))).toBe('/t/domain/running')

    // A row with no parseable identity degrades to the general type.
    expect(entryOpenHref(makeEntry({
      id: 'tag-1',
      kind: 'tag',
      sourceNotebook: 'tags',
      sourceNote: 'heavy',
    }))).toBe('/t/general/heavy')
  })

  it('encodes the tag type and label as individual URI components', () => {
    const href = (id: string) =>
      entryOpenHref(makeEntry({ id, kind: 'tag', sourceNotebook: 'tags', sourceNote: id.slice(id.indexOf('/') + 1) }))

    // '/' must escape (encodePath would preserve it) so the whole label is
    // one :tag segment; '%' escapes so a round-trip decode cannot throw;
    // spaces and Unicode pass through untouched by double decoding.
    expect(href('tag/general/a/b')).toBe('/t/general/a%2Fb')
    expect(href('tag/general/50%')).toBe('/t/general/50%25')
    expect(href('tag/general/e2e heavy')).toBe('/t/general/e2e%20heavy')
    expect(href('tag/general/själv')).toBe('/t/general/sj%C3%A4lv')
    // The type segment gets the same treatment.
    expect(href('tag/do main/x')).toBe('/t/do%20main/x')
  })

  it('routes a dated notebook post to the dated item deep-link (slug/date/item)', () => {
    expect(entryOpenHref(makeEntry({
      id: 'crossfit-programming/2026-01-12/monday',
      kind: 'note',
      sourceId: 'notebook:crossfit-programming/2026-01-12/monday',
      sourceNotebook: 'crossfit-programming',
      sourceNote: '2026-01-12/monday',
      date: '2026-01-12',
    }))).toBe('/notebook/crossfit-programming/2026-01-12/monday')
  })
})

describe('entryNotebookHref', () => {
  it('routes a notebook landing note to the /notebooks route with notebook filter', () => {
    const entry = makeEntry({
      id: 'crossfit-girls',
      kind: 'note',
      sourceId: 'notebook:crossfit-girls',
      sourceNotebook: 'crossfit-girls',
      sourceNote: '',
    })
    expect(entryNotebookHref(entry)).toBe('/notebooks?q=%3Anotebook%7Bnotebook%3Acrossfit-girls%7D')
  })

  it('returns null for notebook items (only landings link the notebook)', () => {
    const entry = makeEntry({
      id: 'crossfit-girls/fran',
      kind: 'note',
      sourceId: 'notebook:crossfit-girls/fran',
      sourceNotebook: 'crossfit-girls',
      sourceNote: 'fran',
    })
    expect(entryNotebookHref(entry)).toBeNull()
  })
})

describe('entryCompareHref', () => {
  it('routes any row with a blockContentId to /dashboards?q=<id>', () => {
    expect(entryCompareHref(makeEntry({ blockContentId: 'bc-fran' }))).toBe(
      '/dashboards?q=bc-fran',
    )
  })

  it('returns null for a row without a content id', () => {
    expect(entryCompareHref(makeEntry())).toBeNull()
  })
})

describe('entryCanAddToToday', () => {
  it('returns true for a Note', () => {
    expect(entryCanAddToToday(makeEntry({ kind: 'note' }))).toBe(true)
  })

  it('returns true for a dated notebook post note', () => {
    expect(entryCanAddToToday(makeEntry({ kind: 'note', sourceId: 'notebook:x/2026-01-12/monday' }))).toBe(true)
  })
  it('returns true for a Result with an associated noteId', () => {
    expect(entryCanAddToToday(makeEntry({
      kind: 'result',
      id: 'res-101',
      execution: { resultId: 'res-101', noteId: 'crossfit-girls/fran', timestamp: 1700000000000, outputType: 'all' },
    }))).toBe(true)
  })

  it('returns true for a Segment with an associated noteId', () => {
    expect(entryCanAddToToday(makeEntry({
      kind: 'segment',
      id: 'res-101:1',
      execution: { resultId: 'res-101', noteId: 'crossfit-girls/fran', timestamp: 1700000000000, outputType: 'segment' },
    }))).toBe(true)
  })

  it('returns false for a Result or Segment without an associated noteId', () => {
    expect(entryCanAddToToday(makeEntry({ kind: 'result', id: 'res-101' }))).toBe(false)
    expect(entryCanAddToToday(makeEntry({ kind: 'segment', id: 'res-101:1' }))).toBe(false)
  })
})

describe('toEntry → entryOpenHref seam (slug routing regressions)', () => {
  const UUID = '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e'
  const note = (overrides: Partial<Note> & { slug?: string; pageId?: string }): Note =>
    ({ id: UUID, title: 't', createdAt: 0, type: 'note', ...overrides } as Note)

  it('routes a UUID-keyed notebook member by its sourceId, not the UUID', () => {
    expect(entryOpenHref(toEntry(note({ sourceId: 'notebook:crossfit-girls/fran' })))).toBe('/notebook/crossfit-girls/fran')
  })

  it('routes a sourcePath-only imported member to the named notebook editor', () => {
    expect(entryOpenHref(toEntry(note({
      sourceId: undefined,
      sourcePath: 'markdown/notebooks/girls/fran.md',
    })))).toBe('/notebook/girls/fran')
  })

  it('routes a UUID landing to the notebook root and links its notebook filter', () => {
    const entry = toEntry(note({ sourceId: 'notebook:crossfit-girls' }))
    expect(entryOpenHref(entry)).toBe('/notebook/crossfit-girls')
    expect(entryNotebookHref(entry)).toBe('/notebooks?q=%3Anotebook%7Bnotebook%3Acrossfit-girls%7D')
  })

  it('routes a dated notebook item by route segments, never the UUID id', () => {
    expect(entryOpenHref(toEntry(note({
      sourceId: 'notebook:crossfit-programming/2026-01-12/monday',
    })))).toBe('/notebook/crossfit-programming/2026-01-12/monday')
  })

  it('routes a guide by its declared sourceId route', () => {
    expect(entryOpenHref(toEntry(note({ sourceId: 'guides:page/guide-clock' })))).toBe('/page/guide-clock')
  })

  it('routes a named page by pageSlug and a slug-less note to /notes/<uuid>', () => {
    expect(entryOpenHref(toEntry(note({ slug: 'library-slug-smoke', pageId: '1d2e3f4a-5b6c-4d8e-9f0a-1b2c3d4e5f6b' })))).toBe('/page/library-slug-smoke')
    expect(entryOpenHref(toEntry(note({ pageId: '1d2e3f4a-5b6c-4d8e-9f0a-1b2c3d4e5f6b' })))).toBe(`/note/${UUID}`)
  })

  it('anchors a block hit within its parent note route', () => {
    const entry = toEntry(note({ sourceId: 'notebook:crossfit-girls/fran' }))
    expect(entryOpenHref({ ...entry, block: { blockId: 'sec-1', dataType: 'wod', preview: [] } })).toBe('/notebook/crossfit-girls/fran#sec-1')
  })
})

describe('entryIsPlayground', () => {
  it('returns true for a playground-sourced Note (sourceNotebook playground)', () => {
    expect(entryIsPlayground(makeEntry({
      id: 'uuid-1',
      kind: 'note',
      sourceNotebook: 'playground',
      sourceNote: 'fran-experiment',
      sourceId: 'playground',
    }))).toBe(true)
  })

  it('returns true when only sourceId carries the playground marker', () => {
    expect(entryIsPlayground(makeEntry({ sourceId: 'playground' }))).toBe(true)
  })

  it('returns false for journal and notebook entries', () => {
    expect(entryIsPlayground(makeEntry({ kind: 'note', sourceNotebook: 'journal' }))).toBe(false)
    expect(entryIsPlayground(makeEntry({ sourceId: 'notebook:crossfit-girls' }))).toBe(false)
  })
})
