/**
 * entryGrouping — the `source` dimension (#playground-buckets).
 *
 * The WQL `by {source}` grouping buckets entries by their source plane
 * (journal / playground / feeds / collections) so mixed-content listings
 * can group by where a note lives, not just when it is dated.
 */
import { describe, expect, it } from 'bun:test'
import { parseQuery } from '@bitcobblers/wod-wiki-engine'
import type { Entry } from './entryMapper'
import { groupEntriesByDimension, parseGroupingDimensions } from './entryGrouping'
import { formatDateHeader } from './dateFormat'

function entry(id: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    kind: 'note',
    sourceCatalog: 'journal',
    sourceItem: id,
    title: id,
    date: null,
    ...overrides,
  } as Entry
}

describe('groupEntriesByDimension — source', () => {
  it('buckets entries by source plane with capitalized labels', () => {
    const groups = groupEntriesByDimension([
      entry('a', { sourceCatalog: 'journal' }),
      entry('b', { sourceCatalog: 'playground' }),
      entry('c', { sourceCatalog: 'playground' }),
      entry('d', { sourceCatalog: 'crossfit-girls' }),
    ], 'source')

    expect(groups.map(g => g.label)).toEqual(['Crossfit-girls', 'Journal', 'Playground'])
    const playground = groups.find(g => g.label === 'Playground')!
    expect(playground.entries.map(e => e.id)).toEqual(['b', 'c'])
    expect(playground.id).toBe('group-source-playground')
  })

  it('falls back to Other when an entry carries no source catalog', () => {
    const groups = groupEntriesByDimension([entry('x', { sourceCatalog: undefined })], 'source')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe('Other')
  })
})

describe('groupEntriesByDimension — ordered dimensions', () => {
  const dated = [
    entry('a', { date: '2026-09-04', sourceCatalog: 'journal' }),
    entry('b', { date: '2026-09-04', sourceCatalog: 'playground' }),
    entry('c', { date: '2026-08-15', sourceCatalog: 'journal' }),
  ]

  it('sub-divides each parent group by the following dimension, in order', () => {
    const groups = groupEntriesByDimension(dated, ['source', 'date'])
    // Parent label (source) / child label (localized date header); children
    // inherit the date dimension's descending order.
    expect(groups.map(g => g.label)).toEqual([
      `Journal / ${formatDateHeader('2026-09-04')}`,
      `Journal / ${formatDateHeader('2026-08-15')}`,
      `Playground / ${formatDateHeader('2026-09-04')}`,
    ])
    const composite = groups.find(g => g.label === `Journal / ${formatDateHeader('2026-09-04')}`)!
    expect(composite.entries.map(e => e.id)).toEqual(['a'])
    // Composite keys stay unique and stable for DOM ids and scroll links.
    expect(composite.id).toBe('group-source-journal--date-group-2026-09-04')
  })

  it('keeps a single dimension flat and groups off-vocabulary dimensions as properties', () => {
    expect(groupEntriesByDimension(dated, ['date']).map(g => g.key)).toEqual([
      '2026-09-04',
      '2026-08-15',
    ])
    // Dimensions outside CONTENT_GROUPING_DIMENSIONS name note properties —
    // these entries carry no typed tags, so all land in Unassigned.
    const unknown = groupEntriesByDimension(dated, ['resistance'])
    expect(unknown.map(g => g.label)).toEqual(['Unassigned'])
    expect(unknown[0]!.id).toBe('group-property-resistance-unassigned')
  })
})

describe('groupEntriesByDimension — property dimensions (typed tags)', () => {
  const tagged = [
    entry('a', { typedTags: [{ label: 'strength', type: 'domain' }, { label: 'amrap', type: 'format' }] }),
    entry('b', { typedTags: [{ label: 'engine', type: 'domain' }] }),
    entry('c', { typedTags: [{ label: 'benchmark', type: undefined }] }),
  ]

  it('groups by a configured tag type value', () => {
    const groups = groupEntriesByDimension(tagged, ['domain'])
    expect(groups.map(g => g.label).sort()).toEqual(['Unassigned', 'engine', 'strength'])
    expect(groups.find(g => g.label === 'strength')!.entries.map(e => e.id)).toEqual(['a'])
  })

  it('matches the tag type case-insensitively', () => {
    const groups = groupEntriesByDimension(tagged, ['DOMAIN'])
    expect(groups.map(g => g.label)).toContain('strength')
  })

  it('untyped tags never satisfy a property dimension', () => {
    const groups = groupEntriesByDimension(tagged, ['format'])
    expect(groups.map(g => g.label)).toEqual(['amrap', 'Unassigned'])
  })
})

describe('groupEntriesByDimension — date (playground createdAt fallback)', () => {
  it('groups playground notes by createdAt when no journal date exists', () => {
    const groups = groupEntriesByDimension([
      entry('p1', { sourceCatalog: 'playground', createdAt: Date.UTC(2026, 9, 8) }),
      entry('p2', { sourceCatalog: 'playground', createdAt: Date.UTC(2026, 9, 8) }),
      entry('p3', { sourceCatalog: 'playground', createdAt: Date.UTC(2026, 9, 7) }),
    ], 'date')

    const keys = groups.map(g => g.key)
    expect(keys).toEqual(['2026-10-08', '2026-10-07'])
    expect(groups[0]!.entries.map(e => e.id)).toEqual(['p1', 'p2'])
  })

  it('groups playground notes with small sentinel createdAt under Undated', () => {
    const groups = groupEntriesByDimension([
      entry('p-sentinel', { sourceCatalog: 'playground', createdAt: 2829 }),
    ], 'date')
    expect(groups.map(g => g.label)).toEqual(['Undated'])
  })

  it('keeps undated collection sessions on the shelf while playgrounds date-group', () => {
    const groups = groupEntriesByDimension([
      entry('c1', { kind: 'session', sourceCatalog: 'crossfit-girls', date: null }),
      entry('p1', { sourceCatalog: 'playground', createdAt: Date.UTC(2026, 9, 8) }),
    ], 'date', { shelfVisible: true })

    expect(groups[1]!.key).toBe('2026-10-08')
    expect(groups[0]!.entries.map(e => e.id)).toEqual(['c1'])
  })

  it('leaves non-playground undated entries in the Undated bucket', () => {
    const groups = groupEntriesByDimension([
      entry('n1', { sourceCatalog: 'journal', date: null }),
    ], 'date')

    expect(groups.map(g => g.key)).toEqual(['undated'])
  })
})

describe('parseGroupingDimensions — ordered', () => {
  it('reads every ordered dimension from the AST, lowercased in order', () => {
    expect(
      parseGroupingDimensions('', parseQuery(':note{tags:pr} by {Discipline, week}')),
    ).toEqual(['discipline', 'week'])
  })

  it('parses the query string through the shared engine parser', () => {
    expect(parseGroupingDimensions(':note by {source, week}')).toEqual(['source', 'week'])
    expect(parseGroupingDimensions(':note by {tag}')).toEqual(['tag'])
  })

  it('is null for invalid queries and without grouping', () => {
    expect(parseGroupingDimensions(':note last 2w')).toBeNull()
    expect(parseGroupingDimensions('not a query')).toBeNull()
  })
})
