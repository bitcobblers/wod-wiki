/**
 * streamResults — the committed stream run's full result set, published once
 * per execution by QueriableStreamView. Navigation panels (conditions facets)
 * subscribe instead of re-running the query: one expensive full execution
 * per query change, many consumers.
 *
 * A snapshot carries the pathname and query string it was produced from;
 * consumers match BOTH before trusting the entries, so a slow run from a
 * previous page or a superseded draft is never mistaken for current data.
 */

import { useSyncExternalStore } from 'react'
import type { Entry } from '../../lib/entryMapper'

export interface StreamResultSnapshot {
  /** Location pathname the run belongs to. */
  pathname: string
  /** The committed query string (URL `q` or the profile default). */
  query: string
  /** Full mapped result set — not a visible batch. */
  entries: Entry[]
  /** Entity-catalog records excluded by default from unscoped `:note{}` (WW-094 / WW-162). */
  excludedCatalogCount?: number
}

let snapshot: StreamResultSnapshot | null = null
const listeners = new Set<() => void>()

export function publishStreamResults(next: StreamResultSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): StreamResultSnapshot | null {
  return snapshot
}

/** The latest committed run, or null before the first publish. */
export function useStreamResults(): StreamResultSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot)
}
