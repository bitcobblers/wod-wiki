import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SettingsPage } from './SettingsPage'
import {
  PlaygroundProviderTree,
  setupPlaygroundTestHost,
  type PlaygroundHostHandle,
} from '@/testing/host'
import { audioService } from '@/services/AudioService'

// Real ThemeProvider / AudioProvider / DebugModeProvider / MemoryRouter /
// InMemoryStorage come from the test host tree — no module mocks.
let host: PlaygroundHostHandle

beforeEach(async () => {
  localStorage.clear()
  // The audio singleton caches its enabled flag; reset both the flag and
  // its persisted record so the system-tab switch starts checked.
  audioService.setEnabled(true)
  host = await setupPlaygroundTestHost()
})

afterEach(async () => {
  cleanup()
  mock.restore()
  document.documentElement.className = ''
  await host.cleanup()
})

// Synchronous on purpose: every test renders and queries in the same tick.
function renderSettings(initialPath = '/settings/appearance') {
  render(
    <PlaygroundProviderTree route={initialPath} routePath="/settings/:tab">
      <SettingsPage />
    </PlaygroundProviderTree>,
  )
}

describe('SettingsPage', () => {
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

      fireEvent.click(screen.getByTestId('theme-option-dark'))
      expect(localStorage.getItem('vite-ui-theme')).toBe('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)

      fireEvent.click(screen.getByTestId('theme-option-light'))
      expect(localStorage.getItem('vite-ui-theme')).toBe('light')
      expect(document.documentElement.classList.contains('light')).toBe(true)
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
      const chimeSpy = spyOn(audioService, 'playSound').mockResolvedValue(undefined)

      const toggle = screen.getByTestId('sound-toggle')
      expect(toggle.getAttribute('data-headlessui-state')).toContain('checked')

      fireEvent.click(toggle)
      expect(audioService.isEnabled()).toBe(false)
      expect(toggle.getAttribute('data-headlessui-state')).not.toContain('checked')

      // Back on through the UI (the provider caches its own enabled state),
      // then the test chime reaches the audio service. The toggle itself
      // plays a click sound first — the chime is the last call.
      fireEvent.click(toggle)
      fireEvent.click(screen.getByTestId('play-test-sound-btn'))
      expect(chimeSpy.mock.calls.at(-1)?.[0]).toBe('chime')
    })

    it('toggles developer debug mode switch', () => {
      renderSettings('/settings/system')

      const toggle = screen.getByTestId('debug-mode-toggle')
      expect(toggle.getAttribute('data-headlessui-state')).not.toContain('checked')

      fireEvent.click(toggle)
      expect(localStorage.getItem('wod-wiki-debug-mode')).toBe('true')
      expect(toggle.getAttribute('data-headlessui-state')).toContain('checked')
    })

    it('defaults telemetry toggle to enabled and toggles to opt out', () => {
      renderSettings('/settings/system')
      const toggle = screen.getByTestId('telemetry-toggle')
      expect(toggle.getAttribute('data-headlessui-state')).toContain('checked')

      fireEvent.click(toggle)
      expect(localStorage.getItem('wodwiki.telemetry.consent')).toBe('denied')
      expect(toggle.getAttribute('data-headlessui-state')).not.toContain('checked')

      fireEvent.click(toggle)
      expect(localStorage.getItem('wodwiki.telemetry.consent')).toBe('granted')
      expect(toggle.getAttribute('data-headlessui-state')).toContain('checked')
    })

    it('opens confirmation modal when clicking Reset & Clear Cache', () => {
      renderSettings('/settings/system')

      fireEvent.click(screen.getByTestId('reset-cache-button'))

      expect(screen.getByText('Reset All Application Data?')).toBeDefined()
      expect(screen.getByText('Cancel')).toBeDefined()
      expect(screen.getByTestId('confirm-reset-button')).toBeDefined()

      // Cancel closes the dialog
      fireEvent.click(screen.getByText('Cancel'))
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
