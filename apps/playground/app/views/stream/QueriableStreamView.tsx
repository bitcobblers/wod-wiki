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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { useSeedLibraryMissing, useSeedReadiness } from '@/services/seed/seedReadiness'
import { syncSeedSource, type SeedSyncProgress } from '@/services/seed/seedSync'
import { getSyncActivity, subscribeSyncActivity } from '@/services/syncActivity'
import { CreateNotebookDialog } from '@/components/organisms/notebook/CreateNotebookDialog'
import { notebookService, storageService } from '@/hooks/useBrowserServices'
import { ProgressBar } from '../../components/atoms/ProgressBar'
import { parseQuery, isFindQuery, isPipelineQuery, type ParsedFindQuery } from '@bitcobblers/wod-wiki-engine'
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
import { defaultStreamQueryEngine, StreamQueryEngine } from '../../lib/entrySearch'
import { publishStreamResults } from './streamResults'
import { useNav } from '../../nav/NavContext'
import type { NavItemL3 } from '../../nav/navTypes'
import { ResponsiveActions } from '../../nav/ResponsiveActions'
import { CatalogsManagerDrawer } from '../../pages/CatalogsManagerDrawer'
import { effortPath, ROUTE_PATTERNS } from '../../lib/routes'
import { useComposerQueryState } from '../../hooks/useComposerQueryState'
import { useViewSettings } from '../../lib/viewSettingsStorage'
import { useBatchedItems, type BatchedItems } from '../../hooks/useBatchedItems'
import { todayKey } from '../../lib/dateFormat'
import { withoutFilters, withoutWindow, withGroupBy } from '../../lib/wqlEdits'
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
import { seedNoteId } from '@/services/seed/SeedImporter'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { useSeedContent } from '@/services/content/seedContent'

const contentProvider = new IndexedDBContentProvider()

const ALL_STREAM_GROUP_DIMS: readonly { id: string; label: string }[] = [
  { id: 'date', label: 'Date' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'tag', label: 'Tags' },
  { id: 'type', label: 'Type' },
  { id: 'discipline', label: 'Discipline' },
  { id: 'source', label: 'Source' },
  { id: 'origin', label: 'Origin' },
]
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
function seedSyncLabel(event: SeedSyncProgress): string {
  switch (event.phase) {
    case 'checking': return 'Checking the community library…'
    case 'fetching': return `Downloading ${event.chunkId ?? 'library'}…`
    case 'applying': return `Importing ${event.chunkId ?? 'library'}…`
    case 'committed': return `Committed ${event.chunkId ?? 'chunk'}`
    case 'finalizing': return 'Finalizing checkpoints…'
    case 'finished': return event.error ?? 'Done'
  }
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
   *  the global ⌘K palette consumes the getter while this view is mounted. */
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
  const seedReadiness = useSeedReadiness()
  const libraryMissing = useSeedLibraryMissing()
  // Inline community sync from the core-only notice (the probe above is
  // mount-only, so a successful sync suppresses it via librarySynced).
  const [librarySynced, setLibrarySynced] = useState(false)
  const [seedSyncRunning, setSeedSyncRunning] = useState(false)
  const [seedSyncEvent, setSeedSyncEvent] = useState<SeedSyncProgress | null>(null)
  const [seedSyncError, setSeedSyncError] = useState<string | null>(null)
  // Synchronize composer state with URL
  const { query, setQuery, urlQueryError } = useComposerQueryState({
    defaultQuery: () => profile.defaultWql,
    legacy: profile.legacy,
  })

  // Publish the live draft to the host's ⌘K seam while mounted; the getter
  // re-registers per draft change and unregisters on unmount/route change.
  useEffect(() => registerStreamDraft?.(() => query), [registerStreamDraft, query])

  // Per-route view settings (layout + field visibility)
  const { settings, setLayout, toggleField, setGroupBy } = useViewSettings(
    profile.route,
    profile.level,
    profile.defaultLayout,
  )

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

  // /catalogs in-situ source management. The grouped update notification and
  // subscription intake deep-link here via ?manage=1; the toolbar button opens
  // it in place. Closing drops ONLY the manage param — the query string (q, …)
  // survives — and replaces the history entry so a modal never stacks history.
  const isCatalogsRoute = profile.route === '/catalogs'
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
  const [createNotebookOpen, setCreateNotebookOpen] = useState(false)
  const handleCreateNotebook = useCallback(async (name: string, description: string, icon: string) => {
    const created = await notebookService.create(name, description, icon)
    await storageService.saveNote(notebookService.createNotebookLandingNote(created))
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
    if (profile.route.startsWith('/c/')) {
      const slug = profile.route.slice(3)
      if (slug && !slug.includes('/')) return slug
    }
    if (!parsed.error && isFindQuery(parsed)) {
      const cat = parsed.filters.find(f => f.key === 'catalog' && !f.negate)?.values[0]?.value
      if (cat) return cat
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

  // Inline sync of the bundled community library from the core-only notice —
  // the same syncSeedSource path the Settings per-source Sync button uses.
  const runLibrarySync = useCallback(async () => {
    setSeedSyncRunning(true)
    setSeedSyncError(null)
    setSeedSyncEvent(null)
    try {
      const outcome = await syncSeedSource('community', {
        force: true,
        onProgress: setSeedSyncEvent,
      })
      if (outcome === 'imported' || outcome === 'current') {
        // Content landed in the active storage: drop the notice and re-run
        // the mounted query so imported entries appear without a refresh.
        setLibrarySynced(true)
        setSavedTick((t) => t + 1)
      } else if (outcome === 'busy') {
        setSeedSyncError('Another tab is already syncing — wait for it to finish, then try again.')
      } else if (outcome === 'disabled') {
        setSeedSyncError('Seed import is disabled.')
      }
      // 'error' surfaces through the finished progress event's message.
    } finally {
      setSeedSyncRunning(false)
    }
  }, [])
  useEffect(() => {
    if (seedReadiness === 'preparing') return
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
  }, [query, activeEngine, parsed, location.pathname, seedReadiness, savedTick])

  // Grouping: the committed run's query `by {}` dimensions win; otherwise
  // the view setting, then the level default. The query leg is stored WITH
  // the results at commit time — a mid-edit draft (valid or not) never
  // regroups the previous results; view/level legs regroup entries live.
  const groupDims = useMemo<string[]>(() => {
    if (queryRunDims?.length) return queryRunDims
    if (settings.groupBy) return [settings.groupBy]
    return [profile.level === 'effort' ? 'discipline' : 'date']
  }, [queryRunDims, settings.groupBy, profile.level])
  const groupingSource: 'query' | 'view' | 'level' = queryRunDims?.length
    ? 'query'
    : settings.groupBy
      ? 'view'
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
    return ALL_STREAM_GROUP_DIMS.filter(d => supported.includes(d.id))
  }, [parsed, profile.level])

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
    })
    return () => setStreamControls?.(null)
  }, [query, setQuery, groupDims, handleToggleGroupDim, availableGroupDims, setStreamControls, settings, setLayout, toggleField, profile.level])

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

  // Empty state remedies
  const emptyStateRemedies = useMemo(() => {
    const remedies: { id: string; label: string; apply: () => void }[] = []
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
    const activeFilters = parsed.error ? [] : parsed.filters.filter(f => f.key !== 'source')
    if (activeFilters.length > 0) {
      remedies.push({
        id: 'clear-filters',
        label: activeFilters.length === 1 ? 'Clear filter' : `Clear filters (${activeFilters.length})`,
        apply: () => setQuery(withoutFilters(query)),
      })
    }
    return remedies
  }, [parsed, query, setQuery, execute])

  // Shared empty state for the grouped layouts (Cards / Feed) — same query,
  // same remedies, whichever mode is active.
  const streamEmptyState = (
    <div
      className="px-6 py-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-3"
      data-testid="stream-empty-state"
    >
      <p className="text-sm font-medium">
        {profile.emptyMessage ?? (parsed.window
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
  if (seedReadiness === 'preparing') {
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
                <span>Manage Catalogs</span>
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
      {profile.seedNotice && libraryMissing && !librarySynced && (
        <div className="px-4 pt-3 sm:px-6 lg:px-8" data-testid="seed-library-notice">
          <div className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <CloudDownload className="size-4 text-primary" />
                Only the core seed is imported
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The content for this page comes from community libraries, which are not imported yet.
                Sync now to import the community library — or open Sync settings to add more sources
                (mirrors, your own libraries).
              </p>
              {seedSyncEvent && (
                <div className="space-y-1.5 pt-1" data-testid="seed-library-notice-progress">
                  <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
                    {seedSyncLabel(seedSyncEvent)}
                  </p>
                  {seedSyncEvent.phase !== 'checking' && seedSyncEvent.phase !== 'finished'
                    ? <ProgressBar value={seedSyncEvent.completedChunks} max={seedSyncEvent.totalChunks} label="Community library import progress" className="max-w-sm" />
                    : seedSyncRunning
                      ? <progress aria-label="Checking the community library" className="h-2 max-w-sm w-full" />
                      : null}
                </div>
              )}
              {(seedSyncError ?? (seedSyncEvent?.phase === 'finished' ? seedSyncEvent.error : null)) && (
                <p className="text-xs text-destructive" data-testid="seed-library-notice-error">
                  {seedSyncError ?? (seedSyncEvent?.phase === 'finished' ? seedSyncEvent.error : null)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                onClick={() => void runLibrarySync()}
                disabled={seedSyncRunning}
                data-testid="seed-library-notice-sync"
                className="gap-2"
              >
                <RefreshCw className={`size-3.5 ${seedSyncRunning ? 'animate-spin' : ''}`} />
                <span>{seedSyncRunning ? 'Syncing…' : 'Sync now'}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(ROUTE_PATTERNS.settingsSync)}
                data-testid="seed-library-notice-settings"
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
