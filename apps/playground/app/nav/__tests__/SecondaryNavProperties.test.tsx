/**
 * SecondaryNav — the L3 rail on stream routes carries the surface's controls:
 * where-filters (FacetProperties — moved here from the L2 ConditionsNavPanel)
 * plus view controls (date window, group-by, layout, visible fields). The L2
 * panel keeps navigation, labeled shortcuts and recent links only. Also covers
 * the mobile thumb ⋯ sheet's L3 block (MobileStreamControlsNav).
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router'

import { parseQuery, isFindQuery, type AnyParsedQuery, type ParsedFindQuery } from '@bitcobblers/wod-wiki-wql'

import { storageService } from '@/services/storage'
import type { Note } from '@/types/storage'

import { publishStreamResults, type StreamResultSnapshot } from '../../views/stream/streamResults'
import { FEEDS_STREAM_PROFILE } from '../../views/stream/streamProfile'
import { GROUP_BY_DIMENSION_IDS, resolveGroupByOptions } from '../../lib/groupByOptions'
import type { Entry } from '../../lib/entryMapper'
import type { StreamNavControls } from '../NavContext'
import { wqlGroupingDimensions } from '@bitcobblers/wod-wiki-wql'

import { NavContext, initialNavState } from '../NavContext'
import { MobileStreamControlsNav, SecondaryNav } from '../SecondaryNav'
import { facetOptions } from '../panels/conditionsFacets'

// The mobile ⋯ sheet gate — flipped per test (defaults to the real hook's
// no-matchMedia behavior).
let isMobile = false
mock.module('../../hooks/useIsMobile', () => ({
  useIsMobile: () => isMobile,
}))

const entry = (over: Partial<Entry> & { id: string; title: string }): Entry => ({
  kind: 'note',
  sourceNotebook: 'journal',
  sourceNote: over.id,
  date: null,
  ...over,
})

const ENTRIES: Entry[] = [
  entry({ id: 'n1', noteType: 'note', title: 'Alpha', tags: ['strength'] }),
]

const MEMBERSHIP = new Map<string, Array<{ label: string; type?: string }>>([
  ['n1', [{ label: 'strength' }]],
  ['notebook:x/one', [{ label: 'barbell', type: 'equipment' }]],
])

const EFFORT_MEMBERSHIP = new Map<string, string[]>([
  ['n1', ['fran']],
  ['notebook:x/one', ['fran', 'thruster']],
])

const DEFAULT_Q = FEEDS_STREAM_PROFILE.defaultWql

function controls(over: Partial<StreamNavControls> = {}): StreamNavControls {
  return {
    query: DEFAULT_Q,
    onQueryChange: () => {},
    groupDims: ['date'],
    onToggleGroupDim: () => {},
    availableGroupDims: [
      { id: 'date', label: 'Date' },
      { id: 'tag', label: 'Tags' },
    ],
    settings: { level: 'note', layout: 'cards', visibleFields: ['title', 'tags'] },
    onLayoutChange: () => {},
    onToggleField: () => {},
    level: 'note',
    ...over,
  }
}

let lastLocation: Location | null = null
function PathTracker() {
  lastLocation = useLocation()
  return null
}

function renderRail(at = '/feeds', streamControls?: StreamNavControls | null) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <PathTracker />
      <NuqsAdapter>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items: () => {},
            secondarySpec: undefined,
            setSecondarySpec: () => {},
            streamControls,
            setStreamControls: () => {},
            scrollToSection: () => {},
            registerScrollFn: () => {},
            openCreateJournal: () => {},
            registerCreateJournal: () => () => {},
            setContextNav: () => {},
          }}
        >
          <SecondaryNav />
        </NavContext.Provider>
      </NuqsAdapter>
    </MemoryRouter>,
  )
}

const originalGetNoteTagLabelsBatch = storageService.getNoteTagLabelsBatch
const originalGetEffortSlugsByNoteBatch = storageService.getEffortSlugsByNoteBatch
const originalGetAllNotes = storageService.getAllNotes

beforeEach(() => {
  lastLocation = null
  isMobile = false
  storageService.getNoteTagLabelsBatch = async () => MEMBERSHIP
  storageService.getEffortSlugsByNoteBatch = async () => EFFORT_MEMBERSHIP
  storageService.getAllNotes = async () => []
})

afterEach(() => {
  cleanup()
  storageService.getNoteTagLabelsBatch = originalGetNoteTagLabelsBatch
  storageService.getEffortSlugsByNoteBatch = originalGetEffortSlugsByNoteBatch
  storageService.getAllNotes = originalGetAllNotes
})

// ── placement: the L3 rail owns view controls AND where-filters ──────────────

describe('SecondaryNav L3 controls on stream routes', () => {
  it('renders view controls plus where-filters over the current query', () => {
    renderRail('/feeds', controls())
    publishStreamResults({ pathname: '/feeds', query: DEFAULT_Q, entries: ENTRIES })

    expect(screen.getByTestId('l3-stream-controls')).toBeTruthy()
    expect(screen.getByText('Date window')).toBeTruthy()
    expect(screen.getByText('Group by')).toBeTruthy()
    expect(screen.getByTestId('l3-layout-options')).toBeTruthy()
    expect(screen.getByTestId('l3-field-options')).toBeTruthy()

    // The moved L2 facet accordion renders here, titled Filters.
    expect(screen.getByTestId('l3-filters')).toBeTruthy()
    expect(screen.getByText('Filters')).toBeTruthy()
    expect(screen.getByTestId('conditions-section-tags')).toBeTruthy()
  })

  it('drives layout and field visibility through the published controls', () => {
    const onLayoutChange = mock(() => {})
    const onToggleField = mock(() => {})
    renderRail('/feeds', controls({ onLayoutChange, onToggleField }))

    // Layout mirrors the published settings and forwards picks.
    expect(screen.getByTestId('l3-layout-cards').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('l3-layout-rows'))
    expect(onLayoutChange).toHaveBeenCalledWith('rows')

    // Fields mirror visibleFields and forward toggles.
    const titleField = screen.getByTestId('l3-field-title').querySelector('input') as HTMLInputElement
    const excerptField = screen.getByTestId('l3-field-excerpt').querySelector('input') as HTMLInputElement
    expect(titleField.checked).toBe(true)
    expect(excerptField.checked).toBe(false)
    fireEvent.click(excerptField)
    expect(onToggleField).toHaveBeenCalledWith('excerpt')
  })

  it('renders nothing when the route publishes no controls and no page index', () => {
    const { container } = renderRail('/feeds', undefined)
    expect(container.firstChild).toBeNull()
  })

  it('group-by parity: the rail offers exactly the shared-vocabulary dimensions the stream picker derives', () => {
    // The stream view publishes resolveGroupByOptions(wqlGroupingDimensions…);
    // the rail renders that same list — same dims, same order, same labels.
    const supported = wqlGroupingDimensions('note', 'find')
    const dims = resolveGroupByOptions(supported, FEEDS_STREAM_PROFILE.groupByOptions)
    renderRail('/feeds', controls({ availableGroupDims: dims }))

    const options = screen.getByTestId('l3-groupby-options')
    expect(options.children.length).toBe(dims.length)
    for (const d of dims) {
      expect(GROUP_BY_DIMENSION_IDS).toContain(d.id)
      expect(screen.getByTestId(`l3-groupby-${d.id}`)).toBeTruthy()
    }
  })
})

// ── mobile thumb ⋯ sheet: the same L3 block, mobile-only ─────────────────────

describe('MobileStreamControlsNav', () => {
  it('renders the full L3 block — filters included — on mobile', () => {
    isMobile = true
    render(
      <MemoryRouter initialEntries={['/feeds']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={{
              tree: [],
              navState: initialNavState,
              dispatch: () => {},
              l3Items: [],
              setL3Items: () => {},
              secondarySpec: undefined,
              setSecondarySpec: () => {},
              streamControls: controls(),
              setStreamControls: () => {},
              scrollToSection: () => {},
              registerScrollFn: () => {},
              openCreateJournal: () => {},
              registerCreateJournal: () => () => {},
              setContextNav: () => {},
            }}
          >
            <MobileStreamControlsNav />
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('l3-stream-controls')).toBeTruthy()
    expect(screen.getByText('Filters')).toBeTruthy()
    expect(screen.getByTestId('conditions-section-tags')).toBeTruthy()
    expect(screen.getByTestId('l3-layout-options')).toBeTruthy()
  })

  it('renders nothing on desktop (rail and header ⋯ keep ownership) and without published controls', () => {
    isMobile = false
    const { container } = render(
      <MemoryRouter initialEntries={['/feeds']}>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items: () => {},
            secondarySpec: undefined,
            setSecondarySpec: () => {},
            streamControls: controls(),
            setStreamControls: () => {},
            scrollToSection: () => {},
            registerScrollFn: () => {},
            openCreateJournal: () => {},
            registerCreateJournal: () => () => {},
            setContextNav: () => {},
          }}
        >
          <MobileStreamControlsNav />
        </NavContext.Provider>
      </MemoryRouter>,
    )
    expect(container.firstChild).toBeNull()

    isMobile = true
    const { container: empty } = render(
      <MemoryRouter initialEntries={['/feeds']}>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items: () => {},
            secondarySpec: undefined,
            setSecondarySpec: () => {},
            streamControls: null,
            setStreamControls: () => {},
            scrollToSection: () => {},
            registerScrollFn: () => {},
            openCreateJournal: () => {},
            registerCreateJournal: () => () => {},
            setContextNav: () => {},
          }}
        >
          <MobileStreamControlsNav />
        </NavContext.Provider>
      </MemoryRouter>,
    )
    expect(empty.firstChild).toBeNull()
  })
})

// ── the moved facet accordion: tri-state rows / narrowing / pending / recovery ──

function publish(snapshot: StreamResultSnapshot) {
  act(() => publishStreamResults(snapshot))
}

/** The row's single cycle button; its current state lives on `data-state`. */
function stateButton(key: string, value: string): HTMLButtonElement {
  return screen.getByTestId(`conditions-state-${key}:${value}`) as HTMLButtonElement
}

function routedQuery(): string {
  return new URLSearchParams(lastLocation!.search).get('q') ?? ''
}

function findOf(parsed: AnyParsedQuery): ParsedFindQuery | null {
  return !parsed.error && isFindQuery(parsed) ? parsed : null
}

function tagsValues(parsed: ParsedFindQuery): string[] {
  return parsed.filters
    .filter(f => f.key === 'tags' && !f.negate)
    .flatMap(f => f.values.map(v => v.value))
}

function textValues(parsed: ParsedFindQuery): string[] {
  return parsed.filters
    .filter(f => f.key === 'text' && !f.negate)
    .flatMap(f => f.values.map(v => v.value))
}

// Canonical corpus rows are UUID-keyed — no path stem to split — so a
// notebook entry's facet vocabulary must come from the note's notebook-slug
// family aggregation over the junction batch. Exercised through the rendered
// rail: the family-only value ('benchmark', carried by the second corpus
// note) must surface for an entry whose notebook is the family.
describe('canonical tag membership through the L3 rail', () => {
  it('lists family-aggregated corpus tags for notebook entries with UUID note ids', async () => {
    storageService.getAllNotes = async () => [
      { id: 'uuid-fran', title: 'Fran', createdAt: 1, sourceId: 'notebook:crossfit-girls/fran' },
      { id: 'uuid-readme', title: 'Crossfit Girls', createdAt: 1, sourceId: 'notebook:crossfit-girls' },
    ] as Note[];
    storageService.getNoteTagLabelsBatch = async () =>
      new Map([
        ['uuid-fran', [{ label: 'strength' }]],
        ['uuid-readme', [{ label: 'strength' }, { label: 'benchmark' }]],
      ]);
    renderRail('/notebooks?q=%3Anotebooks%7Btags%3Astrength%7D%20by%20%7Btag%7D', controls({ query: ':notebooks{tags:strength} by {tag}' }))
    publish({
      pathname: '/notebooks',
      query: ':notebooks{tags:strength} by {tag}',
      entries: [entry({ id: 'f1', sourceNotebook: 'crossfit-girls', title: 'Fran' })],
    })
    fireEvent.click(await waitFor(() => {
      const button = screen.getByTestId('conditions-section-tags').querySelector('button')
      if (!button) throw new Error('tags accordion not rendered yet')
      return button
    }))
    await waitFor(() => expect(screen.getByTestId('conditions-row-tags:benchmark')).toBeTruthy())
    expect(screen.getByTestId('conditions-row-tags:strength')).toBeTruthy()
  })
})

describe('FacetProperties in the L3 stream controls', () => {
  it('toggles include/off on stable rows and narrows counts', async () => {
    renderRail("/feeds", controls())
    publish({ pathname: '/feeds', query: DEFAULT_Q, entries: ENTRIES })

    // Open the Tag section and read the option rows over the full results.
    fireEvent.click(await waitFor(() => screen.getByText('Tag')))
    await waitFor(() => {
      expect(screen.getByTestId('conditions-row-tags:strength')).toBeTruthy()
      expect(screen.getByTestId('conditions-row-tags:barbell')).toBeTruthy()
    })

    // Include strength → the routed query gains tags:strength and the row
    // flips to included WITHOUT re-clicking the accordion header (open state
    // survives the query change)…
    fireEvent.click(stateButton('tags', 'strength'))
    await waitFor(() => expect(tagsValues(findOf(parseQuery(routedQuery()))!)).toEqual(['strength']))
    expect(stateButton('tags', 'strength').dataset.state).toBe('include')
    expect(screen.getByTestId('conditions-row-tags:strength')).toBeTruthy()

    // …and the narrowed published result set keeps empty selectors visible with count 0 and faded styling.
    publish({
      pathname: '/feeds',
      query: routedQuery(),
      entries: ENTRIES.filter(e => e.id === 'n1'),
    })
    await waitFor(() => {
      const barbell = screen.getByTestId('conditions-row-tags:barbell')
      expect(barbell).toBeTruthy()
      expect(barbell.className).toContain('opacity-40')
      expect(barbell.textContent).toContain('0')
    })
    // The selected value stays listed (removable), not duplicated as an option.
    expect(screen.getByTestId('conditions-row-tags:strength')).toBeTruthy()

    // Off removes the value from both polarities — the cycle passes through
    // exclude, which must land (matching run published) before the next click.
    fireEvent.click(stateButton('tags', 'strength'))
    publish({
      pathname: '/feeds',
      query: routedQuery(),
      entries: ENTRIES.filter(e => e.id === 'notebook:x/one'),
    })
    await waitFor(() => expect(stateButton('tags', 'strength').dataset.state).toBe('exclude'))
    fireEvent.click(stateButton('tags', 'strength'))
    await waitFor(() => expect(tagsValues(findOf(parseQuery(routedQuery()))!)).toEqual([]))
    expect(routedQuery()).not.toContain('!tags')
  })

  it('excludes values, keeps them listed past their result support, and recovers', async () => {
    renderRail("/feeds", controls())
    publish({ pathname: '/feeds', query: DEFAULT_Q, entries: ENTRIES })
    fireEvent.click(await waitFor(() => screen.getByText('Tag')))
    await waitFor(() => expect(screen.getByTestId('conditions-row-tags:barbell')).toBeTruthy())

    // Cycle: off → include → exclude; the matching run must land between
    // steps (controls disable while a fresh execution is pending).
    fireEvent.click(stateButton('tags', 'barbell'))
    publish({ pathname: '/feeds', query: routedQuery(), entries: ENTRIES })
    await waitFor(() => expect(stateButton('tags', 'barbell').dataset.state).toBe('include'))
    fireEvent.click(stateButton('tags', 'barbell'))
    await waitFor(() => expect(routedQuery()).toContain('!tags:barbell'))
    expect(stateButton('tags', 'barbell').dataset.state).toBe('exclude')

    // Zero results: the exclusion stays listed with its removal control…
    publish({ pathname: '/feeds', query: routedQuery(), entries: [] })
    await waitFor(() => {
      expect(screen.getByTestId('conditions-row-tags:barbell')).toBeTruthy()
      expect(stateButton('tags', 'barbell').disabled).toBe(false)
    })
    // …and Off clears the negation back to a tags-free query.
    fireEvent.click(stateButton('tags', 'barbell'))
    await waitFor(() => {
      expect(tagsValues(findOf(parseQuery(routedQuery()))!)).toEqual([])
      expect(routedQuery()).not.toContain('!tags')
    })
  })

  it('restores selections from the URL alone and keeps them removable at zero results', async () => {
    // Restoration: the selection renders from the routed q= with NO snapshot.
    renderRail('/feeds?q=%3Anotebook%7Btags%3Astrength%7D%20by%20%7Btag%7D', controls({ query: ':notebook{tags:strength} by {tag}' }))
    expect(screen.getByTestId('conditions-row-tags:strength')).toBeTruthy()
    expect(stateButton('tags', 'strength').dataset.state).toBe('include')

    // Selected-zero recovery: an empty result set keeps the selection listed…
    publish({
      pathname: '/feeds',
      query: ':notebook{tags:strength} by {tag}',
      entries: [],
    })
    await waitFor(() => expect(screen.getByTestId('conditions-row-tags:strength')).toBeTruthy())
    // …removable back to a tags-free query (canonical head scope remains);
    // the cycle steps through exclude once its matching run lands.
    fireEvent.click(stateButton('tags', 'strength'))
    publish({ pathname: '/feeds', query: routedQuery(), entries: [] })
    await waitFor(() => expect(stateButton('tags', 'strength').dataset.state).toBe('exclude'))
    fireEvent.click(stateButton('tags', 'strength'))
    await waitFor(() => expect(tagsValues(findOf(parseQuery(routedQuery()))!)).toEqual([]))
  })

  it('never offers options from a stale snapshot (previous page or superseded draft)', () => {
    renderRail("/feeds", controls())
    publish({ pathname: '/journal', query: ':journal{}', entries: ENTRIES })
    // No option rows anywhere: the published run belongs to another page
    // (hasEverPublished gates rendering). facetOptions itself degrades to
    // the corpus vocabulary at count 0 — the empty criteria stay listed.
    expect(screen.queryByTestId('conditions-row-tags:strength')).toBeNull()
    expect(screen.queryByTestId('conditions-row-tags:barbell')).toBeNull()
    expect(facetOptions('note', 'tags', { entries: [], tagMembership: MEMBERSHIP, effortMembership: EFFORT_MEMBERSHIP })).toEqual([
      { value: 'barbell', count: 0 },
      { value: 'strength', count: 0 },
    ])
  })

  it('retains prior rows visibly disabled while a matching execution is pending', async () => {
    renderRail("/feeds", controls())
    publish({ pathname: '/feeds', query: DEFAULT_Q, entries: ENTRIES })
    fireEvent.click(await waitFor(() => screen.getByText('Tag')))
    await waitFor(() => expect(stateButton('tags', 'strength').disabled).toBe(false))

    fireEvent.click(stateButton('tags', 'strength'))
    // Snapshot still matches the OLD query: committed rows stay visible at
    // their prior counts, every control disabled — no disappearing flash.
    expect(screen.getByTestId('conditions-row-tags:strength')).toBeTruthy()
    expect(screen.getByTestId('conditions-row-tags:barbell')).toBeTruthy()
    expect(stateButton('tags', 'strength').dataset.state).toBe('include')
    expect(stateButton('tags', 'strength').disabled).toBe(true)
    expect(stateButton('tags', 'barbell').disabled).toBe(true)

    // Matching snapshot lands → controls re-enable on the fresh counts (empty selectors stay with count 0).
    publish({
      pathname: '/feeds',
      query: routedQuery(),
      entries: ENTRIES.filter(e => e.id === 'n1'),
    })
    await waitFor(() => expect(stateButton('tags', 'strength').disabled).toBe(false))
    const barbell = screen.getByTestId('conditions-row-tags:barbell')
    expect(barbell).toBeTruthy()
    expect(barbell.textContent).toContain('0')
  })

  it('renders a jump to WQL link for text search; outside the stream page it is a safe no-op', async () => {
    renderRail('/feeds', controls())
    publish({ pathname: '/feeds', query: DEFAULT_Q, entries: ENTRIES })
    expect(screen.getByTestId('conditions-jump-wql-text')).toBeTruthy()
    // No stream-query-bar in this host: the click degrades to a no-op and
    // the routed query is untouched.
    fireEvent.click(screen.getByTestId('conditions-jump-wql-text'))
    expect(routedQuery()).toBe('')
  })

  it('shows no count badge on the live text row while categorical counts remain', async () => {
    renderRail("/feeds", controls())
    publish({ pathname: '/feeds', query: DEFAULT_Q, entries: ENTRIES })
    // Open the tags accordion via its section wrapper — no label wording pin.
    fireEvent.click(await waitFor(() => {
      const button = screen.getByTestId('conditions-section-tags').querySelector('button')
      if (!button) throw new Error('tags accordion not rendered yet')
      return button
    }))
    await waitFor(() => expect(screen.getByTestId('conditions-row-tags:strength')).toBeTruthy())

    // Typing in the live Contains box rewrites the query's text condition;
    // the value becomes a row in the Contains section.
    fireEvent.change(screen.getByTestId('conditions-input-text'), { target: { value: 'PW Workout' } })
    await waitFor(() => expect(textValues(findOf(parseQuery(routedQuery()))!)).toEqual(['PW Workout']))
    const textRow = screen.getByTestId('conditions-row-text:PW Workout')
    expect(textRow.querySelector('span.tabular-nums')).toBeNull()

    // Genuine categorical counts are untouched.
    expect(screen.getByTestId('conditions-row-tags:strength').querySelector('span.tabular-nums')!.textContent).toBe('1')
  })
})
