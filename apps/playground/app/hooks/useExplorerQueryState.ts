/**
 * useExplorerQueryState — URL ↔ WqlComposer query state for the Analytics
 * Explorer route (`/analytics/explorer`, issue #839), with a run-on-submit
 * split on top of the #833 library pattern. String-state rework for
 * wayfinder ticket 013: the draft IS the `?q=` text — no salvage parser,
 * no lossiness; the composer handles pill-expressibility itself.
 *
 * Two tracked values:
 *   - `?q=` mirrors the LIVE composer draft. Editing replaces the URL in
 *     place within an editing spell (no history entry per keystroke); the
 *     first edit after a committed state pushes one scratch entry, so a
 *     deliberate Run/Apply can convert that entry into the checkpoint
 *     without destroying the previous checkpoint.
 *   - `submitted` is the last-run query snapshot. It alone gates the page's
 *     run effect (runQuery/runFind dispatch) and the post-run telemetry
 *     (PipelineAnatomy); editing the draft never re-runs. A popstate restore
 *     re-submits the restored query — the legacy behavior where back/forward
 *     re-ran what it restored.
 *
 * `?weeks=` (the analytics range) is managed here too — router-native, like
 * `q` — so a single history mechanism owns the explorer URL. The nuqs
 * react-router adapter writes through the *global* `history.pushState` and
 * recomposes the query string from its own tracked params; mixing it with
 * router writes on the same route lets either side silently drop the other's
 * params (the global-location coupling called out in #833). The dashboard
 * keeps its nuqs hooks untouched; the unit preference is localStorage-based
 * and unaffected.
 *
 * Deep links carrying WQL the pill model cannot express (e.g. negated
 * `!tags:x` filters) still RUN: `submitted` hydrates from the raw `q`
 * string, and the composer renders them through its free-text escape hatch.
 */
import { useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseQuery } from '@bitcobblers/wod-wiki-engine'

/** Range options offered by the explorer UI (single source for the domain). */
export const EXPLORER_RANGE_OPTIONS = [4, 8, 16] as const
export type ExplorerRangeWeeks = (typeof EXPLORER_RANGE_OPTIONS)[number]
export const DEFAULT_EXPLORER_WEEKS: ExplorerRangeWeeks = 16

export interface ExplorerQueryState {
  /** Live composer draft WQL (the composer's controlled `query` prop). */
  draft: string
  /** Edit the draft; replaces `?q=` in place (one scratch entry per
   *  editing spell — never one history entry per keystroke). */
  setDraft: (wql: string) => void
  /** The last submitted query (gates the run effect and post-run telemetry). */
  submitted: string
  /** Mark a query as run (defaults to the current draft) and convert the
   *  current history entry into the deliberate checkpoint. Invalid queries
   *  are refused. */
  submit: (wql?: string) => void
  /** Analytics range in weeks (from `?weeks=`, default 16). */
  weeks: ExplorerRangeWeeks
  /** Set the analytics range (history replace — a view preference, not navigation). */
  setWeeks: (weeks: ExplorerRangeWeeks) => void
}

/** Explorer landing state: a valid, parseable aggregate draft (issue #897:
 * the old empty-metric default compiled to `sum:`, which surfaced a parser
 * error on first visit). Submitted state still starts empty, so nothing
 * runs until the user submits — unless the surface opts into
 * `runOnLanding` (the /dashboards landing executes its default query). */
export const DEFAULT_EXPLORER_QUERY = 'sum:totalVolume{}'

export interface ExplorerQueryStateOptions {
  /** Landing draft when the URL carries no valid `?q=` (defaults to the
   *  generic aggregate seed). */
  defaultQuery?: string
  /** Run the landing default immediately (no `?q=` deep link present). */
  runOnLanding?: boolean
}

function parseWeeks(raw: string | null): ExplorerRangeWeeks {
  const n = Number.parseInt(raw ?? '', 10)
  return (EXPLORER_RANGE_OPTIONS as readonly number[]).includes(n) ? (n as ExplorerRangeWeeks) : DEFAULT_EXPLORER_WEEKS
}

export function useExplorerQueryState(options: ExplorerQueryStateOptions = {}): ExplorerQueryState {
  const { defaultQuery = DEFAULT_EXPLORER_QUERY, runOnLanding = false } = options
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const weeks = parseWeeks(searchParams.get('weeks'))

  const [draft, setDraftState] = useState<string>(() => (q && !parseQuery(q).error ? q : defaultQuery))
  const [submitted, setSubmitted] = useState(q || (runOnLanding ? defaultQuery : ''))

  const draftRef = useRef(draft)
  draftRef.current = draft
  const searchParamsRef = useRef(searchParams)
  searchParamsRef.current = searchParams
  // True while the current history entry holds a committed (run) state.
  // Editing a committed entry would destroy the checkpoint, so the first
  // edit pushes a scratch entry instead; further edits of the spell replace
  // it in place. A deliberate submit converts the scratch entry into the
  // next checkpoint.
  const urlIsCheckpoint = useRef(true)
  const qRef = useRef(q)
  qRef.current = q

  // URL → draft + submitted (back/forward, external navigation). Content-
  // compared: echoes of our own writes carry the draft text and are skipped
  // — they are edits, not submissions, and must neither clobber a transient
  // edit nor re-run the query. Any other q change is an external restore:
  // it re-runs what it restored (legacy behavior) and the restored entry
  // counts as committed.
  const prevQRef = useRef(q)
  useEffect(() => {
    if (q === prevQRef.current) return
    prevQRef.current = q
    if (draftRef.current === q) return
    urlIsCheckpoint.current = true
    setDraftState(q && !parseQuery(q).error ? q : defaultQuery)
    setSubmitted(q || (runOnLanding ? defaultQuery : ''))
  }, [q, defaultQuery, runOnLanding])

  // A changed landing default (the surface's own query settings saved one)
  // re-seeds a BARE landing — one with no `?q=` of its own. An explicit
  // `?q=` always wins: the new default applies on the next bare landing, and
  // the URL is never rewritten behind the user's back.
  const prevDefaultRef = useRef(defaultQuery)
  useEffect(() => {
    if (defaultQuery === prevDefaultRef.current) return
    prevDefaultRef.current = defaultQuery
    if (q) return
    setDraftState(defaultQuery)
    setSubmitted(runOnLanding ? defaultQuery : '')
  }, [defaultQuery, q, runOnLanding])

  // Draft → URL. Replace within an editing spell; one scratch entry per
  // spell so checkpoints survive (never a history entry per keystroke).
  const setDraft = useCallback(
    (next: string) => {
      if (next === draftRef.current) return
      const params = new URLSearchParams(searchParamsRef.current)
      params.set('q', next)
      setSearchParams(params, { replace: !urlIsCheckpoint.current })
      urlIsCheckpoint.current = false
      setDraftState(next)
    },
    [setSearchParams],
  )

  // Run/Apply checkpoint: commit the snapshot and mark the current entry as
  // the new checkpoint (replace — the scratch spell collapses into it).
  // Invalid queries never execute.
  const submit = useCallback(
    (wql?: string) => {
      const next = wql ?? draftRef.current
      if (parseQuery(next).error) return
      if (urlIsCheckpoint.current && qRef.current === next) {
        setSubmitted(next)
        return
      }
      const params = new URLSearchParams(searchParamsRef.current)
      params.set('q', next)
      setSearchParams(params, { replace: true })
      urlIsCheckpoint.current = true
      setSubmitted(next)
    },
    [setSearchParams],
  )

  const setWeeks = useCallback(
    (next: ExplorerRangeWeeks) => {
      const params = new URLSearchParams(searchParamsRef.current)
      params.set('weeks', String(next))
      setSearchParams(params, { replace: true })
    },
    [setSearchParams],
  )

  return { draft, setDraft, submitted, submit, weeks, setWeeks }
}
