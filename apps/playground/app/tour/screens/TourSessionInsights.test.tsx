/**
 * TourSessionInsights.test.tsx — the derivation behind the home page's
 * Rest/Test Ratio and Reaction Time cards, plus the pane's two states.
 *
 * The segment shapes mirror what a real run records (probe: block-level
 * `segment` statements carry timeSpan, completionReason and the parsed
 * per-line metrics): `timer-expired` + duration = countdown/rest,
 * `user-advance` = time to the Next click.
 */

import { describe, expect, it } from 'bun:test'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Sessions, StoredOutputStatement } from '@/components/Editor/types'
import { deriveSessionInsights, TourSessionInsights } from './TourSessionInsights'

/** A StoredOutputStatement with only the fields the derivation reads. */
function segment(overrides: Partial<StoredOutputStatement>): StoredOutputStatement {
  return {
    outputType: 'segment',
    stackLevel: 1,
    line: 1,
    completionReason: 'user-advance',
    timeSpan: { started: 0, ended: 1000 },
    metrics: [{ type: 'rep', value: 10, origin: 'parser' }],
    ...overrides,
  } as StoredOutputStatement
}

/** The home example run: 3s countdown, 1.8s to Next, 42s of work, Next. */
function homeRun(): Sessions {
  return {
    startTime: 1000,
    endTime: 47800,
    duration: 46800,
    completed: true,
    logs: [
      segment({ line: 1, completionReason: 'timer-expired', timeSpan: { started: 1000, ended: 4000 }, metrics: [{ type: 'duration', value: 3000, origin: 'parser' }, { type: 'effort', value: 'Count Down', origin: 'parser' }] }),
      segment({ line: 2, timeSpan: { started: 4000, ended: 5800 }, metrics: [{ type: 'rep', value: 10, origin: 'parser' }, { type: 'effort', value: 'Pushups', origin: 'parser' }] }),
      segment({ line: 3, timeSpan: { started: 5800, ended: 47800 }, metrics: [{ type: 'rep', value: 10, origin: 'parser' }, { type: 'effort', value: 'Situps', origin: 'parser' }] }),
    ],
  } as unknown as Sessions
}

describe('deriveSessionInsights', () => {
  it('splits countdown spans from next-click spans and samples reactions', () => {
    const insights = deriveSessionInsights(homeRun())!
    expect(insights.clockMs).toBe(3000)
    expect(insights.nextMs).toBe(43800)
    expect(insights.reactions).toEqual([1800, 42000])
    expect(insights.totalMs).toBe(46800)
    expect(insights.segments).toHaveLength(3)
    expect(insights.segments[0]).toMatchObject({ kind: 'clock', label: 'Count Down' })
    expect(insights.segments[1]).toMatchObject({ kind: 'next', label: 'Pushups' })
  })

  it('ignores non-block statements, zero-length and open spans', () => {
    const session = {
      startTime: 0,
      endTime: 5000,
      duration: 5000,
      completed: true,
      logs: [
        segment({ outputType: 'system', timeSpan: { started: 0, ended: 9000 } }),
        segment({ stackLevel: 0, line: 1, timeSpan: { started: 0, ended: 9000 } }), // session root
        segment({ stackLevel: 2, line: 1, timeSpan: { started: 0, ended: 9000 } }), // nested child
        segment({ line: 1, timeSpan: { started: 0, ended: 0 } }), // zero-length waiting pop
        segment({ line: 4, completionReason: 'user-advance', timeSpan: { started: 1000 } }), // open span (stopped mid-block)
      ],
    } as unknown as Sessions
    expect(deriveSessionInsights(session)).toBeNull()
  })

  it('classifies timed work structures as clock time and skips unknown reasons', () => {
    const session = {
      startTime: 0,
      endTime: 6000,
      duration: 6000,
      completed: true,
      logs: [
        segment({ line: 1, completionReason: 'timer-expired', timeSpan: { started: 0, ended: 6000 }, metrics: [{ type: 'duration', value: 6000, origin: 'parser' }] }),
      ],
    } as unknown as Sessions
    const insights = deriveSessionInsights(session)!
    expect(insights.clockMs).toBe(6000)
    expect(insights.nextMs).toBe(0)
    expect(insights.reactions).toEqual([])
  })

  it('returns null when nothing is measurable', () => {
    expect(deriveSessionInsights({ startTime: 0, endTime: 0, duration: 0, completed: true, logs: [] } as Sessions)).toBeNull()
  })
})

describe('TourSessionInsights pane', () => {
  it('shows the run-to-view CTA before any run', () => {
    render(<TourSessionInsights result={null} onRun={() => {}} />)
    expect(screen.getByTestId('tour-insights-empty')).toBeTruthy()
    expect(screen.getByTestId('tour-insights-run').textContent).toContain('Run to view the results')
    cleanup()
  })

  it('starts the fullscreen run from the CTA button', () => {
    let runs = 0
    render(<TourSessionInsights result={null} onRun={() => { runs += 1 }} />)
    fireEvent.click(screen.getByTestId('tour-insights-run'))
    expect(runs).toBe(1)
    cleanup()
  })

  it('renders the timeline and both cards from a recorded run', () => {
    render(<TourSessionInsights result={homeRun()} onRun={() => {}} />)
    expect(screen.getByTestId('tour-insights-timeline')).toBeTruthy()
    // 3s rest vs 43.8s to Next → 1 : 14.6
    expect(screen.getByTestId('tour-insights-ratio')!.textContent).toContain('1 : 14.6')
    expect(screen.getByTestId('tour-insights-ratio')!.textContent).toContain('0:03')
    expect(screen.getByTestId('tour-insights-ratio')!.textContent).toContain('0:44')
    // avg reaction (1.8 + 42) / 2 = 21.9s over 2 clicks, slowest 42.0s
    expect(screen.getByTestId('tour-insights-reaction')!.textContent).toContain('21.9s')
    expect(screen.getByTestId('tour-insights-reaction')!.textContent).toContain('2 clicks')
    expect(screen.getByTestId('tour-insights-reaction')!.textContent).toContain('42.0s')
    cleanup()
  })

  it('renders the CTA when a recorded run has no measurable spans', () => {
    render(
      <TourSessionInsights
        result={{ startTime: 0, endTime: 0, duration: 0, completed: true, logs: [] } as Sessions}
        onRun={() => {}}
      />,
    )
    expect(screen.getByTestId('tour-insights-empty')).toBeTruthy()
    cleanup()
  })
})
