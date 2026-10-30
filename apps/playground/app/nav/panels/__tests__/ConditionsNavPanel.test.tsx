/**
 * ConditionsNavPanel regression — the behaviors the L2 panel must never lose:
 *   1. navigation chrome: landing row, Custom row (save/clear), saved
 *      shortcuts, page actions — full-query navigation closes the drawer;
 *   2. Recent: the committed run for the CURRENT route+query renders as
 *      capped open links — a previous route's or superseded query's run
 *      never appears;
 *   3. placement: where-clause filters are L3-only (StreamControlsNav ▸
 *      FacetProperties — see nav/__tests__/SecondaryNavProperties.test.tsx);
 *      the L2 panel renders none, even with matching published results.
 * The pure facet model (conditionsFacets toggling / text / invariants) stays
 * covered here; its component behavior lives with the L3 host tests.
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'

import { parseQuery, serialize, isFindQuery, type AnyParsedQuery, type ParsedFindQuery } from '@bitcobblers/wod-wiki-wql'

import { publishStreamResults, type StreamResultSnapshot } from '../../../views/stream/streamResults'
import { FEEDS_STREAM_PROFILE } from '../../../views/stream/streamProfile'
import type { Entry } from '../../../lib/entryMapper'
import { entryOpenHref } from '../../../lib/entryActions'

import {
  addFacetValue,
  removeFacetValue,
  selectedValuesFor,
  setTextCondition,
  facetOptions,
  setSourceScopeValue,
} from '../conditionsFacets'
import { NavigationDrawerProvider } from '../../NavigationDrawerContext'
import { createConditionsNavPanel, RECENT_RESULTS_LIMIT } from '../ConditionsNavPanel'

// ── fixtures ─────────────────────────────────────────────────────────────────

const entry = (over: Partial<Entry> & { id: string; title: string }): Entry => ({
  kind: 'note',
  sourceNotebook: 'journal',
  sourceNote: over.id,
  date: null,
  ...over,
})

const ENTRIES: Entry[] = [
  entry({ id: 'n1', noteType: 'note', title: 'Alpha' }),
  entry({ id: 'notebook:x/one', sourceId: 'notebook:x', noteType: 'note', title: 'Beta' }),
]

/** Oversized run — proves the deterministic Recent cap slices the head. */
const MANY: Entry[] = Array.from({ length: RECENT_RESULTS_LIMIT + 4 }, (_, i) =>
  entry({ id: `r-${i}`, title: `Recent ${i}` })
)

const MEMBERSHIP = new Map<string, Array<{ label: string; type?: string }>>([
  ['n1', [{ label: 'strength' }]],
  ['notebook:x/one', [{ label: 'barbell', type: 'equipment' }]],
])

const EFFORT_MEMBERSHIP = new Map<string, string[]>([
  ['n1', ['fran']],
  ['notebook:x/one', ['fran', 'thruster']],
])

const DEFAULT_Q = FEEDS_STREAM_PROFILE.defaultWql

function findOf(parsed: AnyParsedQuery): ParsedFindQuery | null {
  return !parsed.error && isFindQuery(parsed) ? parsed : null
}

function sourceValues(parsed: ParsedFindQuery): string[] {
  return parsed.filters
    .filter(f => f.key === 'source' && !f.negate)
    .flatMap(f => f.values.map(v => v.value))
}

function tagsValues(parsed: ParsedFindQuery): string[] {
  return parsed.filters
    .filter(f => f.key === 'tags' && !f.negate)
    .flatMap(f => f.values.map(v => v.value))
}

let lastLocation: Location | null = null
function PathTracker() {
  lastLocation = useLocation()
  return null
}

const ConditionsPanel = createConditionsNavPanel({
  landingLabel: 'All notebooks',
  icon: undefined,
  route: '/feeds',
  profile: FEEDS_STREAM_PROFILE,
  familyActive: () => true,
})

function renderPanel(at = '/feeds', drawerClose?: () => void) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <PathTracker />
      <NavigationDrawerProvider close={drawerClose ?? (() => {})}>
        <ConditionsPanel />
      </NavigationDrawerProvider>
    </MemoryRouter>,
  )
}

afterEach(() => cleanup())

// ── pure toggle model ────────────────────────────────────────────────────────

describe('conditionsFacets toggling', () => {
  it('merges values into the existing occurrence (OR within key) and keeps structural clauses', () => {
    const once = findOf(parseQuery(addFacetValue(':notebook{} by {tag} last 4w', 'tags', 'strength')))!
    // The serializer canonicalizes the :notebooks head to source:notebooks.
    expect(tagsValues(once)).toEqual(['strength'])
    expect(once.groupBy).toEqual(['tag'])
    expect(once.window).toBeDefined()
    const twice = findOf(parseQuery(addFacetValue(serialize(once), 'tags', 'endurance')))!
    expect(tagsValues(twice)).toEqual(['strength', 'endurance'])
    expect(twice.groupBy).toEqual(['tag'])
    expect(twice.window).toBeDefined()
  })

  it('removes one value occurrence-exactly and splices the clause when it empties', () => {
    const q = serialize(findOf(parseQuery(':notebooks{tags:strength|endurance} by {tag} last 4w'))!)
    const selected = selectedValuesFor(findOf(parseQuery(q))!, 'tags')
    const withoutStrength = findOf(parseQuery(removeFacetValue(q, 'tags', selected.find(row => row.display === 'strength')!)))!
    expect(tagsValues(withoutStrength)).toEqual(['endurance'])
    expect(withoutStrength.groupBy).toEqual(['tag'])
    expect(withoutStrength.window).toBeDefined()
    const last = selectedValuesFor(withoutStrength, 'tags')
    const emptied = findOf(parseQuery(removeFacetValue(serialize(withoutStrength), 'tags', last[0]!)))!
    expect(tagsValues(emptied)).toEqual([])
    expect(emptied.groupBy).toEqual(['tag'])
  })

  it('round-trips wildcard values and preserves negated occurrences', () => {
    const wild = findOf(parseQuery(addFacetValue(':note{}', 'tags', 'fran*')))!
    expect(wild.filters.find(f => f.key === 'tags')!.values[0]).toEqual({ value: 'fran', wildcard: true })
    const negated = selectedValuesFor(findOf(parseQuery(':note{!tags:a}'))!, 'tags')
    expect(negated[0]!.negate).toBe(true)
    expect(tagsValues(findOf(parseQuery(removeFacetValue(':note{!tags:a}', 'tags', negated[0]!)))!)).toEqual([])
  })

  it('keeps the source scope a radio (replace, not AND)', () => {
    const replaced = findOf(parseQuery(addFacetValue(':notebook{source:notebooks}', 'source', 'journal')))!
    expect(sourceValues(replaced)).toEqual(['journal'])
    expect(replaced.sourceScope).toBeUndefined()
    const added = findOf(parseQuery(addFacetValue(':journal{}', 'source', 'notebooks')))!
    expect(sourceValues(added)).toContain('notebooks')
    // Negated source occurrences are independent clauses — a scope write
    // replaces only the head-scope slot and the positive occurrence.
    const withNegated = findOf(parseQuery(setSourceScopeValue(':note{source:journal,!source:guides}', 'notebooks')))!
    expect(sourceValues(withNegated)).toEqual(['notebooks'])
    expect(withNegated.filters.some(f => f.key === 'source' && f.negate && f.values.some(v => v.value === 'guides'))).toBe(true)
    // Head-authored scope clears to all sources, negations surviving.
    const cleared = findOf(parseQuery(setSourceScopeValue(':notebooks{!source:guides} by {tag}', null)))!
    expect(sourceValues(cleared)).toEqual([])
    expect(cleared.filters.some(f => f.key === 'source' && f.negate)).toBe(true)
    expect(cleared.groupBy).toEqual(['tag'])
    // A user-authored scope under a scoped head survives the head-slot clear.
    const mixed = findOf(parseQuery(setSourceScopeValue(':journal{source:notebooks}', null)))!
    expect(sourceValues(mixed)).toEqual(['notebooks'])
  })

  it('preserves sibling source occurrences on a targeted scope replace', () => {
    // Duplicate positives: the FIRST occurrence is the composer-targeted
    // scope slot; later positives and negations are never silently deleted.
    const multi = findOf(parseQuery(setSourceScopeValue(':note{source:journal,source:notebooks,!source:guides}', 'playground')))!
    expect(sourceValues(multi)).toEqual(['playground', 'notebooks'])
    expect(multi.filters.some(f => f.key === 'source' && f.negate && f.values.some(v => v.value === 'guides'))).toBe(true)
  })

  it('counts session plane options per retained event, matching post-selection rows', () => {
    const sessionEntry: Entry = entry({
      id: 'r1',
      title: 'Session',
      kind: 'result',
      execution: {
        resultId: 'r1',
        noteId: 'n1',
        timestamp: 0,
        outputType: 'all',
        events: [
          { id: 'e1', resultId: 'r1', noteId: 'n1', grain: 'event', timestamp: 0, outputType: 'segment', timeSpan: { started: 0 }, metrics: [] },
          { id: 'e2', resultId: 'r1', noteId: 'n1', grain: 'event', timestamp: 0, outputType: 'segment', timeSpan: { started: 0 }, metrics: [] },
          { id: 'e3', resultId: 'r1', noteId: 'n1', grain: 'event', timestamp: 0, outputType: 'load', timeSpan: { started: 0 }, metrics: [] },
        ],
      },
    })
    expect(facetOptions('session', 'plane', {
      entries: [sessionEntry],
      tagMembership: null,
      effortMembership: null,
    })).toEqual([
      { value: 'segment', count: 2 },
      { value: 'load', count: 1 },
    ])
  })
})

// ── pure text-condition model ────────────────────────────────────────────────

function textValues(parsed: ParsedFindQuery): string[] {
  return parsed.filters
    .filter(f => f.key === 'text' && !f.negate)
    .flatMap(f => f.values.map(v => v.value))
}

describe('setTextCondition', () => {
  it('appends, rewrites and clears the positive text condition losslessly', () => {
    const base = ':notebook{} by {tag} last 4w'
    const added = findOf(parseQuery(setTextCondition(base, 'squat')))!
    expect(textValues(added)).toEqual(['squat'])
    expect(added.groupBy).toEqual(['tag'])
    expect(added.window).toBeDefined()

    const rewritten = findOf(parseQuery(setTextCondition(serialize(added), 'press')))!
    expect(textValues(rewritten)).toEqual(['press'])
    expect(rewritten.groupBy).toEqual(['tag'])
    expect(rewritten.window).toBeDefined()

    const cleared = findOf(parseQuery(setTextCondition(serialize(rewritten), '')))!
    expect(textValues(cleared)).toEqual([])
    expect(cleared.groupBy).toEqual(['tag'])
    expect(cleared.window).toBeDefined()
  })

  it('survives negated occurrences and collapses ANDed positives', () => {
    const withNegation = findOf(parseQuery(setTextCondition(':notebook{!text:junk}', 'squat')))!
    expect(textValues(withNegation)).toEqual(['squat'])
    expect(withNegation.filters.some(f => f.key === 'text' && f.negate)).toBe(true)

    const anded = findOf(parseQuery(setTextCondition(':notebook{text:a | text:b}', 'squat')))!
    expect(textValues(anded)).toEqual(['squat'])
  })

  it('returns unparseable input unchanged', () => {
    expect(setTextCondition('not a query at all (((', 'x')).toBe('not a query at all (((')
  })
})

// ── component: navigation chrome + recent results ───────────────────────────

function publish(snapshot: StreamResultSnapshot) {
  act(() => publishStreamResults(snapshot))
}

function routedQuery(): string {
  return new URLSearchParams(lastLocation!.search).get('q') ?? ''
}

describe('ConditionsNavPanel', () => {
  it('closes the drawer on full-query navigation only', async () => {
    let closed = 0
    renderPanel('/feeds', () => {
      closed += 1
    })

    // Landing row navigation closes the drawer…
    fireEvent.click(screen.getByText('All feeds'))
    expect(closed).toBe(1)

    // …and so does the Custom row's Clear-to-all (a full-query navigation).
    const custom = '%3Anotebook%7Btags%3Astrength%7D%20by%20%7Btag%7D'
    cleanup()
    closed = 0
    renderPanel(`/feeds?q=${custom}`, () => {
      closed += 1
    })
    expect(screen.getByTestId('conditions-nav-custom')).toBeTruthy()
    expect(screen.getByTestId('conditions-nav-custom-save')).toBeTruthy()
    fireEvent.click(screen.getByTestId('conditions-nav-custom-clear'))
    expect(closed).toBe(1)
    expect(routedQuery()).toBe('')
  })

  it('enumerates effort slugs from the containment index over current results', () => {
    const options = facetOptions('note', 'effort', {
      entries: ENTRIES,
      tagMembership: MEMBERSHIP,
      effortMembership: EFFORT_MEMBERSHIP,
    })
    // fran is contained by both rows, thruster by one — counts are rows.
    expect(options).toEqual([
      { value: 'fran', count: 2 },
      { value: 'thruster', count: 1 },
    ])
  })

  it('links the committed run for the current route+query, capped deterministically', () => {
    renderPanel()
    publish({ pathname: '/feeds', query: DEFAULT_Q, entries: MANY })

    expect(screen.getByTestId('conditions-nav-recent')).toBeTruthy()
    const links = screen.getAllByTestId('conditions-nav-recent-link') as HTMLAnchorElement[]
    expect(links.length).toBe(RECENT_RESULTS_LIMIT)
    // Committed order: the run's head rows, each routed to its open href.
    expect(links[0]!.getAttribute('href')).toBe(entryOpenHref(MANY[0]))
    expect(links[RECENT_RESULTS_LIMIT - 1]!.getAttribute('href')).toBe(entryOpenHref(MANY[RECENT_RESULTS_LIMIT - 1]))
  })

  it('hides recent entries from a previous route or a superseded query', () => {
    renderPanel()
    publish({ pathname: '/journal', query: DEFAULT_Q, entries: ENTRIES })
    expect(screen.queryByTestId('conditions-nav-recent')).toBeNull()
    publish({ pathname: '/feeds', query: ':notebook{other}', entries: ENTRIES })
    expect(screen.queryByTestId('conditions-nav-recent')).toBeNull()
    // A matching run for THIS surface appears in place of the stale one.
    publish({ pathname: '/feeds', query: DEFAULT_Q, entries: ENTRIES })
    expect(screen.getAllByTestId('conditions-nav-recent-link')).toHaveLength(ENTRIES.length)
  })

  it('renders no where-filters in L2 even with matching published results', () => {
    renderPanel()
    publish({ pathname: '/feeds', query: DEFAULT_Q, entries: ENTRIES })
    expect(screen.queryByText('Filters')).toBeNull()
    expect(screen.queryByTestId('conditions-section-tags')).toBeNull()
    expect(screen.queryByTestId('conditions-section-source')).toBeNull()
  })
})

// Guard: every toggle result must stay a parseable find query.
describe('conditionsFacets invariants', () => {
  it('always yields a valid find AST with the target intact', () => {
    let q = ':notebook{} by {tag} last 4w | limit 20'
    for (const value of ['strength', 'fran*', 'endurance']) {
      q = addFacetValue(q, 'tags', value)
      const parsed = parseQuery(q)
      expect(parsed.error).toBeUndefined()
      expect(isFindQuery(parsed)).toBe(true)
    }
    expect(q).toContain('by {tag}')
    expect(q).toContain('last 4w')
    expect(q).toContain('| limit 20')
  })
})
