/**
 * useZipProcessor.test.ts — ticket #882: `/load` route branches on param.
 *
 *  - `?z=` (+ optional `by`) is the home-hero share contract: decode, persist
 *    to the home-shared localStorage store AND to the persisted home
 *    playground entry (intake ensureEntry), then land per the
 *    startup-page setting — home (default) on `/`, journal on the loaded
 *    entry's /playground/<name> page.
 *  - `?zip=` stays the playground-page flow: import via the intake's
 *    createPage, redirect to the new playground page.
 *  - Neither flow auto-runs the workout; decode/storage failures surface a
 *    toast instead of failing silently.
 *  - Off `/load` the hook does nothing (journal routes etc. have their own
 *    processors).
 *
 * Runs inside the real provider tree (MemoryRouter + NuqsTestingAdapter via
 * PlaygroundProviderTree) with injected deps — no mock.module. Navigation
 * is asserted through the live router location.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { Location } from 'react-router-dom'
import { PlaygroundProviderTree } from '@/testing/host'
import { useZipProcessor } from './useZipProcessor'
import type { PlaygroundIntake } from '../services/createPlaygroundPage'

const ensureEntryMock = mock(() => Promise.resolve({ noteId: 'uuid-home', routeId: 'playground/home' }))
const createPageMock = mock(() => Promise.resolve('2026-09-05-10-00-00-000'))
const toastMock = mock((_args?: unknown) => {})
const decodeMock = mock((z: string) => Promise.resolve(z === 'bad' ? null : `decoded:${z}`))

const fakeIntake = {
  createPage: createPageMock,
  ensureEntry: ensureEntryMock,
} satisfies Pick<PlaygroundIntake, 'createPage' | 'ensureEntry'>

const stableDeps = { decodeZip: decodeMock, intake: fakeIntake, toast: toastMock }

const SHARED_KEY = 'wodwiki.homeShared.v1'

function renderZipHook({
  route = '/load',
  searchParams,
}: { route?: string; searchParams?: Record<string, string> } = {}) {
  const locations: Location[] = []
  const rendered = renderHook(() => useZipProcessor(stableDeps), {
    wrapper: ({ children }) =>
      createElement(
        PlaygroundProviderTree,
        { route, searchParams, onLocationChange: (loc: Location) => locations.push(loc) },
        children,
      ),
  })
  return { ...rendered, locations, landed: () => locations.at(-1)?.pathname }
}

beforeEach(() => {
  ensureEntryMock.mockClear()
  createPageMock.mockClear()
  toastMock.mockClear()
  decodeMock.mockClear()
  ensureEntryMock.mockImplementation(() => Promise.resolve({ noteId: 'uuid-home', routeId: 'playground/home' }))
  createPageMock.mockImplementation(() => Promise.resolve('2026-09-05-10-00-00-000'))
  decodeMock.mockImplementation((z: string) => Promise.resolve(z === 'bad' ? null : `decoded:${z}`))
})

afterEach(() => {
  window.localStorage.clear()
})

describe('useZipProcessor', () => {
  it('keeps the playground-page flow for ?zip= — intake creates the entry; arrival never auto-runs', async () => {
    const { landed } = renderZipHook({ searchParams: { zip: 'abc' } })

    await waitFor(() => expect(landed()).toBe('/playground/2026-09-05-10-00-00-000'))
    expect(createPageMock).toHaveBeenCalledWith('decoded:abc')
    expect(ensureEntryMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(SHARED_KEY)).toBeNull()
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('lands the ?z= home-hero share on home', async () => {
    const { landed } = renderZipHook({ searchParams: { z: 'abc' } })

    await waitFor(() => expect(landed()).toBe('/'))
    expect(ensureEntryMock).toHaveBeenCalledTimes(1)
    expect(ensureEntryMock.mock.calls[0]![1]).toEqual({ reuseKey: 'home', title: 'Home playground' })
    expect(window.localStorage.getItem(SHARED_KEY)).toContain('decoded:abc')
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('lands the ?z= share directly when visited on home route (/)', async () => {
    const { landed } = renderZipHook({ route: '/', searchParams: { z: 'abc' } })

    await waitFor(() => expect(landed()).toBe('/'))
    expect(ensureEntryMock).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(SHARED_KEY)).toContain('decoded:abc')
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('ignores ?zip= on home route (/)', async () => {
    const { locations } = renderZipHook({ route: '/', searchParams: { zip: 'abc' } })

    await Promise.resolve()
    expect(locations).toHaveLength(1) // only the initial mount location — no redirect
    expect(locations[0]!.pathname).toBe('/')
    expect(createPageMock).not.toHaveBeenCalled()
  })

  it.each(['z', 'zip'])('rejects an undecodable %s share without persisting an entry', async (parameter) => {
    const { landed } = renderZipHook({ searchParams: { [parameter]: 'bad' } })

    await waitFor(() => expect(landed()).toBe('/'))
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    expect(ensureEntryMock).not.toHaveBeenCalled()
    expect(createPageMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(SHARED_KEY)).toBeNull()
  })

  it('preserves the existing home preview when saving an incoming share fails', async () => {
    const previous = JSON.stringify({ content: 'Keep this preview', by: 'Original sender' })
    window.localStorage.setItem(SHARED_KEY, previous)
    ensureEntryMock.mockImplementation(() => Promise.reject(new Error('Storage blocked')))
    const { landed } = renderZipHook({ searchParams: { z: 'abc', by: 'New sender' } })

    await waitFor(() => expect(landed()).toBe('/'))
    expect(window.localStorage.getItem(SHARED_KEY)).toBe(previous)
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
  })

  it('returns home rather than creating a blank entry when importing a workout fails', async () => {
    createPageMock.mockImplementation(() => Promise.reject(new DOMException('Blocked', 'SecurityError')))
    const { landed } = renderZipHook({ searchParams: { zip: 'abc' } })

    await waitFor(() => expect(landed()).toBe('/'))
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
  })

  it('does nothing off the /load route', async () => {
    const { locations } = renderZipHook({ route: '/load/journal', searchParams: { z: 'abc', zip: 'abc' } })

    // Flush the microtask queue so any (unexpected) decode would have run.
    await Promise.resolve()
    await Promise.resolve()
    expect(locations).toHaveLength(1)
    expect(locations[0]!.pathname).toBe('/load/journal')
    expect(ensureEntryMock).not.toHaveBeenCalled()
    expect(createPageMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(SHARED_KEY)).toBeNull()
  })
})
