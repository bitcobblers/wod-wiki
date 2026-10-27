/**
 * HomeInsightsSections.zero-size-mounts.test.tsx — dogfood finding #12: the
 * home page emitted repeated Recharts "width(0) and height(0)" warnings on a
 * clean load.
 *
 * Root structure (pre-fix): InsightsDashboardsSection rendered every scope
 * pane twice — once in the desktop-only sticky pane (`hidden … lg:flex`,
 * display:none below lg) and once in the `lg:hidden` mobile column
 * (display:none at lg+). Both copies mounted immediately, so at every
 * viewport half of the chart-bearing panes initialized inside a display:none
 * subtree, where Recharts' ResponsiveContainer can only measure a zero box —
 * one warning per chart per hidden copy, repeated.
 *
 * The fix renders ONE arrangement per breakpoint (JS `useIsMobile`, the same
 * lg edge the layouts were split on). These tests keep the contract locked:
 * each chart-bearing pane mounts exactly once per clean render, so no chart
 * can initialize in a hidden zero box. Real-layout proof (console warnings,
 * zero-box charts) lives in e2e/live-app/property-responsive-defects.e2e.ts.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router'

// Keep the boards pane lightweight: no seed corpus and no composer dialog —
// the pane shells themselves are the chart hosts under test.
mock.module('@/services/content/seedContent', () => ({
  useSeedContent: () => null,
}))
mock.module('../views/dashboards/WidgetComposerDialog', () => ({
  WidgetComposerDialog: () => null,
}))

import { InsightsDashboardsSection } from './HomeInsightsSections'

// jsdom lacks ResizeObserver; the ui package's widgets touch it on mount.
const globalWithResizeObserver = globalThis as unknown as { ResizeObserver?: unknown }
globalWithResizeObserver.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderSection() {
  return render(
    <MemoryRouter>
      <NuqsAdapter>
        <InsightsDashboardsSection session={null} onRun={() => {}} onBackToEditor={() => {}} />
      </NuqsAdapter>
    </MemoryRouter>,
  )
}

describe('home insights pane mounting', () => {
  afterEach(cleanup)

  it('mounts the boards pane once — a display:none duplicate initializes its charts at zero size', () => {
    renderSection()
    expect(
      screen.getAllByTestId('tour-session-dashboard'),
      'the seeded example boards pane is mounted once per breakpoint arrangement; the hidden copy initializes DashboardView charts inside a zero box (repeated "width(0) and height(0)" warnings on clean load)',
    ).toHaveLength(1)
  })

  it('mounts the session insights pane once', () => {
    renderSection()
    expect(
      screen.getAllByTestId('tour-insights-empty'),
      'the Session Insights pane is duplicated across the hidden and visible breakpoint arrangements',
    ).toHaveLength(1)
  })
})
