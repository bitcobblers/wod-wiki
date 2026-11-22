/**
 * FacetProperties — guided facet filter controls for a stream surface, hosted
 * inside StreamQueryBar's `+ Filter` popover on desktop and the mobile Filter
 * Sheet.
 *
 * One accordion of every `{}` condition the CURRENT query's target supports
 * (`wqlFilterKeys(target,'find')`), with values and counts derived from the
 * committed full result set published by QueriableStreamView (one execution
 * per query change — the facets never re-run the query). Every value is a
 * stable single row with explicit Include / Exclude / Off pills backed by the
 * pure model (`filterValueState` / `setFacetValueState`): edits go through
 * occurrence-exact clause edits so source scope, window, grouping, pipes,
 * joins and sibling filters survive.
 */

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import clsx from 'clsx'
import { Plus } from 'lucide-react'

import {
  isFindQuery,
  notebookSlugOfSourceId,
  parseQuery,
  WQL_TYPED_TAG_KEYS,
  wqlFilterKeys,
  type ParsedFindQuery,
} from '@bitcobblers/wod-wiki-wql'
import { getClauseMeta } from '@bitcobblers/wod-wiki-ui'

import { SidebarAccordion } from '@/components/organisms/layout/SidebarAccordion'
import { TEST_IDS } from '@/lib/testIds'
import { storageService } from '@/services/storage'

import { useAppliedRouteWqlConfig } from '../../lib/routeWqlConfig'
import { resolveStreamProfile } from '../../views/stream/streamProfile'
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
 * answers per-note lookups (UUID ids carry no path stem), and each corpus
 * note's notebook aggregates its member notes' rows so `tags:` facets
 * resolve on notebook results too. */
async function loadTagMembership(): Promise<TagMembership> {
  const [byNote, allNotes] = await Promise.all([
    storageService.getNoteTagLabelsBatch(),
    storageService.getAllNotes(),
  ])
  for (const note of allNotes) {
    const labels = byNote.get(note.id)
    const slug = notebookSlugOfSourceId(note.sourceId)
    if (!slug || !labels?.length) continue
    const rows = byNote.get(slug)
    if (rows) {
      for (const row of labels) {
        if (!rows.some(r => r.label === row.label)) rows.push(row)
      }
    } else {
      byNote.set(slug, labels.map(({ label, type }) => ({ label, type })))
    }
  }
  return byNote
}

/** Push a query-only navigation: every selection is its own history entry;
 *  unrelated URL params ride along untouched. */
export function navigateToQuery(
  location: Location,
  navigate: (to: string) => void | Promise<void>,
  wql: string,
): void {
  const params = new URLSearchParams(location.search)
  params.set('q', wql)
  void navigate(`${location.pathname}?${params.toString()}`)
}

export interface FacetPropertiesProps {
  /** Controlled WQL query (falls back to URL `?q=` or route profile default). */
  query?: string
  /** Controlled query writer (falls back to `navigateToQuery`). */
  onQueryChange?: (wql: string) => void
  /** Optional container classes. */
  className?: string
  /** Optional header text; pass `null` when hosted inside a titled popover. */
  heading?: string | null
}

/**
 * Facet properties for the CURRENT stream surface. Supports both controlled
 * (`query` + `onQueryChange` inside StreamQueryBar's `+ Filter` popover /
 * mobile filter sheet) and URL-driven standalone usage.
 */
export function FacetProperties({
  query: controlledQuery,
  onQueryChange,
  className,
  heading = 'Filters',
}: FacetPropertiesProps = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const published = useStreamResults()
  const rawQ = controlledQuery !== undefined ? controlledQuery : urlQuery(location)
  const defaultProfile = useAppliedRouteWqlConfig(resolveStreamProfile(location.pathname))
  const effectiveQuery = rawQ && !parseQuery(rawQ).error ? rawQ : defaultProfile!.defaultWql
  const parsed = useMemo(() => parseQuery(effectiveQuery), [effectiveQuery])
  const parsedFind = useMemo(
    () => (!parsed.error && isFindQuery(parsed) ? parsed : null),
    [parsed],
  )

  const entries = published && published.pathname === location.pathname && published.query === effectiveQuery
    ? published.entries
    : null

  const [committed, setCommitted] = useState<StreamResultSnapshot | null>(null)
  useEffect(() => {
    if (published && published.pathname === location.pathname) setCommitted(published)
  }, [published, location.pathname])
  const pending = entries === null && committed !== null && committed.pathname === location.pathname
  const facetEntries = entries ?? (pending ? committed!.entries : EMPTY_ENTRIES)

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
  const apply = onQueryChange ?? ((wql: string) => navigateToQuery(location, navigate, wql))
  const headScope = parsedFind ? headSourceScope(parsedFind) : null

  const orderedKeys = useMemo(
    () => sectionKeys
      .filter(key => conditionSectionConfig(key).enabled !== false)
      .sort((a, b) => (conditionSectionConfig(a).order ?? 0) - (conditionSectionConfig(b).order ?? 0)),
    [sectionKeys],
  )

  if (!parsedFind) return null
  return (
    <div className={clsx('flex flex-col gap-1', className)} aria-busy={pending || undefined} data-testid="l3-filters">
      {heading !== null && (
        <div className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {heading}
        </div>
      )}
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
    for (const entry of entries) bump(entry.id, entry.title)
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

// ── Tri-state condition rows (explicit Include / Exclude / Off pills) ────────

const PILL_OPTIONS: readonly {
  state: FilterValueState
  label: string
  testIdPrefix: string
}[] = [
  { state: 'include', label: 'Include', testIdPrefix: TEST_IDS.FACET_PILL_INCLUDE },
  { state: 'exclude', label: 'Exclude', testIdPrefix: TEST_IDS.FACET_PILL_EXCLUDE },
  { state: 'off', label: 'Off', testIdPrefix: TEST_IDS.FACET_PILL_OFF },
]

/** One stable row: a value present in the current options, currently
 *  selected, or both — rendered once with explicit Include / Exclude / Off pills. */
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
  const expectedIndex = new Map((expected ?? []).map((spec, index) => [spec.value, index] as const))
  rows.sort((a, b) =>
    (expectedIndex.get(a.value) ?? Number.MAX_SAFE_INTEGER) - (expectedIndex.get(b.value) ?? Number.MAX_SAFE_INTEGER)
    || a.label.localeCompare(b.label),
  )

  const isJournalRoute = location.pathname.startsWith('/journal') || location.pathname.startsWith('/day')
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
      buttonClassName="gap-1.5 py-2 max-lg:min-h-11 text-xs font-semibold normal-case tracking-normal text-foreground [&>span:last-child]:h-auto [&>span:last-child]:w-auto [&>span:last-child]:min-w-0 [&>span:last-child]:rounded-sm [&>span:last-child]:px-1.5 [&>span:last-child]:bg-transparent [&>span:last-child]:text-[11px] [&>span:last-child]:font-semibold [&>span:last-child]:text-muted-foreground"
      bodyClassName="px-2 pb-1"
    >
      <ul className="flex flex-col gap-0.5">
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
  const isZero = row.count === 0 && row.state === 'off'
  return (
    <li
      data-testid={`conditions-row-${entryKey}:${row.value}`}
      className={clsx('rounded-md px-1 py-0.5', pending && 'opacity-70')}
    >
      <div className="flex min-h-9 max-lg:min-h-11 flex-wrap items-center gap-1.5">
        <span
          className={clsx(
            'min-w-0 flex-1 truncate text-xs leading-4',
            isZero ? 'text-muted-foreground' : 'font-medium text-foreground',
          )}
        >
          {row.label}
        </span>
        {row.count !== null && (
          <span className="shrink-0 text-[11px] leading-4 tabular-nums text-muted-foreground">
            {row.count}
          </span>
        )}
        <div
          role="group"
          aria-label={`Filter state for ${row.label}`}
          className="inline-flex shrink-0 items-center rounded-md border border-border/70 bg-muted/40 p-0.5"
        >
          {PILL_OPTIONS.map((pill) => {
            const active = row.state === pill.state
            return (
              <button
                key={pill.state}
                type="button"
                data-testid={`${pill.testIdPrefix}-${entryKey}:${row.value}`}
                data-state={active ? 'active' : 'inactive'}
                aria-pressed={active}
                aria-label={`${pill.label} ${row.label}`}
                disabled={pending}
                onClick={() => {
                  const targetState: FilterValueState =
                    pill.state === 'off'
                      ? 'off'
                      : active
                        ? 'off'
                        : pill.state
                  onApply(setFacetValueState(query, entryKey, row.value, targetState))
                }}
                className={clsx(
                  'inline-flex cursor-pointer items-center justify-center rounded px-2 py-0.5 text-[11px] font-semibold max-lg:min-h-11 max-lg:px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
                  active && pill.state === 'include' && 'bg-primary text-primary-foreground shadow-xs',
                  active && pill.state === 'exclude' && 'bg-destructive text-destructive-foreground shadow-xs',
                  active && pill.state === 'off' && 'bg-background text-foreground shadow-xs',
                  !active && 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {pill.label}
              </button>
            )
          })}
        </div>
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
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    onApply(value)
    setText('')
  }

  if (entryKey === 'text') {
    return (
      <div className="px-1 py-1.5">
        <input
          value={currentText ?? ''}
          onChange={event => onTextChange?.(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          data-testid="conditions-input-text"
          className="h-9 max-lg:min-h-11 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-1.5 px-1 py-1.5">
      <input
        value={text}
        onChange={event => setText(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={`conditions-input-${entryKey}`}
        disabled={pending}
        className="h-9 max-lg:min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="submit"
        aria-label={`Add ${placeholder}`}
        data-testid={`conditions-add-${entryKey}`}
        disabled={pending || !text.trim()}
        className="flex size-9 max-lg:min-h-11 max-lg:min-w-11 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <Plus aria-hidden="true" className="size-3.5" />
      </button>
    </form>
  )
}
