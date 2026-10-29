/**
 * stickyBoundary — the shared stacked-sticky measurement seam.
 *
 * Any element that carries `data-page-sticky-boundary="true"` participates in
 * the page's sticky stack. {@link measureStickyBoundary} returns the viewport
 * bottom of the lowest visible boundary element (+ a breathing-room margin),
 * so stacked sticky children (date-group headers, shelf headers, scroll
 * targets) position themselves from the real layout instead of magic numbers
 * like `top-[104px]`.
 *
 * Two adapters exist today — CanvasPage's scroll-to-section and QueriableStreamView's
 * date-group headers — so the seam is real, not hypothetical.
 */

import { useEffect, useState } from 'react'

/** Selector marking an element as part of the page's sticky stack. */
export const STICKY_BOUNDARY_SELECTOR = '[data-page-sticky-boundary="true"]'

/** Default gap between the sticky boundary and whatever stacks below it (0 = flush). */
const DEFAULT_BOUNDARY_MARGIN = 0

/**
 * Viewport `top` offset below the lowest visible sticky boundary element.
 * Returns `fallback` during SSR / in document-less environments and when no
 * boundary element is on screen.
 */
export function measureStickyBoundary(fallback: number, margin = DEFAULT_BOUNDARY_MARGIN): number {
  if (typeof document === 'undefined') return fallback

  const stickyElements = Array.from(
    document.querySelectorAll<HTMLElement>(STICKY_BOUNDARY_SELECTOR),
  )

  const visibleBottom = stickyElements.reduce((maxBottom, element) => {
    const rect = element.getBoundingClientRect()
    if (rect.height <= 0 || rect.bottom <= 0) return maxBottom
    return Math.max(maxBottom, rect.bottom)
  }, 0)

  return visibleBottom > 0 ? visibleBottom + margin : fallback
}

/**
 * Reactive variant of {@link measureStickyBoundary}: re-measures on scroll,
 * viewport resize, content resize, and mount (rAF-throttled). Content resize
 * tracks expanding WQL writers without a window event.
 */
export function useStickyBoundaryOffset(fallback: number, margin = DEFAULT_BOUNDARY_MARGIN): number {
  const [offset, setOffset] = useState(fallback)

  useEffect(() => {
    let raf = 0
    const apply = () => setOffset(measureStickyBoundary(fallback, margin))
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(apply)
    }
    apply()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', apply)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(apply)
    document.querySelectorAll(STICKY_BOUNDARY_SELECTOR).forEach(element => observer?.observe(element))
    const mutation = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => {
      document.querySelectorAll(STICKY_BOUNDARY_SELECTOR).forEach(element => observer?.observe(element))
      apply()
    })
    if (typeof document !== 'undefined' && document.body) {
      mutation?.observe(document.body, { childList: true, subtree: true })
    }
    return () => {
      mutation?.disconnect()
      observer?.disconnect()
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', apply)
    }
  }, [fallback, margin])

  return offset
}
