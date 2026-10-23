import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SoundProfilesSettingsSection } from './SoundProfilesSettingsSection'
import { readSoundProfiles, type StoredSoundProfile } from '@/services/sound/soundProfiles'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  window.localStorage.clear()
})

function renderSection() {
  return render(<SoundProfilesSettingsSection />)
}

async function createProfile(name = 'Classic') {
  fireEvent.change(screen.getByPlaceholderText('New profile (e.g. Classic beeps)'), {
    target: { value: name },
  })
  fireEvent.click(screen.getByRole('button', { name: /Add Profile/i }))
  await waitFor(() => {
    expect(readSoundProfiles().map((p) => p.id)).toContain('classic')
  })
}

describe('SoundProfilesSettingsSection', () => {
  it('creating a profile adds it to the list', async () => {
    renderSection()

    await createProfile()

    expect(screen.getByText('Classic')).toBeTruthy()
    expect(readSoundProfiles()).toEqual([
      { id: 'classic', name: 'Classic', rules: [] } satisfies StoredSoundProfile,
    ])
  })

  it('shows the selector tag for a profile', async () => {
    renderSection()

    await createProfile()

    expect(screen.getAllByText('sound-classic').length).toBeGreaterThan(0)
  })

  it('rejects a rule with an invalid trigger notation', async () => {
    renderSection()
    await createProfile()

    fireEvent.change(screen.getByLabelText('New rule trigger'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: /Add Rule/i }))

    await waitFor(() => {
      expect(screen.getByText(/is not a trigger/)).toBeTruthy()
    })
    expect(readSoundProfiles()[0].rules).toEqual([])
  })

  it('adds a rule with a valid trigger notation', async () => {
    renderSection()
    await createProfile()

    fireEvent.change(screen.getByLabelText('New rule trigger'), { target: { value: '-:03' } })
    fireEvent.click(screen.getByRole('button', { name: /Add Rule/i }))

    await waitFor(() => {
      expect(readSoundProfiles()[0].rules).toEqual([{ trigger: '-:03', sound: 'beep' }])
    })
    const triggerInput = screen.getByLabelText('Trigger for rule 1') as HTMLInputElement
    expect(triggerInput.value).toBe('-:03')
  })

  it('keeps every rule when several are added in a row', async () => {
    renderSection()
    await createProfile()

    // All three adds land without a re-render in between — the case where a
    // change built from a render-time snapshot would overwrite the others.
    await act(async () => {
      for (const [trigger, sound] of [['-:03', 'countdown-beep'], ['-:02', 'countdown-beep'], ['-:01', 'countdown-beep']] as const) {
        fireEvent.change(screen.getByLabelText('New rule trigger'), { target: { value: trigger } })
        fireEvent.change(screen.getByLabelText('New rule sound'), { target: { value: sound } })
        fireEvent.click(screen.getByRole('button', { name: /Add Rule/i }))
      }
    })

    await waitFor(() => {
      expect(readSoundProfiles()[0].rules).toEqual([
        { trigger: '-:03', sound: 'countdown-beep' },
        { trigger: '-:02', sound: 'countdown-beep' },
        { trigger: '-:01', sound: 'countdown-beep' },
      ])
    })
  })

  it('deletes a profile after the confirm step', async () => {
    renderSection()
    await createProfile()

    fireEvent.click(screen.getByLabelText('Delete profile Classic'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(screen.queryByText('Classic')).toBeNull()
    })
    expect(readSoundProfiles()).toEqual([])
  })
})
