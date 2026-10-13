/**
 * FacetProperties — the properties accordion of a stream surface, rendered
 * by the L2 ConditionsNavPanel (the only host since the L3 rail and ⋯ menu
 * dropped where-filters in favour of view controls).
 *
 * ponytail: the L2 panel remounts per route mount, so async membership
 * loads re-fire on navigation. Swap for a shared context cache if that
 * shows up in profiling.
 *
 * One accordion of every `{}` condition the CURRENT query's target supports
 * (`wqlFilterKeys(target,'find')`), with values and counts derived from the
 * committed full result set published by QueriableStreamView (one execution
 * per query change — the facets never re-run the query). Every value is a
 * stable single row whose control cycles Off → Include → Exclude, backed by
 * the pure model (filterValueState / setFacetValueState): edits go through
 * occurrence-exact clause edits, so source scope, window, grouping, pipes,
 * joins and sibling filters survive; every selection is a history entry, so
 * Back/Forward restore query, options and results. Selected values stay
 * listed with removal controls even at zero results, and nothing
 * engine-ignored is ever offered.
 *
 * While a fresh execution is pending, the last committed run for THIS route
 * stays visible with all controls disabled — no disappearing/reordering
 * flicker; a previous route's run is never shown. Section labels, order and
 * curated value lists come from conditionsConfig; defaults reuse the
 * engine-supported keys and current result-backed options.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import clsx from 'clsx'
import { CheckSquare, MinusSquare, Plus, Square, SquarePen } from 'lucide-react'

import { isFindQuery, parseQuery, WQL_TYPED_TAG_KEYS, type ParsedFindQuery } from '@bitcobblers/wod-wiki-wql'
import { wqlFilterKeys } from '@bitcobblers/wod-wiki-wql'
import { getClauseMeta } from '@bitcobblers/wod-wiki-ui'

import { SidebarAccordion } from '@/components/organisms/layout/SidebarAccordion'

import { useCloseNavigationDrawer } from '../NavigationDrawerContext'

import { storageService } from '@/services/storage'

import { applyRouteWqlConfig } from '../../lib/routeWqlConfig'
import type { StreamProfile } from '../../views/stream/streamProfile'
import { useStreamResults, type StreamResultSnapshot } from '../../views/stream/streamResults'
import type { Entry } from '../../lib/entryMapper'
import {
  clauseTypeFor,
  facetOptions,
  filterValueState,
  headSourceScope,
  isFreeformKey,
  occurrencesForKey,
  resultIdentityKey,
  selectedValuesFor,
  setFacetValueState,
  setTextCondition,
  type FacetContext,
  type FacetOption,
  type FilterValueState,
  type TagMembership,
} from './conditionsFacets'
import { conditionSectionConfig } from './conditionsConfig'

const EMPTY_ENTRIES: Entry[] = []

const urlQuery = (loc: Location): string => new URLSearchParams(loc.search).get('q') ?? ''

/** Corpus tag membership over the canonical plane: the note_tags junction
 * answers per-note lookups (UUID ids carry no path stem), and each note's
 * `catalog` family aggregates its member notes' rows so `tags:` facets
 * resolve on collection/feed results too. */
async function loadTagMembership(): Promise<TagMembership> {
  const [byNote, allNotes] = await Promise.all([
    storageService.getNoteTagLabelsBatch(),
    storageService.getAllNotes(),
  ])
  for (const note of allNotes) {
    const labels = byNote.get(note.id)
    if (!note.catalog || !labels?.length) continue
    const rows = byNote.get(note.catalog)
    if (rows) {
      for (const row of labels) {
        if (!rows.some(r => r.label === row.label)) rows.push(row)
      }
    } else {
      byNote.set(note.catalog, labels.map(({ label, type }) => ({ label, type })))
    }
  }
  return byNote
}

/** Push a query-only navigation: every selection is its own history entry;
 *  unrelated URL params ride along untouched. */
export function navigateToQuery(location: Location, navigate: (to: string) => void, wql: string): void {
  const params = new URLSearchParams(location.search)
  params.set('q', wql)
  navigate(`${location.pathname}?${params.toString()}`)
}

/**
 * Facet properties for one stream surface. `profile` identifies the
 * surface's WQL target and default query; the effective query always comes
 * from the URL (`q`) falling back to the route-default overlay, matching
 * QueriableStreamView exactly.
 */
export function FacetProperties({ profile }: { profile: StreamProfile }) {
  const location = useLocation()
  const navigate = useNavigate()
  const published = useStreamResults()
  // Exact host parity: the URL `q` rides verbatim (whitespace included)
  // when it parses; absent or invalid falls back to the profile default —
  // the same rule useComposerQueryState applies, so publication matches.
  const rawQ = urlQuery(location)
  const defaultProfile = useMemo(() => applyRouteWqlConfig(profile), [profile])
  const effectiveQuery = rawQ && !parseQuery(rawQ).error ? rawQ : defaultProfile.defaultWql
  const parsed = useMemo(() => parseQuery(effectiveQuery), [effectiveQuery])
  const parsedFind = useMemo(
    () => (!parsed.error && isFindQuery(parsed) ? parsed : null),
    [parsed],
  )

  // Snapshot freshness: pathname AND query must match the committed run —
  // a previous page's results or a superseded draft never feed options.
  const entries = published && published.pathname === location.pathname && published.query === effectiveQuery
    ? published.entries
    : null

  // Last committed run for THIS route. While a fresh execution is pending
  // (query edited, snapshot not yet replaced) its rows stay visible with
  // controls disabled; a previous ROUTE's run is never reused.
  const [committed, setCommitted] = useState<StreamResultSnapshot | null>(null)
  useEffect(() => {
    if (published && published.pathname === location.pathname) setCommitted(published)
  }, [published, location.pathname])
  const pending = entries === null && committed !== null && committed.pathname === location.pathname
  const facetEntries = entries ?? (pending ? committed!.entries : EMPTY_ENTRIES)

  // Result identity is never offered as a facet catalog: on a target's own
  // plane (note — journal/collection/playground heads parse to target
  // 'note' + an injected source scope — and effort) the identity key would
  // list every result row as a filter value. A query that explicitly
  // authors the identity key keeps its section so rows stay removable.
  const identityKey = parsedFind ? resultIdentityKey(parsedFind.target) : null
  const identityAuthored = !!parsedFind && !!identityKey && occurrencesForKey(parsedFind, identityKey).length > 0
  const sectionKeys = useMemo(
    () => (parsedFind
      ? wqlFilterKeys(parsedFind.target, 'find').filter(key => key !== identityKey || identityAuthored)
      : []),
    [parsedFind, identityKey, identityAuthored],
  )
  const needsTagMembership = sectionKeys.some(
    key => key === 'tags' || (WQL_TYPED_TAG_KEYS as readonly string[]).includes(key),
  )
  const needsEffortMembership = sectionKeys.includes('effort')
  const [memberships, setMemberships] = useState<{
    tags: TagMembership | null
    efforts: Map<string, string[]> | null
  }>({ tags: null, efforts: null })
  useEffect(() => {
    if ((!needsTagMembership && !needsEffortMembership) || facetEntries.length === 0) return
    let cancelled = false
    Promise.all([
      needsTagMembership ? loadTagMembership() : null,
      needsEffortMembership ? storageService.getEffortSlugsByNoteBatch() : null,
    ])
      .then(([tags, efforts]) => {
        if (!cancelled) setMemberships({ tags, efforts })
      })
      .catch(() => {
        if (!cancelled) setMemberships({ tags: null, efforts: null })
      })
    return () => {
      cancelled = true
    }
  }, [needsTagMembership, needsEffortMembership, facetEntries])

  const facetContext: FacetContext = useMemo(
    () => ({ entries: facetEntries, tagMembership: memberships.tags, effortMembership: memberships.efforts }),
    [facetEntries, memberships],
  )
  const knownOptionsRef = useRef<Map<string, Map<string, Map<string, FacetOption>>>>(new Map())
  let routeKnownOptions = knownOptionsRef.current.get(location.pathname)
  if (!routeKnownOptions) {
    routeKnownOptions = new Map()
    knownOptionsRef.current.set(location.pathname, routeKnownOptions)
  }

  const hasEverPublished = entries !== null || committed !== null
  const apply = (wql: string) => navigateToQuery(location, navigate, wql)
  const headScope = parsedFind ? headSourceScope(parsedFind) : null

  // Config participates in section set + order: disabled keys drop, the
  // rest sort by configured order (stable — ties keep engine order).
  const orderedKeys = useMemo(
    () => sectionKeys
      .filter(key => conditionSectionConfig(key).enabled !== false)
      .sort((a, b) => (conditionSectionConfig(a).order ?? 0) - (conditionSectionConfig(b).order ?? 0)),
    [sectionKeys],
  )

  if (!parsedFind) return null
  return (
    <div className="flex flex-col" aria-busy={pending || undefined}>
      {orderedKeys.map(key => (
        <div key={key} data-testid={`conditions-section-${key}`}>
          <ConditionSection
            query={effectiveQuery}
            parsed={parsedFind}
            entryKey={key}
            facetContext={facetContext}
            labels={identifierLabels(parsedFind.target, key, facetEntries)}
            headScope={key === 'source' ? headScope : null}
            pending={pending}
            hasEverPublished={hasEverPublished}
            routeKnownOptions={routeKnownOptions}
            onApply={apply}
          />
        </div>
      ))}
    </div>
  )
}

/** Identifier values (note/block/result ids) render with their human label. */
function identifierLabels(target: string, key: string, entries: Entry[]): Map<string, string> {
  const labels = new Map<string, string>()
  const bump = (id: string | undefined, title: string) => {
    if (id && !labels.has(id)) labels.set(id, title)
  }
  if ((target === 'note' || target === 'block') && key === 'note') {
    for (const entry of entries) bump(entry.noteId ?? entry.id, entry.title)
  }
  if (target === 'session') {
    for (const entry of entries) {
      if (key === 'result') bump(entry.execution?.resultId, entry.title)
      for (const event of entry.execution?.events ?? []) {
        if (key === 'block') bump(event.blockContentId, entry.title)
        if (key === 'note') bump(event.noteId, entry.title)
      }
    }
  }
  return labels
}

// ── Tri-state condition rows ─────────────────────────────────────────────────

const TRI_STATES = ['off', 'include', 'exclude'] as const

const STATE_TITLE: Record<FilterValueState, string> = { off: 'Off', include: 'Include', exclude: 'Exclude' }

const STATE_ICON: Record<FilterValueState, typeof Square> = {
  off: Square,
  include: CheckSquare,
  exclude: MinusSquare,
}

/** One stable row: a value present in the current options, currently
 *  selected, or both — rendered once with its tri-state. */
interface ConditionRowModel {
  value: string
  label: string
  /** Current-result rows this value would keep; null when the narrowed
   *  result set no longer contains it (selection stays removable). */
  count: number | null
  state: FilterValueState
}

function ConditionSection({
  query,
  parsed,
  entryKey,
  facetContext,
  labels,
  headScope,
  pending,
  hasEverPublished,
  routeKnownOptions,
  onApply,
}: {
  query: string
  parsed: ParsedFindQuery
  entryKey: string
  facetContext: FacetContext
  labels: Map<string, string>
  headScope: string | null
  pending: boolean
  hasEverPublished: boolean
  routeKnownOptions: Map<string, Map<string, FacetOption>>
  onApply: (wql: string) => void
}) {
  const location = useLocation()
  const config = conditionSectionConfig(entryKey)
  if (config.enabled === false) return null
  const meta = getClauseMeta(clauseTypeFor(entryKey))
  const freeform = isFreeformKey(entryKey) || IDENTIFIER_FREEFORM[entryKey] !== undefined

  const selected = selectedValuesFor(parsed, entryKey, labels)
  // Raw positive `text:` value the live box controls — OR-joined when the
  // query carries multiple values.
  const liveText = entryKey === 'text'
    ? occurrencesForKey(parsed, 'text')
        .filter(o => !o.negate)
        .map(o => o.values.map(v => v.value).join('|'))
        .join('|')
    : null
  const options = facetOptions(parsed.target, entryKey, facetContext)

  let keyMap = routeKnownOptions.get(entryKey)
  if (!keyMap) {
    keyMap = new Map()
    routeKnownOptions.set(entryKey, keyMap)
  }
  for (const opt of options) {
    if (!keyMap.has(opt.value)) {
      keyMap.set(opt.value, { value: opt.value, label: opt.label, count: 0 })
    }
  }

  const selectedByDisplay = new Map(selected.map(row => [row.display, row] as const))
  const optionByValue = new Map(options.map(option => [option.value, option] as const))
  const expected = config.expectedValues
  const rows: ConditionRowModel[] = []
  const seen = new Set<string>()
  const addRow = (value: string, option: FacetOption | undefined, labelOverride?: string) => {
    if (seen.has(value)) return
    seen.add(value)
    rows.push({
      value,
      label: labelOverride ?? option?.label ?? selectedByDisplay.get(value)?.label ?? value,
      count: option ? option.count : null,
      state: filterValueState(query, entryKey, value),
    })
  }
  if (hasEverPublished) {
    for (const spec of expected ?? []) {
      const option = optionByValue.get(spec.value)
      addRow(spec.value, option, spec.label)
    }
    if (!expected) {
      for (const option of options) addRow(option.value, option)
      for (const known of keyMap.values()) {
        addRow(known.value, optionByValue.get(known.value), known.label)
      }
    }
  }
  for (const row of selected) addRow(row.display, optionByValue.get(row.display))
  if (entryKey === 'source' && headScope) addRow(headScope, optionByValue.get(headScope))
  // Configured order first, then label — never count ranking.
  const expectedIndex = new Map((expected ?? []).map((spec, index) => [spec.value, index] as const))
  rows.sort((a, b) =>
    (expectedIndex.get(a.value) ?? Number.MAX_SAFE_INTEGER) - (expectedIndex.get(b.value) ?? Number.MAX_SAFE_INTEGER)
    || a.label.localeCompare(b.label),
  )

  const isJournalRoute = location.pathname.startsWith('/journal')
  const visibleRows = (config.hideZero || entryKey === 'effort' || (isJournalRoute && (entryKey === 'tags' || (WQL_TYPED_TAG_KEYS as readonly string[]).includes(entryKey))))
    ? rows.filter(row => (row.count !== null && row.count > 0) || row.state !== 'off')
    : rows

  if (visibleRows.length === 0 && !freeform) return null
  return (
    <SidebarAccordion
      title={config.label ?? meta.label}
      count={visibleRows.length}
      defaultOpen={rows.some(row => row.state !== 'off') || freeform}
      sticky
      buttonClassName="gap-1.5 py-1.5 text-[11px] font-semibold normal-case tracking-normal [&>span:last-child]:h-auto [&>span:last-child]:w-auto [&>span:last-child]:min-w-0 [&>span:last-child]:rounded-sm [&>span:last-child]:px-1 [&>span:last-child]:bg-transparent [&>span:last-child]:text-[10px] [&>span:last-child]:font-semibold [&>span:last-child]:text-muted-foreground"
      bodyClassName="px-6"
    >
      {/* Every current-result value renders — long lists flow through the
          shared scroller, never a per-section viewport. */}
      <ul className="flex flex-col">
        {visibleRows.map(row => (
          <ConditionRow
            key={row.value}
            query={query}
            entryKey={entryKey}
            row={row}
            pending={pending}
            onApply={onApply}
          />
        ))}
      </ul>
      {freeform && (
        <FreeformRow
          entryKey={entryKey}
          placeholder={meta.placeholder}
          pending={pending}
          currentText={liveText ?? undefined}
          onTextChange={value => onApply(setTextCondition(query, value))}
          onApply={value => onApply(setFacetValueState(query, entryKey, value, 'include'))}
        />
      )}
    </SidebarAccordion>
  )
}

function ConditionRow({
  query,
  entryKey,
  row,
  pending,
  onApply,
}: {
  query: string
  entryKey: string
  row: ConditionRowModel
  pending: boolean
  onApply: (wql: string) => void
}) {
  // One row, one control: a native <button> cycles off → include → exclude →
  // off with the plain keyboard contract (Enter/Space) and no checkbox/radio
  // role mimicry. The accessible name announces the action (next state) and
  // the current state; the icon shows the current state.
  const next = TRI_STATES[(TRI_STATES.indexOf(row.state) + 1) % TRI_STATES.length]!
  const Icon = STATE_ICON[row.state]
  const cycleLabel = `${STATE_TITLE[next]} “${row.label}” (currently ${STATE_TITLE[row.state]})`
  const isZero = row.count === 0 && row.state === 'off'
  return (
    <li data-testid={`conditions-row-${entryKey}:${row.value}`} className={clsx('px-1 py-0.5', pending && 'opacity-60', isZero && 'opacity-40')}>
      <div className="flex h-11 items-center gap-1.5">
        <span className={clsx('min-w-0 flex-1 truncate text-xs leading-4', isZero ? 'text-muted-foreground' : 'text-foreground')}>{row.label}</span>
        {row.count !== null && (
          <span className="text-[10px] leading-4 tabular-nums text-muted-foreground">{row.count}</span>
        )}
        <button
          type="button"
          data-testid={`conditions-state-${entryKey}:${row.value}`}
          data-state={row.state}
          onClick={() => onApply(setFacetValueState(query, entryKey, row.value, next))}
          disabled={pending}
          aria-label={cycleLabel}
          title={cycleLabel}
          className={clsx(
            'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-default',
            row.state === 'include' && 'bg-primary/10 text-primary',
            row.state === 'exclude' && 'bg-destructive/10 text-destructive',
            row.state === 'off' && 'text-muted-foreground',
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      </div>
    </li>
  )
}

/** Identifier sections also accept a pasted id (deep links carry ids the
 *  current results may not contain). */
const IDENTIFIER_FREEFORM: Record<string, true> = { note: true, block: true, result: true }

function FreeformRow({
  entryKey,
  placeholder,
  pending,
  currentText,
  onTextChange,
  onApply,
}: {
  entryKey: string
  placeholder: string
  pending: boolean
  /** Current positive `text:` value (text box only) — controlled by the query. */
  currentText?: string
  /** Live text edit → query rewrite (text box only). */
  onTextChange?: (value: string) => void
  onApply: (value: string) => void
}) {
  const [text, setText] = useState('')
  const closeNavigationDrawer = useCloseNavigationDrawer()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    onApply(value)
    setText('')
  }

  if (entryKey === 'text') {
    // Live contains-box: every keystroke rewrites the query's `text:`
    // condition (setTextCondition) — the WQL bar stays the same truth.
    return (
      <div className="px-1 py-1.5">
        <input
          value={currentText ?? ''}
          onChange={event => onTextChange?.(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          data-testid="conditions-input-text"
          className="h-8 w-full min-w-0 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <button
          type="button"
          data-testid="conditions-jump-wql-text"
          onClick={() => {
            closeNavigationDrawer()
            // Jump lands on the header WQL bar when the stream page is
            // mounted; opening it puts the full query in the composer.
            document.querySelector<HTMLElement>('[data-testid="stream-query-bar"]')?.click()
          }}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <SquarePen aria-hidden="true" className="size-3" />
          Edit in WQL bar
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-1 px-1 py-1.5">
      <input
        value={text}
        onChange={event => setText(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={`conditions-input-${entryKey}`}
        disabled={pending}
        className="h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      <button
        type="submit"
        aria-label={`Add ${placeholder}`}
        data-testid={`conditions-add-${entryKey}`}
        disabled={pending || !text.trim()}
        className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <Plus aria-hidden="true" className="size-3.5" />
      </button>
    </form>
  )
}
