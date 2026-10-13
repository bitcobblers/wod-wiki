import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { OfferingTiers } from './OfferingTiers'

afterEach(() => {
  cleanup()
})

describe('OfferingTiers', () => {
  it('renders both numbered sections and all 5 tier cards', () => {
    render(
      <MemoryRouter>
        <OfferingTiers />
      </MemoryRouter>
    )

    // Numbered section headers (TaglineHeader renders h2; index prefix is
    // part of the accessible name)
    expect(screen.getByRole('heading', { level: 2, name: /You Own the Data/ })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: /Wod-Wiki Hosted/ })).toBeTruthy()
    expect(screen.getByTestId('tour-section-offerings')).toBeTruthy()
    expect(screen.getByTestId('tour-section-hosted')).toBeTruthy()

    // 06 — "You Own the Data" cards
    expect(screen.getByRole('heading', { level: 3, name: 'IndexedDB' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Turso Sync' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Self-hosted' })).toBeTruthy()
    expect(screen.getByText('Coming soon')).toBeTruthy()

    // 07 — "Wod-Wiki Hosted" cards
    expect(screen.getByRole('heading', { level: 3, name: 'Individuals' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Coaching & gyms' })).toBeTruthy()

    // Interest survey links for hosted accounts
    const surveyLinks = screen.getAllByRole('link', { name: /Fill out interest survey/i })
    expect(surveyLinks.length).toBe(2)
  })
})
