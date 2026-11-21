/**
 * ScrollTrackProvider.test.tsx — the continuous scroll track service:
 * pure segment geometry, gate capture/release, and driver delegation
 * (useScrollRunway fed by the shared track).
 */

import { describe, it, expect } from 'bun:test'
import { useRef } from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { measureSegment, resolveActiveSegmentId } from './scrollTrack'
import { ScrollTrackProvider, ScrollGate, useTrackAnchor } from './ScrollTrackProvider'
import { useScrollRunway, type UseScrollRunwayResult } from '../canvas/useScrollRunway'
import type { ScrollStage } from '../canvas/parseCanvasMarkdown'

const STAGES: ScrollStage[] = [
  { id: 'stage-a', range: [0, 0.5] },
  { id: 'stage-b', range: [0.5, 1] },
]

function stubRect(el: HTMLElement, top: number, height: number) {
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => {},
    }) as DOMRect
}

/** Flush the rAF-throttled measure pass (unit-setup rAF is setTimeout-based). */
async function flushMeasure() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40))
  })
}

describe('measureSegment', () => {
  it('is 0 before the segment top reaches the viewport top', () => {
    const m = measureSegment(200, 2000, 800)
    expect(m.progress).toBe(0)
    expect(m.reached).toBe(false)
    expect(m.inView).toBe(true)
  })

  it('progresses over (height - viewport) and clamps at 1', () => {
    expect(measureSegment(-600, 2000, 800).progress).toBeCloseTo(0.5)
    expect(measureSegment(-1200, 2000, 800).progress).toBe(1)
    expect(measureSegment(-9999, 2000, 800).progress).toBe(1)
    expect(measureSegment(-1200, 2000, 800).reached).toBe(true)
  })

  it('reports out-of-view segments', () => {
    expect(measureSegment(900, 2000, 800).inView).toBe(false)
    expect(measureSegment(-2100, 2000, 800).inView).toBe(false)
  })
})

describe('resolveActiveSegmentId', () => {
  it('picks the segment crossing the reading line (viewport middle)', () => {
    const spans = [
      { id: 'hero', top: -700, bottom: -50 },
      { id: 'write', top: -50, bottom: 1950 },
    ]
    expect(resolveActiveSegmentId(spans, 800)).toBe('write')
  })

  it('returns null in the gaps between segments', () => {
    const spans = [
      { id: 'hero', top: -900, bottom: -500 },
      { id: 'write', top: 600, bottom: 2600 },
    ]
    expect(resolveActiveSegmentId(spans, 800)).toBeNull()
  })
})

function Anchor({ id, testId }: { id: string; testId: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useTrackAnchor(id, ref)
  return <div ref={ref} data-testid={testId} />
}

describe('ScrollGate', () => {
  it('yields by default, captures on edit focus, releases on focus out', () => {
    const { getByTestId } = render(
      <ScrollTrackProvider>
        <ScrollGate gateId="g1" segmentId="hero" className="wrap">
          <input data-testid="field" />
          <button type="button">Run</button>
        </ScrollGate>
      </ScrollTrackProvider>,
    )
    const gate = document.querySelector('[data-gate-id="g1"]') as HTMLElement
    expect(gate.dataset.scrollGate).toBe('yield')

    fireEvent.focusIn(getByTestId('field'))
    expect(gate.dataset.scrollGate).toBe('captured')

    fireEvent.focusOut(getByTestId('field'), { relatedTarget: document.body })
    expect(gate.dataset.scrollGate).toBe('yield')
  })

  it('does not capture for button focus — controls stay usable while yielding', () => {
    const { getByText } = render(
      <ScrollTrackProvider>
        <ScrollGate gateId="g2" segmentId="hero">
          <button type="button">Run</button>
        </ScrollGate>
      </ScrollTrackProvider>,
    )
    const gate = document.querySelector('[data-gate-id="g2"]') as HTMLElement
    fireEvent.focusIn(getByText('Run'))
    expect(gate.dataset.scrollGate).toBe('yield')
  })

  it('releases a captured gate when the active segment moves on', async () => {
    const { getByTestId } = render(
      <ScrollTrackProvider>
        <Anchor id="hero" testId="anchor-hero" />
        <Anchor id="write" testId="anchor-write" />
        <ScrollGate gateId="hero-pane" segmentId="hero">
          <input data-testid="hero-field" />
        </ScrollGate>
      </ScrollTrackProvider>,
    )
    const heroEl = getByTestId('anchor-hero')
    const writeEl = getByTestId('anchor-write')
    const gate = document.querySelector('[data-gate-id="hero-pane"]') as HTMLElement

    // Hero owns the reading line (viewport 768 in jsdom, line at 384).
    stubRect(heroEl, 0, 700)
    stubRect(writeEl, 700, 2000)
    window.dispatchEvent(new window.Event('scroll'))
    await flushMeasure()

    fireEvent.focusIn(getByTestId('hero-field'))
    expect(gate.dataset.scrollGate).toBe('captured')

    // Scroll on: the write segment now owns the reading line.
    stubRect(heroEl, -800, 700)
    stubRect(writeEl, -100, 2000)
    window.dispatchEvent(new window.Event('scroll'))
    await flushMeasure()
    expect(gate.dataset.scrollGate).toBe('yield')
  })

  it('keeps a captured gate locked during scroll while mobile editing is active', async () => {
    const { getByTestId } = render(
      <ScrollTrackProvider>
        <Anchor id="hero" testId="anchor-hero" />
        <Anchor id="write" testId="anchor-write" />
        <ScrollGate gateId="hero-pane" segmentId="hero">
          <input data-testid="hero-field" />
        </ScrollGate>
      </ScrollTrackProvider>,
    )
    const heroEl = getByTestId('anchor-hero')
    const writeEl = getByTestId('anchor-write')
    const gate = document.querySelector('[data-gate-id="hero-pane"]') as HTMLElement

    stubRect(heroEl, 0, 700)
    stubRect(writeEl, 700, 2000)
    window.dispatchEvent(new window.Event('scroll'))
    await flushMeasure()

    fireEvent.focusIn(getByTestId('hero-field'))
    expect(gate.dataset.scrollGate).toBe('captured')

    document.documentElement.dataset.mobileEditorOpen = 'true'
    try {
      stubRect(heroEl, -800, 700)
      stubRect(writeEl, -100, 2000)
      window.dispatchEvent(new window.Event('scroll'))
      await flushMeasure()
      expect(gate.dataset.scrollGate).toBe('captured')
    } finally {
      delete document.documentElement.dataset.mobileEditorOpen
    }

    window.dispatchEvent(new window.Event('scroll'))
    await flushMeasure()
    expect(gate.dataset.scrollGate).toBe('captured')

    // Moving to a new segment after mobile editing ends releases normally on next handoff
    stubRect(heroEl, 0, 700)
    stubRect(writeEl, 700, 2000)
    window.dispatchEvent(new window.Event('scroll'))
    await flushMeasure()
    stubRect(heroEl, -800, 700)
    stubRect(writeEl, -100, 2000)
    window.dispatchEvent(new window.Event('scroll'))
    await flushMeasure()
    expect(gate.dataset.scrollGate).toBe('yield')
  })

  it('is inert outside a provider', () => {
    render(
      <ScrollGate gateId="lonely">
        <span>content</span>
      </ScrollGate>,
    )
    expect(document.querySelector('[data-scroll-gate]')).toBeNull()
  })
})

describe('useScrollRunway on the track', () => {
  function Probe({ onDriver }: { onDriver: (d: UseScrollRunwayResult) => void }) {
    const trackRef = useRef<HTMLDivElement | null>(null)
    const driver = useScrollRunway(trackRef, false, STAGES, 'write')
    onDriver(driver)
    return <div ref={trackRef} data-testid="track-el" />
  }

  it('resolves the driver slice from the shared track position', async () => {
    let latest: UseScrollRunwayResult | null = null
    const { getByTestId } = render(
      <ScrollTrackProvider>
        <Probe onDriver={(d) => (latest = d)} />
      </ScrollTrackProvider>,
    )
    const el = getByTestId('track-el')
    // progress = 700 / (2000 - 768) ≈ 0.57 → stage-b (range 0.5..1)
    stubRect(el, -700, 2000)
    window.dispatchEvent(new window.Event('scroll'))
    await flushMeasure()
    expect(latest?.slice.stage.id).toBe('stage-b')
    expect(latest?.slice.index).toBe(1)
    expect(latest?.runwayReached).toBe(true)
  })

  it('still runs its own driver outside a provider', async () => {
    let latest: UseScrollRunwayResult | null = null
    const { getByTestId } = render(<Probe onDriver={(d) => (latest = d)} />)
    const el = getByTestId('track-el')
    stubRect(el, -700, 2000)
    window.dispatchEvent(new window.Event('scroll'))
    await flushMeasure()
    expect(latest?.slice.stage.id).toBe('stage-b')
    expect(latest?.runwayReached).toBe(true)
  })
})
