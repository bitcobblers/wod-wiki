/**
 * useZipProcessor.test.ts — ticket #882: `/load` route branches on param.
 *
 *  - `?z=` (+ optional `by`) is the home-hero share contract: decode, persist
 *    to the home-shared localStorage store AND to the persisted home
 *    playground entry (intake `ensurePlaygroundEntry`), then land per the
 *    startup-page setting — home (default) on `/`, journal on the loaded
 *    entry's /playground/<name> page.
 *  - `?zip=` stays the playground-page flow: import via the intake module's
 *    `createPlaygroundPage`, redirect to the new playground page.
 *  - Neither flow auto-runs the workout; decode/storage failures surface a
 *    toast instead of failing silently.
 *  - Off `/load` the hook does nothing (journal routes etc. have their own
 *    processors).
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { renderHook, waitFor } from '@testing-library/react'

let mockNavigate = mock(() => {})
let mockPathname = '/load'
let params: Record<string, string | null> = {}
const ensureEntryMock = mock(() => Promise.resolve({ noteId: 'uuid-home', routeId: 'playground/home' }))
const createPageMock = mock(() => Promise.resolve('2026-09-05-10-00-00-000'))
const toastMock = mock(() => {})

mock.module('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname, search: '', hash: '', state: null, key: 'test' }),
}))

mock.module('nuqs', () => ({
  useQueryState: (key: string) => [params[key] ?? null, mock(() => {})],
}))

mock.module('../services/decodeZip', () => ({
  decodeZip: mock((z: string) => Promise.resolve(z === 'bad' ? null : `decoded:${z}`)),
}))

mock.module('../services/createPlaygroundPage', () => ({
  createPlaygroundPage: createPageMock,
  ensurePlaygroundEntry: ensureEntryMock,
}))

mock.module('@/hooks/use-toast', () => ({
  toast: toastMock,
}))

mock.module('../lib/routes', () => ({
  playgroundPath: (id: string) => `/playground/${id}`,
  ROUTE_PATTERNS: { home: '/' },
}))

import { useZipProcessor } from './useZipProcessor'

const SHARED_KEY = 'wodwiki.homeShared.v1'

describe('useZipProcessor', () => {
  beforeEach(() => {
    mockNavigate = mock(() => {})
    mockPathname = '/load'
    params = {}
    ensureEntryMock.mockClear()
    createPageMock.mockClear()
    toastMock.mockClear()
    ensureEntryMock.mockImplementation(() => Promise.resolve({ noteId: 'uuid-home', routeId: 'playground/home' }))
    createPageMock.mockImplementation(() => Promise.resolve('2026-09-05-10-00-00-000'))
  })

  afterEach(() => {
    window.localStorage.clear()
  })


  it('keeps the playground-page flow for ?zip= — intake creates the entry; arrival never auto-runs', async () => {
    params = { zip: 'abc' }
    renderHook(() => useZipProcessor())

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/playground/2026-09-05-10-00-00-000', { replace: true }))
    expect(createPageMock).toHaveBeenCalledWith('decoded:abc')
    expect(ensureEntryMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(SHARED_KEY)).toBeNull()
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('lands the ?z= home-hero share on home', async () => {
    params = { z: 'abc' }
    renderHook(() => useZipProcessor())

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(ensureEntryMock).toHaveBeenCalledTimes(1)
    expect(ensureEntryMock.mock.calls[0][1]).toEqual({ reuseKey: 'home', title: 'Home playground' })
    expect(window.localStorage.getItem(SHARED_KEY)).toContain('decoded:abc')
    expect(toastMock).not.toHaveBeenCalled()
  })
  it('lands the ?z= share directly when visited on home route (/)', async () => {
    mockPathname = '/'
    params = { z: 'abc' }
    renderHook(() => useZipProcessor())

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(ensureEntryMock).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(SHARED_KEY)).toContain('decoded:abc')
    expect(toastMock).not.toHaveBeenCalled()
  })
  it('ignores ?zip= on home route (/)', async () => {
    mockPathname = '/'
    params = { zip: 'abc' }
    renderHook(() => useZipProcessor())

    await Promise.resolve()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(createPageMock).not.toHaveBeenCalled()
  })
  it.each(['z', 'zip'])('rejects an undecodable %s share without persisting an entry', async (parameter) => {
    params = { [parameter]: 'bad' }
    renderHook(() => useZipProcessor())

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    expect(ensureEntryMock).not.toHaveBeenCalled()
    expect(createPageMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(SHARED_KEY)).toBeNull()
  })

  it('preserves the existing home preview when saving an incoming share fails', async () => {
    const previous = JSON.stringify({ content: 'Keep this preview', by: 'Original sender' })
    window.localStorage.setItem(SHARED_KEY, previous)
    params = { z: 'abc', by: 'New sender' }
    ensureEntryMock.mockImplementation(() => Promise.reject(new Error('Storage blocked')))
    renderHook(() => useZipProcessor())

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(window.localStorage.getItem(SHARED_KEY)).toBe(previous)
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
  })

  it('returns home rather than creating a blank entry when importing a workout fails', async () => {
    params = { zip: 'abc' }
    createPageMock.mockImplementation(() => Promise.reject(new DOMException('Blocked', 'SecurityError')))
    renderHook(() => useZipProcessor())

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
  })

  it('does nothing off the /load route', async () => {
    mockPathname = '/load/journal'
    params = { z: 'abc', zip: 'abc' }
    renderHook(() => useZipProcessor())

    // Flush the microtask queue so any (unexpected) decode would have run.
    await Promise.resolve()
    await Promise.resolve()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(ensureEntryMock).not.toHaveBeenCalled()
    expect(createPageMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(SHARED_KEY)).toBeNull()
  })
})
