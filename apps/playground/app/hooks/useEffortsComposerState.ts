/**
 * useEffortsComposerState — URL ↔ WqlComposer query state for the Efforts
 * catalog (`/efforts`). String-state rework for wayfinder ticket 013.
 *
 * Thin adapter over the shared `useComposerQueryState` core, same contract
 * as the Library: the composed WQL round-trips through `q` (back/forward
 * restores the composer). The page's legacy params are migrated once on
 * mount (history *replace*):
 *   `?origin=bundled&discipline=strength` → origin/discipline filters
 *   `?q=fran` (the old plain-text search)   → a text filter
 * A `q` that already parses as WQL is used as-is; one that doesn't and isn't
 * plain text surfaces the shared rejection banner.
 */
import { useComposerQueryState, type ComposerQueryState } from './useComposerQueryState'

export type EffortsComposerState = ComposerQueryState

/** Efforts landing state: the whole registry, no time window (registry rows
 * carry no queryable creation date). */
export const DEFAULT_EFFORTS_QUERY = ':effort'

const LEGACY_KEYS = ['origin', 'discipline'] as const

function textFilter(value: string): string {
  return /\s/.test(value) ? `text:"${value}"` : `text:${value}`
}

/** Compose the efforts query from filter parts. */
function effortsQuery(filters: string[]): string {
  const body = filters.filter(Boolean)
  return `:effort${body.length ? `{${body.join(',')}}` : ''}`
}

/** The old plain-text `?q=` becomes a text filter (plus any legacy filters). */
function salvageLegacyQ(q: string, search: URLSearchParams): string | null {
  const text = q.trim()
  if (!text) return null
  // Anything that looks like an attempt at WQL is a genuine rejection, not a
  // legacy text search — let the banner report it.
  if (text.startsWith(':') || text.includes('{') || text.includes('}')) return null
  const origin = search.get('origin')
  const discipline = search.get('discipline')?.trim()
  return effortsQuery([
    textFilter(text),
    ...(origin && origin !== 'all' ? [`origin:${origin}`] : []),
    ...(discipline ? [`discipline:${discipline}`] : []),
  ])
}

function legacyParamsToQuery(search: URLSearchParams): string | null {
  if (!LEGACY_KEYS.some(k => search.get(k))) return null
  const origin = search.get('origin')
  const discipline = search.get('discipline')?.trim()
  return effortsQuery([
    ...(origin && origin !== 'all' ? [`origin:${origin}`] : []),
    ...(discipline ? [`discipline:${discipline}`] : []),
  ])
}
export const EFFORTS_LEGACY_CONFIG = {
  keys: LEGACY_KEYS,
  toQuery: legacyParamsToQuery,
  salvageQ: salvageLegacyQ,
}

export function useEffortsComposerState(): EffortsComposerState {
  return useComposerQueryState({
    defaultQuery: DEFAULT_EFFORTS_QUERY,
    legacy: EFFORTS_LEGACY_CONFIG,
  })
}
