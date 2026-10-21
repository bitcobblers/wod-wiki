import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TourJumpSection } from './TourJumpSection'
import { SYNC_PACKAGES } from '@/services/seed/seedSources'
import { parseNotebookChunkId } from '../views/notebook-gallery/notebookGalleryModel'

const NOTEBOOK_PACKAGES = SYNC_PACKAGES.filter(pkg => parseNotebookChunkId(pkg.chunkId) !== null)
// jsdom has neither ResizeObserver nor layout; the marquee falls back to
// one set per half (two copies) and tests scope queries to the first copy.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: ResizeObserverStub })

let mediaMatches = false

function mockMedia(matches: boolean) {
  mediaMatches = matches
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: mediaMatches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }),
  })
}

let subscribed = new Set<string>()
let outcomes: Record<string, 'imported' | 'current' | 'server-stale' | 'error' | 'busy'> = {}
const pending = new Set<string>()

mock.module('@/services/seed/seedSubscriptions', () => ({
  isSeedSubscribed: (id: string) => subscribed.has(id),
  setSeedSubscribed: (id: string, value: boolean) => {
    if (value) subscribed.add(id)
    else subscribed.delete(id)
    for (const listener of subscriptionListeners) listener()
    return true
  },
  subscribeSeedSubscriptions: (cb: () => void) => {
    subscriptionListeners.add(cb)
    return () => subscriptionListeners.delete(cb)
  },
}))
const subscriptionListeners = new Set<() => void>()

mock.module('@/services/seed/seedSync', () => ({
  syncSeedSource: (id: string) => {
    if (pending.has(id)) return new Promise(() => { /* hangs until released */ })
    const outcome = outcomes[id] ?? 'imported'
    if (outcome === 'imported' || outcome === 'current') {
      subscribed.add(id)
      for (const listener of subscriptionListeners) listener()
    }
    return Promise.resolve(outcome)
  },
  readSeedCoverage: async () => ({
    coreImported: true,
    libraryImported: subscribed.size > 0,
  }),
}))

function renderSection() {
  return render(
    <MemoryRouter>
      <TourJumpSection />
    </MemoryRouter>,
  )
}

/** The marquee loops by duplicating the card set — scope queries to copy 0. */
function copyEl(rowTestId: string): HTMLElement {
  const copy = screen.getByTestId(rowTestId).querySelector('[data-marquee-copy="0"]')
  expect(copy).toBeTruthy()
  return copy as HTMLElement
}
function firstCopy(rowTestId: string) {
  return within(copyEl(rowTestId))
}
/** Ids of the notebook cards (articles) inside a copy — not their inner controls. */
function cardIds(el: HTMLElement) {
  return Array.from(el.querySelectorAll('[data-kind]')).map(node => node.getAttribute('data-testid'))
}

describe('TourJumpSection', () => {
  beforeEach(() => {
    subscribed = new Set()
    outcomes = {}
    pending.clear()
    mockMedia(false) // default: mobile layout (single alternating row)
  })
  afterEach(() => {
    cleanup()
  })

  it('renders the library exit first, the journal exit next, and no playground exit', () => {
    renderSection()
    const section = screen.getByTestId('tour-jump-section')
    expect(section).toBeTruthy()

    const exits = screen.getByTestId('jump-grid').children[0]
    expect(exits.children[0].getAttribute('data-testid')).toBe('jump-library')
    expect(exits.children[1].getAttribute('data-testid')).toBe('jump-new-note')
    expect(screen.queryByTestId('jump-playgrounds')).toBeNull()
  })

  it('disables the library card with a 0 feeds synchronized note until a feed is synced', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByTestId('jump-library').getAttribute('aria-disabled')).toBe('true')
    })
    expect(screen.getByText('0 feeds synchronized')).toBeTruthy()

    // Import a package in → the card becomes a live /catalogs link again.
    fireEvent.click(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-programming-import'))
    await waitFor(() => {
      expect(screen.getByTestId('jump-library').getAttribute('href')).toBe('/catalogs')
    })
  })

  it('renders a notebook card for every built-in notebook package (dashboards excluded)', () => {
    renderSection()
    const row = firstCopy('jump-row-mobile')
    for (const pkg of NOTEBOOK_PACKAGES) {
      const card = row.getByTestId(`demo-feed-${pkg.id}`)
      expect(card.getAttribute('data-installed')).toBe('false')
    }
    expect(row.queryByTestId('demo-feed-community-dashboards')).toBeNull()
  })

  it('filters notebooks via search box (label + description) with an empty state', () => {
    renderSection()
    const searchInput = screen.getByTestId('package-search-input')

    // Filter by name
    fireEvent.change(searchInput, { target: { value: 'Dan John' } })
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-dan-john-40-day')).toBeTruthy()
    expect(screen.queryByTestId('demo-feed-community-crossfit-programming')).toBeNull()

    // Filter by description
    fireEvent.change(searchInput, { target: { value: 'murph' } })
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-heroes')).toBeTruthy()
    expect(screen.queryByTestId('demo-feed-community-crossfit-programming')).toBeNull()

    // Clear search restores the full catalog
    fireEvent.change(searchInput, { target: { value: '' } })
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-programming')).toBeTruthy()
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-dan-john-40-day')).toBeTruthy()

    // No matches → empty state with a clear-filters escape hatch
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-xyz' } })
    expect(screen.getByText(/No notebooks match/i)).toBeTruthy()
    fireEvent.click(screen.getByTestId('jump-clear-filters'))
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-programming')).toBeTruthy()
  })

  it('filters by kind chips and restores on second click', () => {
    renderSection()

    fireEvent.click(screen.getByTestId('package-kind-feed'))
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-programming')).toBeTruthy()
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-dan-john-40-day')).toBeTruthy()
    expect(screen.queryByTestId('demo-feed-community-crossfit-girls')).toBeNull()

    fireEvent.click(screen.getByTestId('package-kind-collection'))
    expect(screen.queryByTestId('demo-feed-community-crossfit-programming')).toBeNull()
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-girls')).toBeTruthy()

    // Toggle the collection chip off → both kinds visible again
    fireEvent.click(screen.getByTestId('package-kind-collection'))
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-programming')).toBeTruthy()
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-girls')).toBeTruthy()
  })

  it('sorts the row by name', () => {
    renderSection()

    fireEvent.click(screen.getByTestId('package-sort-name'))
    // The full registry renders; derive the expected order from the same
    // label sort the gallery model applies (no installed dates in tests).
    const expected = [...NOTEBOOK_PACKAGES]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(pkg => `demo-feed-${pkg.id}`)
    expect(cardIds(copyEl('jump-row-mobile'))).toEqual(expected)
  })

  it('imports a package: syncs, subscribes, and reports the outcome on the card', async () => {
    outcomes['community-crossfit-programming'] = 'imported'
    renderSection()

    fireEvent.click(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-programming-import'))
    await waitFor(() => {
      expect(subscribed.has('community-crossfit-programming')).toBe(true)
    })
    await waitFor(() => {
      expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-programming-status').textContent)
        .toContain('Imported')
    })
  })

  it('never subscribes on server-stale, busy, or error outcomes — the card reports the error', async () => {
    outcomes['community-crossfit-programming'] = 'server-stale'
    outcomes['community-dan-john-40-day'] = 'error'
    renderSection()

    fireEvent.click(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-programming-import'))
    await waitFor(() => {
      expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-programming-status').getAttribute('role')).toBe('alert')
    })
    fireEvent.click(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-dan-john-40-day-import'))
    await waitFor(() => {
      expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-dan-john-40-day-status').getAttribute('role')).toBe('alert')
    })
    expect(subscribed.size).toBe(0)
    // Both cards still offer import — no forced state.
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-programming-import')).toBeTruthy()
    expect(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-dan-john-40-day-import')).toBeTruthy()
  })

  it('guards concurrent imports: one import in flight disables the other cards', async () => {
    pending.add('community-crossfit-programming')
    renderSection()

    fireEvent.click(firstCopy('jump-row-mobile').getByTestId('demo-feed-community-crossfit-programming-import'))
    await waitFor(() => {
      expect(firstCopy('jump-row-mobile').getByText('Importing')).toBeTruthy()
    })
    const other = firstCopy('jump-row-mobile').getByTestId('demo-feed-community-dan-john-40-day-import') as HTMLButtonElement
    expect(other.disabled).toBe(true)
  })

  describe('desktop rows', () => {
    beforeEach(() => {
      mockMedia(true) // ≥1024px → two rows sliding opposite ways
    })

    it('splits the catalog across two rows and slides them opposite ways', () => {
      renderSection()
      expect(screen.queryByTestId('jump-row-mobile')).toBeNull()

      // Default sort (uninstalled → registry alphabetical by label), split
      // in half — derived from the registry, not a pinned card list.
      const sorted = [...NOTEBOOK_PACKAGES]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(pkg => `demo-feed-${pkg.id}`)
      const half = Math.ceil(sorted.length / 2)
      expect(cardIds(copyEl('jump-row-a'))).toEqual(sorted.slice(0, half))
      expect(cardIds(copyEl('jump-row-b'))).toEqual(sorted.slice(half))
    })

    it('name sort reorders within the rows: the alphabetically first label leads row A', () => {
      renderSection()
      fireEvent.click(screen.getByTestId('package-sort-name'))
      const first = [...NOTEBOOK_PACKAGES].sort((a, b) => a.label.localeCompare(b.label))[0]
      expect(cardIds(copyEl('jump-row-a'))[0]).toBe(`demo-feed-${first.id}`)
    })
  })
})
