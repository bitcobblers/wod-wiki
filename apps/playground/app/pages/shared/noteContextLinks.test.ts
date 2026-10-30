/**
 * Focused behavior test — source-aware note navigation core.
 *
 * Covers the nontrivial parts of the inventory interlinking:
 *   - extractPageIndex query/widget fences (outline beyond headings/time/log)
 *     and their L3 scroll targets
 *   - noteOwnership: source → zone / owning-list "Up" / sourceNote stamps
 *   - backlinks (journal copies by stamped sourceId, incl. #fragment variants)
 *   - related workouts via shared block content ids
 *   - stored-note routing: bare/UUID ids open /notes/:id, never the `/`
 *     parseNoteId catch-all
 */
import { describe, expect, it } from 'bun:test'
import type { BlockEffort, BlockIndexRow, Note } from '@/types/storage'
import { extractPageIndex, mapIndexToL3 } from './pageUtils'
import {
  backlinkNotes,
  buildNoteContextSpec,
  effortLinks,
  effortUsageLinks,
  EMPTY_NOTE_CONTEXT,
  noteLinkPath,
  noteOwnership,
  provenanceLink,
  relatedBlockLinks,
} from './noteContextLinks'

describe('extractPageIndex — query and widget fences', () => {
  const content = [
    '# Note',
    '',
    '```query:bars',
    'title: Weekly Volume',
    'query: sum:totalVolume{}',
    '```',
    '',
    '```widget:attention',
    '{"headline":"Seed"}',
    '```',
    '',
    '```query',
    'query: find:effort{}',
    '```',
  ].join('\n')

  it('emits typed outline entries with line-anchored scroll ids', () => {
    const links = extractPageIndex(content)
    const query = links.find(l => l.type === 'query')
    const widget = links.find(l => l.type === 'widget')
    expect(query).toMatchObject({ id: 'query-line-3', label: 'Weekly Volume' })
    expect(widget).toMatchObject({ id: 'widget-line-8', label: 'attention' })
    // Second, untitled query falls back to the ordinal.
    expect(links.filter(l => l.type === 'query')).toHaveLength(2)
    expect(links[links.length - 1]).toMatchObject({ id: 'query-line-12', label: 'Query 2' })
  })

  it('maps query/widget entries to scroll actions (no Run — time only)', () => {
    const l3 = mapIndexToL3(extractPageIndex(content))
    const widget = l3.find(i => i.id === 'widget-line-8')
    expect(widget?.action).toEqual({ type: 'scroll', sectionId: 'widget-line-8' })
    expect(widget?.secondaryAction).toBeUndefined()
  })
})

describe('noteLinkPath — stored-note routing', () => {
  it('routes bare/UUID ids to the canonical editor, not the parse catch-all', () => {
    expect(noteLinkPath('018f3c2a-9b7c-7d4e-8f1a-2b3c4d5e6f70')).toBe(
      '/note/018f3c2a-9b7c-7d4e-8f1a-2b3c4d5e6f70',
    )
  })

  it('keeps family routes for composite ids', () => {
    expect(noteLinkPath('crossfit-girls/fran')).toBe('/notebook/crossfit-girls/fran')
    expect(noteLinkPath('effort/grace')).toBe('/effort/grace')
  })
})

describe('noteOwnership — source-aware zone / up / stamps', () => {
  it('journal entry: notebooks zone (the journal view lives inside it), date page up, id stamp', () => {
    const own = noteOwnership({ id: '018f3c2a-9b7c-7d4e-8f1a-2b3c4d5e6f70', type: 'journal', journalDate: '2026-01-12' })
    expect(own.zone).toBe('notebooks')
    expect(own.up).toMatchObject({ title: 'Journal', to: '/day/2026-01-12' })
    expect(own.stamps).toEqual(['018f3c2a-9b7c-7d4e-8f1a-2b3c4d5e6f70'])
  })

  it('notebook workout: notebooks zone, notebook root up, item stamp', () => {
    const own = noteOwnership({ id: 'crossfit-girls/fran', type: 'note' })
    expect(own.zone).toBe('notebooks')
    expect(own.up).toMatchObject({ title: 'crossfit-girls', to: '/notebook/crossfit-girls' })
    expect(own.stamps).toEqual(['/notebook/crossfit-girls/fran'])
  })

  it('effort shadow note: efforts zone, efforts up, /e/ stamp', () => {
    const own = noteOwnership({ id: 'effort/grace', type: 'note' })
    expect(own.zone).toBe('efforts')
    expect(own.up).toMatchObject({ title: 'Efforts', to: '/efforts' })
    expect(own.stamps).toEqual(['/effort/grace'])
  })

  it('playground note: notebooks zone (the playgrounds view lives inside it), list up, /playground/ stamp', () => {
    const own = noteOwnership({ id: '018f3c2a-0000-7000-8000-000000000001', type: 'playground' })
    expect(own.zone).toBe('notebooks')
    expect(own.up).toMatchObject({ title: 'Playgrounds', to: '/playgrounds' })
    expect(own.stamps).toEqual(['/playground/018f3c2a-0000-7000-8000-000000000001'])
  })

  it('dated notebook item: notebooks zone, notebook landing up, id-level stamp', () => {
    // The date-scoped item identity lives in the row's sourceId, not the
    // composite id — the ownership stamps stay empty for these rows.
    const own = noteOwnership({ id: 'notebook/dan-john/2026-01-12/day-01', type: 'note' })
    expect(own.zone).toBe('notebooks')
    expect(own.up).toMatchObject({ title: 'dan-john', to: '/notebook/dan-john' })
    expect(own.stamps).toEqual([])
  })

  it('unknown bare id: no zone, no up', () => {
    const own = noteOwnership({ id: 'loose-note', type: 'note' })
    expect(own.zone).toBeNull()
    expect(own.up).toBeNull()
  })
})

describe('backlinkNotes — journal copies by sourceNote stamp', () => {
  const notes = [
    { id: '018f-copy-1', title: 'Fran copy', sourceId: '/notebook/crossfit-girls/fran', createdAt: 3 },
    { id: '018f-copy-2', title: 'Fran copy anchored', sourceId: '/notebook/crossfit-girls/fran#seg-1', createdAt: 4 },
    { id: '018f-other', title: 'Other', sourceId: '/notebook/other/wod', createdAt: 9 },
    { id: '018f-self', title: 'Itself', sourceId: '/notebook/crossfit-girls/fran', createdAt: 5 },
  ] as Note[]

  it('matches exact and #fragment stamps, excludes self, newest first, canonical routes', () => {
    const links = backlinkNotes(notes, ['/notebook/crossfit-girls/fran'], '018f-self')
    expect(links.map(l => l.id)).toEqual(['018f-copy-2', '018f-copy-1'])
    expect(links[0].to).toBe('/note/018f-copy-2')
    expect(links[1].to).toBe('/note/018f-copy-1')
  })

  it('returns nothing without stamps', () => {
    expect(backlinkNotes(notes, [])).toEqual([])
  })
})

describe('relatedBlockLinks — same block ideas', () => {
  const rows = [
    { noteId: 'crossfit-girls/fran', dataType: 'wod', blockContentId: 'hash-fran', noteTitle: 'Fran' },
    { noteId: '018f-uuid-1', dataType: 'wod', blockContentId: 'hash-fran', noteTitle: 'My Fran' },
    { noteId: '018f-uuid-1', dataType: 'wod', blockContentId: 'hash-own-only', noteTitle: 'My Fran' },
    { noteId: '018f-uuid-2', dataType: 'wod', blockContentId: 'hash-own-only', noteTitle: 'Unrelated copy' },
    // Shares the contentId but is metadata, not a workout — never a link.
    { noteId: '018f-uuid-2', dataType: 'frontmatter', blockContentId: 'hash-fran', noteTitle: 'Unrelated copy' },
  ] as BlockIndexRow[]

  it('joins notes sharing a wod content id, excludes self and non-wod rows', () => {
    const links = relatedBlockLinks(rows, 'crossfit-girls/fran')
    expect(links).toEqual([
      { id: '018f-uuid-1', title: 'My Fran', to: '/note/018f-uuid-1' },
    ])
  })

  it('honours the cap', () => {
    const many: BlockIndexRow[] = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`, noteId: `018f-note-${i}`, dataType: 'wod', blockContentId: 'hash-fran', noteTitle: `N${i}`,
    })) as BlockIndexRow[]
    expect(relatedBlockLinks([...rows, ...many], 'crossfit-girls/fran', 8)).toHaveLength(8)
  })
})

describe('effortLinks — note-referenced efforts', () => {
  const rows = [
    { noteId: 'n1', effortSlug: 'grace' },
    { noteId: 'n1', effortSlug: 'unsung-hero-wod' },
    { noteId: 'n1', effortSlug: 'grace' },
  ] as unknown as BlockEffort[]

  it('links uncataloged slugs to the efforts search, cataloged ones to the detail page', () => {
    const known = new Set(['grace'])
    const links = effortLinks(rows, known)
    expect(links.map(l => l.to)).toEqual(['/effort/grace', '/efforts?q=unsung-hero-wod'])
  })

  it('links every slug to the detail page when no catalog is provided', () => {
    const links = effortLinks(rows)
    expect(links.map(l => l.to)).toEqual(['/effort/grace', '/effort/unsung-hero-wod'])
  })
})

describe('effortUsageLinks — notes whose scripts use an effort', () => {
  const rows = [
    { noteId: '018f-uuid-1', effortSlug: 'grace' },
    { noteId: '018f-uuid-1', effortSlug: 'grace' },
    { noteId: 'effort/grace', effortSlug: 'grace' },
    { noteId: 'crossfit-girls/grace', effortSlug: 'grace' },
  ] as unknown as BlockEffort[]

  it('de-dupes per note and excludes the effort page itself', () => {
    const links = effortUsageLinks(rows, 'effort/grace')
    expect(links.map(l => l.id)).toEqual(['018f-uuid-1', 'crossfit-girls/grace'])
    expect(links[0].to).toBe('/note/018f-uuid-1')
    expect(links[1].to).toBe('/notebook/crossfit-girls/grace')
  })
})

describe('provenanceLink — stamped sourceId resolution', () => {
  it('links app paths directly, stripping block fragments', () => {
    expect(provenanceLink('/notebook/crossfit-girls/fran#seg-1')).toEqual({
      id: '/notebook/crossfit-girls/fran',
      title: 'fran',
      to: '/notebook/crossfit-girls/fran',
    })
  })

  it('leaves bare ids to the caller (content-provider resolution)', () => {
    expect(provenanceLink('018f-uuid-9')).toBeNull()
  })

  it('survives malformed percent-encoding in stored stamps', () => {
    const link = provenanceLink('/notebook/girls/%E0%A4%A')
    expect(link?.to).toBe('/notebook/girls/%E0%A4%A')
    expect(typeof link?.title).toBe('string')
  })
})

describe('buildNoteContextSpec — whiteboard L2 ordering', () => {
  const data = {
    efforts: [{ id: 'e1', title: 'Fran', to: '/effort/fran' }],
    related: [{ id: 'r1', title: 'Related WOD', to: '/note/r1' }],
    backlinks: [{ id: 'b1', title: 'Journal copy', to: '/note/b1' }],
  }
  const up = { id: 'u', title: 'Playgrounds', to: '/playgrounds' }
  const source = { id: 's', title: 'Source', to: '/notebook/girls' }

  it('orders Up, Source, calendar, sections, Related, Efforts, Journal copies, trailing', () => {
    const spec = buildNoteContextSpec({
      data,
      up,
      source,
      calendar: 'CAL',
      sections: [{ kind: 'section', id: 'recent', label: 'Recent', entries: [] }],
      trailingSections: [{ kind: 'section', id: 'recent-efforts', label: 'Recent efforts', entries: [] }],
    })
    expect(spec.map(e => e.id)).toEqual([
      'note-context-up',
      'note-context-source',
      'note-context-calendar',
      'recent',
      'note-context-related',
      'note-context-efforts',
      'note-context-backlinks',
      'recent-efforts',
    ])
    const calendar = spec[2]
    expect(calendar.kind === 'widget' && calendar.render()).toBe('CAL')
  })

  it('omits empty sections; a relationship-free spec renders Up/sections only', () => {
    const spec = buildNoteContextSpec({
      data: EMPTY_NOTE_CONTEXT,
      up: { id: 'nb', title: 'girls', to: '/notebook/girls' },
      sections: [{ kind: 'wql', id: 'recent-notes', label: 'Recent notes', query: ':note{}' }],
    })
    expect(spec.map(e => e.id)).toEqual(['note-context-up', 'recent-notes'])
  })

  it('renames the related section via relatedLabel', () => {
    const spec = buildNoteContextSpec({ data, up, relatedLabel: 'Used in' })
    const related = spec.find(e => e.id === 'note-context-related')
    expect(related && related.kind === 'section' && related.label).toBe('Used in')
  })
})
