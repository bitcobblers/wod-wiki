/**
 * ScrollTrackProvider.tsx — one continuous scroll track for a page built
 * from sticky-runway sections (the home tour).
 *
 * Before this service, every runway section ran its own scroll driver
 * (its own window scroll listener, its own rect math — see
 * canvas/useScrollRunway) and the panes inside the pinned windows — the
 * CodeMirror editor, the caption rail — were nested scrollers. On mobile
 * that made scrolling feel broken in two ways: the *target* of a gesture
 * changed at every section boundary (track → pane → track), and a swipe
 * that started on a pane scrolled the pane's content instead of the
 * page, so the tour felt stuck between sections.
 *
 * The track service is the single owner of the page's scrolling:
 *
 *  - ONE scroll listener (capture phase — the app shell scrolls a
 *    container div, not the window) and one rAF-throttled measure pass.
 *  - Drivers (useScrollRunway instances) and stageless anchors (the
 *    hero) register in page order. Each driver's slice resolves from the
 *    shared track position via the same resolveScrollStage seam the
 *    per-section drivers used — progress is continuous across segment
 *    boundaries by construction. Outside a provider, useScrollRunway
 *    runs its own driver exactly as before.
 *  - Scroll gates: a pane wrapped in <ScrollGate> YIELDS by default —
 *    CSS freezes its inner scrollers ([data-scroll-gate] rules in
 *    index.css) so wheel/touch gestures scroll the track, not the pane.
 *    Editing or the Scroll panel control captures a gate, restoring inner
 *    scrolling for editing and reading overflow. Blur, Escape, Scroll page,
 *    or a segment handoff returns gestures to the page.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { resolveScrollStage, type ScrollSlice } from '../canvas/scrollRunway'
import type { ScrollStage } from '../canvas/parseCanvasMarkdown'
import { measureSegment, resolveActiveSegmentId, type SegmentSpan } from './scrollTrack'

export type ScrollGateMode = 'yield' | 'captured'

/** One measure result for a registered driver, from the shared track position. */
export interface TrackDriverMeasure {
  slice: ScrollSlice
  progress: number
  reached: boolean
}

/** A scroll driver registered with the track (see canvas/useScrollRunway). */
export interface TrackDriver {
  getEl(): HTMLElement | null
  getStages(): ScrollStage[]
  onMeasure(m: TrackDriverMeasure): void
}

export interface ScrollTrackApi {
  /** Register a plain anchor (no stages) — participates in active-segment resolution. */
  registerAnchor(id: string, getEl: () => HTMLElement | null): () => void
  /** Register a staged driver whose slice resolves from the track position. */
  registerDriver(id: string, driver: TrackDriver): () => void
  /** Force a measure pass from the current scroll position. */
  resync(): void
  capturedGateId: string | null
  captureGate(gateId: string, segmentId: string | null): void
  releaseGate(gateId: string): void
}

const ScrollTrackContext = createContext<ScrollTrackApi | null>(null)

/** The track API, or null when rendered outside a ScrollTrackProvider. */
export function useScrollTrack(): ScrollTrackApi | null {
  return useContext(ScrollTrackContext)
}

export function ScrollTrackProvider({ children }: { children: ReactNode }) {
  const anchorsRef = useRef(new Map<string, () => HTMLElement | null>())
  const driversRef = useRef(new Map<string, TrackDriver>())
  const capturedRef = useRef<{ gateId: string; segmentId: string | null } | null>(null)
  const rafRef = useRef(0)

  const [capturedGateId, setCapturedGateId] = useState<string | null>(null)
  const activeRef = useRef<string | null>(null)

  const releaseGate = useCallback((gateId: string) => {
    if (capturedRef.current?.gateId !== gateId) return
    capturedRef.current = null
    setCapturedGateId(null)
  }, [])

  const captureGate = useCallback((gateId: string, segmentId: string | null) => {
    capturedRef.current = { gateId, segmentId }
    setCapturedGateId(gateId)
  }, [])

  const measure = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    const viewportH = window.innerHeight

    // Measure every registered element once; anchors and drivers share
    // the pass so active-segment resolution and driver slices always
    // come from the same track position.
    const rects = new Map<string, DOMRect>()
    const collect = (id: string, getEl: () => HTMLElement | null) => {
      const el = getEl()
      if (el) rects.set(id, el.getBoundingClientRect())
    }
    anchorsRef.current.forEach((getEl, id) => collect(id, getEl))
    driversRef.current.forEach((driver, id) => collect(id, driver.getEl))

    const spans: SegmentSpan[] = []
    rects.forEach((rect, id) => spans.push({ id, top: rect.top, bottom: rect.top + rect.height }))
    const nextActive = resolveActiveSegmentId(spans, viewportH)
    if (nextActive !== activeRef.current) {
      activeRef.current = nextActive
      // The scroll target hands off between sections: a gate captured in
      // a segment that no longer owns the reading line releases.
      const captured = capturedRef.current
      if (captured && captured.segmentId !== nextActive) {
        capturedRef.current = null
        setCapturedGateId(null)
      }
    }

    driversRef.current.forEach((driver, id) => {
      const rect = rects.get(id)
      if (!rect) return
      // Mirror the per-section driver's guard: a track no taller than
      // the viewport has no scrollable distance — leave it unmeasured.
      if (rect.height - viewportH <= 0) return
      const m = measureSegment(rect.top, rect.height, viewportH)
      driver.onMeasure({
        slice: resolveScrollStage(m.progress, driver.getStages()),
        progress: m.progress,
        reached: m.reached,
      })
    })
  }, [])

  const onScroll = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(measure)
  }, [measure])

  useEffect(() => {
    // Capture phase: scroll events don't bubble, and the app shell
    // scrolls inside a container div — capture catches every scroller,
    // matching the per-section drivers this service replaces.
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    window.addEventListener('resize', onScroll)
    measure()
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [onScroll, measure])

  const registerAnchor = useCallback((id: string, getEl: () => HTMLElement | null) => {
    anchorsRef.current.set(id, getEl)
    onScroll()
    return () => {
      anchorsRef.current.delete(id)
    }
  }, [onScroll])

  const registerDriver = useCallback(
    (id: string, driver: TrackDriver) => {
      driversRef.current.set(id, driver)
      onScroll()
      return () => {
        driversRef.current.delete(id)
      }
    },
    [onScroll],
  )

  const resync = useCallback(() => measure(), [measure])

  const api = useMemo<ScrollTrackApi>(() => ({
    registerAnchor,
    registerDriver,
    resync,
    capturedGateId,
    captureGate,
    releaseGate,
  }), [registerAnchor, registerDriver, resync, capturedGateId, captureGate, releaseGate])

  return <ScrollTrackContext.Provider value={api}>{children}</ScrollTrackContext.Provider>
}

/** Register a stageless anchor element (e.g. the hero) with the track. */
export function useTrackAnchor(id: string, ref: RefObject<HTMLElement | null>): void {
  const track = useScrollTrack()
  const registerAnchor = track?.registerAnchor
  useEffect(() => {
    if (!registerAnchor) return
    return registerAnchor(id, () => ref.current)
  }, [registerAnchor, id, ref])
}

/**
 * A scroll gate around an interactive pane inside the track.
 *
 * While the gate yields (the default), CSS freezes its inner scrollers so
 * gestures scroll the track. Editing or Scroll panel restores inner scrolling
 * until focus leaves, the user releases it, or the active segment moves on.
 * Outside a provider the gate is inert.
 */
export function ScrollGate({
  gateId,
  segmentId,
  className,
  children,
}: {
  gateId: string
  /** Segment this gate belongs to; its capture releases when another segment activates. */
  segmentId?: string
  className?: string
  children: ReactNode
}) {
  const track = useScrollTrack()
  const paneRef = useRef<HTMLDivElement | null>(null)
  // The toggle only matters when the gated content can actually scroll; a
  // roomy pane renders no control (finding 1 — an affordance that never
  // applies reads as a stray label).
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const pane = paneRef.current
    if (!pane || typeof ResizeObserver === 'undefined') return
    // The gated scrollers the CSS freezes (see [data-scroll-gate] rules);
    // absolute-positioned panes never overflow their wrapper themselves.
    const check = () => {
      const inner = pane.querySelectorAll('.cm-scroller, [data-scroll-pane], .overflow-auto, .overflow-y-auto')
      setOverflowing(
        pane.scrollHeight > pane.clientHeight + 1
        || [...inner].some((el) => el.scrollHeight > el.clientHeight + 1),
      )
    }
    const ro = new ResizeObserver(check)
    ro.observe(pane)
    // Stage captions swap children (childList) while CodeMirror settles by
    // rewriting inline styles (attributes); re-check both, then again after
    // the layout settles so a transiently-tall measure never sticks.
    let settle = 0
    const mo = new MutationObserver(() => {
      check()
      window.clearTimeout(settle)
      settle = window.setTimeout(check, 400)
    })
    mo.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', check)
    // One delayed pass: fonts and CodeMirror settle after mount without
    // further mutations, which would otherwise pin a transient tall measure.
    const settleAll = window.setTimeout(check, 1200)
    check()
    return () => {
      window.clearTimeout(settle)
      window.clearTimeout(settleAll)
      ro.disconnect(); mo.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [])
  if (!track) {
    return <div className={className}>{children}</div>
  }
  const mode: ScrollGateMode = track.capturedGateId === gateId ? 'captured' : 'yield'
  return (
    <div
      data-scroll-gate={mode}
      data-gate-id={gateId}
      className={`${className ?? ''} flex flex-col`}
      onFocus={(e) => {
        // Ordinary controls do not capture on focus.
        const target = e.target
        if (target instanceof HTMLElement && target.closest('input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), select:not([disabled]), [contenteditable="true"]')) {
          track.captureGate(gateId, segmentId ?? null)
        }
      }}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
          track.releaseGate(gateId)
        }
      }}
    >
      <div ref={paneRef} className="relative min-h-0 flex-1">{children}</div>
      {(overflowing || mode === 'captured') && (
        <button
          type="button"
          className="min-h-11 self-start rounded px-3 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={`${mode === 'captured' ? 'Scroll page' : 'Scroll panel'}: ${gateId.replace(/-/g, ' ')} content`}
          aria-pressed={mode === 'captured'}
          onClick={() => mode === 'captured'
            ? track.releaseGate(gateId)
            : track.captureGate(gateId, segmentId ?? null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') track.releaseGate(gateId)
          }}
        >
          {mode === 'captured' ? 'Scroll page' : 'Scroll panel'}
        </button>
      )}
    </div>
  )
}
