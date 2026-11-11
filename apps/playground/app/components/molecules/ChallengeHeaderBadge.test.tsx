import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
// React 19 only flushes updates inside act() when the test environment opts
// in; the historical full-suite run got this from a sibling file's global.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

import { ChallengeHeaderBadge } from './ChallengeHeaderBadge'
import type { Quest } from '../../canvas/parseCanvasMarkdown'

// Every test uses the same page route; completion state is seeded into the
// real localStorage ledger (`questProgress.ts`) that `usePageQuests` reads.
const PAGE_ROUTE = '/guide/demo'

beforeEach(() => {
  localStorage.setItem('wodwiki.quests.v1', JSON.stringify({ [PAGE_ROUTE]: { 'done-quest': true } }))
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('ChallengeHeaderBadge', () => {
  it('renders a badge with completed / total', () => {
    const quests: Quest[] = [
      { id: 'done-quest', label: 'Done quest' },
      { id: 'pending-quest', label: 'Pending quest' },
    ]

    render(
      <ChallengeHeaderBadge
        pageRoute="/guide/demo"
        quests={quests}
        challengeSectionMap={new Map([['done-quest', 'sec-1']])}
      />,
    )

    expect(screen.getAllByText('1/2').length).toBeGreaterThanOrEqual(1)
  })

  it('opens the dropdown on click and calls onScrollToSection when a challenge is clicked', () => {
    const quests: Quest[] = [{ id: 'done-quest', label: 'Done quest' }]
    const onScrollToSection = mock(() => {})

    render(
      <ChallengeHeaderBadge
        pageRoute="/guide/demo"
        quests={quests}
        challengeSectionMap={new Map([['done-quest', 'sec-1']])}
        onScrollToSection={onScrollToSection}
      />,
    )

    const badge = screen.getByRole('button', { expanded: false })
    fireEvent.click(badge)

    const item = screen.getByText('Done quest')
    fireEvent.click(item)
    expect(onScrollToSection).toHaveBeenCalledWith('sec-1')
  })

  it('opens on click and ignores touch hover', () => {
    const quests: Quest[] = [{ id: 'pending-quest', label: 'Pending quest' }]

    render(
      <ChallengeHeaderBadge
        pageRoute="/guide/demo"
        quests={quests}
        challengeSectionMap={new Map([['pending-quest', 'sec-1']])}
      />,
    )

    const badge = screen.getByRole('button', { expanded: false })

    // Touch devices should not open the menu on pointer enter
    fireEvent.pointerEnter(badge, { pointerType: 'touch' })
    expect(screen.queryByText('Pending quest')).toBeNull()

    // Tapping the badge should open the menu
    fireEvent.click(badge)
    expect(screen.queryByText('Pending quest')).not.toBeNull()

    // Clicking the badge again keeps it open: on desktop hover already
    // opens the menu, so a toggle would instantly close what the user
    // just opened and the click would appear to do nothing.
    fireEvent.click(badge)
    expect(screen.queryByText('Pending quest')).not.toBeNull()

    // Escape closes the menu and returns focus to the badge
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Pending quest')).toBeNull()
  })

  it('returns null when there are no quests', () => {
    const { container } = render(
      <ChallengeHeaderBadge
        pageRoute="/guide/demo"
        quests={[]}
        challengeSectionMap={new Map()}
      />,
    )

    expect(container.firstChild).toBeNull()
  })
})
