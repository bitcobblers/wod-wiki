/**
 * HomeDataOwnership / HomeCommunityFeeds — the local-first home sections.
 * Focused behavior checks: exactly three honest mode cards with the active
 * badge on the real mode, and the feed subscribe gate (manual sync
 * subscribes only after a successful commit; explicit unsubscribe stays off).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let nextOutcome: string = 'imported'
const syncSeedSource = mock(async (id: string) => {
  void id
  return nextOutcome
})

mock.module('@/services/seed/seedSync', () => ({
  syncSeedSource,
}))

mock.module('@/services/storage', () => ({
  readDataSettings: () => ({ state: 'indexed-db' }),
  storageBackend: 'indexed-db',
}))

import { HomeCommunityFeeds, HomeDataOwnership } from './HomeDataOwnership'
import { isSeedSubscribed, resetSeedSubscriptionsForTest } from '@/services/seed/seedSubscriptions'

beforeEach(() => {
  localStorage.clear()
  // seedSubscriptions caches its map — drop the cache with the storage.
  resetSeedSubscriptionsForTest()
  nextOutcome = 'imported'
  syncSeedSource.mockClear()
})

afterEach(cleanup)

describe('HomeDataOwnership', () => {
  it('renders exactly three mode cards and badges the active browser mode', () => {
    render(
      <MemoryRouter>
        <HomeDataOwnership />
      </MemoryRouter>,
    )
    const modes = screen.getByTestId('home-data-ownership')
    expect(modes.children).toHaveLength(3)
    expect(screen.getByTestId('home-mode-browser').textContent).toContain('Active')
    expect(screen.getByTestId('home-mode-turso').textContent).not.toContain('Active')
    expect(screen.getByTestId('home-mode-api').textContent).not.toContain('Active')
    // No latency superlatives, no coming-soon choices.
    expect(modes.textContent).not.toContain('zero latency')
    expect(modes.textContent).not.toContain('Coming soon')
    // Configure link points at /settings/database.
    const configure = screen.getByText('Configure data →') as HTMLAnchorElement
    expect(configure.getAttribute('href')).toBe('/settings/database')
  })
})

describe('HomeCommunityFeeds', () => {
  it('shows the two demo feeds with demo labels and real repository links', () => {
    render(
      <MemoryRouter>
        <HomeCommunityFeeds />
      </MemoryRouter>,
    )
    const feeds = screen.getByTestId('home-community-feeds')
    expect(feeds.children).toHaveLength(2)
    expect(screen.getByTestId('home-feed-core').textContent).toContain('Demo')
    expect(screen.getByTestId('home-feed-community').textContent).toContain('Demo')
    const repo = screen.getByText('https://github.com/bitcobblers/wod-wiki') as HTMLAnchorElement
    expect(repo.getAttribute('href')).toBe('https://github.com/bitcobblers/wod-wiki')
    expect(screen.getAllByText(/bun run generate:seed/).length).toBeGreaterThan(0)
  })

  it('subscribes only after a successful sync commit', async () => {
    render(
      <MemoryRouter>
        <HomeCommunityFeeds />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('home-feed-sync-community'))
    await waitFor(() => {
      expect(screen.getByTestId('home-feed-status-community').textContent).toContain('Synced')
    })
    expect(isSeedSubscribed('community')).toBe(true)
    expect(screen.getByTestId('home-feed-subscribe-community').textContent).toBe('Unsubscribe')
  })

  it('does not subscribe when the sync fails', async () => {
    nextOutcome = 'error'
    render(
      <MemoryRouter>
        <HomeCommunityFeeds />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('home-feed-sync-community'))
    await waitFor(() => {
      expect(screen.getByTestId('home-feed-status-community').textContent).toContain('Sync failed')
    })
    expect(isSeedSubscribed('community')).toBe(false)
    expect(screen.getByTestId('home-feed-subscribe-community').textContent).toBe('Subscribe')
  })

  it('unsubscribe is explicit and persistent — nothing re-subscribes automatically', async () => {
    render(
      <MemoryRouter>
        <HomeCommunityFeeds />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('home-feed-sync-community'))
    await waitFor(() => expect(isSeedSubscribed('community')).toBe(true))

    fireEvent.click(screen.getByTestId('home-feed-subscribe-community'))
    expect(isSeedSubscribed('community')).toBe(false)
    expect(screen.getByTestId('home-feed-subscribe-community').textContent).toBe('Subscribe')

    // Re-render (fresh mount) — the flag stays off with no sync involved.
    cleanup()
    render(
      <MemoryRouter>
        <HomeCommunityFeeds />
      </MemoryRouter>,
    )
    expect(isSeedSubscribed('community')).toBe(false)
    expect(screen.getByTestId('home-feed-subscribe-community').textContent).toBe('Subscribe')
  })

  it('core is always subscribed and cannot be unsubscribed', () => {
    render(
      <MemoryRouter>
        <HomeCommunityFeeds />
      </MemoryRouter>,
    )
    expect(isSeedSubscribed('core')).toBe(true)
    fireEvent.click(screen.getByTestId('home-feed-subscribe-core'))
    expect(isSeedSubscribed('core')).toBe(true)
  })
})
