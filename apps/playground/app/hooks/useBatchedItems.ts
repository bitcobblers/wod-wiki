/**
 * useBatchedItems — progressive rendering for large result lists (#861).
 *
 * The Library renders the first `batchSize` items and grows by another
 * batch whenever the sentinel scrolls near the viewport (IntersectionObserver,
 * 400px root margin). Grouping/sticky headers operate on the visible subset;
 * group counts come from the full set, so "showing 40 of 21,329" stays
 * truthful. The batch resets when the result set identity changes (new query).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export const LIBRARY_BATCH_SIZE = 200

export interface BatchedItems<T> {
  /** The first N items — render these. */
  visible: T[]
  /** True when items remain beyond the current batch. */
  hasMore: boolean
  /** Ref for the sentinel element rendered after the visible list. */
  sentinelRef: React.RefObject<HTMLDivElement | null>
  /** Total items in the full set (for "N more" messaging). */
  total: number
  /** Materialize items up to `n` immediately — jump-to-group support so a
   *  group link never targets an anchor progressive rendering hasn't built. */
  growTo: (n: number) => void
}

export function useBatchedItems<T>(items: T[], batchSize = LIBRARY_BATCH_SIZE): BatchedItems<T> {
  const [state, setState] = useState<{ items: T[]; batchSize: number; count: number }>(() => ({
    items,
    batchSize,
    count: batchSize,
  }))
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // New result set (or batch size) → immediately derive the first batch on render
  // rather than resetting in a passive useEffect (which can clobber an early growTo/click).
  const count = state.items === items && state.batchSize === batchSize ? state.count : batchSize
  const hasMore = count < items.length

  const updateCount = useCallback(
    (computeNext: (base: number) => number) => {
      setState(prev => {
        const sameInput = prev.items === items && prev.batchSize === batchSize
        const base = sameInput ? prev.count : batchSize
        const next = computeNext(base)
        if (sameInput && prev.count === next) return prev
        return { items, batchSize, count: next }
      })
    },
    [items, batchSize],
  )

  const growTo = useCallback(
    (n: number) => updateCount(base => Math.max(base, Math.min(Math.max(n, 0), items.length))),
    [updateCount, items.length],
  )

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasMore) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          updateCount(base => Math.min(base + batchSize, items.length))
        }
      },
      { rootMargin: '400px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, items.length, batchSize, updateCount])

  return { visible: items.slice(0, count), hasMore, sentinelRef, total: items.length, growTo }
}
