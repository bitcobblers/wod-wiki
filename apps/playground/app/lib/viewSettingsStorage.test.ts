import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { LocalStore, InMemoryBackend } from '@/services/storage/LocalStore'
import { renderHook, act } from '@testing-library/react'
import {
  readViewSettings,
  writeViewSettings,
  resetViewSettings,
  useViewSettings,
  VIEW_SETTINGS_STORAGE_PREFIX,
  getRouteStorageKey,
  type ViewSettings,
} from './viewSettingsStorage'
import { getDefaultVisibleFieldIds } from './fieldProjection'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('viewSettingsStorage — pure read/write/reset', () => {
  it('returns default view settings when localStorage is empty', () => {
    const settings = readViewSettings('/journal', 'note')
    expect(settings.layout).toBe('cards')
    expect(settings.level).toBe('note')
    expect(settings.visibleFields).toEqual(getDefaultVisibleFieldIds('note'))
  })

  it('persists and recovers custom view settings per route', () => {
    const custom: ViewSettings = {
      level: 'note',
      layout: 'rows',
      visibleFields: ['title', 'date'],
    }
    writeViewSettings('/journal', custom)

    const raw = window.localStorage.getItem(`${VIEW_SETTINGS_STORAGE_PREFIX}/journal`)
    expect(raw).not.toBeNull()

    const read = readViewSettings('/journal', 'note')
    expect(read.layout).toBe('rows')
    expect(read.visibleFields).toEqual(['title', 'date'])
  })

  it('resolves settings saved under pre-rename /results for /sessions', () => {
    // Layout a user customized on the pre-rebrand sessions listing must survive.
    writeViewSettings('/results', { level: 'result', layout: 'feed', visibleFields: ['title'] })

    const read = readViewSettings('/sessions', 'result')
    expect(read.layout).toBe('feed')
  })

  it('persists the calendar layouts', () => {
    writeViewSettings('/notes', { level: 'note', layout: 'agenda', visibleFields: ['title'] })
    expect(readViewSettings('/notes', 'note').layout).toBe('agenda')

    writeViewSettings('/notes', { level: 'note', layout: 'planner', visibleFields: ['title'] })
    expect(readViewSettings('/notes', 'note').layout).toBe('planner')
  })

  it('falls back to cards for an unknown layout', () => {
    window.localStorage.setItem(
      `${VIEW_SETTINGS_STORAGE_PREFIX}/notes`,
      JSON.stringify({ level: 'note', layout: 'timeline', visibleFields: ['title'] }),
    )
    expect(readViewSettings('/notes', 'note').layout).toBe('cards')
  })

  it('the current route key wins over the legacy alias', () => {
    writeViewSettings('/results', { level: 'result', layout: 'feed', visibleFields: ['title'] })
    writeViewSettings('/sessions', { level: 'result', layout: 'rows', visibleFields: ['title'] })

    expect(readViewSettings('/sessions', 'result').layout).toBe('rows')
  })

  it('resetViewSettings clears the legacy key too — a reset must not resurrect', () => {
    writeViewSettings('/results', { level: 'result', layout: 'feed', visibleFields: ['title'] })

    resetViewSettings('/sessions', 'result')

    expect(window.localStorage.getItem(getRouteStorageKey('/results'))).toBeNull()
    expect(readViewSettings('/sessions', 'result').layout).toBe('cards')
  })

  it('migrates the retired notes-list /feeds and /collections keys to /notes', () => {
    // First hop: the /feeds surface (notes list) is /notes' predecessor.
    window.localStorage.setItem(
      `${VIEW_SETTINGS_STORAGE_PREFIX}/feeds`,
      JSON.stringify({ level: 'note', layout: 'rows', visibleFields: ['title'] }),
    )
    expect(readViewSettings('/notes', 'note').layout).toBe('rows')

    // Second hop: an older /collections key surfaces only when /feeds is absent.
    window.localStorage.setItem(
      `${VIEW_SETTINGS_STORAGE_PREFIX}/collections`,
      JSON.stringify({ level: 'note', layout: 'feed', visibleFields: ['title'] }),
    )
    const backend = new InMemoryBackend()
    const store = new LocalStore(VIEW_SETTINGS_STORAGE_PREFIX, backend)
    backend.setItem(`${VIEW_SETTINGS_STORAGE_PREFIX}/collections`, JSON.stringify({ level: 'note', layout: 'feed', visibleFields: ['title'] }))
    expect(readViewSettings('/notes', 'note', store).layout).toBe('feed')
  })

  it('resetViewSettings removes the second-hop /collections key for /notes', () => {
    // A key from the second rename hop must not survive a reset: the next
    // read would otherwise resurrect the retired /collections settings.
    const backend = new InMemoryBackend()
    const store = new LocalStore(VIEW_SETTINGS_STORAGE_PREFIX, backend)
    backend.setItem(
      `${VIEW_SETTINGS_STORAGE_PREFIX}/collections`,
      JSON.stringify({ level: 'note', layout: 'feed', visibleFields: ['title'] }),
    )

    resetViewSettings('/notes', 'note', store)

    expect(backend.getItem(`${VIEW_SETTINGS_STORAGE_PREFIX}/collections`)).toBeNull()
    expect(readViewSettings('/notes', 'note', store).layout).toBe('cards')
  })

  it('the new /feeds surface stores under /feeds@2 — legacy note settings never leak', () => {
    // A user's old /feeds (notes list) rows layout must not shape the new
    // feed-source list at the same public URL.
    window.localStorage.setItem(
      `${VIEW_SETTINGS_STORAGE_PREFIX}/feeds`,
      JSON.stringify({ level: 'note', layout: 'rows', visibleFields: ['title'] }),
    )
    expect(readViewSettings('/feeds', 'note').layout).toBe('cards')

    // Its own writes land on the versioned key; the legacy key stays intact
    // for the /notes migration.
    writeViewSettings('/feeds', { level: 'note', layout: 'feed', visibleFields: ['title'] })
    expect(window.localStorage.getItem(`${VIEW_SETTINGS_STORAGE_PREFIX}/feeds@2`)).not.toBeNull()
    expect(readViewSettings('/feeds', 'note').layout).toBe('feed')
    expect(readViewSettings('/notes', 'note').layout).toBe('rows')
  })

  it('persists groupBy across reload', () => {
    writeViewSettings('/journal', {
      level: 'note',
      layout: 'cards',
      visibleFields: ['title'],
      groupBy: 'week',
    })

    const read = readViewSettings('/journal', 'note')
    expect(read.groupBy).toBe('week')
  })

  it('migrates legacy stream/table layouts to cards/rows on read', () => {
    window.localStorage.setItem(
      `${VIEW_SETTINGS_STORAGE_PREFIX}/journal`,
      JSON.stringify({ level: 'note', layout: 'stream', visibleFields: ['title'] }),
    )
    window.localStorage.setItem(
      `${VIEW_SETTINGS_STORAGE_PREFIX}/efforts`,
      JSON.stringify({ level: 'note', layout: 'table', visibleFields: ['title'] }),
    )

    expect(readViewSettings('/journal', 'note').layout).toBe('cards')
    expect(readViewSettings('/efforts', 'note').layout).toBe('rows')
  })

  it('isolates preferences across different routes', () => {
    writeViewSettings('/journal', {
      level: 'note',
      layout: 'rows',
      visibleFields: ['title'],
    })
    writeViewSettings('/efforts', {
      level: 'effort',
      layout: 'cards',
      visibleFields: ['label', 'met'],
    })

    const journalSettings = readViewSettings('/journal', 'note')
    const effortsSettings = readViewSettings('/efforts', 'effort')

    expect(journalSettings.layout).toBe('rows')
    expect(journalSettings.visibleFields).toEqual(['title'])

    expect(effortsSettings.layout).toBe('cards')
    expect(effortsSettings.visibleFields).toEqual(['label', 'met'])
  })

  it('drops unknown or obsolete field ids on read', () => {
    const corrupted = {
      level: 'note',
      layout: 'rows',
      visibleFields: ['title', 'non_existent_field', 'date'],
    }
    window.localStorage.setItem(
      `${VIEW_SETTINGS_STORAGE_PREFIX}/journal`,
      JSON.stringify(corrupted),
    )

    const read = readViewSettings('/journal', 'note')
    expect(read.visibleFields).toEqual(['title', 'date'])
  })

  it('resets view settings to defaults', () => {
    writeViewSettings('/journal', {
      level: 'note',
      layout: 'rows',
      visibleFields: ['title'],
    })

    const reset = resetViewSettings('/journal', 'note')
    expect(reset.layout).toBe('cards')
    expect(reset.visibleFields).toEqual(getDefaultVisibleFieldIds('note'))

    const read = readViewSettings('/journal', 'note')
    expect(read.layout).toBe('cards')
  })
  it('operates identically when an isolated LocalStore is injected', () => {
    const inMemory = new LocalStore(VIEW_SETTINGS_STORAGE_PREFIX, new InMemoryBackend())
    writeViewSettings('/custom', { level: 'note', layout: 'feed', visibleFields: ['title'] }, inMemory)
    const read = readViewSettings('/custom', 'note', inMemory)
    expect(read.layout).toBe('feed')
    expect(read.visibleFields).toEqual(['title'])
  })
})

describe('useViewSettings hook', () => {
  it('initializes with route defaults', () => {
    const { result } = renderHook(() => useViewSettings('/results', 'result'))
    expect(result.current.settings.layout).toBe('cards')
    expect(result.current.settings.visibleFields).toEqual(getDefaultVisibleFieldIds('result'))
  })

  it('switches layout between cards, rows, and feed and persists', () => {
    const { result } = renderHook(() => useViewSettings('/results', 'result'))

    act(() => {
      result.current.setLayout('feed')
    })
    expect(result.current.settings.layout).toBe('feed')

    const persisted = readViewSettings('/results', 'result')
    expect(persisted.layout).toBe('feed')
  })

  it('persists groupBy via setGroupBy', () => {
    const { result } = renderHook(() => useViewSettings('/journal', 'note'))

    act(() => {
      result.current.setGroupBy('month')
    })
    expect(result.current.settings.groupBy).toBe('month')
    expect(readViewSettings('/journal', 'note').groupBy).toBe('month')
  })

  it('toggles individual fields visibility on and off and persists', () => {
    const { result } = renderHook(() => useViewSettings('/efforts', 'effort'))
    expect(result.current.settings.visibleFields).toContain('met')

    act(() => {
      result.current.toggleField('met')
    })
    expect(result.current.settings.visibleFields).not.toContain('met')

    // Toggling again restores it
    act(() => {
      result.current.toggleField('met')
    })
    expect(result.current.settings.visibleFields).toContain('met')
  })

  it('resets settings to defaults', () => {
    const { result } = renderHook(() => useViewSettings('/journal', 'note'))

    act(() => {
      result.current.setLayout('rows')
      result.current.toggleField('tags')
    })
    expect(result.current.settings.layout).toBe('rows')

    act(() => {
      result.current.resetSettings()
    })
    expect(result.current.settings.layout).toBe('cards')
    expect(result.current.settings.visibleFields).toEqual(getDefaultVisibleFieldIds('note'))
  })
})
