/**
 * useComposerQueryState — URL ↔ WqlComposer query state, shared core
 * (issue #833, decision #828; string-state rework for wayfinder ticket 013).
 *
 * The composer state IS the WQL string (the C6 AST's canonical form): the
 * `q` query parameter holds it verbatim. Each editing spell pushes one
 * scratch entry and replaces subsequent edits; browser Back/Forward
 * restores the composer directly. No salvage parser is needed. The string
 * round-trips losslessly by construction, and the composer itself decides
 * pill-expressibility (unexpressible-but-valid queries ride its free-text
 * escape hatch).
 *
 * Consumed by QueriableStreamView stream profiles (Library/Feeds/Journal
 * legacy tri-state migration #813) and the Efforts catalog (`useEffortsComposerState`)
 * — so the seam is real.
 *
 * Implementation note: this hook deliberately uses react-router's
 * `useSearchParams` rather than nuqs (the app-wide pattern elsewhere). The
 * nuqs react-router adapter reads and writes the *global* `location` /
 * `history` directly — invisible to the router in tests (jsdom +
 * MemoryRouter) and bypassing router listeners on shallow pushes — which
 * makes the required back/forward contract unimplementable through it.
 */
import { useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseQuery } from '@bitcobblers/wod-wiki-engine'

export interface ComposerQueryState {
  /** The composed WQL — the composer state (canonical text at rest). */
  query: string
  /** Edit `?q=` in one scratch history entry per editing spell. */
  setQuery: (wql: string) => void
  /** Set when the URL's `q` fails to parse — the query was rejected and the
   *  default took its place (#854). Cleared on the next edit or parseable
   *  `q`. */
  urlQueryError: string | null
}

export interface ComposerLegacyConfig {
  /** URL keys consumed by the migration (stripped afterwards). */
  keys: readonly string[]
  /** Map legacy URL params to a WQL query; null when nothing to migrate. */
  toQuery: (search: URLSearchParams) => string | null
  /**
   * Interpret an unparseable `q` as legacy state (e.g. the efforts page's
   * old plain-text `?q=fran`). Return the migrated query, or null to
   * surface the rejection banner instead.
   */
  salvageQ?: (q: string, search: URLSearchParams) => string | null
}

export interface ComposerQueryStateConfig {
  /**
   * Landing state when no usable URL state exists — the surface's default
   * query. A VALUE, not a thunk, so a changed default is a dependency: the
   * composer re-seeds when the surface's own settings change it.
   */
  defaultQuery: string
  legacy?: ComposerLegacyConfig
}

/** Rejection message for an unparseable `q`, with the parser's own detail. */
function urlQueryErrorFor(q: string): string | null {
  if (!q) return null
  const parsed = parseQuery(q)
  if (!parsed.error) return null
  return `Couldn't parse "${q}" — ${parsed.error}`
}

/** Idle period after which the current history entry settles into the
 *  checkpoint and the next edit starts a fresh spell. */
const URL_SPELL_SETTLE_MS = 1000

export function useComposerQueryState(config: ComposerQueryStateConfig): ComposerQueryState {
  // Config via ref: adapters pass inline literals; effects must not re-fire
  // on identity churn. The default/salvage functions themselves are pure.
  const configRef = useRef(config)
  configRef.current = config
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''

  const [query, setQueryState] = useState<string>(() => {
    const { defaultQuery: makeDefault, legacy } = configRef.current
    if (q) {
      const parsed = parseQuery(q)
      if (!parsed.error) return q
      return legacy?.salvageQ?.(q, searchParams) ?? makeDefault
    }
    return legacy?.toQuery(searchParams) ?? makeDefault
  })
  const [urlQueryError, setUrlQueryError] = useState<string | null>(() => {
    if (!q) return null
    if (!parseQuery(q).error) return null
    return configRef.current.legacy?.salvageQ?.(q, searchParams) ? null : urlQueryErrorFor(q)
  })
  const queryRef = useRef(query)
  queryRef.current = query
  const searchParamsRef = useRef(searchParams)
  searchParamsRef.current = searchParams

  // One-time legacy migration: rewrite legacy params (or a salvaged legacy
  // `q`) as a WQL `q` (replace, so the migrated URL does not add a history
  // entry).
  const migratedRef = useRef(false)
  useEffect(() => {
    if (migratedRef.current) return
    migratedRef.current = true
    const { legacy } = configRef.current
    const search = searchParamsRef.current
    const current = search.get('q') ?? ''
    let migrated: string | null = null
    if (current) {
      if (parseQuery(current).error) migrated = legacy?.salvageQ?.(current, search) ?? null
    } else {
      migrated = legacy?.toQuery(search) ?? null
    }
    if (!migrated) return
    const next = new URLSearchParams(search)
    for (const key of legacy?.keys ?? []) next.delete(key)
    next.set('q', migrated)
    setSearchParams(next, { replace: true })
  }, [setSearchParams])

  // Editing spells: the first edit after a committed state pushes one scratch
  // history entry; the burst's further edits replace it in place — never one
  // history entry per keystroke. After a short idle the entry settles into
  // the checkpoint (the stream has no explicit Run), so a later discrete edit
  // pushes anew and Back lands on the last settled query.
  const urlIsCheckpoint = useRef(true)
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // URL → query. Skip our own URL echoes without clobbering transient edits.
  const prevQRef = useRef(q)
  useEffect(() => {
    if (q === prevQRef.current) return
    prevQRef.current = q
    urlIsCheckpoint.current = true
    clearTimeout(settleRef.current)
    settleRef.current = null
    setUrlQueryError(urlQueryErrorFor(q))
    const restored = q && !parseQuery(q).error ? q : configRef.current.defaultQuery
    setQueryState(current => (current === restored ? current : restored))
  }, [q])

  // A changed landing default (the surface's own settings dialog saved one)
  // re-seeds a BARE landing — one with no `?q=` of its own. An explicit
  // `?q=` always wins: the new default applies on the next bare landing, and
  // the URL is never rewritten behind the user's back.
  const prevDefaultRef = useRef(configRef.current.defaultQuery)
  useEffect(() => {
    const next = configRef.current.defaultQuery
    if (next === prevDefaultRef.current) return
    prevDefaultRef.current = next
    if (q) return
    setQueryState(current => (current === next ? current : next))
  }, [q, configRef.current.defaultQuery])

  useEffect(() => {
    const restore = () => {
      const restoredQ = new URLSearchParams(window.location.search).get('q') ?? ''
      // Sentinel pops (palette open/close push+pop the SAME location) are
      // back navigations with no URL change — they must not reset the
      // composer: the local draft (invalid included) is newer than the URL.
      if (restoredQ === prevQRef.current) return
      prevQRef.current = restoredQ
      urlIsCheckpoint.current = true
      clearTimeout(settleRef.current)
      settleRef.current = null
      setUrlQueryError(urlQueryErrorFor(restoredQ))
      setQueryState(restoredQ && !parseQuery(restoredQ).error ? restoredQ : configRef.current.defaultQuery)
    }
    window.addEventListener('popstate', restore)
    return () => {
      window.removeEventListener('popstate', restore)
      clearTimeout(settleRef.current)
    }
  }, [])

  // Invalid drafts stay in the composer; only parseable queries reach the URL
  // (a half-typed query must not become history or a page error).
  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next)
      if (parseQuery(next).error) return
      if (next !== queryRef.current) {
        const params = new URLSearchParams(searchParamsRef.current)
        params.set('q', next)
        prevQRef.current = next
        setSearchParams(params, { replace: !urlIsCheckpoint.current })
        urlIsCheckpoint.current = false
        clearTimeout(settleRef.current)
        settleRef.current = setTimeout(() => {
          urlIsCheckpoint.current = true
          settleRef.current = null
        }, URL_SPELL_SETTLE_MS)
      }
    },
    [setSearchParams],
  )

  return { query, setQuery, urlQueryError }
}
