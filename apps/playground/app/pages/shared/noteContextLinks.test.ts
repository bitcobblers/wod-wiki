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
import type { Page, PageNote, Tag } from '@bitcobblers/wod-wiki-core'
import type { BlockEffort, BlockIndexRow, Note } from '@/types/storage'
import { extractPageIndex, mapIndexToL3 } from './pageUtils'
import {
  backlinkNotes,
  buildNoteContextSpec,
  collectionLinks,
  effortLinks,
  effortUsageLinks,
  EMPTY_NOTE_CONTEXT,
  equipmentLinks,
  MAX_RELATED,
  noteLinkPath,
  noteOwnership,
  notesFacetFilterPath,
  pagePlacementLinks,
  provenanceLink,
  relatedBlockLinks,
  scheduleLinks,
  tagLinks,
  type NotePeekTarget,
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
  it('journal entry: journal zone, date page up, id stamp', () => {
    const own = noteOwnership({ id: '018f3c2a-9b7c-7d4e-8f1a-2b3c4d5e6f70', type: 'journal', journalDate: '2026-01-12' })
    expect(own.zone).toBe('journal')
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

  it('user-created notebook note: notebooks zone, notebook slug up from notebookId even when dated', () => {
    const own = noteOwnership({
      id: '018f3c2a-9b7c-7d4e-8f1a-2b3c4d5e6f70',
      type: 'note',
      journalDate: '2026-11-10',
      notebookId: 'notebook/dogfood-notebook',
    })
    expect(own.zone).toBe('notebooks')
    expect(own.up).toMatchObject({ title: 'dogfood-notebook', to: '/notebook/dogfood-notebook' })
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

  it('resolves readable note titles when notes are supplied', () => {
    const links = effortUsageLinks(rows, 'effort/grace', [
      { id: '018f-uuid-1', title: 'Multiple AMRAP Windows' },
    ])
    expect(links[0]).toMatchObject({ id: '018f-uuid-1', title: 'Multiple AMRAP Windows', to: '/note/018f-uuid-1' })
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

  it('orders Up, Source, calendar, sections, facets (Collections..Unrecognized), Related, Journal copies, trailing', () => {
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
      'note-context-efforts',
      'note-context-related',
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

  it('builds 2-part facet links (entity route + /notes?q= filter) and de-dupes Collections/Pages against Up/Source', () => {
    const collections = collectionLinks({
      id: 'n1',
      notebookId: 'notebook/crossfit-girls',
      tags: ['notebook:hero-wods', 'notebook:journal'],
    })
    expect(collections).toEqual([
      { id: 'crossfit-girls', title: 'crossfit-girls', to: '/notebook/crossfit-girls' },
      { id: 'hero-wods', title: 'hero-wods', to: '/notebook/hero-wods' },
    ])

    const pagesById = new Map<string, Page>([
      ['p-date', { id: 'p-date', date: '2026-04-12', createdAt: 1 }],
      ['p-board', { id: 'p-board', slug: 'prep-cycle', title: 'Prep Cycle', createdAt: 1 }],
    ])
    const placements: PageNote[] = [
      { id: 'pn-1', pageId: 'p-date', noteId: 'n1', position: 0, createdAt: 1 },
      { id: 'pn-2', pageId: 'p-board', noteId: 'n1', position: 1, createdAt: 1 },
    ]
    const pages = pagePlacementLinks(placements, pagesById)
    expect(pages).toEqual([
      { id: 'p-date', title: '2026-04-12', to: '/day/2026-04-12' },
      { id: 'p-board', title: 'Prep Cycle', to: '/page/prep-cycle' },
    ])

    const tags = tagLinks([
      { id: 't1', label: 'crossfit', type: 'domain', createdAt: 1 },
      { id: 't2', label: 'heavy', createdAt: 1 },
      // effort & equipment tags are merged into Efforts/Equipment, never emitted under /t/effort/* or /t/equipment/*
      { id: 't3', label: 'fran', type: 'effort', createdAt: 1 },
      { id: 't4', label: 'kettlebell', type: 'equipment', createdAt: 1 },
    ] as Tag[])
    expect(tags).toEqual([
      {
        id: 'domain:crossfit',
        title: '#crossfit',
        to: '/t/domain/crossfit',
        filterTo: notesFacetFilterPath('domain', 'crossfit'),
        filterLabel: 'Filter notes by #crossfit',
      },
      {
        id: 'general:heavy',
        title: '#heavy',
        to: '/t/general/heavy',
        filterTo: notesFacetFilterPath('tags', 'heavy'),
        filterLabel: 'Filter notes by #heavy',
      },
    ])

    const equipment = equipmentLinks(
      [{ equipmentSlug: 'kettlebell' }],
      new Set(['kettlebell']),
      new Map([['kettlebell', 'Kettlebell']]),
    )
    expect(equipment).toEqual([
      {
        id: 'kettlebell',
        title: 'Kettlebell',
        to: '/equipment/kettlebell',
        filterTo: notesFacetFilterPath('equipment', 'kettlebell'),
        filterLabel: 'Filter notes by Kettlebell',
      },
    ])

    // Up points to /day/2026-04-12 and Source points to /notebook/crossfit-girls →
    // buildNoteContextSpec de-duplicates both from Pages & Collections!
    const spec = buildNoteContextSpec({
      data: {
        collections,
        pages,
        tags,
        efforts: [],
        equipment,
        unrecognized: [],
        related: [],
        backlinks: [],
      },
      up: { id: '2026-04-12', title: 'Journal', to: '/day/2026-04-12' },
      source: { id: 'src', title: 'crossfit-girls', to: '/notebook/crossfit-girls' },
    })

    const collectionsSec = spec.find(s => s.id === 'note-context-collections')
    expect(collectionsSec && collectionsSec.kind === 'section' && collectionsSec.label).toBe('Notebooks')
    expect(
      collectionsSec && collectionsSec.kind === 'section' && collectionsSec.entries.map(e => (e.kind === 'link' ? e.label : '')),
    ).toEqual(['hero-wods'])
    const pagesSec = spec.find(s => s.id === 'note-context-pages')
    expect(
      pagesSec && pagesSec.kind === 'section' && pagesSec.entries.map(e => (e.kind === 'link' ? e.label : '')),
    ).toEqual(['Prep Cycle'])
  })

  it('caps Used in / related at 5 items and appends View all N in Notes → when count > 5', () => {
    expect(MAX_RELATED).toBe(5)
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `note-${i}`,
      title: `Workout ${i}`,
      to: `/note/note-${i}`,
    }))
    const viewAllTo = notesFacetFilterPath('effort', 'air-squat')
    const spec = buildNoteContextSpec({
      data: {
        efforts: [],
        related: many,
        backlinks: [],
      },
      relatedLabel: 'Used in',
      relatedViewAllTo: viewAllTo,
    })
    const relatedSec = spec.find(s => s.id === 'note-context-related')
    expect(relatedSec?.kind).toBe('section')
    if (relatedSec?.kind === 'section') {
      expect(relatedSec.label).toBe('Used in')
      expect(relatedSec.entries).toHaveLength(6)
      const viewAll = relatedSec.entries[5]
      expect(viewAll?.kind === 'link' && viewAll.label).toBe('View all 12 in Notes →')
      expect(viewAll?.kind === 'link' && viewAll.to).toBe(viewAllTo)
    }

    // At or below 5 items: no View all link.
    const smallSpec = buildNoteContextSpec({
      data: { efforts: [], related: many.slice(0, 5), backlinks: [] },
      relatedLabel: 'Used in',
    })
    const smallSec = smallSpec.find(s => s.id === 'note-context-related')
    expect(smallSec?.kind === 'section' && smallSec.entries).toHaveLength(5)
  })

  it('cleanly separates Notebooks, Schedules, and Pages and suppresses currentPath self-links', () => {
    const schedules = scheduleLinks([
      { id: 's2', date: '2026-04-15', status: 'planned' },
      { id: 's1', date: '2026-04-12', status: 'completed' },
    ])
    const spec = buildNoteContextSpec({
      data: {
        collections: [{ id: 'strength', title: 'Strength', to: '/notebook/strength' }],
        schedules,
        pages: [
          { id: 'p-self', title: 'Air Squat', to: '/effort/air-squat' },
          { id: 'p-board', title: 'Prep Cycle', to: '/page/prep-cycle' },
        ],
        efforts: [],
        related: [],
        backlinks: [],
      },
      currentPath: '/effort/air-squat',
    })
    expect(spec.map(s => (s.kind === 'section' ? [s.id, s.label] : [s.id, '']))).toEqual([
      ['note-context-collections', 'Notebooks'],
      ['note-context-schedules', 'Schedules'],
      ['note-context-pages', 'Pages'],
    ])
    const pagesSec = spec.find(s => s.id === 'note-context-pages')
    expect(pagesSec?.kind === 'section' && pagesSec.entries.map(e => (e.kind === 'link' ? e.label : ''))).toEqual([
      'Prep Cycle',
    ])
  })

  it('wires onPeekEntity onSelect callbacks for Efforts, Equipment, Tags, Notebooks, and Related Notes while keeping View all direct', () => {
    const peeked: NotePeekTarget[] = []
    const manyRelated = Array.from({ length: 6 }, (_, i) => ({
      id: `n-${i}`,
      title: `Session ${i}`,
      to: `/note/n-${i}`,
    }))
    const spec = buildNoteContextSpec({
      data: {
        collections: [{ id: 'girls', title: 'Girls', to: '/notebook/girls' }],
        tags: [{ id: 'domain:strength', title: '#strength', to: '/t/domain/strength', filterTo: '/notes?q=...' }],
        efforts: [{ id: 'back-squat', title: 'Back Squat', to: '/effort/back-squat', filterTo: '/notes?q=...' }],
        equipment: [{ id: 'barbell', title: 'Barbell', to: '/equipment/barbell', filterTo: '/notes?q=...' }],
        related: manyRelated,
        backlinks: [{ id: 'copy-1', title: 'Copy 1', to: '/note/copy-1' }],
      },
      onPeekEntity: (target) => peeked.push(target),
    })

    for (const secId of ['note-context-collections', 'note-context-tags', 'note-context-efforts', 'note-context-equipment', 'note-context-backlinks']) {
      const sec = spec.find(s => s.id === secId)
      expect(sec?.kind).toBe('section')
      if (sec?.kind === 'section') {
        const entry = sec.entries[0]
        expect(entry?.kind).toBe('link')
        if (entry?.kind === 'link') {
          expect(entry.onSelect).toBeDefined()
          expect(entry.filterTo).toBeUndefined()
          entry.onSelect?.()
        }
      }
    }

    const relSec = spec.find(s => s.id === 'note-context-related')
    if (relSec?.kind === 'section') {
      const first = relSec.entries[0]
      if (first?.kind === 'link') first.onSelect?.()
      const viewAll = relSec.entries[5]
      expect(viewAll?.kind === 'link' && viewAll.onSelect).toBeUndefined()
      expect(viewAll?.kind === 'link' && viewAll.to).toBe('/notes')
    }

    expect(peeked).toEqual([
      { kind: 'notebook', slug: 'girls', title: 'Girls' },
      { kind: 'tag', tagType: 'domain', label: 'strength' },
      { kind: 'effort', slug: 'back-squat', label: 'Back Squat' },
      { kind: 'equipment', slug: 'barbell', label: 'Barbell' },
      { kind: 'note', noteId: 'copy-1', title: 'Copy 1' },
      { kind: 'note', noteId: 'n-0', title: 'Session 0' },
    ])
  })
})
