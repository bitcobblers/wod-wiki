/**
 * QueriableStreamView — unified deep queriable stream across notes, efforts, and results (Ticket 003).
 *
 * Consolidates LibraryPage and EffortsCatalogPage into a single reusable view:
 * 1. Takes a StreamProfile (route, default WQL query, scope lock, level).
 * 2. Connects to StreamQueryEngine for unified execution across content, efforts, and rows.
 * 3. Renders either the progressive Date Group Stream or the Property Table based on ViewSettings.
 * 4. Provides a discrete "View Settings" modal dialog (sliders button in action bar).
 * 5. Preserves all sticky boundaries, DOM batching, and search palette integrations.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloudDownload,
  RefreshCw,
  Rss,
  Settings2,
  TriangleAlertIcon,
} from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@bitcobblers/wod-wiki-ui/primitives";
import { BUILTIN_NOTEBOOKS, isSystemReadOnlyNotebook } from '@bitcobblers/wod-wiki-core'
import { listWritableNotebooks, type WritableNotebookTarget } from '@/components/molecules/PublicationPill'
import { createUserNotebookLanding } from '@bitcobblers/wod-wiki-engine'
import { FolderPlus, Loader2 } from 'lucide-react'
import { queryService } from '@/services/queryService'
import { onResultSaved } from '@/services/resultRecorder'
import { useFeedImportPending, useFeedLibraryMissing, useFeedReadiness } from '@/services/feed/feedReadiness'
import { subscribeAppEffortRegistry } from '@/services/effortRegistry'
import { defaultFeedSources, subscribeFeed, syncFeedSource, type FeedSyncProgress } from '@/services/feed/feedSync'
import { canonicalNotebookSlug, listFeedSources, feedSourceById } from '@/services/feed/feedSources'
import { flushFeedStatePersistence, isFeedSubscribed, subscribeFeedSubscriptions } from '@/services/feed/feedSubscriptions'
import { toast } from '@/hooks/use-toast'
import { TEST_IDS } from '@/lib/testIds'
import { getSyncActivity, subscribeSyncActivity } from '@/services/syncActivity'
import { CreateNotebookDialog } from '@/components/organisms/notebook/CreateNotebookDialog'
import type { Notebook } from '@/types/notebook'
import { notebookService } from '@/hooks/useBrowserServices'
import { subscribeNotebooks } from '@/services/NotebookService'
import { removeRecentVisit } from '../../nav/panels/ConditionsNavPanel'
import { ProgressBar } from '../../components/atoms/ProgressBar'
import { parseQuery, isFindQuery, isPipelineQuery, notebookSlugFromId, serialize, type NoteUsageCounts, type ParsedFindQuery } from '@bitcobblers/wod-wiki-engine'
import { suggestWqlSyntaxHint, wqlFilterKeys, wqlGroupingDimensions } from '@bitcobblers/wod-wiki-wql'
import type { WqlExecutor } from '@bitcobblers/wod-wiki-ui'
import { toggleGroupDimension } from '../../nav/panels/conditionsFacets'
import { createPortal } from 'react-dom'
import {
  StickyPageHeader,
  StickyGroupHeader,
  useStickyBoundaryOffset,
  useMobileQuerySlot,
} from '@/panels/page-shells'
import { useIsMobile } from '../../hooks/useIsMobile'
import { StreamQueryBar, openStreamQueryEditor } from './StreamQueryBar'
import type { Entry } from '../../lib/entryMapper'
import {
  groupEntriesByDimension,
  parseGroupingDimensions,
} from '../../lib/entryGrouping'
import {
  resolveFallbackGroupDimension,
  resolveGroupByOptions,
} from '../../lib/groupByOptions'
import { queryConfigSurface } from '../../lib/queryConfigSurfaces'
import { QuerySettingsDialog } from '../../components/organisms/wql/QuerySettingsDialog'
import { defaultStreamQueryEngine, StreamQueryEngine } from '../../lib/entrySearch'
import { publishStreamResults } from './streamResults'
import { useNav } from '../../nav/NavContext'
import { ResponsiveActions } from '../../nav/ResponsiveActions'
import { cloneRemotePreviewNoteToNotebook, playgroundFeedCatalogStore } from '@/services/feed/feedCatalog'
import { toggleNotebookSubscription, unsubscribeFeedSource } from '@/services/feed/feedSync'
import { setNotebookPublic } from '@bitcobblers/wod-wiki-engine'
import { storage, storageBackend } from '@/services/storage'
import { exportFeedRepositoryZip, publishSelfHostedFeed } from '@/services/ExportImportService'
import { FeedIntakeBanner } from '../notebook-gallery/FeedIntakeBanner'
import { OUTCOME_LABEL } from '../../pages/SyncSection'
import { notebookPath, ROUTE_PATTERNS } from '../../lib/routes'
import { MobileNewEntryCombo, resolveNewEntryRoute, routeSupportsCreation } from '../../pages/shared/NewEntryCombo'
import { salvagePlainTextQuery, useComposerQueryState } from '../../hooks/useComposerQueryState'
import { useViewSettings, LAYOUT_MODES, type LayoutMode } from '../../lib/viewSettingsStorage'
import { LIBRARY_BATCH_SIZE, useBatchedItems, type BatchedItems } from '../../hooks/useBatchedItems'
import { todayKey } from '@/lib/dateFormat'
import { withoutWindow, withGroupBy } from '../../lib/wqlEdits'
import { LibraryRow } from '../library/LibraryRow'
import { PropertyTable } from './PropertyTable'
import { StreamFeed } from './StreamFeed'
import { CreateJournalNoteDialog } from '../../components/organisms/journal/CreateJournalNoteDialog'
import { CalendarAgendaView } from './CalendarAgendaView'
import { CalendarPlannerView } from './CalendarPlannerView'
import { journalNotes } from '../../services/journalNotes'
import { journalSchedule, subscribeSchedule } from '../../services/journalSchedule'
import { createJournalNoteFromWorkout } from '../../services/journalWorkout'
import { ensurePlaygroundEntry } from '../../services/createPlaygroundPage'
import { addEntryToTodayInput } from '../../lib/addToToday'
import { startEntryRun } from '../../lib/entryRun'
import { playgroundPath } from '../../lib/routes'
import { StreamViewPopover } from './StreamViewPopover'
import { SchedulePeekDrawer } from './SchedulePeekDrawer'
import { type OverlayFilterMode } from './CalendarChrome'
import type { Note as StoredNote, Session as StoredSession, ScheduleItem } from '@/types/storage'
import { storageService } from '@/services/storage'
import { toEntry } from '../../lib/entryMapper'
import { registerNotebookTitle, type StreamProfile } from './streamProfile'
import { splitReadmeQueries, hasReadmeQuery } from './readmeWql'
import { ReadmeQueryBlock } from './ReadmeQueryBlock'
import { QueryToDashboardDialog } from '../analytics/QueryToDashboardDialog'
import { CanvasProse } from '../../canvas/CanvasProse'
import { seedNoteId } from '@/services/feed/FeedImporter'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { useSeedContent } from '@/services/content/seedContent'
import { registerActiveStreamBridge, setSurfaceBusy } from '@/agent/surfaceBridges'

const contentProvider = new IndexedDBContentProvider()

function BatchingSentinel({
  batch,
  testId = 'stream-load-more',
}: {
  batch: BatchedItems<unknown>
  testId?: string
}) {
  if (!batch.hasMore) return null
  return (
    <div
      ref={batch.sentinelRef}
      className="px-6 py-4 text-center"
      data-testid={testId}
    >
      {/* WW-023: idle sentinel is an interactive control, never "Loading" —
          the run may have fully settled; scrolling still auto-grows via the
          observer on this same div. */}
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
        data-testid={`${testId}-button`}
        onClick={() => batch.growTo(batch.visible.length + LIBRARY_BATCH_SIZE)}
      >
        Show more ({(batch.total - batch.visible.length).toLocaleString()} remaining)
      </button>
    </div>
  )
}

/** WW-034 — convert plain-text search terms (no WQL operators like `:` or
 *  `{`) into a `:${target}{text:...}` query so typing e.g. `kettlebell` in
 *  the WQL bar works smoothly instead of failing as invalid syntax. */
export function plainTextFallbackQuery(rawInput: string, target: string): string | null {
  return salvagePlainTextQuery(rawInput, target)
}

/** Host-owned execution debounce for stream queries — the composer resolves
 *  drafts synchronously; only the run coalesces (existing 150ms behavior). */
const STREAM_EXECUTE_DEBOUNCE_MS = 150

/** Trailing debounce for coalescing bursty `syncActivity.result` commits into
 *  a single stream re-query (WW-036). */
const SYNC_ACTIVITY_DEBOUNCE_MS = 300

/** `/notebook/:slug` — the single-notebook landing route (WW-032). */
const NOTEBOOK_PATH_RE = /^\/notebook\/([^/]+)\/?$/

/** Reserved slugs that always resolve, even before any notebook record is
 *  registered or the landing note exists (seed corpus may not have landed). */
const BUILTIN_NOTEBOOK_SLUGS = ['journal', 'playground', 'defaults', 'custom', 'guides', 'efforts', 'equipment', 'dashboards']

/** Inline notice sync label — same phase vocabulary as the Settings sync surface. */
function feedSyncLabel(event: FeedSyncProgress): string {
  switch (event.phase) {
    case 'checking': return `Checking ${event.sourceLabel}…`
    case 'fetching': return `Downloading ${event.chunkId ?? 'library'}…`
    case 'applying': return `Importing ${event.chunkId ?? 'library'}…`
    case 'committed': return `Committed ${event.chunkId ?? 'chunk'}`
    case 'finalizing': return 'Finalizing checkpoints…'
    case 'finished': return event.error ?? OUTCOME_LABEL[event.outcome]
  }
}

/** Stable identity of one parsed filter — key, polarity, and value set. */
function filterSignature(f: ParsedFindQuery['filters'][number]): string {
  return `${f.negate ? '!' : ''}${f.key}=${f.values.map(v => `${v.wildcard ? '*' : ''}${v.value}`).sort().join('|')}`
}

/** The filters a query's AUTHOR wrote. The parser injects the head's scope
 *  and plane type into the same filter list as authored clauses (wql.ts head
 *  injection) and keeps no provenance marker, so the route default is parsed
 *  and its implied filters subtracted as a multiset — a head-injected
 *  `type:feed`/`source:` can then never surface as a removable remedy, while
 *  an authored `text:` clause stays one. */
function userAuthoredFilters(
  filters: ParsedFindQuery['filters'],
  implied: ParsedFindQuery['filters'],
): ParsedFindQuery['filters'] {
  const budget: Record<string, number> = {}
  for (const f of implied) {
    const sig = filterSignature(f)
    budget[sig] = (budget[sig] ?? 0) + 1
  }
  return filters.filter(f => {
    const sig = filterSignature(f)
    const left = budget[sig] ?? 0
    budget[sig] = left - 1
    return left <= 0
  })
}

const TARGET_NOUNS: Record<string, { singular: string; plural: string }> = {
  note: { singular: 'note', plural: 'notes' },
  block: { singular: 'block', plural: 'blocks' },
  effort: { singular: 'effort', plural: 'efforts' },
  session: { singular: 'session', plural: 'sessions' },
  segment: { singular: 'segment', plural: 'segments' },
  event: { singular: 'event', plural: 'events' },
  notebook: { singular: 'notebook', plural: 'notebooks' },
  page: { singular: 'page', plural: 'pages' },
  tag: { singular: 'tag', plural: 'tags' },
  equipment: { singular: 'equipment item', plural: 'equipment items' },
  feed: { singular: 'feed', plural: 'feeds' },
}

/** Compact query status strip beneath the composer (desktop) / top of the
 *  stream (mobile): calm athlete counts at rest, escalating to full query
 *  diagnostics (`:target`, `matched of total`, `applied/ignored`, advisories,
 *  and syntax hints) when custom filters, advisories, or errors are active. */
function StreamQueryStatus({
  error,
  syntaxHint,
  target,
  matched,
  total,
  countsPending,
  applied,
  ignored,
  advisories,
  groupDims,
  groupingSource,
  hasAppliedFilters,
  isCustomQuery,
  itemNoun,
}: {
  error: string | null
  /** WW-034 — parse-failure guidance rendered under the invalid-query line. */
  syntaxHint: string | null
  target: string | null
  matched: number
  total: number
  countsPending: boolean
  applied: number
  ignored: number
  advisories: readonly string[]
  groupDims: string[]
  groupingSource: string
  hasAppliedFilters: boolean
  isCustomQuery: boolean
  itemNoun: { singular: string; plural: string }
}) {
  const showDiagnostics =
    Boolean(error) ||
    hasAppliedFilters ||
    isCustomQuery ||
    ignored > 0 ||
    advisories.length > 0

  if (!showDiagnostics) {
    return (
      <div
        role="status"
        data-testid="stream-query-status"
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
      >
        <span data-testid="stream-query-counts">
          {countsPending
            ? 'Searching…'
            : `${matched.toLocaleString()} ${matched === 1 ? itemNoun.singular : itemNoun.plural}`}
        </span>
        {groupDims.length > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span data-grouping-source={groupingSource}>
              by {groupDims.join(', ')}
            </span>
          </>
        )}
      </div>
    )
  }

  return (
    <div
      role="status"
      data-testid="stream-query-status"
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
    >
      {error ? (
        <span className="font-semibold text-destructive">Invalid query — showing previous results</span>
      ) : target ? (
        <span className="font-mono">:{target}</span>
      ) : null}
      <span aria-hidden="true">·</span>
      <span data-testid="stream-query-counts">
        {countsPending ? 'Searching…' : `${matched} of ${total}`}
      </span>
      <span aria-hidden="true">·</span>
      <span data-testid="stream-query-filters">
        {applied} applied{ignored > 0 ? `, ${ignored} ignored` : ''}
      </span>
      {groupDims.length > 0 && (
        <>
          <span aria-hidden="true">·</span>
          {/* WW-004/#5: the internal precedence enum never renders — it rides the
              data attribute for tests and diagnostics only. */}
          <span data-grouping-source={groupingSource}>
            by {groupDims.join(', ')}
          </span>
        </>
      )}
      {advisories.map(advisory => (
        <p key={advisory} className="w-full break-words text-amber-700 dark:text-amber-400">
          {advisory}
        </p>
      ))}
      {error && syntaxHint && (
        <p className="w-full break-words text-muted-foreground" data-testid="stream-query-syntax-hint">
          {syntaxHint}
        </p>
      )}
    </div>
  )
}

export interface QueriableStreamViewProps {
  /** Configuration profile for this stream route. */
  profile: StreamProfile
  /** Optional custom action buttons rendered in the header action bar. */
  actions?: ReactNode
  /** Optional custom query engine (defaults to defaultStreamQueryEngine). */
  queryEngine?: StreamQueryEngine
  /** Optional Add-to-today handler for cards. */
  onAddToToday?: (entry: Entry) => void
  /** Register a getter and apply callback for the LIVE composer draft while
   *  this view is mounted (global ⌘K / ⌘/ palette). */
  registerStreamDraft?: (getDraft: () => string | null, applyDraft?: (wql: string) => void) => () => void
  /** Dependency overrides for tests (all default to production modules). */
  deps?: {
    /** Engine for README `[heading](:query)!` embeds (defaults to the shared engine). */
    readmeQueryEngine?: typeof defaultStreamQueryEngine
  }
}

export function QueriableStreamView({
  profile,
  actions,
  queryEngine,
  deps,
  onAddToToday,
  registerStreamDraft,
}: QueriableStreamViewProps) {
  const navigate = useNavigate()
  const location = useLocation()
  // Local-first feed readiness: the stream queries local IndexedDB immediately
  // even while `feedReadiness === 'preparing'`, staying in the loading state
  // only when zero local entries exist so cold boot never flashes an empty state.
  const feedReadiness = useFeedReadiness()
  const feedImportPending = useFeedImportPending()
  const libraryMissing = useFeedLibraryMissing()
  // Inline community sync from the core-only notice (the probe above is
  // mount-only, so a successful sync suppresses it via librarySynced).
  const [librarySynced, setLibrarySynced] = useState(false)
  const [feedSyncRunning, setFeedSyncRunning] = useState(false)
  const [feedSyncEvent, setFeedSyncEvent] = useState<FeedSyncProgress | null>(null)
  const [feedSyncError, setFeedSyncError] = useState<string | null>(null)
  // Subscribed library sources — the notice's real sync worklist. "Library"
  // means exactly what the coverage probe means by it: a source that does
  // NOT auto-import (autoImport === false — readFeedCoverage's own rule);
  // the bundled core auto-imports at boot and must never satisfy the notice
  // while the community library the page needs is still missing.
  // useSyncExternalStore needs a referentially stable snapshot, so the ids
  // cross as one joined string; splitting is per-render and cheap.
  // Subscribing in the manager drawer updates this live.
  const subscribedIdsKey = useSyncExternalStore(subscribeFeedSubscriptions, () =>
    defaultFeedSources()
      .filter(s => s.autoImport === false && isFeedSubscribed(s.id))
      .map(s => s.id)
      .join('\n'),
  )
  const subscribedLibraryIds = useMemo(
    () => (subscribedIdsKey ? subscribedIdsKey.split('\n') : []),
    [subscribedIdsKey],
  )
  // Synchronize composer state with URL
  const { query, setQuery, urlQueryError } = useComposerQueryState({
    defaultQuery: profile.defaultWql,
    legacy: profile.legacy,
  })

  // Publish the live draft and apply handler to the host's ⌘K/⌘/ seam while mounted.
  useEffect(() => registerStreamDraft?.(() => query, setQuery), [registerStreamDraft, query, setQuery])

  // Per-route view settings (layout + field visibility)
  const { settings, setLayout: setPersistedLayout, toggleField, setGroupBy } = useViewSettings(
    profile.route,
    profile.level,
    profile.defaultLayout,
  )

  /**
   * The layouts this surface offers. The calendar layouts need dated
   * entries, so a route without dates (notebooks, efforts, tags…) never
   * offers them — and a stored calendar layout falls back to Cards there
   * rather than rendering an empty time axis.
   */
  const availableLayouts = useMemo<readonly LayoutMode[]>(
    () => (profile.calendarCapable ? LAYOUT_MODES : LAYOUT_MODES.filter(mode => mode !== 'agenda' && mode !== 'planner')),
    [profile.calendarCapable],
  )
  const urlLayoutParam = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('layout')
    return raw && availableLayouts.includes(raw as LayoutMode) ? (raw as LayoutMode) : null
  }, [location.search, availableLayouts])
  const layout = urlLayoutParam ?? (availableLayouts.includes(settings.layout) ? settings.layout : 'cards')
  const setLayout = useCallback(
    (nextLayout: LayoutMode) => {
      setPersistedLayout(nextLayout)
      const params = new URLSearchParams(location.search)
      if (nextLayout === (profile.defaultLayout ?? 'cards')) {
        params.delete('layout')
      } else {
        params.set('layout', nextLayout)
      }
      const nextSearch = params.toString()
      void navigate(
        { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
        { replace: true },
      )
    },
    [setPersistedLayout, location.pathname, location.search, navigate, profile.defaultLayout],
  )

  // This page's own query settings — the landing default, the Where-stored
  // and Group-By favorites and the saved shortcuts, edited where the query
  // lives. Only surfaces WITH a configurable surface offer it (detail routes
  // resolve a profile per item, so they keep their in-code defaults).
  const querySettingsSurface = queryConfigSurface(profile.route)
  const [querySettingsOpen, setQuerySettingsOpen] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)

  const [entries, setEntries] = useState<Entry[]>([])
  const [runtimeQueryError, setRuntimeQueryError] = useState<string | null>(null)

  // The calendar layouts start a new entry on a given day; the dialog lives
  // here so the calendar never owns a creation flow of its own.
  const [createOnDate, setCreateOnDate] = useState<string | null>(null)
  const [overlayMode, setOverlayMode] = useState<OverlayFilterMode>('all')
  const [inspectedEntry, setInspectedEntry] = useState<Entry | null>(null)
  const [inspectedDay, setInspectedDay] = useState<string | null>(null)
  const handleInspectEntry = useCallback((entry: Entry) => {
    setInspectedDay(null)
    setInspectedEntry(entry)
  }, [])
  const handleInspectDay = useCallback((dateKey: string) => {
    setInspectedEntry(null)
    setInspectedDay(dateKey)
  }, [])
  const handleClosePeek = useCallback(() => {
    setInspectedEntry(null)
    setInspectedDay(null)
  }, [])
  const [selectedBatchNoteIds, setSelectedBatchNoteIds] = useState<Set<string>>(() => new Set())
  const [batchScheduleDate, setBatchScheduleDate] = useState(() => todayKey())
  const [batchScheduling, setBatchScheduling] = useState(false)
  const urlMonthParam = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('month')
    return raw && /^\d{4}-\d{2}$/.test(raw) ? raw : undefined
  }, [location.search])
  const handleMonthChange = useCallback(
    (nextMonth: string) => {
      const params = new URLSearchParams(location.search)
      params.set('month', nextMonth)
      const nextSearch = params.toString()
      void navigate(
        { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
        { replace: true },
      )
    },
    [location.pathname, location.search, navigate],
  )
  // The run's own stage counts (scope population vs matches) — captured from
  // the engine's stage callback, never a second scan.
  const [stages, setStages] = useState<{ selected: number; matched: number } | undefined>(undefined)
  // The committed run's query-leg `by {}` dims — stored together with the
  // results they grouped; null when that run carried no query grouping.
  const [queryRunDims, setQueryRunDims] = useState<string[] | null>(null)
  const [settledRoute, setSettledRoute] = useState<string | null>(null)
  const hasSettledRun = settledRoute === profile.route
  const [shelfOpen, setShelfOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [queryPending, setQueryPending] = useState(false)
  const effectiveQuery = useMemo(() => plainTextFallbackQuery(query, profile.target) ?? query, [query, profile.target])
  const parsed = useMemo(() => parseQuery(effectiveQuery), [effectiveQuery])
  const streamBusy = loading || queryPending || (!hasSettledRun && !parsed.error)
  useEffect(() => setSurfaceBusy(streamBusy), [streamBusy])
  useEffect(() => {
    return registerActiveStreamBridge({
      route: profile.route,
      defaultQuery: profile.defaultWql,
      query,
      loading: streamBusy,
      layout,
      availableLayouts,
      groupBy: settings.groupBy,
      month: urlMonthParam,
      overlayMode,
      setQuery,
      setLayout: (nextLayout) => {
        if (availableLayouts.includes(nextLayout as LayoutMode)) {
          setLayout(nextLayout as LayoutMode)
        }
      },
      setGroupBy,
      setMonth: handleMonthChange,
      setOverlayMode,
    })
  }, [profile.route, profile.defaultWql, query, streamBusy, layout, availableLayouts, settings.groupBy, urlMonthParam, overlayMode, setQuery, setLayout, setGroupBy, handleMonthChange, setOverlayMode])
  const [actionError, setActionError] = useState<string | null>(null)
  // Mobile: the query bar portals into the app navbar (no page header).
  const isMobile = useIsMobile()
  const mobileSlot = useMobileQuerySlot()

  const isNotebooksRoute = profile.route === '/notebooks'
  const isFeedsRoute = profile.route === '/feeds'
  const feedIntakeParam = useMemo(
    () => (isNotebooksRoute || isFeedsRoute) ? new URLSearchParams(location.search).get('feed') : null,
    [isNotebooksRoute, isFeedsRoute, location.search],
  )
  const dismissFeedIntake = useCallback((nextQuery?: string) => {
    const params = new URLSearchParams(location.search)
    params.delete('feed')
    params.delete('q')
    const rest = params.toString()
    const qPart = typeof nextQuery === 'string' && nextQuery.length > 0 ? `q=${nextQuery}` : ''
    const search = [rest, qPart].filter(Boolean).join('&')
    void navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })
  }, [navigate, location.pathname, location.search])
  useEffect(() => {
    if (!feedIntakeParam) return
    const isKnown = listFeedSources().some((s) => s.id === feedIntakeParam)
    if (isKnown) {
      dismissFeedIntake(`:notebook{feed:${feedIntakeParam},subscribed:true,false}`)
    }
  }, [feedIntakeParam, dismissFeedIntake])
  const openLibraryManager = useCallback(() => {
    void navigate(ROUTE_PATTERNS.settingsSync)
  }, [navigate])
  const [createNotebookOpen, setCreateNotebookOpen] = useState(false)
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null)
  const handleCreateNotebook = useCallback(async (name: string, description: string, icon: string) => {
    const created = await notebookService.create(name, description, icon)
    setSavedTick(t => t + 1)
    if (created?.slug) {
      navigate(notebookPath(created.slug))
    }
    return created
  }, [navigate])
  const handleSaveEditedNotebook = useCallback(async (nb: Notebook, name: string, description: string, icon: string) => {
    try {
      const updated = await notebookService.update(nb.id, { name, description, icon })
      setSavedTick(t => t + 1)
      return updated
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [])
  const handleOpenEditNotebook = useCallback(async (entry: Entry) => {
    const targetId = entry.notebookId ?? entry.id
    const all = await notebookService.getAllNotebooks().catch(() => [] as Notebook[])
    const found = all.find(nb => nb.notebookId === targetId || nb.id === targetId || nb.slug === entry.sourceNotebook)
    if (found) {
      setEditingNotebook(found)
      setCreateNotebookOpen(true)
    }
  }, [])
  const [pendingDeleteNotebook, setPendingDeleteNotebook] = useState<Entry | null>(null)
  const [deletingNotebook, setDeletingNotebook] = useState(false)
  const handleDeleteNotebookEntry = useCallback((entry: Entry) => {
    setActionError(null)
    setPendingDeleteNotebook(entry)
  }, [])
  const handleConfirmDeleteNotebook = useCallback(async () => {
    if (!pendingDeleteNotebook || deletingNotebook) return
    const targetId = pendingDeleteNotebook.notebookId ?? pendingDeleteNotebook.id
    const slug = pendingDeleteNotebook.sourceNotebook
    setActionError(null)
    setDeletingNotebook(true)
    try {
      await notebookService.delete(targetId)
      if (slug) removeRecentVisit(notebookPath(slug))
      setPendingDeleteNotebook(null)
      setSavedTick(t => t + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
      setPendingDeleteNotebook(null)
    } finally {
      setDeletingNotebook(false)
    }
  }, [pendingDeleteNotebook, deletingNotebook])
  const createNotebookDialog = isNotebooksRoute ? (
    <CreateNotebookDialog
      open={createNotebookOpen}
      onOpenChange={(open) => {
        setCreateNotebookOpen(open)
        if (!open) setEditingNotebook(null)
      }}
      onCreate={handleCreateNotebook}
      notebook={editingNotebook}
      onSave={handleSaveEditedNotebook}
    />
  ) : null

  // Playground scope: the canonical filter source:playground (authored as
  // :playground{...}). In this scope the "Notebook Sessions" shelf would
  // mislabel undated playground entries — they render in the explicit
  // 'Undated' group instead.
  const isPlaygroundScope = useMemo(() => {
    if (parsed.error || isPipelineQuery(parsed)) return false
    return parsed.filters.some(
      f => f.key === 'source' && !f.negate && f.values.some(v => v.value === 'playground'),
    )
  }, [parsed])
  const notebookStreamSlug = useMemo(() => {
    if (profile.notebookSlug) return profile.notebookSlug
    if (profile.route.startsWith('/notebook/')) {
      const slug = profile.route.slice('/notebook/'.length)
      if (slug && !slug.includes('/')) return slug
    }
    if (!parsed.error && isFindQuery(parsed)) {
      const nb = parsed.filters.find(f => f.key === 'notebook' && !f.negate)?.values[0]?.value
      if (nb) return notebookSlugFromId(nb)
    }
    return undefined
  }, [profile, parsed])
  const targetFeedFilter = useMemo(() => {
    if (parsed.error || isPipelineQuery(parsed)) return null
    return parsed.filters.find(f => f.key === 'feed' && !f.negate)?.values[0]?.value ?? null
  }, [parsed])

  const seedFiles = useSeedContent()
  const [readmeContent, setReadmeContent] = useState<string | null>(null)
  // WQL embed links (`[heading](:query)!`) — when any are present they
  // override the notebook's default item stream below the readme.
  const readmeSegments = useMemo(
    () => (readmeContent ? splitReadmeQueries(readmeContent) : []),
    [readmeContent],
  )
  const readmeOverride = hasReadmeQuery(readmeSegments)

  useEffect(() => {
    if (!notebookStreamSlug) {
      setReadmeContent(null)
      return
    }
    const seedPath = `markdown/notebooks/${notebookStreamSlug}/README.md`
    const raw = seedFiles?.[seedPath]
    if (raw) {
      setReadmeContent(raw.replace(/\{\{workouts\}\}/g, '').trim())
    }

    let cancelled = false
    void seedNoteId(seedPath).then(async (id) => {
      try {
        const entry = await contentProvider.getRecord(id)
        if (!cancelled && entry?.rawContent) {
          setReadmeContent(entry.rawContent.replace(/\{\{workouts\}\}/g, '').trim())
        }
      } catch {
        // fallback to seedFiles
      }
    })
    return () => {
      cancelled = true
    }
  }, [notebookStreamSlug, seedFiles])


  // Feed mode attaches note block info (excerpt + wod content id) via the same
  // engine's block-plane companion query — never a second query-state seam.
  const activeEngine = useMemo<StreamQueryEngine>(() => {
    const base = queryEngine ?? defaultStreamQueryEngine
    return layout === 'feed' ? base.withNoteBlockInfo() : base
  }, [queryEngine, layout])

  const defaultAddToToday = useCallback(async (entry: Entry) => {
    const today = todayKey()
    let rawContent = ''
    const targetNoteId =
      entry.kind === 'result' || entry.kind === 'segment'
        ? entry.execution?.noteId
        : entry.kind === 'note'
          ? (entry.id || entry.sourceNote)
          : entry.id

    // Link-first scheduling for real stored Notes & remote feed previews
    if (targetNoteId && (entry.kind === 'note' || entry.kind === 'result' || entry.kind === 'segment')) {
      const existingNote = await storageService.getNote(targetNoteId).catch(() => undefined)
      if (existingNote || entry.isRemotePreview) {
        await createJournalNoteFromWorkout({
          workoutName: existingNote?.title || entry.title,
          category: entry.sourceNotebook || 'journal',
          sourceNoteId: existingNote?.id ?? targetNoteId,
          sourceNotePath: entry.sourcePath,
          wodContent: rawContent,
        })
        toast({
          title: `Scheduled "${existingNote?.title || entry.title || 'Workout'}"`,
          description: `Linked onto ${today}.`,
        })
        return
      }
    }

    if (targetNoteId) {
      // 1. If segment has a specific blockContentId, resolve that block first
      if (entry.kind === 'segment' && entry.blockContentId) {
        const result = await queryService.runFind({
          raw: `:block{note:${targetNoteId}}`,
          target: 'block',
          filters: [{ key: 'note', negate: false, values: [{ value: targetNoteId, wildcard: false }] }],
        } as ParsedFindQuery)
        const matchingBlock = result.blocks.find(b => b.id === entry.blockContentId)
        if (matchingBlock?.rawContent) {
          rawContent = matchingBlock.rawContent
        }
      }

      // 2. If no block-specific content found, check if it's a journal note
      if (!rawContent && (entry.kind === 'note' || entry.kind === 'result' || entry.kind === 'segment')) {
        const note = await journalNotes.getById(targetNoteId)
        if (note && typeof note === 'object' && 'rawContent' in note && typeof note.rawContent === 'string') {
          rawContent = note.rawContent
        }
      }

      // 3. If still no content, fetch all blocks for the note (notebook items or indexed notes)
      if (!rawContent && entry.kind !== 'note') {
        const result = await queryService.runFind({
          raw: `:block{note:${targetNoteId}}`,
          target: 'block',
          filters: [{ key: 'note', negate: false, values: [{ value: targetNoteId, wildcard: false }] }],
        } as ParsedFindQuery)
        if (result.blocks.length > 0) {
          rawContent = [...result.blocks]
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
            .filter(b => b.rawContent.trim() !== '')
            .map(b => (b.dataType === 'frontmatter' ? `---\n${b.rawContent}\n---` : b.rawContent))
            .join('\n\n')
        }
      }
    }

    const input = addEntryToTodayInput(entry, rawContent, today)
    await journalNotes.create(input)
  }, [])

  const handleAddToToday = onAddToToday ?? defaultAddToToday

  // Feed's Run action: stage a pending runtime (real UUID identity) before
  // navigating — never a bare /run/:contentId link. Failure stays visible.
  const handleRunEntry = useCallback(
    async (entry: Entry) => {
      setActionError(null)
      try {
        await startEntryRun(entry, navigate)
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Could not start the workout.')
      }
    },
    [navigate],
  )

  // Feed's Playground action: persist the entry's content as a playground
  // entry (the intake helper persists BEFORE any navigation/runtime), then
  // open it. Failure stays visible — no silent fallback.
  const handleSendToPlayground = useCallback(
    async (entry: Entry) => {
      setActionError(null)
      try {
        const resolved = await journalNotes.resolve(entry.id)
        const content = resolved && typeof resolved === 'object' && 'rawContent' in resolved
          ? String(resolved.rawContent ?? '')
          : ''
        const { routeId } = await ensurePlaygroundEntry(content, { title: entry.title })
        void navigate(playgroundPath(routeId.replace(/^playground\//, '')))
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Could not create the playground entry.')
      }
    },
    [navigate],
  )

  const execute = useCallback<WqlExecutor>(
    ast => (isFindQuery(ast) ? queryService.runFind(ast) : queryService.runQuery(ast.raw)),
    [],
  )

  // Query execution pipeline. The draft resolves synchronously; only the RUN
  // is debounced (host-owned 150ms, coalescing per-keystroke composer
  // emissions). Invalid drafts never execute — previous results stay visible
  // (stale, flagged by the query error banner), and loading never wedges.
  // A committed result or notebook mutation bumps savedTick so the mounted listing re-queries.
  const [savedTick, setSavedTick] = useState(0)
  useEffect(() => subscribeNotebooks(() => setSavedTick(t => t + 1)), [])
  useEffect(() => subscribeSchedule(() => setSavedTick(t => t + 1)), [])

  // Notebook-plane management (ticket 05): the /notebooks list plus the move
  // targets the stream rows offer (user-owned notebooks only — feed
  // notebooks are read-only).
  const [moveNotebookTargets, setMoveNotebookTargets] = useState<Array<{ id: string; name: string; icon: string }>>([])
  useEffect(() => {
    let cancelled = false
    void notebookService.getAllNotebooks().then((all) => {
      if (cancelled) return
      setMoveNotebookTargets(all
        .filter(nb => nb.origin === 'user' || nb.origin === 'default')
        .filter(nb => nb.slug !== 'playground' && !isSystemReadOnlyNotebook(nb.notebookId) && !isSystemReadOnlyNotebook(nb.slug))
        .map(nb => ({ id: nb.notebookId, name: nb.name, icon: nb.icon })))
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [savedTick])
  const handleMoveNotebook = useCallback(async (noteId: string | undefined, notebookId: string) => {
    if (!noteId) return
    try {
      await notebookService.moveNote(noteId, notebookId)
      setSavedTick(t => t + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }, [])
  const subscribingIdsRef = useRef<Set<string>>(new Set())
  const [subscribingIds, setSubscribingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [pendingUnsubscribeFeed, setPendingUnsubscribeFeed] = useState<{ feedId: string; label: string } | null>(null)
  const [pendingCloneEntry, setPendingCloneEntry] = useState<Entry | null>(null)
  const [cloneTargetNotebooks, setCloneTargetNotebooks] = useState<WritableNotebookTarget[]>([])
  const [cloneTargetId, setCloneTargetId] = useState<string>('notebook/journal')
  const [cloneCreateNew, setCloneCreateNew] = useState(false)
  const [cloneNewName, setCloneNewName] = useState('')
  const [cloningRemote, setCloningRemote] = useState(false)
  const [pullingRemotePreview, setPullingRemotePreview] = useState(false)

  const handleConfirmUnsubscribe = useCallback(async () => {
    if (!pendingUnsubscribeFeed) return
    const { feedId } = pendingUnsubscribeFeed
    if (subscribingIdsRef.current.has(feedId)) return
    setActionError(null)
    subscribingIdsRef.current.add(feedId)
    setSubscribingIds(new Set(subscribingIdsRef.current))
    try {
      await unsubscribeFeedSource(feedId)
      setPendingUnsubscribeFeed(null)
      setSavedTick(t => t + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      subscribingIdsRef.current.delete(feedId)
      setSubscribingIds(new Set(subscribingIdsRef.current))
    }
  }, [pendingUnsubscribeFeed])

  const handleToggleSubscribeEntry = useCallback(async (entry: Entry) => {
    const subKey = entry.feedId ?? entry.id
    if (subscribingIdsRef.current.has(subKey)) return
    setActionError(null)
    const nextSub = !entry.subscribed
    if (entry.kind === 'feed' && entry.feedId && !nextSub) {
      const label = entry.title || feedSourceById(entry.feedId)?.label || entry.feedId
      setPendingUnsubscribeFeed({ feedId: entry.feedId, label })
      return
    }
    subscribingIdsRef.current.add(subKey)
    setSubscribingIds(new Set(subscribingIdsRef.current))
    try {
      if (entry.kind === 'feed' && entry.feedId && nextSub) {
        const outcome = await subscribeFeed(entry.feedId, { offlinePolicy: entry.feedId === 'core' ? 'offline-full' : 'index-only' })
        await flushFeedStatePersistence()
        if (outcome !== 'imported' && outcome !== 'current' && outcome !== 'server-stale') {
          setActionError(outcome === 'busy' ? 'Another tab is already syncing.' : 'Feed sync failed.')
          return
        }
      } else if (entry.kind === 'notebook' && entry.feedId && entry.seedChunkId) {
        await toggleNotebookSubscription(entry.feedId, entry.seedChunkId, nextSub)
      }
      setSavedTick(t => t + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      subscribingIdsRef.current.delete(subKey)
      setSubscribingIds(new Set(subscribingIdsRef.current))
    }
  }, [])

  const handleTogglePublicNotebookEntry = useCallback(async (entry: Entry) => {
    if (!entry.notebookId) return
    setActionError(null)
    try {
      await setNotebookPublic(storage, entry.notebookId, !entry.isPublic)
      setSavedTick(t => t + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handlePublishOutboundFeed = useCallback(async () => {
    setActionError(null)
    try {
      if (storageBackend === 'api') {
        const res = await publishSelfHostedFeed()
        toast({
          title: `Published Feed v${res.report.manifest.version}`,
          description: `${res.report.totalNotes} note(s) live at ${res.feedUrl}`,
        })
      } else {
        const report = await exportFeedRepositoryZip()
        toast({
          title: 'Exported wod-wiki-feed-repository.zip',
          description: `${report.totalNotes} note(s) and ${report.totalPublicSessions} public session(s) exported.`,
        })
      }
      setSavedTick(t => t + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleCloneRemoteEntry = useCallback((entry: Entry) => {
    setActionError(null)
    setCloneCreateNew(false)
    setCloneNewName('')
    setPendingCloneEntry(entry)
    void listWritableNotebooks(storage).then((targets) => {
      setCloneTargetNotebooks(targets)
      setCloneTargetId((prev) =>
        targets.some((nb) => nb.id === prev) ? prev : (targets[0]?.id ?? 'notebook/journal'),
      )
    })
  }, [])

  const handleConfirmCloneRemote = useCallback(async () => {
    if (!pendingCloneEntry || cloningRemote) return
    setCloningRemote(true)
    setActionError(null)
    try {
      let targetNb = cloneTargetId
      if (cloneCreateNew && cloneNewName.trim()) {
        const cleanName = cloneNewName.trim()
        const slug = cleanName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'custom'
        const candidateId = `notebook/${slug}` as Notebook['id']
        if (isSystemReadOnlyNotebook(candidateId)) {
          setActionError(`"${cleanName}" is reserved for a read-only system notebook. Choose another name.`)
          return
        }
        targetNb = await createUserNotebookLanding(storage, cleanName)
      }
      if (isSystemReadOnlyNotebook(targetNb)) {
        setActionError('Cannot clone into a read-only system notebook.')
        return
      }
      const cloned = await cloneRemotePreviewNoteToNotebook(pendingCloneEntry.id, targetNb)
      const destLabel = cloneTargetNotebooks.find((n) => n.id === targetNb)?.name || targetNb.replace(/^notebook\//, '')
      toast({
        title: `Cloned "${cloned.title}"`,
        description: `Saved to ${destLabel}. You own this copy and can edit or publish it.`,
      })
      setPendingCloneEntry(null)
      setCloneNewName('')
      setCloneCreateNew(false)
      setSavedTick(t => t + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setCloningRemote(false)
    }
  }, [pendingCloneEntry, cloningRemote, cloneTargetId, cloneCreateNew, cloneNewName, cloneTargetNotebooks])
  useEffect(() => onResultSaved(() => setSavedTick((t) => t + 1)), [])
  // The effort corpus keeps importing after the readiness gate flips (the
  // gate ungates on first paint; the effort chunk lands later). When the
  // import commits, the registry singleton re-hydrates — re-run an
  // effort-plane query so the catalog fills in without a manual re-query.
  // Only the effort plane listens: other planes never read the registry.
  useEffect(() => {
    if (!('target' in parsed) || parsed.target !== 'effort') return
    return subscribeAppEffortRegistry(() => setSavedTick((t) => t + 1))
  }, [parsed])
  // A sync that commits records (inline notice run, Settings page, another
  // tab) changes the vault under the mounted query — re-run it so imported
  // entries appear without a refresh. Only `result` bumps (not task
  // start/end) so unrelated activity never re-executes, and trailing-debounce
  // bursts so multi-chunk cold-boot commits trigger one refresh (WW-036).
  useEffect(() => {
    let lastSeen = getSyncActivity().result?.id ?? -1
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = subscribeSyncActivity(() => {
      const id = getSyncActivity().result?.id ?? -1
      if (id !== lastSeen) {
        lastSeen = id
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          setSavedTick((t) => t + 1)
        }, SYNC_ACTIVITY_DEBOUNCE_MS)
      }
    })
    return () => {
      unsub()
      if (timer !== null) clearTimeout(timer)
    }
  }, [])

  // Inline sync of the user's SUBSCRIBED library sources from the core-only
  // notice — the same syncFeedSource path the Settings per-source Sync
  // button uses, with the same outcome vocabulary. With nothing subscribed
  // the button cannot sync an empty worklist, so it becomes the subscribe
  // offer instead of pretending.
  const runLibrarySync = useCallback(async () => {
    const sources = defaultFeedSources().filter(
      s => s.autoImport === false && subscribedLibraryIds.includes(s.id),
    )
    if (sources.length === 0) {
      openLibraryManager()
      return
    }
    setFeedSyncRunning(true)
    setFeedSyncError(null)
    setFeedSyncEvent(null)
    try {
      let imported = 0
      let current = 0
      const problems: string[] = []
      for (const spec of sources) {
        // NOT force:true — a forced sync always decides "import" (it skips the
        // version-equality check), so the executor could never report
        // "current" and the up-to-date case stayed silent. A plain sync
        // compares the published version against the stored checkpoint and
        // reports "current" honestly when there is nothing to fetch.
        const outcome = await syncFeedSource(spec.id, { onProgress: setFeedSyncEvent })
        if (outcome === 'imported') {
          imported += 1
          // Content landed in the active storage: drop the notice and re-run
          // the mounted query so imported entries appear without a refresh.
          setLibrarySynced(true)
          setSavedTick(t => t + 1)
        } else if (outcome === 'current' || outcome === 'server-stale') {
          // The stored checkpoint is healthy — the corpus is present even
          // though nothing needed importing.
          current += 1
          setLibrarySynced(true)
        } else {
          // error/busy/disabled (and the force-sync-unreachable
          // update-pending) must be visible — the notice's error line
          // carries the per-source wording.
          problems.push(`${spec.label}: ${OUTCOME_LABEL[outcome]}`)
        }
      }
      if (problems.length > 0) setFeedSyncError(problems.join(' — '))
      if (imported > 0) {
        toast({
          title: imported === sources.length ? 'Libraries synced' : `${imported} of ${sources.length} libraries synced`,
          description: 'Content was imported from the published seeds. Your own edits were kept.',
        })
      } else if (current > 0 && problems.length === 0) {
        toast({
          title: 'Everything is up to date',
          description: 'All your subscribed libraries already match their published versions.',
        })
      }
    } finally {
      setFeedSyncRunning(false)
    }
  }, [subscribedLibraryIds, openLibraryManager])
  useEffect(() => {
    if (parsed.error) {
      setLoading(false)
      setQueryPending(false)
      return
    }
    let cancelled = false
    setQueryPending(true)
    const timer = setTimeout(() => {
      setLoading(true)
      setStages(undefined)
      setRuntimeQueryError(null)
      activeEngine
        .query(
          effectiveQuery,
          next => {
            if (!cancelled) setStages(next)
          },
          {
            notebookPlane:
              isNotebooksRoute &&
              isFindQuery(parsed) &&
              parsed.filters.some(
                f =>
                  f.key === 'subscribed' ||
                  f.key === 'feed' ||
                  (f.key === 'type' && f.values.some(v => v.value === 'notebook')),
              )
                ? 'containers'
                : 'notes',
          },
        )
        .then((results: Entry[]) => {
          if (!cancelled) {
            setEntries(results)
            // Bind the query-leg grouping to the COMMITTED run: transient
            // draft edits (each valid intermediate re-parses) must never
            // regroup the still-displayed previous results.
            setQueryRunDims(parseGroupingDimensions(effectiveQuery, parsed))
            setSettledRoute(profile.route)
            // One full execution per query change — nav facet panels read
            // this snapshot instead of re-running the query.
            publishStreamResults({ pathname: location.pathname, query: effectiveQuery, entries: results })
            setSavedTick((prev) => prev) // keep reference clean
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setEntries([])
            setRuntimeQueryError(err instanceof Error ? err.message : 'Query execution failed')
            setSettledRoute(profile.route)
            publishStreamResults({ pathname: location.pathname, query: effectiveQuery, entries: [] })
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false)
            setQueryPending(false)
          }
        })
    }, STREAM_EXECUTE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      setQueryPending(false)
    }
  }, [effectiveQuery, activeEngine, parsed, location.pathname, profile.route, isNotebooksRoute, feedReadiness, feedImportPending, savedTick])

  // Usage counts & M:N schedule enrichment for Note rows + Calendar Overlay projection
  const [usageCounts, setUsageCounts] = useState<ReadonlyMap<string, NoteUsageCounts>>(
    () => new Map(),
  )
  const [allScheduleItems, setAllScheduleItems] = useState<ScheduleItem[]>([])
  const [overlaySessions, setOverlaySessions] = useState<StoredSession[]>([])
  const [overlayNotesById, setOverlayNotesById] = useState<ReadonlyMap<string, StoredNote>>(() => new Map())

  useEffect(() => {
    if (loading || !hasSettledRun) return
    let cancelled = false
    const needsCounts =
      profile.route === '/notes' ||
      Boolean(profile.notebookSlug) ||
      location.pathname.startsWith('/notebook/')
    const needsCalendarOverlay =
      Boolean(profile.calendarCapable) && (layout === 'planner' || layout === 'agenda')

    if (needsCounts) {
      journalSchedule
        .getUsageCountsByNote()
        .then((map) => {
          if (!cancelled) setUsageCounts(map)
        })
        .catch(() => {})
    }
    if (needsCalendarOverlay) {
      void Promise.all([
        journalSchedule.listAll().catch(() => [] as ScheduleItem[]),
        storage.readonly('sessions').getAll().catch(() => [] as StoredSession[]),
        storageService.getAllNotes().catch(() => [] as StoredNote[]),
      ]).then(([sched, sess, notes]) => {
        if (cancelled) return
        setAllScheduleItems(sched)
        setOverlaySessions(sess)
        setOverlayNotesById(new Map(notes.map((n) => [n.id, n])))
      })
    }
    return () => {
      cancelled = true
    }
  }, [profile.route, profile.notebookSlug, profile.calendarCapable, location.pathname, layout, savedTick, loading, hasSettledRun])

  const enrichedEntries = useMemo(() => {
    const schedDatesByNote = new Map<string, string[]>()
    for (const item of allScheduleItems) {
      const list = schedDatesByNote.get(item.noteId) ?? []
      if (!list.includes(item.date)) list.push(item.date)
      schedDatesByNote.set(item.noteId, list)
    }
    if (usageCounts.size === 0 && schedDatesByNote.size === 0) return entries
    return entries.map((entry) => {
      const counts = usageCounts.get(entry.id)
      const schedDates = schedDatesByNote.get(entry.id)
      if (!counts && !schedDates) return entry
      return {
        ...entry,
        ...(counts ? { scheduleCount: counts.scheduleCount, sessionCount: counts.sessionCount } : {}),
        ...(schedDates ? { scheduledDates: schedDates } : {}),
      }
    })
  }, [entries, usageCounts, allScheduleItems])

  const calendarOverlayEntries = useMemo(() => {
    if (!profile.calendarCapable || (layout !== 'planner' && layout !== 'agenda')) {
      return enrichedEntries
    }
    if (allScheduleItems.length === 0 && overlaySessions.length === 0) {
      return overlayMode === 'all' ? enrichedEntries : overlayMode === 'planned' ? enrichedEntries : []
    }
    const matchingNoteIds = new Set(enrichedEntries.map((e) => e.id))
    const enforceNoteFilter =
      profile.route !== '/journal' || effectiveQuery.trim() !== profile.defaultWql.trim()
    const pairedByScheduleId = new Map<string, StoredSession[]>()
    const adhocSessions: StoredSession[] = []
    for (const sess of overlaySessions) {
      if (sess.origin === 'playground') continue
      if (enforceNoteFilter && !matchingNoteIds.has(sess.noteId)) continue
      if (sess.scheduleItemId) {
        const list = pairedByScheduleId.get(sess.scheduleItemId) ?? []
        list.push(sess)
        pairedByScheduleId.set(sess.scheduleItemId, list)
      } else {
        adhocSessions.push(sess)
      }
    }

    const overlay: Entry[] = []
    const coveredNoteDates = new Set<string>()
    for (const item of allScheduleItems) {
      if (enforceNoteFilter && !matchingNoteIds.has(item.noteId)) continue
      const note = overlayNotesById.get(item.noteId)
      const base = note ? toEntry(note) : enrichedEntries.find((e) => e.id === item.noteId)
      if (!base) continue
      const paired = pairedByScheduleId.get(item.id) ?? []
      coveredNoteDates.add(`${item.noteId}:${item.date}`)
      const itemEntry: Entry = {
        ...base,
        date: item.date,
        scheduledDates: [item.date],
        overlayKind: paired.length > 0 ? 'logged' : item.status === 'skipped' ? 'skipped' : 'planned',
        scheduleItemId: item.id,
        scheduleSlot: item.slot,
        scheduleNotes: item.notes,
        scheduleStatus: paired.length > 0 ? 'completed' : item.status,
        pairedSessions: paired.map((s) => ({
          sessionId: s.id,
          duration: s.duration,
          completed: s.completed,
          startTime: s.startTime,
        })),
      }
      if (overlayMode === 'all' || (overlayMode === 'planned' && paired.length === 0) || (overlayMode === 'logged' && paired.length > 0)) {
        overlay.push(itemEntry)
      }
    }

    if (overlayMode === 'all' || overlayMode === 'logged') {
      for (const sess of adhocSessions) {
        const sessDate = sess.sessionDate ?? journalSchedule.todayKey(sess.startTime || sess.createdAt)
        const note = overlayNotesById.get(sess.noteId)
        const base = note ? toEntry(note) : enrichedEntries.find((e) => e.id === sess.noteId)
        if (!base) continue
        overlay.push({
          ...base,
          id: base.id,
          date: sessDate,
          scheduledDates: [sessDate],
          overlayKind: 'logged',
          adHocSessionId: sess.id,
          adHocSessionDate: sessDate,
          noteSourceRevision: sess.noteSourceRevision,
          pairedSessions: [{
            sessionId: sess.id,
            duration: sess.duration,
            completed: sess.completed,
            startTime: sess.startTime,
          }],
        })
      }
    }

    // Preserve any legacy dated or undated entries that didn't map through ScheduleItems yet
    if (overlayMode === 'all') {
      for (const entry of enrichedEntries) {
        if (entry.date && coveredNoteDates.has(`${entry.id}:${entry.date}`)) continue
        if (!entry.date) overlay.push(entry)
      }
    }
    return overlay
  }, [profile.calendarCapable, profile.route, profile.defaultWql, effectiveQuery, layout, enrichedEntries, allScheduleItems, overlaySessions, overlayNotesById, overlayMode])

  // Grouping: the committed run's query `by {}` dimensions win; otherwise
  // the view setting, then the surface's Group-By favorite, then the level
  // default. The query leg is stored WITH the results at commit time — a
  // mid-edit draft (valid or not) never regroups the previous results;
  // view/favorite/level legs regroup entries live.
  const groupDims = useMemo<string[]>(() => {
    if (queryRunDims?.length) return queryRunDims
    if (settings.groupBy) return [settings.groupBy]
    const target = parsed.error || !isFindQuery(parsed) ? (profile.level === 'effort' ? 'effort' : 'note') : parsed.target
    const supported = wqlGroupingDimensions(target, 'find')
    return [resolveFallbackGroupDimension(
      profile.groupByOptions,
      supported,
      profile.level === 'effort' ? 'discipline' : 'date',
    )]
  }, [queryRunDims, settings.groupBy, profile.level, profile.groupByOptions, parsed])
  const groupingSource: 'query' | 'view' | 'favorite' | 'level' = queryRunDims?.length
    ? 'query'
    : settings.groupBy
      ? 'view'
      : profile.groupByOptions?.length
        ? 'favorite'
        : 'level'

  // WW-032: a settled, EMPTY /notebook/:slug stream may mean the slug does
  // not exist at all. One lightweight async existence probe (built-in slugs,
  // registered notebooks, feed-catalog notebooks, or a stored landing note)
  // decides between the generic empty state and the explicit not-found one.
  const notebookSlugParam = useMemo(() => {
    const match = NOTEBOOK_PATH_RE.exec(location.pathname)
    if (!match?.[1]) return null
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }, [location.pathname])
  const [notebookNotFound, setNotebookNotFound] = useState(false)
  const [resolvedNotebookTitle, setResolvedNotebookTitle] = useState<string | null>(null)
  useEffect(() => {
    if (!notebookSlugParam) {
      setResolvedNotebookTitle(null)
      return
    }
    let cancelled = false
    const cleanSlug = canonicalNotebookSlug(notebookSlugParam)
    const builtinSpec = BUILTIN_NOTEBOOKS.find(b => b.slug === notebookSlugParam || b.slug === cleanSlug)
    void Promise.all([
      notebookService.getAllNotebooks().catch(() => [] as Notebook[]),
      playgroundFeedCatalogStore.getAllNotebooks().catch(() => []),
      storage.readonly('notes').get(`notebook/${cleanSlug}`).catch(() => undefined),
      cleanSlug !== notebookSlugParam
        ? storage.readonly('notes').get(`notebook/${notebookSlugParam}`).catch(() => undefined)
        : Promise.resolve(undefined),
    ]).then(([registered, catalog, landingClean, landingRaw]) => {
      if (cancelled) return
      const landing = landingClean ?? landingRaw
      const regMatch = registered.find(nb => nb.slug === notebookSlugParam || nb.slug === cleanSlug)
      const catMatch = catalog.find(row => row.slug === notebookSlugParam || row.slug === cleanSlug)
      const name = regMatch?.name || landing?.title || catMatch?.label || builtinSpec?.name || null
      registerNotebookTitle(notebookSlugParam, name)
      setResolvedNotebookTitle(name)
    })
    return () => {
      cancelled = true
    }
  }, [notebookSlugParam, savedTick])
  useEffect(() => {
    if (!notebookSlugParam || !resolvedNotebookTitle) return
    const prevTitle = document.title
    document.title = `Wod.Wiki - ${resolvedNotebookTitle}`
    return () => {
      document.title = prevTitle
    }
  }, [notebookSlugParam, resolvedNotebookTitle])
  useEffect(() => {
    if (!notebookSlugParam || entries.length > 0 || !hasSettledRun || feedImportPending || feedReadiness === 'preparing') {
      setNotebookNotFound(false)
      return
    }
    let cancelled = false
    const builtin = BUILTIN_NOTEBOOK_SLUGS.includes(notebookSlugParam)
    const landing = storage.readonly('notes').get(`notebook/${notebookSlugParam}`).catch(() => undefined)
    void Promise.all([
      notebookService.getAllNotebooks().then((nbs) => nbs.some((nb) => nb.slug === notebookSlugParam)).catch(() => false),
      playgroundFeedCatalogStore.getAllNotebooks().then((rows) => rows.some((row) => row.slug === notebookSlugParam)).catch(() => false),
      landing.then(Boolean),
    ]).then(([registered, catalog, hasLanding]) => {
      if (!cancelled) setNotebookNotFound(!builtin && !registered && !catalog && !hasLanding)
    })
    return () => {
      cancelled = true
    }
  }, [notebookSlugParam, entries.length, hasSettledRun, feedImportPending, feedReadiness])
  // Filter truth vs the target's own vocabulary: the executor IGNORES
  // unsupported keys (advisory) — the strip says applied vs ignored instead
  // of implying every requested filter ran.
  const supportedFilterKeys = useMemo(
    () => new Set(parsed.error || !isFindQuery(parsed) ? [] : wqlFilterKeys(parsed.target, 'find')),
    [parsed],
  )
  const appliedFilters = parsed.error || isPipelineQuery(parsed) ? 0 : parsed.filters.filter(f => supportedFilterKeys.has(f.key)).length
  const ignoredFilters = (parsed.error || isPipelineQuery(parsed) ? 0 : parsed.filters.length) - appliedFilters

  const handleToggleBatchSelect = useCallback((entry: Entry) => {
    setSelectedBatchNoteIds((prev) => {
      const next = new Set(prev)
      if (next.has(entry.id)) next.delete(entry.id)
      else next.add(entry.id)
      return next
    })
  }, [])

  const handleConfirmBatchSchedule = useCallback(async () => {
    if (selectedBatchNoteIds.size === 0 || !batchScheduleDate || batchScheduling) return
    setBatchScheduling(true)
    setActionError(null)
    try {
      const sourceNbId = notebookStreamSlug ? `notebook/${notebookStreamSlug}` : undefined
      await journalSchedule.batchSchedule(
        [...selectedBatchNoteIds].map((noteId) => ({
          noteId,
          date: batchScheduleDate,
          ...(sourceNbId ? { sourceNotebookId: sourceNbId } : {}),
        })),
      )
      toast({
        title: `Scheduled ${selectedBatchNoteIds.size} workout${selectedBatchNoteIds.size === 1 ? '' : 's'}`,
        description: `Linked onto ${batchScheduleDate}.`,
      })
      setSelectedBatchNoteIds(new Set())
      setSavedTick((t) => t + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Batch scheduling failed.')
    } finally {
      setBatchScheduling(false)
    }
  }, [selectedBatchNoteIds, batchScheduleDate, batchScheduling, notebookStreamSlug])

  // Full dataset grouped by dimension
  const shelfVisible = profile.shelfVisible && !isPlaygroundScope
  const allGroups = useMemo(
    () => groupEntriesByDimension(enrichedEntries, groupDims, { shelfVisible }),
    [enrichedEntries, groupDims, shelfVisible],
  )

  // Progressive DOM batching — destructure members (growTo is a stable
  // callback) so effects/memos depend on values, not the per-render object.
  const entriesBatch = useBatchedItems(enrichedEntries)
  const { visible: batchedVisible, growTo: growBatchTo } = entriesBatch
  const visibleGroups = useMemo(
    () => groupEntriesByDimension(batchedVisible, groupDims, { shelfVisible }),
    [batchedVisible, groupDims, shelfVisible],
  )
  const groupCountMap = useMemo(() => new Map(allGroups.map(g => [g.id, g.entries.length])), [allGroups])

  // Streams retire resting L3 (0px right rail) — filters live inside
  // StreamQueryBar's `+ Filter` popover and layout/fields/group-by/actions
  // live inside StreamViewPopover.
  const { setL3Items, setL3Actions, scrollToSection, navState, openCreateJournal } = useNav()
  useEffect(() => {
    setL3Items([])
    setL3Actions?.([])
    return () => {
      setL3Items([])
      setL3Actions?.([])
    }
  }, [setL3Items, setL3Actions])

  const availableGroupDims = useMemo(() => {
    const target = parsed.error || !isFindQuery(parsed) ? (profile.level === 'effort' ? 'effort' : 'note') : parsed.target
    const supported = wqlGroupingDimensions(target, 'find')
    return resolveGroupByOptions(supported, profile.groupByOptions)
  }, [parsed, profile.level, profile.groupByOptions])

  const handleGroupByChange = useCallback(
    (newGroup: string) => {
      const next = withGroupBy(query, newGroup)
      if (next !== query) setQuery(next)
      else setGroupBy(newGroup)
    },
    [query, setQuery, setGroupBy],
  )

  const handleToggleGroupDim = useCallback(
    (dim: string) => {
      const isCurrentlyActive = groupDims.some(d => d.toLowerCase() === dim.toLowerCase())
      const next = toggleGroupDimension(query, dim, !isCurrentlyActive)
      setQuery(next)
      const nextParsed = parseQuery(next)
      if (!nextParsed.error && isFindQuery(nextParsed)) {
        handleGroupByChange(nextParsed.groupBy?.[0] ?? '')
      }
    },
    [groupDims, query, setQuery, handleGroupByChange],
  )

  const saveDisabled = Boolean(parsed.error) || query.trim() === ''

  // Progressive anchor reachability: the L3 index covers ALL groups, but only
  // the rendered prefix has DOM anchors (progressive batching). A click on a
  // not-yet-rendered group materializes its batch, then completes the scroll —
  // otherwise the DOM fallback misses and the link is dead.
  // NavState's runtime field is `activeL3Id` (NavContext reducer); the
  // navTypes declaration still says `activeL3` — narrow the runtime shape.
  const activeL3Id =
    'activeL3Id' in navState && typeof navState.activeL3Id === 'string' ? navState.activeL3Id : null
  const pendingScrollRef = useRef<string | null>(null)
  useEffect(() => {
    const id = activeL3Id
    if (!id || pendingScrollRef.current === id) return
    if (document.getElementById(id)) return
    const group = allGroups.find(g => g.id === id)
    if (!group) return
    pendingScrollRef.current = id
    const last = group.entries[group.entries.length - 1]
    const endIdx = last ? entries.findIndex(e => e.id === last.id) : -1
    growBatchTo(endIdx >= 0 ? endIdx + 1 : entries.length)
  }, [activeL3Id, allGroups, entries, growBatchTo])

  // Once the pending group's anchor exists in the committed DOM, finish the scroll.
  useEffect(() => {
    const id = pendingScrollRef.current
    if (!id || !document.getElementById(id)) return
    pendingScrollRef.current = null
    scrollToSection(id)
  }, [visibleGroups, scrollToSection])

  const stickyOffset = useStickyBoundaryOffset(104)

  // Query error detection (composed query is the default fallback and has nothing to flag unless edited or invalid from URL)
  const composedError = parsed.error && query !== profile.defaultWql ? parsed.error : null
  const queryError = urlQueryError ?? composedError ?? runtimeQueryError

  // The route default's own filters — exactly what its head injects (scope +
  // plane type). Subtracted from a user query to find authorship.
  const defaultImpliedFilters = useMemo(() => {
    const baseline = parseQuery(profile.defaultWql)
    const out = !baseline.error && isFindQuery(baseline) ? [...baseline.filters] : []
    const headMatch = /^:([a-z0-9_-]+)/i.exec(query.trim())
    if (headMatch?.[1]) {
      const bareHead = parseQuery(`:${headMatch[1]}{}`)
      if (!bareHead.error && isFindQuery(bareHead)) {
        out.push(...bareHead.filters)
      }
    }
    if (profile.scopeOptions.length === 1) {
      out.push({
        key: 'source',
        negate: false,
        values: [{ value: profile.scopeOptions[0]!, wildcard: false }],
      })
    }
    return out
  }, [profile.defaultWql, profile.scopeOptions, query])

  const authoredFilters = useMemo(() => {
    if (parsed.error || !isFindQuery(parsed)) return []
    return userAuthoredFilters(parsed.filters, defaultImpliedFilters)
  }, [parsed, defaultImpliedFilters])
  const hasAppliedFilters = authoredFilters.length > 0
  const isCustomQuery = hasAppliedFilters || effectiveQuery.trim() !== profile.defaultWql.trim()
  const statusTarget = parsed.error ? null : isFindQuery(parsed) ? parsed.target : parsed.family
  const statusNoun = TARGET_NOUNS[statusTarget ?? profile.target] ?? { singular: 'item', plural: 'items' }

  const canCreateOnRoute = routeSupportsCreation(profile.route) && !notebookNotFound
  const handleStreamAddAction = useCallback(() => {
    if (isNotebooksRoute) {
      setEditingNotebook(null)
      setCreateNotebookOpen(true)
      return
    }
    const routeCtx = resolveNewEntryRoute(location.pathname)
    openCreateJournal({
      kind: routeCtx.defaultKind,
      notebookSlug: routeCtx.notebookSlug,
      date: routeCtx.defaultDate,
    })
  }, [isNotebooksRoute, location.pathname, openCreateJournal])

  // Nothing imported on a seed-library route: the emptiness is the missing
  // corpus, not the query — the empty state points at the import action and
  // never offers search remedies (a "Clear filter" there would lie).
  const libraryNotImported = profile.feedNotice === true && libraryMissing === true && !librarySynced

  // Empty state remedies
  const emptyStateRemedies = useMemo(() => {
    const remedies: { id: string; label: string; apply: () => void }[] = []
    if (libraryNotImported) {
      remedies.push({ id: 'browse-libraries', label: 'Browse libraries', apply: openLibraryManager })
      return remedies
    }
    // A no-op advisory (ignored clause) is the emptiness a user can't see —
    // offer the editor first; Clear filter / Remove window stay below.
    if (!parsed.error && parsed.advisories?.length) {
      remedies.push({
        id: 'edit-query',
        label: 'Edit query',
        apply: () => openStreamQueryEditor(query, execute, setQuery),
      })
    }
    if (!parsed.error && parsed.window) {
      const w = parsed.window
      const label =
        w.kind === 'relative'
          ? `last ${w.size}${w.unit}`
          : w.kind === 'param'
            ? `last $${w.param}${w.unit ? ` ${w.unit}` : ''}`
            : `from ${w.start}${w.end ? ` to ${w.end}` : ''}`
      remedies.push({
        id: 'remove-window',
        label: `Remove time window (${label})`,
        apply: () => setQuery(withoutWindow(query)),
      })
    }
    if (!parsed.error && isFindQuery(parsed)) {
      const authored = userAuthoredFilters(parsed.filters, defaultImpliedFilters)
      if (authored.length > 0) {
        const authoredSigs = new Set(authored.map(filterSignature))
        const kept = parsed.filters.filter(f => !authoredSigs.has(filterSignature(f)))
        remedies.push({
          id: 'clear-filters',
          label: authored.length === 1 ? 'Clear filter' : `Clear filters (${authored.length})`,
          // Re-emit through the serializer with only the head-implied
          // filters kept — the scoped feed plane survives; authored clauses
          // (and only those) are gone.
          apply: () => setQuery(serialize({ ...parsed, filters: kept })),
        })
      }
    }
    return remedies
  }, [parsed, query, setQuery, execute, defaultImpliedFilters, libraryNotImported, openLibraryManager])

  // Shared empty state for the grouped layouts (Cards / Feed) — same query,
  // same remedies, whichever mode is active. An unknown /notebook/:slug gets
  // the explicit not-found state instead (WW-032).
  const streamEmptyState = (
    <div
      className="px-6 py-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-3"
      data-testid="stream-empty-state"
    >
      {notebookNotFound && notebookSlugParam ? (
        <div className="flex flex-col items-center gap-3" data-testid="notebook-not-found">
          <p className="text-sm font-medium">
            Notebook “{notebookSlugParam}” not found.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => navigate('/notebooks')}
            data-testid="notebook-not-found-back"
          >
            Back to Notebooks
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium">
            {libraryNotImported
              ? `No ${profile.title.toLowerCase()} are imported yet.`
              : profile.emptyMessage ?? (parsed.window
                ? 'No entries found within the selected time window.'
                : 'No entries match your search.')}
          </p>
          {emptyStateRemedies.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
              {emptyStateRemedies.map(r => (
                <Button
                  key={r.id}
                  variant="outline"
                  size="sm"
                  onClick={r.apply}
                  className="text-xs"
                >
                  {r.label}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )

  // Invalid draft: previous results stay visible but visibly stale.
  const stale = !!parsed.error && entries.length > 0
  const feedSyncing = feedImportPending || feedReadiness === 'preparing'
  const awaitingFeedEntries = entries.length === 0 && feedSyncing

  const visibleHeaderTitle = notebookSlugParam ? (resolvedNotebookTitle ?? profile.title ?? undefined) : undefined
  const streamHeading = resolvedNotebookTitle ?? profile.title ?? 'Stream'

  const desktopCreateTestId = isNotebooksRoute
    ? TEST_IDS.NOTEBOOKS_CREATE_BUTTON
    : profile.route === '/efforts'
      ? TEST_IDS.EFFORTS_CREATE_BTN
      : TEST_IDS.NEW_ENTRY_PRIMARY
  const addActionLabel = isNotebooksRoute ? '+ New notebook' : '+ Add'

  return (
    <div
      className="bg-card flex flex-col flex-1"
      data-testid="queriable-stream-view"
      data-feed-sync={feedSyncing ? 'syncing' : 'settled'}
    >
      {!visibleHeaderTitle && (
        <h1 className="sr-only" data-testid={TEST_IDS.STREAM_PAGE_HEADING}>
          {streamHeading}
        </h1>
      )}
      {createNotebookDialog}
      {querySettingsSurface && (
        <QuerySettingsDialog
          surface={querySettingsSurface}
          open={querySettingsOpen}
          onOpenChange={setQuerySettingsOpen}
        />
      )}
      {profile.dashboardEnabled && (
        <QueryToDashboardDialog
          open={dashboardOpen}
          onOpenChange={setDashboardOpen}
          initialQuery={query}
          subsetQuery={!parsed.error && isFindQuery(parsed) ? query : null}
        />
      )}
      {/* Desktop: single-line header — the query bar fills the row left
          empty by the removed title. The header itself is the sticky zone
          (lg:sticky top-0) and MUST be a direct child of this full-height
          column: a wrapper div would box the sticky element to its own
          height and let it scroll away. max-lg:hidden therefore rides on
          the header root via className.
          Mobile: no page-level header at all; the query bar portals into
          the app's mobile thumb footer (fixed bottom bar) instead — the
          WQL composer lives in the thumb-control zone. */}
      <StickyPageHeader
        className="max-lg:hidden"
        parent={notebookSlugParam ? { label: 'Notebooks', to: ROUTE_PATTERNS.notebooks } : undefined}
        title={visibleHeaderTitle}
        actions={
          <ResponsiveActions
            primary={
              canCreateOnRoute ? (
                isMobile ? (
                  isNotebooksRoute ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleStreamAddAction}
                      aria-label="New notebook"
                      title="New notebook"
                      data-testid={TEST_IDS.NOTEBOOKS_CREATE_BUTTON}
                      className="h-11 rounded-full px-3.5 gap-1.5 shadow-lg text-xs font-semibold whitespace-nowrap"
                    >
                      <span>{addActionLabel}</span>
                    </Button>
                  ) : (
                    <MobileNewEntryCombo />
                  )
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleStreamAddAction}
                    data-testid={desktopCreateTestId}
                    className="h-8 gap-1.5 px-2.5 text-xs font-semibold whitespace-nowrap"
                  >
                    <span>{addActionLabel}</span>
                  </Button>
                )
              ) : undefined
            }
            label="Stream actions"
          >
            <StreamViewPopover
              level={profile.level}
              settings={settings}
              availableLayouts={availableLayouts}
              availableGroupDims={availableGroupDims.map((opt) => opt.id)}
              groupDims={groupDims}
              onLayoutChange={setLayout}
              onToggleGroupDim={handleToggleGroupDim}
              onToggleField={toggleField}
              calendarCapable={Boolean(profile.calendarCapable)}
              query={query}
              onQueryChange={setQuery}
              addActionLabel={addActionLabel}
              onAddAction={canCreateOnRoute ? handleStreamAddAction : undefined}
              onAddToDashboard={profile.dashboardEnabled ? () => setDashboardOpen(true) : undefined}
              addToDashboardDisabled={saveDisabled}
              onOpenQuerySettings={querySettingsSurface ? () => setQuerySettingsOpen(true) : undefined}
            />
            {actions}
          </ResponsiveActions>
        }
        queryBar={
          !isMobile ? (
            <StreamQueryBar
              query={query}
              onQueryChange={setQuery}
              scopeOptions={profile.scopeOptions}
              execute={execute}
              defaultQuery={profile.defaultWql}
              route={profile.route}
              hasAppliedFilters={hasAppliedFilters}
              activeFilterCount={authoredFilters.length}
            />
          ) : undefined
        }
      />

      {/* Query status strip — one instance under the header: calm athlete
          counts at rest, full query diagnostics when custom/advisory/error. */}
      <div className="px-4 pt-2 sm:px-6 lg:px-8" data-testid="stream-query-status-row">
        <StreamQueryStatus
          error={queryError}
          syntaxHint={queryError ? suggestWqlSyntaxHint(query, profile.target) : null}
          target={statusTarget}
          matched={entries.length}
          total={Math.max(stages?.selected ?? 0, entries.length)}
          countsPending={!parsed.error && (!hasSettledRun || (loading && !stages) || awaitingFeedEntries)}
          applied={appliedFilters}
          ignored={ignoredFilters}
          advisories={parsed.error ? [] : parsed.advisories ?? []}
          groupDims={groupDims}
          groupingSource={groupingSource}
          hasAppliedFilters={hasAppliedFilters}
          isCustomQuery={isCustomQuery}
          itemNoun={statusNoun}
        />
      </div>

      {/* ponytail: the nudge is a passive hint — upgrade to an inline source
          picker when the "Empty-option nudge UX" ticket lands. An empty
          scopeOptions list is a deliberate Route WQL Config state, shown only
          when a settled query returns zero entries so populated planes
          (/tags, /efforts, /sessions, /pages) never show a dead-end warning. */}
      {profile.scopeOptions.length === 0 && profile.target !== 'session' && hasSettledRun && !loading && !awaitingFeedEntries && entries.length === 0 && !hasAppliedFilters && !queryError && (
        <p
          data-testid="route-wql-empty-options"
          className="px-4 pt-3 text-xs text-muted-foreground sm:px-6 lg:px-8"
        >
          No source options are set for this route — pick a source by editing the query.
        </p>
      )}
      {/* Core-only notice: this route's corpus lives in optional seed
          libraries and none has imported yet — the page is a dead end until
          the user syncs. Hidden while the coverage probe is unsettled. */}
      {profile.feedNotice && libraryMissing && !librarySynced && (
        <div className="px-4 pt-3 sm:px-6 lg:px-8" data-testid="feed-library-notice">
          <div className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <CloudDownload className="size-4 text-primary" />
                Only the core seed is imported
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {targetFeedFilter ? (
                  isFeedSubscribed(targetFeedFilter)
                    ? `The content for this page comes from "${feedSourceById(targetFeedFilter)?.label ?? targetFeedFilter}", which has not been imported yet. Sync now to import its notebooks.`
                    : `The content for this page comes from "${feedSourceById(targetFeedFilter)?.label ?? targetFeedFilter}", which is not subscribed yet. Subscribe in Sync settings to import its notebooks.`
                ) : subscribedLibraryIds.length > 0
                  ? 'The content for this page comes from your subscribed libraries, which have not been imported yet. Sync now to import them — or open Sync settings to add more sources (mirrors, your own libraries).'
                  : 'The content for this page comes from community libraries, and none are subscribed yet beyond the core seed. Browse the library manager to subscribe — mirrors and your own libraries both work.'}
              </p>
              {feedSyncEvent && (
                <div className="space-y-1.5 pt-1" data-testid="feed-library-notice-progress">
                  <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
                    {feedSyncLabel(feedSyncEvent)}
                  </p>
                  {feedSyncEvent.phase !== 'checking' && feedSyncEvent.phase !== 'finished'
                    ? <ProgressBar value={feedSyncEvent.completedChunks} max={feedSyncEvent.totalChunks} label="Library import progress" className="max-w-sm" />
                    : feedSyncRunning
                      ? <progress aria-label="Checking library sources" className="h-2 max-w-sm w-full" />
                      : null}
                </div>
              )}
              {(feedSyncError ?? (feedSyncEvent?.phase === 'finished' ? feedSyncEvent.error : null)) && (
                <p className="text-xs text-destructive" data-testid="feed-library-notice-error">
                  {feedSyncError ?? (feedSyncEvent?.phase === 'finished' ? feedSyncEvent.error : null)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Primary action follows the worklist: subscribed sources sync
                  inline; none subscribed, it is the subscribe offer routed to
                  the source manager (drawer on /notebooks, Sync settings
                  elsewhere). Same test id — still the notice's primary. */}
              <Button
                size="sm"
                onClick={() => void runLibrarySync()}
                disabled={feedSyncRunning}
                data-testid="feed-library-notice-sync"
                className="gap-2"
              >
                <RefreshCw className={`size-3.5 ${feedSyncRunning ? 'animate-spin' : ''}`} />
                <span>{feedSyncRunning ? 'Syncing…' : subscribedLibraryIds.length > 0 ? 'Sync now' : 'Browse libraries'}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(ROUTE_PATTERNS.settingsSync)}
                data-testid="feed-library-notice-settings"
                className="gap-2"
              >
                <Settings2 className="size-3.5" />
                <span>Sync settings</span>
              </Button>
            </div>
          </div>
        </div>
      )}
      {isMobile && mobileSlot && (
        createPortal(
          <StreamQueryBar
            query={query}
            onQueryChange={setQuery}
            scopeOptions={profile.scopeOptions}
            execute={execute}
            defaultQuery={profile.defaultWql}
            route={profile.route}
            hasAppliedFilters={hasAppliedFilters}
            activeFilterCount={authoredFilters.length}
            compact
          />,
          mobileSlot,
        )
      )}

      {/* Query error banner */}
      {queryError && (
        <div
          role="alert"
          className="mx-6 mt-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive"
          data-testid="stream-query-error"
        >
          <TriangleAlertIcon className="size-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <p className="font-bold">Query error</p>
            <p className="mt-1 font-mono text-[11px] opacity-90">{queryError}</p>
          </div>
        </div>
      )}

      {/* Action error banner (e.g. playground intake persistence failure —
          no silent fallback) */}
      {actionError && (
        <div
          role="alert"
          className="mx-6 mt-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive"
          data-testid="stream-action-error"
        >
          <TriangleAlertIcon className="size-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <p className="font-bold">Action failed</p>
            <p className="mt-1 text-[11px] opacity-90">{actionError}</p>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-[11px] font-bold uppercase tracking-wider hover:opacity-80"
            data-testid="stream-action-error-dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      {(isNotebooksRoute || isFeedsRoute) && feedIntakeParam && (
        <div className="px-6 pt-4">
          <FeedIntakeBanner
            feedParam={feedIntakeParam}
            onDismiss={() => dismissFeedIntake()}
            onRegistered={(feedId) => {
              dismissFeedIntake(`:notebook{feed:${feedId},subscribed:true,false}`)
            }}
            onSubscribed={(feedId) => {
              dismissFeedIntake(`:notebook{feed:${feedId}}`)
            }}
          />
        </div>
      )}

      {/* Read-only view of the notebook readme note. WQL embed links
          (`[heading](:query)!`) inject live query results in place; any
          embed suppresses the default stream below (the override). */}
      {readmeContent && (
        <div
          className="border-b border-border/60 bg-card/20 px-6 py-4"
          data-testid="notebook-readme-note"
        >
          {readmeSegments.map((segment, index) =>
            segment.kind === 'markdown' ? (
              <CanvasProse key={index} prose={segment.text} />
            ) : (
              <ReadmeQueryBlock
                key={index}
                query={segment.query}
                heading={segment.heading}
                queryEngine={deps?.readmeQueryEngine}
                onAddToToday={handleAddToToday}
                onRunStart={handleRunEntry}
              />
            ),
          )}
        </div>
      )}

      {/* Zero-import remote preview banner when viewing an unsubscribed remote Notebook */}
      {entries.length > 0 && entries.every(e => e.isRemotePreview) && notebookStreamSlug && (
        <div className="mx-6 mt-4 rounded-xl border border-sky-700/30 dark:border-sky-400/30 bg-sky-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs" data-testid="remote-notebook-preview-banner">
          <div>
            <p className="font-semibold text-foreground">
              Index Preview · {entries.length} workout{entries.length === 1 ? '' : 's'} — loaded on demand
            </p>
            <p className="text-muted-foreground mt-0.5">
              Browsing directly from the feed index without downloading everything upfront. Open any workout on demand, clone a copy to My Notes, or subscribe for offline access.
            </p>
          </div>
          {entries[0]?.feedId && (
            <Button
              size="sm"
              disabled={pullingRemotePreview}
              aria-busy={pullingRemotePreview}
              onClick={() => {
                const feedId = entries[0]!.feedId!
                const chunkId = entries[0]!.seedChunkId ?? `notebook.${notebookStreamSlug}`
                setPullingRemotePreview(true)
                void toggleNotebookSubscription(feedId, chunkId, true)
                  .then(() => { setSavedTick(t => t + 1) })
                  .catch((err) => { setActionError(err instanceof Error ? err.message : String(err)) })
                  .finally(() => { setPullingRemotePreview(false) })
              }}
              data-testid="remote-preview-subscribe-btn"
              className="gap-1.5"
            >
              {pullingRemotePreview ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              {pullingRemotePreview ? 'Downloading offline…' : '+ Subscribe & Download Offline'}
            </Button>
          )}
        </div>
      )}
      {/* Unified Stream Content across all Library routes (/feeds, /notebooks, /notes, /journal, /sessions, /efforts, /tags) */}
      {readmeOverride ? null : (layout === 'rows' || layout === 'agenda' || layout === 'planner') && entries.length === 0 && (!hasSettledRun || loading || awaitingFeedEntries) ? (
        <div className="py-16 text-center text-xs text-muted-foreground" data-testid="stream-loading">
          Loading…
        </div>
      ) : layout === 'rows' ? (
        <div className={stale ? 'flex-1 opacity-50 transition-opacity' : 'flex-1'}>
          <PropertyTable
            entries={entries}
            level={profile.level}
            visibleFieldIds={settings.visibleFields}
            stickyHeaderTop={stickyOffset}
            emptyMessage={profile.emptyMessage ?? 'No matching records found.'}
          />
        </div>
      ) : layout === 'agenda' ? (
        <div className={stale ? 'flex-1 opacity-50 transition-opacity' : 'flex-1'}>
          <CalendarAgendaView
            entries={calendarOverlayEntries}
            stickyOffset={stickyOffset}
            visibleFieldIds={settings.visibleFields}
            onAddToToday={handleAddToToday}
            onRunStart={handleRunEntry}
            moveNotebookTargets={moveNotebookTargets}
            onMoveNotebook={(entry, notebookId) => void handleMoveNotebook(entry.id, notebookId)}
            onCreateOnDay={setCreateOnDate}
            monthParam={urlMonthParam}
            onMonthChange={handleMonthChange}
            overlayMode={overlayMode}
            onOverlayModeChange={setOverlayMode}
            onInspectEntry={handleInspectEntry}
            onInspectDay={handleInspectDay}
          />
        </div>
      ) : layout === 'planner' ? (
        <div className={stale ? 'flex-1 opacity-50 transition-opacity' : 'flex-1'}>
          <CalendarPlannerView
            entries={calendarOverlayEntries}
            visibleFieldIds={settings.visibleFields}
            onAddToToday={handleAddToToday}
            onRunStart={handleRunEntry}
            moveNotebookTargets={moveNotebookTargets}
            onMoveNotebook={(entry, notebookId) => void handleMoveNotebook(entry.id, notebookId)}
            onCreateOnDay={setCreateOnDate}
            monthParam={urlMonthParam}
            onMonthChange={handleMonthChange}
            overlayMode={overlayMode}
            onOverlayModeChange={setOverlayMode}
            onInspectEntry={handleInspectEntry}
            onInspectDay={handleInspectDay}
          />
        </div>
      ) : layout === 'feed' ? (
        visibleGroups.length > 0 ? (
          <StreamFeed
            groups={visibleGroups}
            batch={entriesBatch}
            stickyOffset={stickyOffset}
            onRunEntry={handleRunEntry}
            onSendToPlayground={handleSendToPlayground}
            onAddToToday={handleAddToToday}
            moveNotebookTargets={moveNotebookTargets}
            onMoveNotebook={(entry, notebookId) => void handleMoveNotebook(entry.id, notebookId)}
            onEditNotebook={e => void handleOpenEditNotebook(e)}
            onDeleteNotebook={e => void handleDeleteNotebookEntry(e)}
          />
        ) : (loading || awaitingFeedEntries) && entries.length === 0 ? (
          <div className="py-16 text-center text-xs text-muted-foreground" data-testid="stream-loading">
            Loading…
          </div>
        ) : entries.length === 0 && !loading && !awaitingFeedEntries ? (
          streamEmptyState
        ) : null
      ) : (
        <div className={stale ? 'flex-1 divide-y divide-border/60 opacity-50 transition-opacity' : 'flex-1 divide-y divide-border/60'}>
          {/* Undated Shelf (Sessions or Curated Workouts) */}
          {/* Grouped Progressive Stream */}
          {visibleGroups.length > 0 ? (
            <div className="divide-y divide-border/40" data-testid="stream-dated-content">
              {visibleGroups.map(group => {
                const totalInGroup = groupCountMap.get(group.id) ?? group.entries.length

                // Undated Shelf (Sessions or Curated Workouts)
                if (group.key === 'shelf') {
                  return (
                    <div key={group.id} id={group.id} className="border-b border-border/60" data-testid="stream-shelf">
                      <button
                        type="button"
                        onClick={() => setShelfOpen(prev => !prev)}
                        className="w-full flex items-center justify-between px-6 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          {shelfOpen ? (
                            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                          )}
                          <Rss className="size-3.5 text-amber-500" />
                          <span className="text-xs font-bold text-foreground">{group.label}</span>
                          <span className="text-[11px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            {totalInGroup}
                          </span>
                        </div>
                      </button>
                      {shelfOpen && (
                        <div className="divide-y divide-border/40">
                          {group.entries.map(entry => (
                            <LibraryRow
                              key={entry.id}
                              entry={entry}
                              visibleFieldIds={settings.visibleFields}
                              onAddToToday={handleAddToToday}
                              onRunStart={handleRunEntry}
                              moveNotebookTargets={moveNotebookTargets}
                              onMoveNotebook={(e, notebookId) => void handleMoveNotebook(e.id, notebookId)}
                              onToggleSubscribe={(e) => void handleToggleSubscribeEntry(e)}
                              subscribing={subscribingIds.has(entry.feedId ?? entry.id)}
                              onTogglePublicNotebook={(e) => void handleTogglePublicNotebookEntry(e)}
                              onPublishFeed={() => void handlePublishOutboundFeed()}
                              onCloneRemote={(e) => void handleCloneRemoteEntry(e)}
                              onEditNotebook={(e) => void handleOpenEditNotebook(e)}
                              onDeleteNotebook={(e) => void handleDeleteNotebookEntry(e)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <div key={group.id} id={group.id} className="group/date" data-testid={`date-group-${group.key}`}>
                    <StickyGroupHeader
                      top={stickyOffset}
                      icon={<CalendarIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                      label={group.label}
                      badge={group.isToday ? (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                          Today
                        </span>
                      ) : undefined}
                      meta={`${totalInGroup} ${totalInGroup === 1 ? 'entry' : 'entries'}`}
                    />
                    <div className="divide-y divide-border/30">
                      {group.entries.map(entry => (
                        <LibraryRow
                          key={entry.id}
                          entry={entry}
                          visibleFieldIds={settings.visibleFields}
                          tone={group.isToday ? 'primary' : 'secondary'}
                          selected={Boolean(notebookStreamSlug) && selectedBatchNoteIds.has(entry.id)}
                          onToggleSelect={notebookStreamSlug ? handleToggleBatchSelect : undefined}
                          onAddToToday={handleAddToToday}
                          onRunStart={handleRunEntry}
                          moveNotebookTargets={moveNotebookTargets}
                          onMoveNotebook={(e, notebookId) => void handleMoveNotebook(e.id, notebookId)}
                          onToggleSubscribe={(e) => void handleToggleSubscribeEntry(e)}
                          subscribing={subscribingIds.has(entry.feedId ?? entry.id)}
                          onTogglePublicNotebook={(e) => void handleTogglePublicNotebookEntry(e)}
                          onPublishFeed={() => void handlePublishOutboundFeed()}
                          onCloneRemote={(e) => void handleCloneRemoteEntry(e)}
                          onEditNotebook={(e) => void handleOpenEditNotebook(e)}
                          onDeleteNotebook={(e) => void handleDeleteNotebookEntry(e)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
              <BatchingSentinel batch={entriesBatch} />
            </div>
          ) : (loading || awaitingFeedEntries) && entries.length === 0 ? (
            /* Initial loading state */
            <div className="py-16 text-center text-xs text-muted-foreground" data-testid="stream-loading">
              Loading…
            </div>
          ) : entries.length === 0 && !loading && !awaitingFeedEntries ? (
            streamEmptyState
          ) : null}
        </div>
      )}

      {notebookStreamSlug && selectedBatchNoteIds.size > 0 && (
        <div
          data-testid={TEST_IDS.NOTEBOOK_BATCH_SCHEDULE_BAR}
          className="sticky bottom-4 z-30 mx-auto my-2 flex flex-wrap items-center gap-2.5 rounded-full border border-border bg-background/95 px-4 py-2 text-xs shadow-lg backdrop-blur-md"
        >
          <span className="font-semibold text-foreground">
            {selectedBatchNoteIds.size} selected
          </span>
          <input
            type="date"
            aria-label="Schedule selected workouts onto date"
            value={batchScheduleDate}
            onChange={(e) => setBatchScheduleDate(e.target.value)}
            disabled={batchScheduling}
            className="h-8 rounded border border-input bg-background px-2 text-xs"
          />
          <Button
            type="button"
            size="sm"
            disabled={batchScheduling || !batchScheduleDate}
            onClick={() => void handleConfirmBatchSchedule()}
            data-testid={TEST_IDS.NOTEBOOK_BATCH_SCHEDULE_SUBMIT}
          >
            {batchScheduling ? 'Scheduling…' : 'Schedule Selected'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={batchScheduling}
            onClick={() => setSelectedBatchNoteIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      <SchedulePeekDrawer
        entry={inspectedEntry}
        dayDate={inspectedDay}
        dayEntries={
          inspectedDay
            ? calendarOverlayEntries.filter(
                (item) =>
                  item.date === inspectedDay || item.scheduledDates?.includes(inspectedDay),
              )
            : undefined
        }
        onClose={handleClosePeek}
        onRunEntry={(entry) => void handleRunEntry(entry)}
        onPlanForDate={(dateKey) => setCreateOnDate(dateKey)}
        onSelectEntry={handleInspectEntry}
        onMutated={() => setSavedTick((t) => t + 1)}
      />

      {/* The calendar layouts start a new entry on a day — the dialog opens
          with that date, and the user picks the notebook it lands in. */}
      <CreateJournalNoteDialog
        open={createOnDate !== null}
        onOpenChange={open => {
          if (!open) setCreateOnDate(null)
        }}
        defaultKind={notebookStreamSlug ? 'note' : 'journal'}
        defaultDate={createOnDate ?? undefined}
        defaultNotebookSlug={notebookStreamSlug ?? undefined}
        onCreated={() => {
          // The new note is in the vault — re-run the query so the calendar
          // shows it on its day without a reload.
          setSavedTick(t => t + 1)
        }}
      />

      {/* Safe User Notebook Delete Confirmation Dialog */}
      <AlertDialog
        open={pendingDeleteNotebook !== null}
        onOpenChange={(open) => { if (!open && !deletingNotebook) setPendingDeleteNotebook(null) }}
      >
        <AlertDialogBackdrop />
        <AlertDialogContent className="max-w-sm" data-testid={TEST_IDS.NOTEBOOK_DELETE_DIALOG}>
          <DialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{pendingDeleteNotebook?.title || pendingDeleteNotebook?.sourceNotebook}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Any links pointing to this deleted notebook are detached; member notes remain intact (and become unfiled if no other notebook links remain).
            </AlertDialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <AlertDialogClose disabled={deletingNotebook}>
              Cancel
            </AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingNotebook}
              data-testid={
                pendingDeleteNotebook?.sourceNotebook
                  ? `notebook-delete-confirm-${pendingDeleteNotebook.sourceNotebook}`
                  : 'notebook-delete-confirm'
              }
              onClick={() => void handleConfirmDeleteNotebook()}
            >
              {deletingNotebook ? 'Deleting…' : 'Delete notebook'}
            </Button>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Safe Unsubscribe Confirmation Dialog */}
      <AlertDialog
        open={pendingUnsubscribeFeed !== null}
        onOpenChange={(open) => { if (!open) setPendingUnsubscribeFeed(null) }}
      >
        <AlertDialogBackdrop />
        <AlertDialogContent className="max-w-sm">
          <DialogHeader>
            <AlertDialogTitle>
              Unsubscribe from &ldquo;{pendingUnsubscribeFeed?.label}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Index entries from this feed will leave your feed browser, while the feed stays listed so you can subscribe again later. Any personal notes and workouts where you&apos;ve logged sessions remain pinned locally.
            </AlertDialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <AlertDialogClose disabled={pendingUnsubscribeFeed ? subscribingIds.has(pendingUnsubscribeFeed.feedId) : false}>
              Cancel
            </AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={pendingUnsubscribeFeed ? subscribingIds.has(pendingUnsubscribeFeed.feedId) : false}
              onClick={() => void handleConfirmUnsubscribe()}
            >
              {pendingUnsubscribeFeed && subscribingIds.has(pendingUnsubscribeFeed.feedId) ? 'Unsubscribing…' : 'Unsubscribe'}
            </Button>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Safe Remote Clone Target Notebook Picker Dialog */}
      <Dialog
        open={pendingCloneEntry !== null}
        onOpenChange={(open) => { if (!open && !cloningRemote) setPendingCloneEntry(null) }}
      >
        <DialogBackdrop />
        <DialogContent className="max-w-md bg-popover text-popover-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Clone to My Notes</DialogTitle>
            <DialogDescription>
              Choose one of your writable notebooks for &ldquo;{pendingCloneEntry?.title}&rdquo;. You will own this personal copy and can edit or publish it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label htmlFor="clone-target-notebook" className="block text-xs font-medium text-foreground">
                Destination notebook
              </label>
              <select
                id="clone-target-notebook"
                value={cloneTargetId}
                onChange={(e) => {
                  setCloneTargetId(e.target.value)
                  setCloneCreateNew(false)
                }}
                disabled={cloneCreateNew || cloningRemote}
                className="w-full min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {cloneTargetNotebooks.map((nb) => (
                  <option key={nb.id} value={nb.id}>
                    {nb.name || nb.slug}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setCloneCreateNew(v => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline underline-offset-2"
              >
                <FolderPlus className="size-3.5" aria-hidden="true" />
                {cloneCreateNew ? 'Use existing notebook instead' : 'Or create a new notebook'}
              </button>
              {cloneCreateNew && (
                <Input
                  type="text"
                  value={cloneNewName}
                  onValueChange={setCloneNewName}
                  placeholder="e.g., Kettlebell Block"
                  aria-label="New notebook name"
                  className="min-h-10"
                />
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={cloningRemote}
              onClick={() => setPendingCloneEntry(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={cloningRemote || (cloneCreateNew && !cloneNewName.trim())}
              onClick={() => void handleConfirmCloneRemote()}
            >
              {cloningRemote ? 'Cloning…' : 'Clone to Notebook'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ponytail: L3 controls (filters, layout, visible fields, grouping) live in L3 (SecondaryNav) */}
    </div>
  )
}
