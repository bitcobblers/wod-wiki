/**
 * contextSize.ts — measured-context orientation for sticky runway shells.
 *
 * The available context is the actual content box a surface occupies
 * (ResizeObserver), or the window below the app sticky nav when no element
 * applies (desktop STICKY_NAV_HEIGHT, mobile MOBILE_STICKY_TOP, dynamic
 * viewport). The demo pane takes DEMO_SHARE and the caption rail the rest,
 * along the dominant axis: split side-by-side when the context is at least
 * as wide as tall, stacked when taller — never viewport-width breakpoints.
 * Pane/caption CSS is plain calc/flex ratios at the call sites.
 */
import { useCallback, useEffect, useState } from 'react'

/** Demo pane share of the measured context; the caption rail takes the rest. */
export const DEMO_SHARE = 0.6

/** Minimum measured context width before switching from stacked to side-by-side split. */
export const SPLIT_MIN_WIDTH = 640

export type ContextMode = 'split' | 'stack'

/** Side-by-side when the measured context is at least 640px wide and at least as wide as tall. */
export function contextMode(width: number, height: number): ContextMode {
  return width >= SPLIT_MIN_WIDTH && width >= height ? 'split' : 'stack'
}

export interface ContextSize {
  width: number
  height: number
  mode: ContextMode
}

/**
 * Live context measurement. With `el`, ResizeObserver reports the element's
 * content box — the true layout context after nav/status strip/padding.
 * Without it, the window minus `navOffset`, re-measured on resize; that
 * window estimate also stands when ResizeObserver is unavailable (jsdom).
 */
export function useContextSize(navOffset: number, el?: HTMLElement | null): ContextSize {
  const measure = useCallback(() => {
    if (typeof window === 'undefined') return { width: 0, height: 0, mode: 'stack' as const }
    const width = window.innerWidth
    const height = Math.max(0, window.innerHeight - navOffset)
    return { width, height, mode: contextMode(width, height) }
  }, [navOffset])
  const [size, setSize] = useState(measure)
  useEffect(() => {
    if (el && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect
        setSize((prev) =>
          prev.width === width && prev.height === height
            ? prev
            : { width, height, mode: contextMode(width, height) },
        )
      })
      observer.observe(el)
      return () => observer.disconnect()
    }
    const onResize = () =>
      setSize((prev) => {
        const next = measure()
        return prev.width === next.width && prev.height === next.height ? prev : next
      })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [el, measure])
  return size
}
