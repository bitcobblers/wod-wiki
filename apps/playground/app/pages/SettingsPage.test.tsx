import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

    it('validates pairing JSON import, populates credentials, and refuses same-URL restore while preserving local settings and notes (storage-restore-ui)', async () => {
      const saved = { kind: 'turso', url: 'libsql://saved.turso.io', authToken: 'saved-token' }
      localStorage.setItem('wodwiki.dataSettings.v1', JSON.stringify(saved))
      await host.storage.readwrite('notes').put({
        id: 'restore-keep',
        title: 'Restore Keep',
        rawContent: '# Restore Keep\n\nLocal note preserved.\n',
        sourceRevision: 1,
        blocks: {},
        createdAt: Date.now(),
      })

      renderSettings('/settings/storage')

      const pairingInput = screen.getByTestId('restore-pairing-input') as HTMLInputElement
      const invalidFile = new File(['{ not json'], 'broken.json', { type: 'application/json' })
      Object.defineProperty(invalidFile, 'text', { value: async () => '{ not json' })
      await act(async () => {
        fireEvent.change(pairingInput, { target: { files: [invalidFile] } })
      })

      await waitFor(() => {
        expect(screen.getByTestId('restore-pairing-error')).toBeDefined()
      })
      const urlInput = screen.getByRole('textbox', { name: /^Backup database URL$/ }) as HTMLInputElement
      expect(urlInput.value).toBe('')

      const validPairing = {
        wodWikiPairing: 1,
        kind: 'turso',
        url: 'libsql://pair-target.turso.io',
        authToken: 'pair-token-e2e',
        database: 'pair-target',
        schemaVersion: 32,
        createdAt: '2026-10-19T00:00:00.000Z',
      }
      const validFile = new File([JSON.stringify(validPairing)], 'pairing.json', { type: 'application/json' })
      Object.defineProperty(validFile, 'text', { value: async () => JSON.stringify(validPairing) })
      await act(async () => {
        fireEvent.change(pairingInput, { target: { files: [validFile] } })
      })

      await waitFor(() => {
        expect(urlInput.value).toBe(validPairing.url)
        expect((document.getElementById('restore-token') as HTMLInputElement).value).toBe(validPairing.authToken)
      })

      // Same-URL restore is refused and leaves settings + local note intact
      fireEvent.change(urlInput, { target: { value: 'libsql://saved.turso.io' } })
      fireEvent.change(document.getElementById('restore-token')!, { target: { value: 'other-token' } })
      fireEvent.click(screen.getByTestId('restore-button'))
      fireEvent.click(screen.getByTestId('restore-confirm-button'))

      await waitFor(() => {
        expect(screen.getByTestId('restore-error').textContent).toContain('already the active sync target')
      })
      expect(JSON.parse(localStorage.getItem('wodwiki.dataSettings.v1') ?? 'null')).toEqual(saved)
      const kept = await host.storage.readonly('notes').get('restore-keep')
      expect(kept?.id).toBe('restore-keep')
    })
  })

})
