import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SettingsPage } from './SettingsPage'

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
        label: 'Core',
        autoImport: true,
        count: 0,
        bytes: 0,
        subscribed: true,
        autoSync: true,
        checkedAt: null,
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

  })

  describe('System Subroute', () => {
    it('renders the System tab with Audio, Debug, Telemetry, and Danger Zone controls', () => {
      renderSettings('/settings/system')

      expect(screen.getByText('Audio Feedback')).toBeDefined()
      expect(screen.getByTestId('sound-toggle')).toBeDefined()
      expect(screen.getByTestId('play-test-sound-btn')).toBeDefined()

      expect(screen.getByText('Developer Diagnostics')).toBeDefined()
      expect(screen.getByTestId('debug-mode-toggle')).toBeDefined()

      expect(screen.getByText('Anonymous Telemetry')).toBeDefined()
      expect(screen.getByTestId('telemetry-toggle')).toBeDefined()

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

    it('defaults telemetry toggle to enabled and toggles to opt out', () => {
      renderSettings('/settings/system')
      const toggle = screen.getByTestId('telemetry-toggle')
      expect(toggle.getAttribute('data-headlessui-state')).toContain('checked')

      act(() => {
        toggle.click()
      })
      expect(localStorage.getItem('wodwiki.telemetry.consent')).toBe('denied')
      expect(toggle.getAttribute('data-headlessui-state')).not.toContain('checked')

      act(() => {
        toggle.click()
      })
      expect(localStorage.getItem('wodwiki.telemetry.consent')).toBe('granted')
      expect(toggle.getAttribute('data-headlessui-state')).toContain('checked')
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

  describe('Storage & Sync Subroutes', () => {
    it('renders the Storage tab with the combined browser + Turso Sync card', () => {
      renderSettings('/settings/storage')

      expect(screen.getByText('Storage')).toBeDefined()
      expect(screen.getByTestId('storage-option-browser')).toBeDefined()
      // Turso Sync lives inside the combined card as a wide subsection.
      expect(screen.getByTestId('storage-option-turso')).toBeDefined()
      expect(screen.getByTestId('turso-connect-form')).toBeDefined()
      // Content sync is a separate page now.
      expect(screen.queryByText('Content Sources')).toBeNull()
    })

  })

})
