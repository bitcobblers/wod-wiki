import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SettingsPage } from './SettingsPage'
import { writeRouteWqlConfig, readRouteWqlConfig } from '../lib/routeWqlConfig'

// Mock contexts
let currentTheme = 'system'
const mockSetTheme = mock((t: string) => {
  currentTheme = t
})

mock.module('@/contexts/ThemeProvider', () => ({
  useTheme: () => ({
    theme: currentTheme,
    setTheme: mockSetTheme,
  }),
}))

let isAudioEnabled = true
const mockToggleAudio = mock(() => {
  isAudioEnabled = !isAudioEnabled
})
const mockPlayTestSound = mock(() => {})

mock.module('@/contexts/AudioContext', () => ({
  useAudio: () => ({
    isEnabled: isAudioEnabled,
    toggleAudio: mockToggleAudio,
    playTestSound: mockPlayTestSound,
  }),
}))

let isDebugMode = false
const mockToggleDebugMode = mock(() => {
  isDebugMode = !isDebugMode
})

mock.module('@/contexts/DebugModeContext', () => ({
  useDebugMode: () => ({
    isDebugMode,
    toggleDebugMode: mockToggleDebugMode,
  }),
}))
mock.module('@/services/seed/seedSync', () => ({
  readSeedStatus: async () => ({
    sources: [
      {
        id: 'core',
        label: 'Core (playground)',
        autoImport: true,
        stored: { version: 1, schema: 1, builtAt: '2026-01-01', importedAt: 1000 },
        remote: { version: 1, schema: 1, builtAt: '2026-01-01' },
        remoteError: null,
        upToDate: true,
      },
    ],
  }),
  runSeedSync: async () => 'current',
  runBootSeedSync: async () => 'current',
  syncSeedSource: async () => 'current',
}))

function renderSettings(initialPath = '/settings/appearance') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:tab" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    currentTheme = 'system'
    isAudioEnabled = true
    isDebugMode = false
    mockSetTheme.mockClear()
    mockToggleAudio.mockClear()
    mockPlayTestSound.mockClear()
    mockToggleDebugMode.mockClear()
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  describe('Appearance Subroute', () => {
    it('renders the Appearance tab active by default and displays theme options', () => {
      renderSettings('/settings/appearance')

      expect(screen.getByText('Settings')).toBeDefined()

      // Interface Theme section
      expect(screen.getByText('Interface Theme')).toBeDefined()
      expect(screen.getByTestId('theme-option-system')).toBeDefined()
      expect(screen.getByTestId('theme-option-light')).toBeDefined()
      expect(screen.getByTestId('theme-option-dark')).toBeDefined()
    })

    it('changes theme when a theme card is clicked', () => {
      renderSettings('/settings/appearance')

      act(() => {
        screen.getByTestId('theme-option-dark').click()
      })
      expect(mockSetTheme).toHaveBeenCalledWith('dark')

      act(() => {
        screen.getByTestId('theme-option-light').click()
      })
      expect(mockSetTheme).toHaveBeenCalledWith('light')
    })

    it('offers Startup Page options with Home default, and persists a Journal pick', () => {
      renderSettings('/settings/appearance')

      // Home is the default (unset preference) and renders selected.
      expect(screen.getByText('Startup Page')).toBeDefined()
      expect(screen.getByTestId('start-page-home').getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByTestId('start-page-journal').getAttribute('aria-pressed')).toBe('false')

      act(() => {
        screen.getByTestId('start-page-journal').click()
      })
      expect(localStorage.getItem('wodwiki:startPage')).toBe('journal')

      // Re-render to observe state update
      cleanup()
      renderSettings('/settings/appearance')

      expect(screen.getByTestId('start-page-journal').getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByTestId('start-page-home').getAttribute('aria-pressed')).toBe('false')

      // Switching back to Home clears the stored override
      act(() => {
        screen.getByTestId('start-page-home').click()
      })
      expect(localStorage.getItem('wodwiki:startPage')).toBeNull()
    })
  })

  describe('System Subroute', () => {
    it('renders the System tab with Audio, Debug, and Danger Zone controls', () => {
      renderSettings('/settings/system')

      expect(screen.getByText('Audio Feedback')).toBeDefined()
      expect(screen.getByTestId('sound-toggle')).toBeDefined()
      expect(screen.getByTestId('play-test-sound-btn')).toBeDefined()

      expect(screen.getByText('Developer Diagnostics')).toBeDefined()
      expect(screen.getByTestId('debug-mode-toggle')).toBeDefined()

      expect(screen.getByText('Data & Cache (Danger Zone)')).toBeDefined()
      expect(screen.getByTestId('reset-cache-button')).toBeDefined()
    })

    it('toggles audio feedback switch and plays test chime', () => {
      renderSettings('/settings/system')

      act(() => {
        screen.getByTestId('sound-toggle').click()
      })
      expect(mockToggleAudio).toHaveBeenCalled()

      act(() => {
        screen.getByTestId('play-test-sound-btn').click()
      })
      expect(mockPlayTestSound).toHaveBeenCalled()
    })

    it('toggles developer debug mode switch', () => {
      renderSettings('/settings/system')

      act(() => {
        screen.getByTestId('debug-mode-toggle').click()
      })
      expect(mockToggleDebugMode).toHaveBeenCalled()
    })

    it('opens confirmation modal when clicking Reset & Clear Cache', () => {
      renderSettings('/settings/system')

      act(() => {
        screen.getByTestId('reset-cache-button').click()
      })

      expect(screen.getByText('Reset All Application Data?')).toBeDefined()
      expect(screen.getByText('Cancel')).toBeDefined()
      expect(screen.getByTestId('confirm-reset-button')).toBeDefined()

      // Cancel closes the dialog
      act(() => {
        screen.getByText('Cancel').click()
      })
      expect(screen.queryByText('Reset All Application Data?')).toBeNull()
    })
  })

  describe('Database & Sync Subroutes', () => {
    it('renders the Database tab with storage location options', () => {
      renderSettings('/settings/database')

      expect(screen.getByText('Storage Location')).toBeDefined()
      expect(screen.getByTestId('storage-option-browser')).toBeDefined()
      // Content sync is a separate page now.
      expect(screen.queryByText('Content Sources')).toBeNull()
    })

    it('renders the Sync tab with sources and the add-source form', async () => {
      renderSettings('/settings/sync')

      expect(screen.getByText('Content Sources')).toBeDefined()
      const sourceCard = await screen.findByTestId('seed-source-core')
      expect(sourceCard).toBeDefined()
      expect(screen.getByTestId('seed-sync-core')).toBeDefined()
      expect(screen.getByTestId('seed-resync-button')).toBeDefined()
      expect(screen.getByTestId('seed-add-source-form')).toBeDefined()
    })
  })

})

describe('SettingsPage — Query Defaults tab', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders the tab and one card per configurable surface', () => {
    renderSettings('/settings/queries')

    expect(screen.getByTestId('query-defaults-section')).toBeDefined()
    for (const id of ['/journal', '/catalogs', '/feeds', '/efforts', '/sessions', '/playgrounds', '/dashboards', '/palette']) {
      expect(screen.getByTestId(`query-defaults-card-${id}`)).toBeDefined()
    }
  })

  it('saves a landing default query override into routeWqlConfig storage', async () => {
    renderSettings('/settings/queries')

    fireEvent.change(screen.getByTestId('query-defaults-wql-/journal'), {
      target: { value: ':note{source:journal} last 52w' },
    })
    fireEvent.click(screen.getByTestId('query-defaults-save-/journal'))
    expect(screen.queryByTestId('query-defaults-wql-error-/journal')).toBeNull()
    expect(readRouteWqlConfig('/journal').defaultWql).toBe(':note{source:journal} last 52w')
    // Saved state is no longer dirty — save disables (after the async save settles).
    await waitFor(() =>
      expect((screen.getByTestId('query-defaults-save-/journal') as HTMLButtonElement).disabled).toBe(true),
    )
  })

  it('blocks saving an unparseable default query', () => {
    renderSettings('/settings/queries')

    fireEvent.change(screen.getByTestId('query-defaults-wql-/journal'), {
      target: { value: ':note{' },
    })
    expect(screen.getByTestId('query-defaults-wql-error-/journal')).toBeDefined()
    expect((screen.getByTestId('query-defaults-save-/journal') as HTMLButtonElement).disabled).toBe(true)
  })

  it('reset discards the stored override and returns to the system default', async () => {
    await writeRouteWqlConfig('/journal', { defaultWql: ':note last 6w' })
    renderSettings('/settings/queries')

    fireEvent.click(screen.getByTestId('query-defaults-reset-/journal'))

    expect(readRouteWqlConfig('/journal')).toEqual({})
    await waitFor(() =>
      expect((screen.getByTestId('query-defaults-wql-/journal') as HTMLTextAreaElement).value).toBe(''),
    )
  })

  it('persists custom scope options, including the emptied nudge state', async () => {
    await writeRouteWqlConfig('/feeds', { typeOptions: ['notes', 'journal'] })
    renderSettings('/settings/queries')

    // `notes` shows migrated to the canonical `note` target favorite.
    fireEvent.click(screen.getByTestId('query-defaults-type-/feeds-remove-note'))
    fireEvent.click(screen.getByTestId('query-defaults-type-/feeds-remove-journal'))
    expect(screen.getByTestId('query-defaults-type-empty-/feeds')).toBeDefined()
    fireEvent.click(screen.getByTestId('query-defaults-save-/feeds'))

    expect(readRouteWqlConfig('/feeds').typeOptions).toEqual([])
  })

  it('adds a supported scope option and persists it', () => {
    renderSettings('/settings/queries')

    fireEvent.click(screen.getByTestId('query-defaults-type-custom-/feeds'))
    fireEvent.click(screen.getByTestId('query-defaults-type-/feeds-add-playground'))
    fireEvent.click(screen.getByTestId('query-defaults-save-/feeds'))

    expect(readRouteWqlConfig('/feeds').typeOptions).toEqual(['playground'])
  })

  it('restricts Group-By favorites to the supported arrangement dimensions', () => {
    renderSettings('/settings/queries')

    fireEvent.click(screen.getByTestId('query-defaults-group-custom-/efforts'))
    fireEvent.click(screen.getByTestId('query-defaults-group-/efforts-add-week'))
    fireEvent.click(screen.getByTestId('query-defaults-group-/efforts-add-discipline'))
    fireEvent.click(screen.getByTestId('query-defaults-save-/efforts'))

    expect(readRouteWqlConfig('/efforts').groupByOptions).toEqual(['week', 'discipline'])
  })

  it('reports stored option ids that are neither canonical nor migratable', async () => {
    await writeRouteWqlConfig('/feeds', { typeOptions: ['rows', 'journal'] })
    renderSettings('/settings/queries')

    const report = screen.getByTestId('query-defaults-invalid-/feeds')
    expect(report.textContent).toContain('rows')
    // The invalid id never becomes a favorite — only the canonical scope does.
    expect(screen.queryByTestId('query-defaults-type-/feeds-chip-rows')).toBeNull()
    expect(screen.getByTestId('query-defaults-type-/feeds-chip-journal')).toBeDefined()
  })
})
