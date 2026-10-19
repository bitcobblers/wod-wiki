/**
 * Entry action tests (#813 slice 10) — the pure helper that turns an Entry
 * into the URL the Open / Run / Compare row action should navigate to.
 * The LibraryRow consumes this; the test seam is the URL.
 */
import { describe, it, expect } from 'bun:test'
import { entryOpenHref, entryCompareHref, entryCanAddToToday, entryIsPlayground, entryCollectionFeedHref } from './entryActions'
import { toEntry } from './entryMapper'
import type { Entry } from './entryMapper'
import type { Note } from '@/types/storage'

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'crossfit-girls/fran',
    kind: 'session',
    sourceCatalog: 'crossfit-girls',
    sourceItem: 'fran',
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
      sourceCatalog: 'playground',
      sourceItem: 'fran-experiment',
      sourceId: 'playground',
      date: null,
    }))).toBe('/playground/fran-experiment')
  })

  it('routes a guide Note to its page render', () => {
    expect(entryOpenHref(makeEntry({
      id: 'guide/syntax/basics',
      kind: 'note',
      sourceCatalog: 'guides',
      sourceItem: 'guide/syntax/basics',
      sourceId: 'guides:guide/syntax/basics',
      pageSlug: 'syntax/basics',
      date: null,
    }))).toBe('/p/syntax/basics')
  })

  it('routes a Note to the canonical single-note editor', () => {
    expect(entryOpenHref(makeEntry({
      id: 'note-uuid-1',
      kind: 'note',
      sourceCatalog: 'journal',
      sourceItem: 'note-uuid-1',
      date: '2026-07-15',
    }))).toBe('/notes/note-uuid-1')
  })

  it('routes a page note to its /p page render', () => {
    expect(entryOpenHref(makeEntry({
      id: 'guide/syntax/basics',
      kind: 'note',
      sourceCatalog: 'guides',
      sourceItem: '/guide/syntax/basics',
      pageSlug: 'syntax/basics',
    }))).toBe('/p/syntax/basics')
  })

  it('opens named pages at pageSlug and never routes a UUID pageId', () => {
    expect(entryOpenHref(makeEntry({
      id: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      kind: 'note',
      sourceCatalog: 'journal',
      sourceItem: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      pageId: '1d2e3f4a-5b6c-4d8e-9f0a-1b2c3d4e5f6b',
      pageSlug: 'library-slug-smoke',
      date: null,
    }))).toBe('/p/library-slug-smoke')

    // Slug-less note: /notes/<uuid>, even with a hydrated UUID pageId present
    expect(entryOpenHref(makeEntry({
      id: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      kind: 'note',
      sourceCatalog: 'journal',
      sourceItem: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      pageId: '1d2e3f4a-5b6c-4d8e-9f0a-1b2c3d4e5f6b',
      date: null,
    }))).toBe('/notes/0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e')
  })

  it('encodes slug segments individually', () => {
    expect(entryOpenHref(makeEntry({
      id: 'n-1',
      kind: 'note',
      sourceCatalog: 'journal',
      sourceItem: 'n-1',
      pageSlug: 'my page',
      date: null,
    }))).toBe('/p/my%20page')
  })

  it('routes dashboard corpus notes to /d/<slug> by sourcePath', () => {
    expect(entryOpenHref(makeEntry({
      id: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      kind: 'note',
      sourceCatalog: 'journal',
      sourceItem: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      sourcePath: 'markdown/dashboards/strength-blocks.md',
      date: null,
    }))).toBe('/d/strength-blocks')
  })

  it('routes effort corpus notes to /e/<slug> by sourcePath', () => {
    expect(entryOpenHref(makeEntry({
      id: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      kind: 'note',
      sourceCatalog: 'journal',
      sourceItem: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      sourcePath: 'markdown/efforts/gymnastics/muscle-up.md',
      date: null,
    }))).toBe('/e/muscle-up')
  })

  it('appends the block anchor to the open href', () => {
    expect(entryOpenHref(makeEntry({
      kind: 'session',
      sourceCatalog: 'crossfit-girls',
      sourceItem: 'fran',
      block: { blockId: 'sec 1', dataType: 'wod', preview: [] },
    }))).toBe('/c/crossfit-girls/fran#sec%201')
    expect(entryOpenHref(makeEntry({
      id: 'n-1',
      kind: 'note',
      sourceCatalog: 'journal',
      sourceItem: 'n-1',
      pageSlug: 'workout-plan',
      date: null,
      block: { blockId: 'seg-0', dataType: 'wod', preview: [] },
    }))).toBe('/p/workout-plan#seg-0')
  })

  it('routes a Session to the /c page-slug editor', () => {
    expect(entryOpenHref(makeEntry({
      id: 'crossfit-girls/fran',
      kind: 'session',
      sourceCatalog: 'crossfit-girls',
      sourceItem: 'fran',
    }))).toBe('/c/crossfit-girls/fran')
  })

  it('routes a collection page Session to the /c collection landing', () => {
    expect(entryOpenHref(makeEntry({
      id: 'crossfit-girls',
      kind: 'session',
      sourceCatalog: 'crossfit-girls',
      sourceItem: '',
    }))).toBe('/c/crossfit-girls')
  })

  it('routes an Effort to the /e slug editor', () => {
    expect(entryOpenHref(makeEntry({
      id: 'grace',
      kind: 'effort',
    }))).toBe('/e/grace')
  })

  it('routes an Effort by its registry slug when the id is not a slug', () => {
    expect(entryOpenHref(makeEntry({
      id: 'eff-uuid-1',
      kind: 'effort',
      effort: { slug: 'clean-and-jerk', label: 'Clean & Jerk' },
    }))).toBe('/e/clean-and-jerk')
  })

  it('routes Equipment entries to the dedicated /equipment/<slug> route', () => {
    // Seed-corpus equipment note: the corpus slug is the route slug.
    expect(entryOpenHref(makeEntry({
      id: 'dumbbell',
      kind: 'equipment',
      sourceCatalog: 'equipment',
      sourceItem: 'dumbbell',
    }))).toBe('/equipment/dumbbell')

    // Custom (vault) equipment note keyed by composite id: strip the family
    // prefix — /equipment/<slug> is still the open route.
    expect(entryOpenHref(makeEntry({
      id: 'equipment/kettlebell',
      kind: 'equipment',
      sourceCatalog: 'equipment',
      sourceItem: 'equipment/kettlebell',
    }))).toBe('/equipment/kettlebell')

    // Unidentifiable slug falls back to the canonical note editor.
    expect(entryOpenHref(makeEntry({
      id: '0c9e6f2e-1111-4222-8333-444455556666',
      kind: 'equipment',
      sourceCatalog: 'equipment',
      sourceItem: '0c9e6f2e-1111-4222-8333-444455556666',
    }))).toBe('/notes/0c9e6f2e-1111-4222-8333-444455556666')
  })

  it('routes a Post to the feed-item deep-link (catalog/date/item)', () => {
    expect(entryOpenHref(makeEntry({
      id: 'feeds/crossfit-programming/2026-01-12/monday',
      kind: 'post',
      sourceCatalog: 'crossfit-programming',
      sourceItem: 'monday',
      date: '2026-01-12',
    }))).toBe('/feeds/crossfit-programming/2026-01-12/monday')
  })
})

describe('entryCollectionFeedHref', () => {
  it('routes a collection page Session to the /feeds route with collection filter', () => {
    const entry = makeEntry({
      id: 'crossfit-girls',
      kind: 'session',
      sourceCatalog: 'crossfit-girls',
      sourceItem: '',
    })
    expect(entryCollectionFeedHref(entry)).toBe('/feeds?q=%3Anotebook%7Bnotebook%3Acrossfit-girls%7D')
  })

  it('returns null for regular workouts', () => {
    const entry = makeEntry({
      id: 'crossfit-girls/fran',
      kind: 'session',
      sourceCatalog: 'crossfit-girls',
      sourceItem: 'fran',
    })
    expect(entryCollectionFeedHref(entry)).toBeNull()
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

  it('returns true for a Post', () => {
    expect(entryCanAddToToday(makeEntry({ kind: 'post' }))).toBe(true)
  })

  it('returns false for a Session (undated, cannot be added to a journal date)', () => {
    expect(entryCanAddToToday(makeEntry({ kind: 'session' }))).toBe(false)
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

  it('routes a UUID-keyed collection member by its sourceId, not the UUID', () => {
    expect(entryOpenHref(toEntry(note({ sourceId: 'collection:crossfit-girls/fran' })))).toBe('/c/crossfit-girls/fran')
  })

  it('routes a sourcePath-only imported member to the named collection editor', () => {
    expect(entryOpenHref(toEntry(note({
      sourceId: undefined,
      sourcePath: 'markdown/collections/girls/fran.md',
    })))).toBe('/c/girls/fran')
  })

  it('routes a UUID landing to the collection root and links its feed filter', () => {
    const entry = toEntry(note({ sourceId: 'page:collection:crossfit-girls', type: 'feed' }))
    expect(entryOpenHref(entry)).toBe('/c/crossfit-girls')
    expect(entryCollectionFeedHref(entry)).toBe('/feeds?q=%3Anotebook%7Bnotebook%3Acrossfit-girls%7D')
  })

  it('routes a feed item by route segments, never the UUID id', () => {
    expect(entryOpenHref(toEntry(note({
      sourceId: 'feed:feeds/crossfit-programming/2026-01-12/monday',
    })))).toBe('/feeds/crossfit-programming/2026-01-12/monday')
  })

  it('routes a guide by its declared sourceId route', () => {
    expect(entryOpenHref(toEntry(note({ sourceId: 'guides:guide/clock' })))).toBe('/p/clock')
  })

  it('routes a named page by pageSlug and a slug-less note to /notes/<uuid>', () => {
    expect(entryOpenHref(toEntry(note({ slug: 'library-slug-smoke', pageId: '1d2e3f4a-5b6c-4d8e-9f0a-1b2c3d4e5f6b' })))).toBe('/p/library-slug-smoke')
    expect(entryOpenHref(toEntry(note({ pageId: '1d2e3f4a-5b6c-4d8e-9f0a-1b2c3d4e5f6b' })))).toBe(`/notes/${UUID}`)
  })

  it('anchors a block hit within its parent note route', () => {
    const entry = toEntry(note({ sourceId: 'collection:crossfit-girls/fran' }))
    expect(entryOpenHref({ ...entry, block: { blockId: 'sec-1', dataType: 'wod', preview: [] } })).toBe('/c/crossfit-girls/fran#sec-1')
  })
})

describe('entryIsPlayground', () => {
  it('returns true for a playground-sourced Note (sourceCatalog playground)', () => {
    expect(entryIsPlayground(makeEntry({
      id: 'uuid-1',
      kind: 'note',
      sourceCatalog: 'playground',
      sourceItem: 'fran-experiment',
      sourceId: 'playground',
    }))).toBe(true)
  })

  it('returns true when only sourceId carries the playground marker', () => {
    expect(entryIsPlayground(makeEntry({ sourceId: 'playground' }))).toBe(true)
  })

  it('returns false for journal and catalog entries', () => {
    expect(entryIsPlayground(makeEntry({ kind: 'note', sourceCatalog: 'journal' }))).toBe(false)
    expect(entryIsPlayground(makeEntry({ sourceId: 'collection:crossfit-girls' }))).toBe(false)
  })
})
