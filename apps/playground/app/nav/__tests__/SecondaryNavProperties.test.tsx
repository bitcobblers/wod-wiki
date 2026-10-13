/**
 * SecondaryNav — the L3 right rail on stream routes carries VIEW controls
 * only (date window, group-by, layout, visible fields). Where-clause filters
 * are L2-only: even with a committed result snapshot published, no facet accordion
 * and no "Properties" block render here.
 */

import { describe, it, expect, afterEach, mock } from 'bun:test'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router'

import { publishStreamResults } from '../../views/stream/streamResults'
import { FEEDS_STREAM_PROFILE } from '../../views/stream/streamProfile'
import type { Entry } from '../../lib/entryMapper'
import type { StreamNavControls } from '../NavContext'

import { NavContext, initialNavState } from '../NavContext'
import { SecondaryNav } from '../SecondaryNav'

const entry = (over: Partial<Entry> & { id: string; title: string }): Entry => ({
  kind: 'note',
  sourceCatalog: 'journal',
  sourceItem: over.id,
  date: null,
  ...over,
})

const ENTRIES: Entry[] = [
  entry({ id: 'n1', noteId: 'n1', noteType: 'note', title: 'Alpha', tags: ['strength'] }),
]

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

function renderRail(at = '/feeds', streamControls?: StreamNavControls | null) {
  return render(
    <MemoryRouter initialEntries={[at]}>
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

afterEach(() => cleanup())

describe('SecondaryNav view controls on stream routes', () => {
  it('renders view controls — and never where-filters, even with published results', () => {
    renderRail('/feeds', controls())
    publishStreamResults({ pathname: '/feeds', query: DEFAULT_Q, entries: ENTRIES })

    expect(screen.getByTestId('l3-stream-controls')).toBeTruthy()
    expect(screen.getByText('Date window')).toBeTruthy()
    expect(screen.getByText('Group by')).toBeTruthy()
    expect(screen.getByTestId('l3-layout-options')).toBeTruthy()
    expect(screen.getByTestId('l3-field-options')).toBeTruthy()

    // Where-filters stay in L2: no Properties block, no facet sections.
    expect(screen.queryByTestId('l3-properties')).toBeNull()
    expect(screen.queryByText('Properties')).toBeNull()
    expect(screen.queryByTestId('conditions-section-tags')).toBeNull()
    expect(screen.queryByTestId('conditions-row-tags:strength')).toBeNull()
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
})
