import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as realSeedSync from '@/services/seed/seedSync'
import { TourJumpSection } from '../../tour/TourJumpSection'


let subscribed: Set<string>
let outcomes: Record<string, 'imported' | 'current' | 'server-stale' | 'busy' | 'error'>
const syncSeedSourceMock = mock(async (id: string, _deps?: unknown) => outcomes[id] ?? 'current')

mock.module('@/services/seed/seedSync', () => ({
  ...realSeedSync,
  syncSeedSource: (id: string, deps?: unknown) => syncSeedSourceMock(id, deps),
  removePackageFromLibrary: async (id: string) => {
    subscribed.delete(id)
    for (const listener of subscriptionListeners) listener()
    return { deleted: 0 }
  },
}))
const subscriptionListeners = new Set<() => void>()
mock.module('@/services/seed/seedSubscriptions', () => ({
  isSeedSubscribed: (id: string) => subscribed.has(id),
  setSeedSubscribed: (id: string, value: boolean) => {
    if (value) subscribed.add(id)
    else subscribed.delete(id)
    for (const listener of subscriptionListeners) listener()
    return true
  },
  subscribeSeedSubscriptions: (listener: () => void) => {
    subscriptionListeners.add(listener)
    return () => subscriptionListeners.delete(listener)
  },
}))

function renderSection() {
  return render(
    <MemoryRouter>
      <TourJumpSection />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  subscribed = new Set()
  outcomes = {}
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  syncSeedSourceMock.mockClear()
})


describe('TourJumpSection community feeds', () => {

  it('subscribes only after a successful sync (imported/current)', async () => {
    outcomes['community-crossfit-programming'] = 'imported'
    renderSection()
    fireEvent.click(screen.getByTestId('demo-feed-subscribe-community-crossfit-programming'))
    await waitFor(() => {
      expect(screen.getByTestId('demo-feed-unsubscribe-community-crossfit-programming')).toBeTruthy()
    })
    expect(subscribed.has('community-crossfit-programming')).toBe(true)
  })

  it('never subscribes on server-stale, busy, or error outcomes', async () => {
    outcomes['community-crossfit-programming'] = 'server-stale'
    outcomes['community-dan-john-40-day'] = 'error'
    renderSection()
    fireEvent.click(screen.getByTestId('demo-feed-subscribe-community-crossfit-programming'))
    await waitFor(() => {
      expect(screen.getByTestId('demo-feed-error-community-crossfit-programming')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('demo-feed-subscribe-community-dan-john-40-day'))
    await waitFor(() => {
      expect(screen.getByTestId('demo-feed-error-community-dan-john-40-day')).toBeTruthy()
    })
    expect(subscribed.size).toBe(0)
    // Both cards still offer subscribe — no navigation, no forced state.
    expect(screen.getByTestId('demo-feed-subscribe-community-crossfit-programming')).toBeTruthy()
    expect(screen.getByTestId('demo-feed-subscribe-community-dan-john-40-day')).toBeTruthy()
  })

  it('removing a package explicitly stops its subscription', async () => {
    renderSection()
    fireEvent.click(screen.getByTestId('demo-feed-subscribe-community-crossfit-programming'))
    await waitFor(() => {
      expect(screen.getByTestId('demo-feed-unsubscribe-community-crossfit-programming')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('demo-feed-unsubscribe-community-crossfit-programming'))
    await waitFor(() => {
      expect(screen.getByTestId('demo-feed-subscribe-community-crossfit-programming')).toBeTruthy()
    })
    expect(subscribed.size).toBe(0)
  })
})
