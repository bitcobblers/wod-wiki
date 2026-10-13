import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TourJumpSection } from './TourJumpSection'
import * as seedSync from '@/services/seed/seedSync'
import * as seedSubscriptions from '@/services/seed/seedSubscriptions'
import { SYNC_PACKAGES } from '@/services/seed/seedSources'

let subscribed = new Set<string>()
let outcomes: Record<string, 'imported' | 'current' | 'server-stale' | 'error' | 'busy'> = {}

mock.module('@/services/seed/seedSubscriptions', () => ({
  isSeedSubscribed: (id: string) => subscribed.has(id),
  setSeedSubscribed: (id: string, value: boolean) => {
    if (value) subscribed.add(id)
    else subscribed.delete(id)
    return true
  },
  subscribeSeedSubscriptions: (cb: () => void) => () => {},
}))

mock.module('@/services/seed/seedSync', () => ({
  syncSeedSource: async (id: string) => {
    const outcome = outcomes[id] ?? 'imported'
    if (outcome === 'imported' || outcome === 'current') {
      subscribed.add(id)
    }
    return outcome
  },
  removePackageFromLibrary: async (id: string) => {
    subscribed.delete(id)
    return { deleted: 1 }
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

describe('TourJumpSection', () => {
  beforeEach(() => {
    subscribed = new Set()
    outcomes = {}
  })
  afterEach(() => {
    cleanup()
  })

  it('renders the library exit leftmost, the journal exit next, and no playground exit', () => {
    renderSection()
    const section = screen.getByTestId('tour-jump-section')
    expect(section).toBeTruthy()

    const track = within(section).getByTestId('jump-carousel-track')
    expect(track.children[0].getAttribute('data-testid')).toBe('jump-library')
    expect(track.children[1].getAttribute('data-testid')).toBe('jump-new-note')
    expect(screen.queryByTestId('jump-playgrounds')).toBeNull()
  })

  it('disables the library card with a 0 feeds synchronized note until a feed is synced', async () => {
    renderSection()

    // Empty library → card is disabled with the note.
    await waitFor(() => {
      expect(screen.getByTestId('jump-library').getAttribute('aria-disabled')).toBe('true')
    })
    expect(screen.getByText('0 feeds synchronized')).toBeTruthy()

    // Sync a package in → the card becomes a live /catalogs link again.
    fireEvent.click(screen.getByTestId('demo-feed-subscribe-community-crossfit-programming'))
    await waitFor(() => {
      expect(screen.getByTestId('jump-library').getAttribute('href')).toBe('/catalogs')
    })
  })

  it('renders package cards for all built-in sync packages', () => {
    renderSection()
    for (const pkg of SYNC_PACKAGES) {
      expect(screen.getByTestId(`demo-feed-${pkg.id}`)).toBeTruthy()
    }
  })

  it('filters packages via search box', () => {
    renderSection()
    const searchInput = screen.getByTestId('package-search-input')

    // Filter by name
    fireEvent.change(searchInput, { target: { value: 'Dan John' } })
    expect(screen.getByTestId('demo-feed-community-dan-john-40-day')).toBeTruthy()
    expect(screen.queryByTestId('demo-feed-community-crossfit-programming')).toBeNull()

    // Filter by category
    fireEvent.change(searchInput, { target: { value: 'collections' } })
    expect(screen.getByTestId('demo-feed-community-crossfit-girls')).toBeTruthy()
    expect(screen.queryByTestId('demo-feed-community-crossfit-programming')).toBeNull()

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } })
    expect(screen.getByTestId('demo-feed-community-crossfit-programming')).toBeTruthy()
    expect(screen.getByTestId('demo-feed-community-dan-john-40-day')).toBeTruthy()

    // No matches
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-xyz' } })
    expect(screen.getByText(/No packages match/i)).toBeTruthy()
  })

  it('toggles package into library on switch click, and out of library on next click', async () => {
    renderSection()
    const feedId = 'community-crossfit-programming'
    const toggle = screen.getByTestId(`demo-feed-toggle-${feedId}`)

    // Initially not in library
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    // Turn ON -> syncs and marks in library
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(subscribed.has(feedId)).toBe(true)
      expect(toggle.getAttribute('aria-checked')).toBe('true')
    })

    // Turn OFF -> removes from library
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(subscribed.has(feedId)).toBe(false)
      expect(toggle.getAttribute('aria-checked')).toBe('false')
    })
  })

  it('supports explicit sync and delete buttons', async () => {
    renderSection()
    const feedId = 'community-dan-john-40-day'

    // Subscribe via subscribe button
    fireEvent.click(screen.getByTestId(`demo-feed-subscribe-${feedId}`))
    await waitFor(() => {
      expect(screen.getByTestId(`demo-feed-sync-${feedId}`)).toBeTruthy()
      expect(screen.getByTestId(`demo-feed-unsubscribe-${feedId}`)).toBeTruthy()
    })
    expect(subscribed.has(feedId)).toBe(true)

    // Sync now while in library
    fireEvent.click(screen.getByTestId(`demo-feed-sync-${feedId}`))
    await waitFor(() => {
      expect(subscribed.has(feedId)).toBe(true)
    })

    // Delete button removes package
    fireEvent.click(screen.getByTestId(`demo-feed-unsubscribe-${feedId}`))
    await waitFor(() => {
      expect(screen.getByTestId(`demo-feed-subscribe-${feedId}`)).toBeTruthy()
    })
    expect(subscribed.has(feedId)).toBe(false)
  })

  it('scrolls carousel when left and right buttons are clicked', () => {
    renderSection()
    const track = screen.getByTestId('jump-carousel-track')
    const scrollBySpy = mock(() => {})
    track.scrollBy = scrollBySpy

    fireEvent.click(screen.getByLabelText('Next cards'))
    expect(scrollBySpy).toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Previous cards'))
    expect(scrollBySpy).toHaveBeenCalledTimes(2)
  })
})
