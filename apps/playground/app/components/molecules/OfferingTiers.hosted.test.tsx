import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as telemetryModule from '@/services/telemetry'
import { OfferingTiers } from './OfferingTiers'

// Capture funnel events without the IndexedDB persist or gtag forwarder.
const recorded: Array<{ name: string; payload?: Record<string, unknown> }> = []
mock.module('@/services/telemetry', () => ({
  ...telemetryModule,
  telemetry: {
    ...telemetryModule.telemetry,
    record: (name: string, payload?: Record<string, unknown>) => {
      recorded.push({ name, payload })
    },
  },
}))

function renderHosted() {
  return render(
    <MemoryRouter>
      <OfferingTiers />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  recorded.length = 0
  localStorage.clear()
  cleanup()
})

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

    expect(recorded).toEqual([
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
    expect(recorded.length).toBe(1)
  })
})
