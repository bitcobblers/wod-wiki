/**
 * SecondaryNav — canonical L3 outline, connections & grouped actions rail.
 *
 * Verifies:
 *   - Stream controls are retired (resting L3 = 0px on stream routes even if
 *     legacy `streamControls` is published).
 *   - AnalyticsControlsNav renders Range, Units, and Query settings in Slot 1.
 *   - `l3Connections` renders under "Connections" beside "On this page".
 *   - Grouped `l3Actions` renders pinned `primary` CTA, flat secondary rows
 *     when < 4 secondary actions exist, collapsible `<details>` disclosures for
 *     `author` / `organize` / `share` when >= 4 secondary actions exist, and a
 *     separated red `danger` block.
 */

import { describe, it, expect, afterEach, mock } from 'bun:test'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7'

import { TEST_IDS } from '@/lib/testIds'
import type { AnalyticsNavControls, L3ActionItem, NavContextValue, StreamNavControls } from '../NavContext'
import { NavContext, initialNavState } from '../NavContext'
import { NavigationDrawerProvider } from '../NavigationDrawerContext'
import { SecondaryNav } from '../SecondaryNav'
import type { MenuSpec } from '../menuModel'

function renderSecondaryNav(
  overrides: Partial<NavContextValue> = {},
  {
    route = '/note/1',
    closeDrawer = () => {},
    pageAction,
    spec,
  }: {
    route?: string
    closeDrawer?: () => void
    pageAction?: React.ReactNode
    spec?: MenuSpec
  } = {},
) {
  const ctx: NavContextValue = {
    tree: [],
    navState: initialNavState,
    dispatch: () => {},
    peekTarget: null,
    openPeek: () => {},
    closePeek: () => {},
    l3Items: [],
    setL3Items: () => {},
    l3Connections: undefined,
    setL3Connections: () => {},
    l3Actions: [],
    setL3Actions: () => {},
    secondarySpec: undefined,
    setSecondarySpec: () => {},
    streamControls: null,
    setStreamControls: () => {},
    analyticsControls: null,
    setAnalyticsControls: () => {},
    scrollToSection: () => {},
    registerScrollFn: () => {},
    openCreateJournal: () => {},
    registerCreateJournal: () => {},
    setContextNav: () => {},
    ...overrides,
  }

  return render(
    <MemoryRouter initialEntries={[route]}>
      <NuqsAdapter>
        <NavigationDrawerProvider close={closeDrawer}>
          <NavContext.Provider value={ctx}>
            <SecondaryNav spec={spec} pageAction={pageAction} />
          </NavContext.Provider>
        </NavigationDrawerProvider>
      </NuqsAdapter>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
})

describe('SecondaryNav stream retirement (0px resting L3)', () => {
  it('renders nothing on stream routes even when legacy streamControls is published', () => {
    const legacyControls: StreamNavControls = {
      query: ':journal{} last 4w',
      onQueryChange: () => {},
      groupDims: ['date'],
      onToggleGroupDim: () => {},
      availableGroupDims: [{ id: 'date', label: 'Date' }],
      settings: { level: 'note', layout: 'cards', visibleFields: ['title'] },
      onLayoutChange: () => {},
      onToggleField: () => {},
      level: 'note',
    }

    const { container } = renderSecondaryNav({ streamControls: legacyControls }, { route: '/journal' })
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('Date window')).toBeNull()
    expect(screen.queryByText('Group by')).toBeNull()
  })

  it('renders nothing when no modifiers, outline, connections, or actions exist', () => {
    const { container } = renderSecondaryNav({}, { route: '/feeds' })
    expect(container.firstChild).toBeNull()
  })
})

describe('SecondaryNav 3-slot anatomy (AnalyticsControlsNav + Outline + Connections + Grouped Actions)', () => {
  it('renders AnalyticsControlsNav (Range, Units, Query settings) in Slot 1, Outline in Slot 2, and Actions in Slot 3', () => {
    const onWeeksChange = mock(() => {})
    const onOpenQuerySettings = mock(() => {})
    const onRunAction = mock(() => {})
    const closeDrawer = mock(() => {})

    const analyticsControls: AnalyticsNavControls = {
      weeks: 8,
      onWeeksChange,
      showRange: true,
      showUnits: true,
      unitForced: false,
      onOpenQuerySettings,
    }
    const l3Actions: L3ActionItem[] = [
      { id: 'save-dash', label: 'Save to dashboard', onRun: onRunAction },
    ]

    renderSecondaryNav(
      {
        l3Items: [{ id: 'sec-1', label: 'Overview', level: 3, action: { type: 'scroll', sectionId: 'sec-1' } }],
        l3Actions,
        analyticsControls,
      },
      { route: '/dashboards', closeDrawer },
    )

    expect(screen.getByTestId(TEST_IDS.L3_ANALYTICS_CONTROLS)).toBeTruthy()
    expect(screen.getByTestId('l3-range-8w').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('l3-range-4w'))
    expect(onWeeksChange).toHaveBeenCalledWith(4)

    fireEvent.click(screen.getByTestId('query-settings-trigger'))
    expect(closeDrawer).toHaveBeenCalledTimes(1)
    expect(onOpenQuerySettings).toHaveBeenCalledTimes(1)

    expect(screen.getByText('On this page')).toBeTruthy()
    expect(screen.getByText('Overview')).toBeTruthy()

    const actionsSection = screen.getByTestId(TEST_IDS.L3_ACTIONS)
    expect(actionsSection.textContent).toContain('Actions')
    fireEvent.click(screen.getByRole('button', { name: 'Save to dashboard' }))
    expect(onRunAction).toHaveBeenCalledTimes(1)
    expect(closeDrawer).toHaveBeenCalledTimes(2)
  })

  it('disables unit buttons with pinned hint when unitForced is true', () => {
    renderSecondaryNav(
      {
        analyticsControls: { showRange: false, showUnits: true, unitForced: true },
      },
      { route: '/dashboards' },
    )

    expect(screen.getByText(/pinned by query/i)).toBeTruthy()
    expect((screen.getByTestId('l3-unit-kg') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('l3-unit-lb') as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders l3Connections under Connections beside On this page and supports peek callbacks', () => {
    const onPeekEffort = mock(() => {})
    const l3Connections: MenuSpec = [
      {
        kind: 'section',
        id: 'note-context-efforts',
        label: 'Efforts',
        entries: [
          {
            kind: 'link',
            id: 'effort:back-squat',
            label: 'Back Squat',
            onSelect: onPeekEffort,
            filterTo: '/notes?q=%3Anote%7Beffort%3Aback-squat%7D',
          },
        ],
      },
    ]

    renderSecondaryNav({
      l3Items: [{ id: 'sec-wod', label: 'Strength Block', level: 3, action: { type: 'scroll', sectionId: 'sec-wod' } }],
      l3Connections,
    })

    expect(screen.getByText('On this page')).toBeTruthy()
    const connectionsBlock = screen.getByTestId(TEST_IDS.L3_CONNECTIONS)
    expect(within(connectionsBlock).getByText('Connections')).toBeTruthy()
    expect(within(connectionsBlock).getByText('Efforts')).toBeTruthy()

    fireEvent.click(within(connectionsBlock).getByRole('button', { name: 'Back Squat' }))
    expect(onPeekEffort).toHaveBeenCalledTimes(1)
  })

  it('renders grouped l3Actions with pinned primary CTA, collapsible disclosures at >=4 secondary actions, and separated red danger', () => {
    const onRun = mock(() => {})
    const onAddTimer = mock(() => {})
    const onDelete = mock(() => {})

    const l3Actions: L3ActionItem[] = [
      { id: 'run', label: 'Run Workout', group: 'primary', onRun },
      { id: 'add-timer', label: 'Add timer', group: 'author', onRun: onAddTimer },
      { id: 'token-inspector', label: 'Token Inspector', group: 'author', onRun: () => {} },
      { id: 'placements', label: 'Notebooks & Pages', group: 'organize', onRun: () => {} },
      { id: 'clone', label: 'Clone', group: 'organize', onRun: () => {} },
      { id: 'copy-link', label: 'Copy link', group: 'share', onRun: () => {} },
      { id: 'delete', label: 'Delete note', group: 'danger', onRun: onDelete },
    ]

    renderSecondaryNav(
      { l3Actions },
      { pageAction: <button type="button">Download Markdown</button> },
    )

    // Pinned primary CTA
    const primaryBox = screen.getByTestId(TEST_IDS.L3_ACTIONS_PRIMARY)
    const primaryBtn = within(primaryBox).getByRole('button', { name: 'Run Workout' })
    expect(primaryBtn.className).toContain('bg-primary')
    fireEvent.click(primaryBtn)
    expect(onRun).toHaveBeenCalledTimes(1)

    // Collapsible native <details> disclosures for Author, Organize, Share & Export
    const authorDetails = screen.getByTestId(TEST_IDS.L3_ACTIONS_GROUP_AUTHOR) as HTMLDetailsElement
    const organizeDetails = screen.getByTestId(TEST_IDS.L3_ACTIONS_GROUP_ORGANIZE) as HTMLDetailsElement
    const shareDetails = screen.getByTestId(TEST_IDS.L3_ACTIONS_GROUP_SHARE) as HTMLDetailsElement
    expect(authorDetails.tagName).toBe('DETAILS')
    expect(organizeDetails.tagName).toBe('DETAILS')
    expect(shareDetails.tagName).toBe('DETAILS')
    expect(authorDetails.textContent).toContain('Author')
    expect(authorDetails.textContent).toContain('2')
    expect(organizeDetails.textContent).toContain('Organize')
    expect(organizeDetails.textContent).toContain('2')
    expect(shareDetails.textContent).toContain('Share & Export')
    expect(shareDetails.textContent).toContain('2') // Copy link + Download Markdown

    fireEvent.click(within(authorDetails).getByRole('button', { name: 'Add timer' }))
    expect(onAddTimer).toHaveBeenCalledTimes(1)

    // Separated red Danger block at bottom
    const dangerBox = screen.getByTestId(TEST_IDS.L3_ACTIONS_DANGER)
    const dangerBtn = within(dangerBox).getByRole('button', { name: 'Delete note' })
    expect(dangerBtn.className).toContain('text-destructive')
    fireEvent.click(dangerBtn)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('keeps secondary actions flat and immediately visible when fewer than 4 secondary actions exist', () => {
    const l3Actions: L3ActionItem[] = [
      { id: 'override', label: 'Override Effort', group: 'primary', onRun: () => {} },
      { id: 'resolved', label: 'Show Resolved', group: 'author', onRun: () => {} },
      { id: 'copy', label: 'Copy link', group: 'share', onRun: () => {} },
      { id: 'delete', label: 'Delete', group: 'danger', onRun: () => {} },
    ]

    renderSecondaryNav({ l3Actions })

    expect(screen.getByTestId(TEST_IDS.L3_ACTIONS_PRIMARY)).toBeTruthy()
    expect(screen.queryByTestId(TEST_IDS.L3_ACTIONS_GROUP_AUTHOR)).toBeNull()
    expect(screen.queryByTestId(TEST_IDS.L3_ACTIONS_GROUP_SHARE)).toBeNull()
    expect(screen.getByRole('button', { name: 'Show Resolved' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    expect(screen.getByTestId(TEST_IDS.L3_ACTIONS_DANGER)).toBeTruthy()
  })
})
