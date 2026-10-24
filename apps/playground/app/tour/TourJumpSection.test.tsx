import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TourJumpSection } from './TourJumpSection'
import { NOTEBOOKS, SEED_SOURCES } from '@/services/seed/seedSources'
import { parseNotebookChunkId } from '../views/notebook-gallery/notebookGalleryModel'

/** Notebooks a card can carry — effort/equipment/dashboard registries are not. */
const CARDS = NOTEBOOKS.filter(notebook => parseNotebookChunkId(notebook.chunkId) !== null)
/** Seeds that publish at least one card notebook. */
const SEEDS = SEED_SOURCES.filter(seed => CARDS.some(notebook => notebook.seedId === seed.id))
/** Default card order: nothing imported → labels alphabetically. */
const seedCardIds = (seeds = SEEDS) =>
  [...seeds].sort((a, b) => a.label.localeCompare(b.label)).map(seed => `seed-card-${seed.id}`)

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
let notebookSubscribed = new Set<string>()
let outcomes: Record<string, 'imported' | 'current' | 'server-stale' | 'error' | 'busy'> = {}
const pending = new Set<string>()
const synced: string[] = []
const subscriptionListeners = new Set<() => void>()

mock.module('@/services/seed/seedSubscriptions', () => ({
  isSeedSubscribed: (id: string) => subscribed.has(id),
  isNotebookSubscribed: (seedId: string, chunkId: string) =>
    subscribed.has(seedId) || notebookSubscribed.has(`${seedId}#${chunkId}`),
  setSeedSubscribed: (id: string, value: boolean) => {
    if (value) subscribed.add(id)
    else subscribed.delete(id)
    for (const listener of subscriptionListeners) listener()
    return true
  },
  setNotebookSubscribed: (seedId: string, chunkId: string, value: boolean) => {
    const key = `${seedId}#${chunkId}`
    if (value) notebookSubscribed.add(key)
    else notebookSubscribed.delete(key)
    for (const listener of subscriptionListeners) listener()
    return true
  },
  subscribeSeedSubscriptions: (cb: () => void) => {
    subscriptionListeners.add(cb)
    return () => subscriptionListeners.delete(cb)
  },
}))

mock.module('@/services/seed/seedSync', () => ({
  syncSeedSource: (id: string) => {
    synced.push(id)
    // Held open so the in-flight state is observable; never settles.
    if (pending.has(id)) return Promise.withResolvers<'imported'>().promise
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
/** Card test ids inside a copy (the cards themselves, not their chips). */
function cardIds(el: HTMLElement) {
  return Array.from(el.querySelectorAll('article[data-testid^="seed-card-"]')).map(node => node.getAttribute('data-testid'))
}

describe('TourJumpSection', () => {
  beforeEach(() => {
    subscribed = new Set()
    notebookSubscribed.clear()
    outcomes = {}
    pending.clear()
    synced.length = 0
    mockMedia(true) // default: desktop, two rows
  })
  afterEach(() => {
    cleanup()
  })

  it('renders the library exit first, the journal exit next, and no playground exit', () => {
    renderSection()
    expect(screen.getByTestId('tour-jump-section')).toBeTruthy()

    const exits = screen.getByTestId('jump-grid').children[0]
    expect(exits.children[0].getAttribute('data-testid')).toBe('jump-library')
    expect(exits.children[1].getAttribute('data-testid')).toBe('jump-new-note')
    expect(screen.queryByTestId('jump-playgrounds')).toBeNull()
  })

  it('renders one card per seed across two rows, split in half', () => {
    renderSection()
    expect(screen.queryByTestId('jump-row-mobile')).toBeNull()
    const expected = seedCardIds()
    const half = Math.ceil(expected.length / 2)
    expect(cardIds(copyEl('jump-row-a'))).toEqual(expected.slice(0, half))
    expect(cardIds(copyEl('jump-row-b'))).toEqual(expected.slice(half))
  })

  it('cards are seeds: each lists the notebooks that one import brings', () => {
    renderSection()
    const card = screen.getByTestId('seed-card-seed-crossfit')
    expect(within(card).getByTestId('seed-card-seed-crossfit-notebooks').textContent)
      .toContain('CrossFit Games')
    for (const notebook of CARDS.filter(n => n.seedId === 'seed-crossfit')) {
      expect(within(card).getByTestId(`seed-card-seed-crossfit-notebook-${notebook.id}`)).toBeTruthy()
    }
    // One import action per card — never per notebook.
    expect(within(card).getByTestId('seed-card-seed-crossfit-import')).toBeTruthy()
    expect(card.querySelectorAll('[data-testid$="-import"]').length).toBe(1)
  })

  it('summarises a seed with more notebooks than chips', () => {
    renderSection()
    const swimming = SEEDS.find(seed => seed.id === 'seed-swimming')!
    // Six swimming notebooks ship; the card lists six chips (under the cap).
    expect(CARDS.filter(n => n.seedId === swimming.id).length).toBe(7)
    expect(screen.getByTestId('seed-card-seed-swimming')).toBeTruthy()
  })

  it('disables the library card until a seed is imported', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByTestId('jump-library').getAttribute('aria-disabled')).toBe('true')
    })
    expect(screen.getByText('0 feeds synchronized')).toBeTruthy()

    // Import any seed → the card becomes a live /catalogs link again.
    fireEvent.click(screen.getByTestId(`seed-card-${SEEDS[0].id}-import`))
    await waitFor(() => {
      expect(screen.getByTestId('jump-library').getAttribute('href')).toBe('/catalogs')
    })
  })

  it('filters seeds via search box (label, description, and their notebooks)', () => {
    renderSection()
    const searchInput = screen.getByTestId('package-search-input')

    // A notebook label matches through its seed card.
    fireEvent.change(searchInput, { target: { value: 'Dan John' } })
    expect(screen.getByTestId('seed-card-seed-kettlebell')).toBeTruthy()
    expect(screen.queryByTestId('seed-card-seed-crossfit')).toBeNull()

    // A notebook description matches too (Murph lives in CrossFit Heroes).
    fireEvent.change(searchInput, { target: { value: 'murph' } })
    expect(screen.getByTestId('seed-card-seed-crossfit')).toBeTruthy()
    expect(screen.queryByTestId('seed-card-seed-swimming')).toBeNull()

    // Seed copy matches directly.
    fireEvent.change(searchInput, { target: { value: 'parkour archive' } })
    expect(screen.getByTestId('seed-card-seed-zombie-fit')).toBeTruthy()

    // No matches → empty state with a clear-filters escape hatch
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-xyz' } })
    expect(screen.getByText(/No seeds match/i)).toBeTruthy()
    fireEvent.click(screen.getByTestId('jump-clear-filters'))
    expect(screen.getByTestId('seed-card-seed-crossfit')).toBeTruthy()
  })

  it('kind facets keep the seeds that publish a notebook of that kind', () => {
    renderSection()

    fireEvent.click(screen.getByTestId('package-kind-feed'))
    // Swimming publishes only collections → dropped; kettlebell keeps its feed.
    expect(screen.queryByTestId('seed-card-seed-swimming')).toBeNull()
    expect(screen.getByTestId('seed-card-seed-kettlebell')).toBeTruthy()

    fireEvent.click(screen.getByTestId('package-kind-collection'))
    expect(screen.getByTestId('seed-card-seed-swimming')).toBeTruthy()
    // r/WorkoutRoutines publishes only a feed → dropped by the collection facet.
    expect(screen.queryByTestId('seed-card-r-workoutroutines')).toBeNull()

    // Toggle the collection chip off → every seed back
    fireEvent.click(screen.getByTestId('package-kind-collection'))
    expect(screen.getByTestId('seed-card-r-workoutroutines')).toBeTruthy()
  })

  it('name sort reorders the cards inside both rows', () => {
    renderSection()

    fireEvent.click(screen.getByTestId('package-sort-name'))
    const expected = seedCardIds()
    const half = Math.ceil(expected.length / 2)
    expect(cardIds(copyEl('jump-row-a'))).toEqual(expected.slice(0, half))
    expect(cardIds(copyEl('jump-row-b'))).toEqual(expected.slice(half))
  })

  it('imports a SEED: syncs it, subscribes it, and reports the outcome on the card', async () => {
    outcomes['seed-crossfit'] = 'imported'
    renderSection()

    fireEvent.click(screen.getByTestId('seed-card-seed-crossfit-import'))
    await waitFor(() => {
      expect(synced).toEqual(['seed-crossfit'])
      expect(subscribed.has('seed-crossfit')).toBe(true)
    })
    await waitFor(() => {
      expect(screen.getByTestId('seed-card-seed-crossfit-status').textContent).toContain('Imported')
    })
  })

  it('never subscribes on server-stale, busy, or error outcomes — the card reports the error', async () => {
    outcomes['seed-crossfit'] = 'server-stale'
    outcomes['seed-kettlebell'] = 'error'
    renderSection()

    fireEvent.click(screen.getByTestId('seed-card-seed-crossfit-import'))
    await waitFor(() => {
      expect(screen.getByTestId('seed-card-seed-crossfit-status').getAttribute('role')).toBe('alert')
    })
    fireEvent.click(screen.getByTestId('seed-card-seed-kettlebell-import'))
    await waitFor(() => {
      expect(screen.getByTestId('seed-card-seed-kettlebell-status').getAttribute('role')).toBe('alert')
    })
    expect(subscribed.size).toBe(0)
    // Both cards still offer import — no forced state.
    expect(screen.getByTestId('seed-card-seed-crossfit-import')).toBeTruthy()
    expect(screen.getByTestId('seed-card-seed-kettlebell-import')).toBeTruthy()
  })

  it('guards concurrent imports: one seed in flight disables the other cards', async () => {
    pending.add('seed-crossfit')
    renderSection()

    fireEvent.click(screen.getByTestId('seed-card-seed-crossfit-import'))
    await waitFor(() => {
      expect(screen.getByText('Importing')).toBeTruthy()
    })
    const other = screen.getByTestId('seed-card-seed-kettlebell-import') as HTMLButtonElement
    expect(other.disabled).toBe(true)
  })

  it('mobile renders the same cards in one alternating row', () => {
    mockMedia(false)
    renderSection()
    expect(screen.queryByTestId('jump-row-a')).toBeNull()
    expect(screen.queryByTestId('jump-row-b')).toBeNull()
    expect(cardIds(copyEl('jump-row-mobile'))).toEqual(seedCardIds())
  })

  it('filters by subscribed only and by seed source', () => {
    renderSection()
    // Default: subscribedOnly is false, all seeds shown
    expect(screen.getByTestId('seed-card-seed-crossfit')).toBeTruthy()
    expect(screen.getByTestId('seed-card-seed-swimming')).toBeTruthy()

    // Filter by seed source: only CrossFit should appear
    const seedSelect = screen.getByTestId('filter-seed-source')
    fireEvent.change(seedSelect, { target: { value: 'seed-crossfit' } })
    expect(screen.getByTestId('seed-card-seed-crossfit')).toBeTruthy()
    expect(screen.queryByTestId('seed-card-seed-swimming')).toBeNull()

    // Reset seed source filter
    fireEvent.change(seedSelect, { target: { value: '' } })
    expect(screen.getByTestId('seed-card-seed-swimming')).toBeTruthy()

    // Enable subscribed only when nothing is subscribed -> no seeds match
    const subCheckbox = screen.getByTestId('filter-subscribed-only')
    fireEvent.click(subCheckbox)
    expect(screen.getByText(/No seeds match/i)).toBeTruthy()

    // Uncheck subscribed only -> all seeds visible again
    fireEvent.click(subCheckbox)
    expect(screen.getByTestId('seed-card-seed-crossfit')).toBeTruthy()
  })

  it('toggles individual notebook subscription and updates chip state', () => {
    renderSection()
    const toggleBtn = screen.getByTestId('seed-card-seed-crossfit-notebook-toggle-community-crossfit-games')
    expect(toggleBtn.textContent).toBe('+')

    // Subscribe the notebook
    fireEvent.click(toggleBtn)
    expect(notebookSubscribed.has('seed-crossfit#collection.crossfit-games')).toBe(true)
    expect(synced).toContain('seed-crossfit')
  })
})
