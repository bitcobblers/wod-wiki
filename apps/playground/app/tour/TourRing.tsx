/**
 * TourRing.tsx — the single gliding highlight ring + target registry.
 *
 * Screens register wrapper elements under RingTargetKeys; the ring measures
 * the active target relative to its canvas and positions itself with a CSS
 * transition — position changes are discrete (stage/beat boundaries), never
 * per-frame layout thrash.
 *
 * The ring draws only the box — no label chip. The stage caption already
 * names the target; a chip just covered the highlighted control.
 */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import type { RingTargetKey } from './tourConstants'

// ── Registry ────────────────────────────────────────────────────────────────

export type RingRegistry = Record<RingTargetKey, HTMLElement | null>

export interface RingTargetsContextValue {
  register: (key: RingTargetKey, el: HTMLElement | null) => void
  registry: RefObject<RingRegistry>
  /** Bumps when any registration changes so the ring re-measures. */
  version: number
}

const RingTargetsContext = createContext<RingTargetsContextValue | null>(null)

export function RingTargetsProvider({ children }: { children: ReactNode }) {
  const registry = useRef<RingRegistry>({
    'editor.window': null,
    'editor.wodBlock': null,
    'editor.runButton': null,
    'editor.typeahead': null,
    'timer.floor': null,
    'timer.nextButton': null,
    'timer.castButton': null,
    'metrics.efforts': null,
    'metrics.data': null,
    'metrics.compound': null,
    'analytics.vocab': null,
    'analytics.table': null,
    'analytics.graphs': null,
    'analytics.dashboard': null,
  })
  const [version, setVersion] = useState(0)

  const register = useCallback((key: RingTargetKey, el: HTMLElement | null) => {
    if (registry.current[key] === el) return
    registry.current[key] = el
    setVersion((v) => v + 1)
  }, [])

  return (
    <RingTargetsContext.Provider value={{ register, registry, version }}>
      {children}
    </RingTargetsContext.Provider>
  )
}

export function useRingTargets(): RingTargetsContextValue {
  const ctx = useContext(RingTargetsContext)
  if (!ctx) {
    return {
      registry: { current: {} as RingRegistry },
      register: () => () => {},
      version: 0,
    }
  }
  return ctx
}

/** Callback ref for screens: registers the element under a ring key.
 *  No-ops outside a RingTargetsProvider so screens can render standalone. */
export function useRingRef(key: RingTargetKey) {
  const ctx = useContext(RingTargetsContext)
  const register = ctx?.register
  return useCallback((el: HTMLElement | null) => register?.(key, el), [key, register])
}

/**
 * Registers an element held via parent state/ref under a ring key in the
 * NEAREST RingTargetsProvider. Needed when the registering component sits
 * ABOVE the provider in the tree — its own useRingRef would resolve to an
 * outer provider (runways scope a provider around their stage pane).
 */
export function RingElementRegistrar({
  ringKey,
  el,
}: {
  ringKey: RingTargetKey
  el: HTMLElement | null
}) {
  const { register } = useRingTargets()
  useLayoutEffect(() => {
    register(ringKey, el)
  }, [ringKey, el, register])
  return null
}

// ── Ring ────────────────────────────────────────────────────────────────────

export interface TourRingProps {
  target?: { key: RingTargetKey } | null
  accent: string
  canvasRef: React.RefObject<HTMLElement | null>
}

interface RingBox {
  x: number
  y: number
  w: number
  h: number
}

export function TourRing({ target, accent, canvasRef }: TourRingProps) {
  const { registry, version } = useRingTargets()
  const [box, setBox] = useState<RingBox | null>(null)
  const targetKey = target?.key ?? null

  useLayoutEffect(() => {
    if (!targetKey) {
      setBox(null)
      return
    }
    const measure = () => {
      const el = registry.current[targetKey]
      const canvas = canvasRef.current
      if (!el || !canvas) {
        setBox(null)
        return
      }
      const elRect = el.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      const x = Math.round(elRect.left - canvasRect.left)
      const y = Math.round(elRect.top - canvasRect.top)
      const w = Math.round(elRect.width)
      const h = Math.round(elRect.height)
      // Entirely offscreen targets draw no border — during screen
      // cross-fades a stale registration would otherwise smear a ring
      // outside the visible canvas.
      if (w <= 0 || h <= 0 || x + w < 0 || y + h < 0 || x > canvasRect.width || y > canvasRect.height) {
        setBox(null)
        return
      }
      // Round to whole px: during a resize drag the subpixel noise
      // would otherwise restart the 500ms position transition every event
      // and the ring would smear/shimmer instead of staying glued.
      setBox({ x, y, w, h })
    }
    measure()
    // Re-measure after transitions/layout settles (screen cross-fades, fonts).
    const t1 = window.setTimeout(measure, 120)
    const t2 = window.setTimeout(measure, 480)
    // The proxy itself can settle late (font swap re-measures it) — follow
    // its box so the ring stays glued instead of freezing at first measure.
    let ro: ResizeObserver | null = null
    const el = registry.current[targetKey]
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }
    const mutations = new MutationObserver(measure)
    if (el) mutations.observe(el, { attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      ro?.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [targetKey, version, registry, canvasRef])

  if (!target || !box) return null

  const pad = 6
  return (
    <div
      data-testid="tour-ring"
      className="pointer-events-none absolute z-30 rounded-2xl transition-all duration-500 ease-out"
      style={{
        left: box.x - pad,
        top: box.y - pad,
        width: box.w + pad * 2,
        height: box.h + pad * 2,
        boxShadow: `0 0 0 2px ${accent}`,
      }}
    >
    </div>
  )
}
