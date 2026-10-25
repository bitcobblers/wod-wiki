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
const syncFeedSource = mock(async (id: string) => {
  void id
  return nextOutcome
})

mock.module('@/services/feed/feedSync', () => ({
  syncFeedSource,
}))

mock.module('@/services/storage', () => ({
  readDataSettings: () => ({ state: 'indexed-db' }),
  storageBackend: 'indexed-db',
}))

import { HomeCommunityFeeds, HomeDataOwnership } from './HomeDataOwnership'
import { isFeedSubscribed, resetFeedSubscriptionsForTest, setFeedSubscribed } from '@/services/feed/feedSubscriptions'

beforeEach(() => {
  localStorage.clear()
  // feedSubscriptions caches its map — drop the cache with the storage.
  resetFeedSubscriptionsForTest()
  nextOutcome = 'imported'
  syncFeedSource.mockClear()
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
    expect(screen.getByTestId('home-feed-seed-crossfit').textContent).toContain('Demo')
    expect(screen.getByTestId('home-feed-seed-kettlebell').textContent).toContain('Demo')
    // Each demo feed links to the repo that publishes it (split corpus).
    const crossfitRepo = screen.getByTestId('home-feed-seed-crossfit').textContent as string
    const kettlebellRepo = screen.getByTestId('home-feed-seed-kettlebell').textContent as string
    expect(crossfitRepo).toContain('https://github.com/bitcobblers/wod-wiki-seed-crossfit')
    expect(kettlebellRepo).toContain('https://github.com/bitcobblers/wod-wiki-seed-kettlebell')
    const repos = screen.getAllByText('https://github.com/bitcobblers/wod-wiki-seed-crossfit') as HTMLAnchorElement[]
    expect(repos[0].getAttribute('href')).toBe('https://github.com/bitcobblers/wod-wiki-seed-crossfit')
    expect(screen.getAllByText(/bun run generate:seed/).length).toBeGreaterThan(0)
  })

  it('subscribes only after a successful sync commit', async () => {
    render(
      <MemoryRouter>
        <HomeCommunityFeeds />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('home-feed-sync-seed-kettlebell'))
    await waitFor(() => {
      expect(screen.getByTestId('home-feed-status-seed-kettlebell').textContent).toContain('Synced')
    })
    expect(isFeedSubscribed('seed-kettlebell')).toBe(true)
    expect(screen.getByTestId('home-feed-subscribe-seed-kettlebell').textContent).toBe('Unsubscribe')
  })

  it('does not subscribe when the sync fails', async () => {
    nextOutcome = 'error'
    render(
      <MemoryRouter>
        <HomeCommunityFeeds />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('home-feed-sync-seed-kettlebell'))
    await waitFor(() => {
      expect(screen.getByTestId('home-feed-status-seed-kettlebell').textContent).toContain('Sync failed')
    })
    expect(isFeedSubscribed('seed-kettlebell')).toBe(false)
    expect(screen.getByTestId('home-feed-subscribe-seed-kettlebell').textContent).toBe('Subscribe')
  })

  it('unsubscribe is explicit and persistent — nothing re-subscribes automatically', async () => {
    render(
      <MemoryRouter>
        <HomeCommunityFeeds />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('home-feed-sync-seed-kettlebell'))
    await waitFor(() => expect(isFeedSubscribed('seed-kettlebell')).toBe(true))

    fireEvent.click(screen.getByTestId('home-feed-subscribe-seed-kettlebell'))
    expect(isFeedSubscribed('seed-kettlebell')).toBe(false)
    expect(screen.getByTestId('home-feed-subscribe-seed-kettlebell').textContent).toBe('Subscribe')

    // Re-render (fresh mount) — the flag stays off with no sync involved.
    cleanup()
    render(
      <MemoryRouter>
        <HomeCommunityFeeds />
      </MemoryRouter>,
    )
    expect(isFeedSubscribed('seed-kettlebell')).toBe(false)
    expect(screen.getByTestId('home-feed-subscribe-seed-kettlebell').textContent).toBe('Subscribe')
  })

  it('core is always subscribed and cannot be unsubscribed', () => {
    render(
      <MemoryRouter>
        <HomeCommunityFeeds />
      </MemoryRouter>,
    )
    expect(isFeedSubscribed('core')).toBe(true)
    // The core seed has no feed card; the invariant lives in feedSubscriptions.
    setFeedSubscribed('core', false)
    expect(isFeedSubscribed('core')).toBe(true)
  })
})
