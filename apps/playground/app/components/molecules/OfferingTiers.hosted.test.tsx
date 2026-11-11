import { afterEach, beforeEach, describe, expect, it, mock, spyOn, type Mock } from 'bun:test'
// React 19 only flushes updates inside act() when the test environment opts
// in; the historical full-suite run got this from a sibling file's global.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as telemetryModule from '@/services/telemetry'
import { OfferingTiers } from './OfferingTiers'

// Capture funnel events without the IndexedDB persist or gtag forwarder.
let record: Mock<typeof telemetryModule.telemetry.record>

function renderHosted() {
  return render(
    <MemoryRouter>
      <OfferingTiers />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  record = spyOn(telemetryModule.telemetry, 'record').mockImplementation(() => {})
  localStorage.clear()
  cleanup()
})

afterEach(() => mock.restore())

describe('OfferingTiers hosted interest flow', () => {
  it('shows no survey on first load — the footer stays unmounted until interest', () => {
    renderHosted()
    expect(screen.queryByTestId('hosted-survey-button')).toBeNull()
    expect(screen.queryByTestId('hosted-survey-footer')).toBeNull()
    expect(screen.queryByText('Fill out interest survey')).toBeNull()
  })

  it('records hosted_interest_clicked with the feature id and reveals the survey footer', () => {
    renderHosted()
    fireEvent.click(screen.getByTestId('hosted-interest-managed-hosting'))
    fireEvent.click(screen.getByTestId('hosted-interest-coaches-portal'))

    expect(record.mock.calls.map(([name, payload]) => ({ name, payload }))).toEqual([
      { name: 'home:hosted_interest_clicked', payload: { feature: 'managed-hosting' } },
      { name: 'home:hosted_interest_clicked', payload: { feature: 'coaches-portal' } },
    ])

    // Interest in either offering mounts the thank-you footer with a button
    // (not a link) as the survey CTA.
    const button = screen.getByTestId('hosted-survey-button')
    expect(button.tagName).toBe('BUTTON')
    expect(button.textContent).toContain('Fill out interest survey')
    expect(screen.getByText('Thanks for showing interest — please fill out the survey and give us feedback.')).toBeTruthy()
  })

  it('marks the clicked feature as interested exactly once (latch, no double counting)', () => {
    renderHosted()
    const button = screen.getByTestId('hosted-interest-public-profile')
    expect(button.textContent).toBe('Interested')
    fireEvent.click(button)
    expect(button.textContent).toBe('✓ Interested')
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(record.mock.calls.length).toBe(1)
  })
})
