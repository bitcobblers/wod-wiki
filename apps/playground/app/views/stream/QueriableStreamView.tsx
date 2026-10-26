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
  Plus,
  RefreshCw,
  Settings2,
  TriangleAlertIcon,
} from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/atoms/primitives/button'
import { queryService } from '@/services/queryService'
import { onResultSaved } from '@/services/resultRecorder'
import { useFeedLibraryMissing, useFeedReadiness } from '@/services/feed/feedReadiness'
import { defaultFeedSources, syncFeedSource, type FeedSyncProgress } from '@/services/feed/feedSync'
import { isFeedSubscribed, subscribeFeedSubscriptions } from '@/services/feed/feedSubscriptions'
import { toast } from '@/hooks/use-toast'
import { getSyncActivity, subscribeSyncActivity } from '@/services/syncActivity'
import { CreateNotebookDialog } from '@/components/organisms/notebook/CreateNotebookDialog'
import { NotebookList } from '@/components/organisms/notebook/NotebookList'
import { notebookService } from '@/hooks/useBrowserServices'
import { ProgressBar } from '../../components/atoms/ProgressBar'
import { parseQuery, isFindQuery, isPipelineQuery, notebookSlugFromId, serialize, type ParsedFindQuery } from '@bitcobblers/wod-wiki-engine'
import { wqlFilterKeys, wqlGroupingDimensions } from '@bitcobblers/wod-wiki-wql'
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
import type { NavItemL3 } from '../../nav/navTypes'
import { ResponsiveActions } from '../../nav/ResponsiveActions'
import { CatalogsManagerDrawer } from '../../pages/CatalogsManagerDrawer'
import { OUTCOME_LABEL } from '../../pages/SyncSection'
import { effortPath, ROUTE_PATTERNS } from '../../lib/routes'
import { useComposerQueryState } from '../../hooks/useComposerQueryState'
import { useViewSettings } from '../../lib/viewSettingsStorage'
import { useBatchedItems, type BatchedItems } from '../../hooks/useBatchedItems'
import { todayKey } from '../../lib/dateFormat'
import { withoutWindow, withGroupBy } from '../../lib/wqlEdits'
import { LibraryRow } from '../library/LibraryRow'
import { PropertyTable } from './PropertyTable'
import { StreamFeed } from './StreamFeed'
import { journalNotes } from '../../services/journalNotes'
import { ensurePlaygroundEntry } from '../../services/createPlaygroundPage'
import { addEntryToTodayInput } from '../../lib/addToToday'
import { startEntryRun } from '../../lib/entryRun'
import { playgroundPath } from '../../lib/routes'
import type { StreamProfile } from './streamProfile'
import { splitReadmeQueries, hasReadmeQuery } from './readmeWql'
import { ReadmeQueryBlock } from './ReadmeQueryBlock'
import { CanvasProse } from '../../canvas/CanvasProse'
import { seedNoteId } from '@/services/feed/FeedImporter'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { useSeedContent } from '@/services/content/seedContent'

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
      className="px-6 py-4 text-center text-xs text-muted-foreground/60"
      data-testid={testId}
    >
      Loading more — {batch.total - batch.visible.length} remaining…
    </div>
  )
}

/** Host-owned execution debounce for stream queries — the composer resolves
 *  drafts synchronously; only the run coalesces (existing 150ms behavior). */
const STREAM_EXECUTE_DEBOUNCE_MS = 150

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

/** Compact query truth strip beneath the composer (desktop) / top of the
 *  stream (mobile): validity, target, matched of total, applied vs ignored
 *  filters, ignored advisories, the grouping dimensions and their
 *  precedence source. Fed from the run's own stage callback — no extra
 *  scans. */
function StreamQueryStatus({
  error,
  target,
  matched,
  total,
  loading,
  applied,
  ignored,
  advisories,
  groupDims,
  groupingSource,
}: {
  error: string | null
  target: string | null
  matched: number
  total: number
  loading: boolean
  applied: number
  ignored: number
  advisories: readonly string[]
  groupDims: string[]
  groupingSource: string
}) {
  return (
    <div
      role="status"
      data-testid="stream-query-status"
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground"
    >
      {error ? (
        <span className="font-semibold text-destructive">Invalid query — showing previous results</span>
      ) : target ? (
        <span className="font-mono">:{target}</span>
      ) : null}
      <span aria-hidden="true">·</span>
      <span data-testid="stream-query-counts" className={loading ? 'motion-safe:animate-pulse' : undefined}>
        {matched} of {total}
      </span>
      <span aria-hidden="true">·</span>
      <span data-testid="stream-query-filters">
        {applied} applied{ignored > 0 ? `, ${ignored} ignored` : ''}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        by {groupDims.join(', ')}{' '}
        <span className="text-muted-foreground/60">({groupingSource})</span>
      </span>
      {advisories.map(advisory => (
        <p key={advisory} className="w-full break-words text-amber-700 dark:text-amber-400">
          {advisory}
        </p>
      ))}
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
  /** Register a getter for the LIVE composer draft (invalid text included —
   *  invalid drafts never reach the URL). Returns the unregister cleanup;
   *  the global ⌘/ palette consumes the getter while this view is mounted. */
  registerStreamDraft?: (getDraft: () => string | null) => () => void
}

export function QueriableStreamView({
  profile,
  actions,
  queryEngine,
  onAddToToday,
  registerStreamDraft,
}: QueriableStreamViewProps) {
  const navigate = useNavigate()
  const location = useLocation()
  // First-run gate: the vault query must not execute until the seed import
  // has settled, or a fresh profile briefly commits a permanent "0 of 0".
  const feedReadiness = useFeedReadiness()
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

  // Publish the live draft to the host's ⌘/ seam while mounted; the getter
  // re-registers per draft change and unregisters on unmount/route change.
  useEffect(() => registerStreamDraft?.(() => query), [registerStreamDraft, query])

  // Per-route view settings (layout + field visibility)
  const { settings, setLayout, toggleField, setGroupBy } = useViewSettings(
    profile.route,
    profile.level,
    profile.defaultLayout,
  )

  // This page's own query settings — the landing default, the Where-stored
  // and Group-By favorites and the saved shortcuts, edited where the query
  // lives. Only surfaces WITH a configurable surface offer it (detail routes
  // resolve a profile per item, so they keep their in-code defaults).
  const querySettingsSurface = queryConfigSurface(profile.route)
  const [querySettingsOpen, setQuerySettingsOpen] = useState(false)

  const [entries, setEntries] = useState<Entry[]>([])
  // The run's own stage counts (scope population vs matches) — captured from
  // the engine's stage callback, never a second scan.
  const [stages, setStages] = useState<{ selected: number; matched: number } | undefined>(undefined)
  // The committed run's query-leg `by {}` dims — stored together with the
  // results they grouped; null when that run carried no query grouping.
  const [queryRunDims, setQueryRunDims] = useState<string[] | null>(null)
  const [shelfOpen, setShelfOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // Mobile: the query bar portals into the app navbar (no page header).
  const isMobile = useIsMobile()
  const mobileSlot = useMobileQuerySlot()

  // /notebooks in-situ source management. The grouped update notification and
  // subscription intake deep-link here via ?manage=1; the toolbar button opens
  // it in place. Closing drops ONLY the manage param — the query string (q, …)
  // survives — and replaces the history entry so a modal never stacks history.
  const isCatalogsRoute = profile.route === '/notebooks'
  const manageOpen = useMemo(
    () => isCatalogsRoute && new URLSearchParams(location.search).get('manage') === '1',
    [isCatalogsRoute, location.search],
  )
  const setManageOpen = useCallback((open: boolean) => {
    const params = new URLSearchParams(location.search)
    if (open) params.set('manage', '1')
    else params.delete('manage')
    const search = params.toString()
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: !open })
  }, [navigate, location.pathname, location.search])
  const catalogsManager = isCatalogsRoute ? (
    <CatalogsManagerDrawer open={manageOpen} onOpenChange={setManageOpen} />
  ) : null
  // The subscribe offer's target: /notebooks manages sources in place (the
  // drawer); every other route defers to Sync settings — no drawer there.
  const openLibraryManager = useCallback(() => {
    if (isCatalogsRoute) setManageOpen(true)
    else navigate(ROUTE_PATTERNS.settingsSync)
  }, [isCatalogsRoute, setManageOpen, navigate])
  const [createNotebookOpen, setCreateNotebookOpen] = useState(false)
  const handleCreateNotebook = useCallback(async (name: string, description: string, icon: string) => {
    // The landing note (the notebook's stored definition) is part of create().
    const created = await notebookService.create(name, description, icon)
    setSavedTick(t => t + 1)
    return created
  }, [])
  const createNotebookDialog = isCatalogsRoute ? (
    <CreateNotebookDialog
      open={createNotebookOpen}
      onOpenChange={setCreateNotebookOpen}
      onCreate={handleCreateNotebook}
    />
  ) : null

  const parsed = useMemo(() => parseQuery(query), [query])

  // Playground scope: the canonical filter source:playground (authored as
  // :playground{...}). In this scope the "Catalog Sessions" shelf would
  // mislabel undated playground entries — they render in the explicit
  // 'Undated' group instead.
  const isPlaygroundScope = useMemo(() => {
    if (parsed.error || isPipelineQuery(parsed)) return false
    return parsed.filters.some(
      f => f.key === 'source' && !f.negate && f.values.some(v => v.value === 'playground'),
    )
  }, [parsed])
  const catalogSlug = useMemo(() => {
    if (profile.catalog) return profile.catalog
    if (profile.route.startsWith('/notebook/')) {
      const slug = profile.route.slice(3)
      if (slug && !slug.includes('/')) return slug
    }
    if (!parsed.error && isFindQuery(parsed)) {
      const cat = parsed.filters.find(f => (f.key === 'notebook' || f.key === 'catalog') && !f.negate)?.values[0]?.value
      if (cat) return notebookSlugFromId(cat)
    }
    return undefined
  }, [profile, parsed])

  const seedFiles = useSeedContent()
  const [readmeContent, setReadmeContent] = useState<string | null>(null)
  // WQL embed links (`[heading](:query)!`) — when any are present they
  // override the catalog's default feed stream below the readme.
  const readmeSegments = useMemo(
    () => (readmeContent ? splitReadmeQueries(readmeContent) : []),
    [readmeContent],
  )
  const readmeOverride = hasReadmeQuery(readmeSegments)

  useEffect(() => {
    if (!catalogSlug) {
      setReadmeContent(null)
      return
    }
    const seedPath = `markdown/collections/${catalogSlug}/README.md`
    const raw = seedFiles?.[seedPath]
    if (raw) {
      setReadmeContent(raw.replace(/\{\{workouts\}\}/g, '').trim())
    }

    let cancelled = false
    void seedNoteId(seedPath).then(async (id) => {
      try {
        const entry = await contentProvider.getEntry(id)
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
  }, [catalogSlug, seedFiles])


  // Feed mode attaches note block info (excerpt + wod content id) via the same
  // engine's block-plane companion query — never a second query-state seam.
  const activeEngine = useMemo<StreamQueryEngine>(() => {
    const base = queryEngine ?? defaultStreamQueryEngine
    return settings.layout === 'feed' ? base.withNoteBlockInfo() : base
  }, [queryEngine, settings.layout])

  const defaultAddToToday = useCallback(async (entry: Entry) => {
    const today = todayKey()
    let rawContent = ''
    const targetNoteId =
      entry.kind === 'result' || entry.kind === 'segment'
        ? entry.execution?.noteId
        : entry.kind === 'note'
          ? entry.sourceItem
          : entry.id

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

      // 3. If still no content, fetch all blocks for the note (catalog sessions, feeds, or indexed notes)
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
        navigate(playgroundPath(routeId.replace(/^playground\//, '')))
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
  // A committed result bumps savedTick so the mounted listing re-queries.
  const [savedTick, setSavedTick] = useState(0)

  // Notebook-plane management (ticket 05): the /notebooks list plus the move
  // targets the stream rows offer (user-owned notebooks only — feed
  // notebooks are read-only).
  const [moveNotebookTargets, setMoveNotebookTargets] = useState<Array<{ id: string; name: string; icon: string }>>([])
  useEffect(() => {
    let cancelled = false
    void notebookService.getAllCatalogNotebooks().then((all) => {
      if (cancelled) return
      setMoveNotebookTargets(all
        .filter(nb => nb.origin === 'user' || nb.origin === 'default')
        .filter(nb => nb.slug !== 'guides' && nb.slug !== 'playground')
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
  useEffect(() => onResultSaved(() => setSavedTick((t) => t + 1)), [])
  // A sync that commits records (inline notice run, Settings page, another
  // tab) changes the vault under the mounted query — re-run it so imported
  // entries appear without a refresh. Only `result` bumps (not task
  // start/end) so unrelated activity never re-executes.
  useEffect(() => {
    let lastSeen = getSyncActivity().result?.id ?? -1
    return subscribeSyncActivity(() => {
      const id = getSyncActivity().result?.id ?? -1
      if (id !== lastSeen) {
        lastSeen = id
        setSavedTick((t) => t + 1)
      }
    })
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
    if (feedReadiness === 'preparing') return
    if (parsed.error) {
      setLoading(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      setStages(undefined)
      activeEngine
        .query(query, next => {
          // Stage counts cancel together with results — a superseded run
          // never publishes counts.
          if (!cancelled) setStages(next)
        })
        .then((results: Entry[]) => {
          if (!cancelled) {
            setEntries(results)
            // Bind the query-leg grouping to the COMMITTED run: transient
            // draft edits (each valid intermediate re-parses) must never
            // regroup the still-displayed previous results.
            setQueryRunDims(parseGroupingDimensions(query, parsed))
            // One full execution per query change — nav facet panels read
            // this snapshot instead of re-running the query.
            publishStreamResults({ pathname: location.pathname, query, entries: results })
          }
        })
        .catch(() => {
          if (!cancelled) {
            setEntries([])
            publishStreamResults({ pathname: location.pathname, query, entries: [] })
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, STREAM_EXECUTE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, activeEngine, parsed, location.pathname, feedReadiness, savedTick])

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
  // Filter truth vs the target's own vocabulary: the executor IGNORES
  // unsupported keys (advisory) — the strip says applied vs ignored instead
  // of implying every requested filter ran.
  const supportedFilterKeys = useMemo(
    () => new Set(parsed.error || !isFindQuery(parsed) ? [] : wqlFilterKeys(parsed.target, 'find')),
    [parsed],
  )
  const appliedFilters = parsed.error || isPipelineQuery(parsed) ? 0 : parsed.filters.filter(f => supportedFilterKeys.has(f.key)).length
  const ignoredFilters = (parsed.error || isPipelineQuery(parsed) ? 0 : parsed.filters.length) - appliedFilters

  // Full dataset grouped by dimension
  const shelfVisible = profile.shelfVisible && !isPlaygroundScope
  const allGroups = useMemo(
    () => groupEntriesByDimension(entries, groupDims, { shelfVisible }),
    [entries, groupDims, shelfVisible],
  )

  // Progressive DOM batching — destructure members (growTo is a stable
  // callback) so effects/memos depend on values, not the per-render object.
  const entriesBatch = useBatchedItems(entries)
  const { visible: batchedVisible, growTo: growBatchTo } = entriesBatch
  const visibleGroups = useMemo(
    () => groupEntriesByDimension(batchedVisible, groupDims, { shelfVisible }),
    [batchedVisible, groupDims, shelfVisible],
  )
  const groupCountMap = useMemo(() => new Map(allGroups.map(g => [g.id, g.entries.length])), [allGroups])

  // Publish dynamic section links and L3 stream controls to NavContext
  const { setL3Items, scrollToSection, navState, setStreamControls } = useNav()
  useEffect(() => {
    if (allGroups.length === 0) {
      setL3Items([])
      return
    }
    const sectionLinks: NavItemL3[] = allGroups.map(g => ({
      id: g.id,
      label: g.label,
      level: 3,
      action: { type: 'scroll', sectionId: g.id },
    }))
    setL3Items(sectionLinks)
    return () => setL3Items([])
  }, [allGroups, setL3Items])

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

  useEffect(() => {
    setStreamControls?.({
      query,
      onQueryChange: setQuery,
      groupDims,
      onToggleGroupDim: handleToggleGroupDim,
      availableGroupDims,
      settings,
      onLayoutChange: setLayout,
      onToggleField: toggleField,
      level: profile.level,
      ...(querySettingsSurface ? { onOpenQuerySettings: () => setQuerySettingsOpen(true) } : {}),
    })
    return () => setStreamControls?.(null)
  }, [query, setQuery, groupDims, handleToggleGroupDim, availableGroupDims, setStreamControls, settings, setLayout, toggleField, profile.level, querySettingsSurface])

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
  const queryError = urlQueryError ?? composedError

  // The route default's own filters — exactly what its head injects (scope +
  // plane type). Subtracted from a user query to find authorship.
  const defaultImpliedFilters = useMemo(() => {
    const baseline = parseQuery(profile.defaultWql)
    return !baseline.error && isFindQuery(baseline) ? baseline.filters : []
  }, [profile.defaultWql])

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
      const label = w.kind === 'relative' ? `last ${w.size}${w.unit}` : `from ${w.start}${w.end ? ` to ${w.end}` : ''}`
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
  // same remedies, whichever mode is active.
  const streamEmptyState = (
    <div
      className="px-6 py-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-3"
      data-testid="stream-empty-state"
    >
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
    </div>
  )

  // Invalid draft: previous results stay visible but visibly stale.
  const stale = !!parsed.error && entries.length > 0

  // First-run vault gate: skeleton until the seed import settles, then the
  // query effect above runs against the full corpus on this mount.
  if (feedReadiness === 'preparing') {
    return (
      <div
        className="bg-card flex flex-col flex-1"
        data-testid="stream-preparing"
        role="status"
        aria-busy="true"
      >
        {catalogsManager}
        {createNotebookDialog}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="w-full max-w-2xl space-y-3" aria-hidden="true">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          </div>
          <span className="text-sm text-muted-foreground">Loading library…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card flex flex-col flex-1" data-testid="queriable-stream-view">
      {catalogsManager}
      {createNotebookDialog}
      {querySettingsSurface && (
        <QuerySettingsDialog
          surface={querySettingsSurface}
          open={querySettingsOpen}
          onOpenChange={setQuerySettingsOpen}
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
        actions={
          <ResponsiveActions
            primary={
              profile.route === '/efforts' ? (
                <Button
                  size="sm"
                  onClick={() => navigate(effortPath('new', undefined, { mode: 'create' }))}
                  className="h-9 px-2.5 text-xs gap-1.5"
                  data-testid="efforts-catalog-create-btn"
                >
                  <Plus className="size-3.5" />
                  <span>New</span>
                </Button>
              ) : isCatalogsRoute ? (
                <Button
                  size="sm"
                  onClick={() => setCreateNotebookOpen(true)}
                  className="h-9 px-2.5 text-xs gap-1.5"
                  data-testid="notebooks-create-button"
                >
                  <Plus className="size-3.5" />
                  <span>New Notebook</span>
                </Button>
              ) : undefined
            }
            label="Stream actions"
          >
            {isCatalogsRoute && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setManageOpen(true)}
                data-testid="manage-catalogs-button"
                className="h-9 gap-1.5 px-2.5 text-xs"
              >
                <Settings2 className="size-3.5" />
                <span>Manage Notebooks</span>
              </Button>
            )}
            {actions}
          </ResponsiveActions>
        }
        queryBar={
          <StreamQueryBar
            query={query}
            onQueryChange={setQuery}
            scopeOptions={profile.scopeOptions}
            execute={execute}
            defaultQuery={profile.defaultWql}
            route={profile.route}
          />
        }
      />

      {/* Query truth strip — one instance under the header: beneath the
          composer on desktop, top-of-page status on mobile (the header is
          max-lg:hidden). Never duplicated in the page body. */}
      <div className="px-4 pt-2 sm:px-6 lg:px-8" data-testid="stream-query-status-row">
        <StreamQueryStatus
          error={queryError}
          target={parsed.error ? null : isFindQuery(parsed) ? parsed.target : parsed.family}
          matched={entries.length}
          total={Math.max(stages?.selected ?? 0, entries.length)}
          loading={loading}
          applied={appliedFilters}
          ignored={ignoredFilters}
          advisories={parsed.error ? [] : parsed.advisories ?? []}
          groupDims={groupDims}
          groupingSource={groupingSource}
        />
      </div>

      {/* ponytail: the nudge is a passive hint — upgrade to an inline source
          picker when the "Empty-option nudge UX" ticket lands. An empty
          scopeOptions list is a deliberate Route WQL Config state. */}
      {profile.scopeOptions.length === 0 && (
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
                {subscribedLibraryIds.length > 0
                  ? 'The content for this page comes from your subscribed libraries, which have not been imported yet. Sync now to import them — or open Sync settings to add more sources (mirrors, your own libraries).'
                  : 'The content for this page comes from library sources, and none are subscribed yet. Browse the library manager to subscribe — mirrors and your own libraries both work.'}
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

      {/* Notebook plane: the management list on /notebooks — defaults, the
          user's own, the feed libraries and the core references. */}
      {isCatalogsRoute && (
        <NotebookList refreshKey={savedTick} onChanged={() => setSavedTick(t => t + 1)} />
      )}

      {/* Read-only view of the collection readme note. WQL embed links
          (`[heading](:query)!`) inject live query results in place; any
          embed suppresses the default stream below (the override). */}
      {readmeContent && (
        <div
          className="border-b border-border/60 bg-card/20 px-6 py-4"
          data-testid="collection-readme-note"
        >
          {readmeSegments.map((segment, index) =>
            segment.kind === 'markdown' ? (
              <CanvasProse key={index} prose={segment.text} />
            ) : (
              <ReadmeQueryBlock
                key={index}
                query={segment.query}
                heading={segment.heading}
                onAddToToday={handleAddToToday}
                onRunStart={handleRunEntry}
              />
            ),
          )}
        </div>
      )}

      {/* Main Content: Rows (table) / Feed (rich cards) / Cards (grouped stream).
          An invalid draft dims retained results — visibly stale, still inspectable.
          With readme query tokens the injected blocks replace this stream. */}
      {readmeOverride ? null : settings.layout === 'rows' ? (
        <div className={stale ? 'flex-1 opacity-50 transition-opacity' : 'flex-1'}>
          <PropertyTable
            entries={entries}
            level={profile.level}
            visibleFieldIds={settings.visibleFields}
            stickyHeaderTop={stickyOffset}
            emptyMessage={profile.emptyMessage ?? 'No matching records found.'}
          />
        </div>
      ) : settings.layout === 'feed' ? (
        visibleGroups.length > 0 ? (
          <StreamFeed
            groups={visibleGroups}
            batch={entriesBatch}
            stickyOffset={stickyOffset}
            onRunEntry={handleRunEntry}
            onSendToPlayground={handleSendToPlayground}
            onAddToToday={handleAddToToday}
            moveNotebookTargets={moveNotebookTargets}
            onMoveNotebook={(entry, notebookId) => void handleMoveNotebook(entry.noteId, notebookId)}
          />
        ) : loading && entries.length === 0 ? (
          <div className="py-16 text-center text-xs text-muted-foreground/60" data-testid="stream-loading">
            Loading…
          </div>
        ) : entries.length === 0 && !loading ? (
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
                          <span className="text-[10px] font-bold text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded-full">
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
                              onMoveNotebook={(e, notebookId) => void handleMoveNotebook(e.noteId, notebookId)}
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
                        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
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
                          onAddToToday={handleAddToToday}
                          onRunStart={handleRunEntry}
                          moveNotebookTargets={moveNotebookTargets}
                          onMoveNotebook={(e, notebookId) => void handleMoveNotebook(e.noteId, notebookId)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
              <BatchingSentinel batch={entriesBatch} />
            </div>
          ) : loading && entries.length === 0 ? (
            /* Initial loading state */
            <div className="py-16 text-center text-xs text-muted-foreground/60" data-testid="stream-loading">
              Loading…
            </div>
          ) : entries.length === 0 && !loading ? (
            streamEmptyState
          ) : null}
        </div>
      )}
      {/* ponytail: view controls (layout, visible fields, grouping) live in L3 (SecondaryNav) */}
    </div>
  )
}
