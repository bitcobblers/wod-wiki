/**
 * SyncSection — /settings/sync, and (via NotebookManageDrawer) the /notebooks
 * manager. Content sync feeds for the active data location: the bundled core
 * feed, built-in community catalogs, and user-registered feeds.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CloudDownload, RefreshCw, CheckCircle2, AlertCircle, Link2, HardDriveDownload, Loader2 } from 'lucide-react'
import { Button, Input } from '@bitcobblers/wod-wiki-ui/primitives'
import { EditorDialog } from '@bitcobblers/wod-wiki-ui'
import {
  deleteFeedSource,
  downloadFeedOffline,
  probeFeedManifest,
  readFeedStatus,
  runFeedSync,
  subscribeFeed,
  subscribeFeedUpdates,
  syncFeedSource,
  toggleNotebookSubscription,
  unsubscribeFeedSource,
  type FeedSourceStatus,
  type FeedStatus,
  type FeedSyncOutcome,
  type FeedSyncProgress,
} from '@/services/feed/feedSync'
import type { FeedImportProgress } from '@/services/feed/FeedImporter'
import {
  flushFeedStatePersistence,
  getFeedSubscriptionMode,
  isFeedAutoSync,
  setFeedAutoSync,
  setFeedOfflinePolicy,
  setFeedSubscribed,
  subscribeFeedSubscriptions,
} from '@/services/feed/feedSubscriptions'
import type { ProbedFeedManifest } from '@/services/feed/feedCatalog'
import { ProgressBar } from '../components/atoms/ProgressBar'
import { toast } from '@/hooks/use-toast'
import { formatDateTimeMediumShort } from '@/lib/dateFormat'
import { feedPath } from '../lib/routes'
import { FeedInspectCard, formatFeedBytes, formatFeedProbeError } from '../views/notebook-gallery/FeedIntakeBanner'

const formatFeedVersion = (version: number): string =>
  formatDateTimeMediumShort(new Date(version))

/** One toast per sync outcome, labeled with the source that produced it. */
function announceOutcome(outcome: string, label: string): void {
  if (outcome === 'imported') {
    toast({
      title: `${label} synced`,
      description: 'Content was synced from the published feed. Your own edits and logged workouts were kept.',
    })
  } else if (outcome === 'error') {
    toast({
      title: `${label} sync failed`,
      description: 'Check your connection and try again.',
      variant: 'destructive',
    })
  } else if (outcome === 'busy') {
    toast({ title: 'Another tab is already syncing', description: 'Wait for it to finish, then try again.' })
  } else {
    toast({ title: `${label} is up to date` })
  }
}

type SourceProgress = {
  event: FeedSyncProgress
  imported: FeedImportProgress | null
  chunks: string[]
}

/** Exported for the stream surfaces' inline sync notice. */
export const OUTCOME_LABEL: Record<FeedSyncOutcome, string> = {
  imported: 'Synced',
  current: 'Up to date',
  'server-stale': 'Published version is older than the stored version',
  'update-pending': 'Update available',
  busy: 'Another tab is syncing',
  disabled: 'Feed import is disabled',
  error: 'Sync failed',
}

function progressLabel(event: FeedSyncProgress): string {
  switch (event.phase) {
    case 'checking': return 'Checking source…'
    case 'fetching': return `Downloading ${event.chunkId}…`
    case 'applying': return `Importing ${event.chunkId}…`
    case 'committed': return `Committed ${event.chunkId}`
    case 'finalizing': return 'Finalizing checkpoints…'
    case 'finished': return event.error ?? OUTCOME_LABEL[event.outcome]
  }
}

function SourceCard({ source, running, subscribing = false, disabled, onSync, onSubscribe, onDownloadOffline, onSwitchIndexOnly, onUnsubscribe, onDelete, onAutoSync, onToggleNotebook }: {
  source: FeedSourceStatus
  running: boolean
  subscribing?: boolean
  disabled: boolean
  onSync: (id: string) => void
  onSubscribe: (id: string) => void
  onDownloadOffline: (id: string) => void
  onSwitchIndexOnly: (id: string) => void
  onUnsubscribe: (id: string) => void
  onDelete: (id: string) => void
  onAutoSync: (id: string, enabled: boolean) => void
  onToggleNotebook: (feedId: string, chunkId: string, subscribed: boolean) => void
}) {
  const navigate = useNavigate()
  const autoSync = useSyncExternalStore(subscribeFeedSubscriptions, () => isFeedAutoSync(source.id))
  const allNotebooks = source.notebooks.filter(notebook => notebook.id !== source.id)
  const subMode = getFeedSubscriptionMode(source.id)
  const subscribedCount = allNotebooks.filter(notebook => notebook.subscribed).length
  const core = source.autoImport
  const isOfflineFull = core || source.offlinePolicy === 'offline-full'
  const isIndexActive = source.subscribed && !isOfflineFull
  const pending = source.subscribed && isOfflineFull && !source.upToDate && source.remote !== null
  const moreDetailsRef = useRef<HTMLDetailsElement>(null)

  useLayoutEffect(() => {
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && moreDetailsRef.current?.open) {
        e.preventDefault()
        moreDetailsRef.current.open = false
        moreDetailsRef.current.removeAttribute('open')
        moreDetailsRef.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('keydown', onDocKeyDown)
    return () => document.removeEventListener('keydown', onDocKeyDown)
  }, [])

  const closeDetails = (e: React.SyntheticEvent) => {
    const details = (e.currentTarget as HTMLElement).closest('details')
    if (details) details.open = false
  }

  const sizeSummary = isIndexActive
    ? (source.indexBytes && source.indexBytes > 0 ? `${formatFeedBytes(source.indexBytes)} index` : 'Index-only')
    : formatFeedBytes(source.chunkBytes ?? source.bytes)

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid={`feed-source-${source.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <Link
            to={feedPath(source.id)}
            className="no-underline hover:underline text-sm font-semibold text-foreground truncate"
          >
            {source.label}
          </Link>
          <span
            className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded shrink-0 ${
              source.subscribed
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {source.subscribed ? 'Subscribed' : 'Not subscribed'}
          </span>
          {core && (
            <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              Core
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {!source.subscribed || subscribing ? (
            <Button
              size="sm"
              onClick={() => onSubscribe(source.id)}
              disabled={disabled || Boolean(subscribing)}
              aria-busy={running || Boolean(subscribing)}
              data-testid={`feed-subscribe-${source.id}`}
              className="gap-2"
            >
              {running || subscribing ? (
                <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CloudDownload className="size-3.5" aria-hidden="true" />
              )}
              <span>{running || subscribing ? 'Subscribing…' : 'Subscribe'}</span>
            </Button>
          ) : pending ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSync(source.id)}
              disabled={disabled}
              data-testid={`feed-sync-${source.id}`}
              className="gap-2"
            >
              <RefreshCw className={`size-3.5 ${running ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{running ? 'Syncing…' : 'Sync'}</span>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5" data-testid={`feed-current-${source.id}`}>
              <CheckCircle2 className="size-3.5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
              {isIndexActive
                ? 'Index active'
                : source.remote === null
                  ? 'Remote unreachable'
                  : 'Up to date'}
            </span>
          )}
          <label
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={source.subscribed
              ? 'Apply new published versions automatically during the load-time check. Turning it off never removes content.'
              : 'Unsubscribed sources never auto-import.'}
          >
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={autoSync}
              disabled={disabled || !source.subscribed}
              onChange={(event) => onAutoSync(source.id, event.target.checked)}
              aria-label={`Auto-sync ${source.label}`}
              data-testid={`feed-autosync-${source.id}`}
            />
            <span>Auto-sync</span>
          </label>
          {/* Native details/summary overflow — opens without JavaScript, keyboard reachable. */}
          <details
            ref={moreDetailsRef}
            className="relative shrink-0"
            data-testid={`feed-more-${source.id}`}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.currentTarget.open = false
                e.currentTarget.querySelector('summary')?.focus()
              }
            }}
          >
            <summary
              aria-label={`More actions for ${source.label}`}
              className="flex cursor-pointer list-none items-center justify-center rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden"
            >
              …
            </summary>
            <div
              className="fixed inset-0 z-50"
              data-testid="feed-more-backdrop"
              aria-hidden="true"
              onClick={(e) => {
                e.stopPropagation()
                closeDetails(e)
              }}
            />
            <div
              className="absolute right-0 z-[60] mt-1 flex w-64 max-w-[80vw] flex-col items-stretch gap-1.5 rounded-lg border border-border bg-card p-2 text-xs shadow-lg"
              onClick={(e) => {
                const target = e.target as HTMLElement
                if (target.closest('button') || target.closest('a')) {
                  closeDetails(e)
                }
              }}
            >
              {source.url ? (
                <a href={source.url} target="_blank" rel="noopener noreferrer" className="no-underline hover:underline break-all font-mono text-primary">
                  Published HTML: {source.url}
                </a>
              ) : (
                <span className="text-muted-foreground">Published HTML: bundled with this app (no standalone URL)</span>
              )}
              {source.repositoryUrl ? (
                <a href={source.repositoryUrl} target="_blank" rel="noopener noreferrer" className="no-underline hover:underline break-all text-primary">
                  Git source directory
                </a>
              ) : (
                <span className="text-muted-foreground">Git repository: not published</span>
              )}
              {!core && source.subscribed && (
                <>
                  <button
                    type="button"
                    onClick={() => onSync(source.id)}
                    disabled={disabled}
                    className="min-h-8 rounded-md px-2 text-left text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Refresh now
                  </button>
                  {source.hasOfflineChunks && !isOfflineFull ? (
                    <button
                      type="button"
                      onClick={() => onDownloadOffline(source.id)}
                      disabled={disabled}
                      className="min-h-8 rounded-md px-2 text-left text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      Download for offline
                      {source.chunkBytes && source.chunkBytes > 0 ? ` (${formatFeedBytes(source.chunkBytes)})` : ''}
                    </button>
                  ) : isOfflineFull ? (
                    <button
                      type="button"
                      onClick={() => onSwitchIndexOnly(source.id)}
                      disabled={disabled}
                      className="min-h-8 rounded-md px-2 text-left text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      Use index-only for future updates
                    </button>
                  ) : null}
                </>
              )}
              {!core && (
                <button
                  type="button"
                  onClick={() => onUnsubscribe(source.id)}
                  disabled={disabled || !source.subscribed}
                  data-testid={`feed-unsubscribe-${source.id}`}
                  className="min-h-8 rounded-md px-2 text-left text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  Unsubscribe
                </button>
              )}
              {!core && (
                <button
                  type="button"
                  onClick={() => onDelete(source.id)}
                  disabled={disabled}
                  data-testid={`feed-delete-${source.id}`}
                  className="min-h-8 rounded-md px-2 text-left text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  Delete source
                </button>
              )}
            </div>
          </details>
        </div>
      </div>

      {source.url && (
        <div className="text-xs text-muted-foreground font-mono break-all" data-testid={`feed-origin-${source.id}`}>{source.url}</div>
      )}

      {source.description && (
        <p className="text-xs text-muted-foreground text-pretty max-w-prose" data-testid={`feed-description-${source.id}`}>
          {source.description}
        </p>
      )}

      {/* Flat subscription mode & per-notebook checklist (never a nested card) */}
      <div className="border-t border-border/60 pt-3 space-y-2.5" data-testid={`feed-notebooks-${source.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Subscription
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold ${
                subMode === 'full'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : subMode === 'partial'
                    ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300'
                    : 'bg-muted text-muted-foreground'
              }`}
              data-testid={`feed-sub-mode-${source.id}`}
            >
              {subMode === 'full' ? 'Full' : subMode === 'partial' ? `Partial (${subscribedCount} of ${allNotebooks.length} subscribed)` : 'Unsubscribed'}
            </span>
            {source.subscribed && !core && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-muted text-foreground">
                {isOfflineFull ? 'Offline copy' : 'Index-only'}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate(`/notebooks?q=:notebook{feed:${source.id},subscribed:true,false}`)}
            data-testid={`browse-notebooks-link-${source.id}`}
            className="no-underline hover:underline text-xs font-semibold text-primary flex items-center gap-1 cursor-pointer"
          >
            Browse notebooks in Library →
          </button>
        </div>

        {!core && allNotebooks.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {allNotebooks.map((notebook) => (
              <label
                key={notebook.chunkId}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/50 cursor-pointer"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={Boolean(notebook.subscribed)}
                    disabled={disabled}
                    onChange={(e) => onToggleNotebook(source.id, notebook.chunkId, e.target.checked)}
                    data-testid={`feed-notebook-toggle-${source.id}-${notebook.chunkId}`}
                    className="size-3.5 accent-primary rounded shrink-0"
                  />
                  <span className="truncate text-foreground font-medium">{notebook.label}</span>
                </span>
                {notebook.count > 0 && (
                  <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                    {notebook.count.toLocaleString()}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Concise status line + progressive disclosure for technical sync details */}
      <div className="border-t border-border/60 pt-2.5 space-y-2 text-xs" data-testid="feed-status-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium flex items-center gap-1.5 text-foreground" data-testid="feed-sync-status">
            {!source.subscribed ? (
              'Not subscribed'
            ) : isIndexActive ? (
              <>
                <CheckCircle2 className="size-3.5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                Index active. Workouts load on demand.
              </>
            ) : source.upToDate ? (
              <>
                <CheckCircle2 className="size-3.5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                Up to date
              </>
            ) : source.remote == null ? (
              'Status unknown (remote unreachable)'
            ) : autoSync ? (
              'Update available. Applied automatically on next load.'
            ) : (
              'Update available. Sync to apply.'
            )}
          </span>
          <div className="flex items-center gap-3">
            <span className="font-medium text-muted-foreground tabular-nums" data-testid="feed-source-size">
              {source.count.toLocaleString()} feed {source.count === 1 ? 'item' : 'items'} · {sizeSummary}
            </span>
            {!core && source.subscribed && !isOfflineFull && source.hasOfflineChunks && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onDownloadOffline(source.id)}
                data-testid={`feed-download-offline-${source.id}`}
                className="h-7 px-2.5 text-xs gap-1.5"
              >
                <HardDriveDownload className="size-3" aria-hidden="true" />
                <span>
                  Download offline{source.chunkBytes && source.chunkBytes > 0 ? ` (${formatFeedBytes(source.chunkBytes)})` : ''}
                </span>
              </Button>
            )}
          </div>
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
            Sync &amp; version details
          </summary>
          <div className="mt-2 grid gap-1.5 pl-1">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Local copy</span>
              <span className="font-medium text-foreground" data-testid="feed-local-version">
                {source.stored
                  ? `v${source.stored.version} · synced ${formatFeedVersion(source.stored.importedAt)}`
                  : 'Not imported yet'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Published version</span>
              <span className="font-medium text-foreground flex items-center gap-1.5" data-testid="feed-remote-version">
                {source.remote
                  ? `v${source.remote.version}`
                  : source.remoteError
                    ? (
                        <>
                          <AlertCircle className="size-3.5 text-muted-foreground" aria-hidden="true" />
                          Unavailable
                        </>
                      )
                    : 'Not checked yet'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Last check</span>
              <span className="font-medium text-foreground" data-testid="feed-last-check">
                {source.checkedAt ? formatFeedVersion(source.checkedAt) : 'Not checked'}
              </span>
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}

export interface SyncSectionDeps {
  /** Feed service seams; production defaults — tests inject fakes. */
  readFeedStatus?: typeof readFeedStatus
  syncFeedSource?: typeof syncFeedSource
  subscribeFeed?: typeof subscribeFeed
  downloadFeedOffline?: typeof downloadFeedOffline
  toggleNotebookSubscription?: typeof toggleNotebookSubscription
  runFeedSync?: typeof runFeedSync
  probeFeedManifest?: typeof probeFeedManifest
  unsubscribeFeedSource?: typeof unsubscribeFeedSource
  deleteFeedSource?: typeof deleteFeedSource
}

type PendingConfirmAction = {
  kind: 'unsubscribe' | 'delete'
  id: string
  label: string
}

export function SyncSection({ deps = {} }: { deps?: SyncSectionDeps } = {}) {
  const {
    readFeedStatus: readStatus = readFeedStatus,
    syncFeedSource: syncSource = syncFeedSource,
    subscribeFeed: subscribeFn = subscribeFeed,
    downloadFeedOffline: downloadOfflineFn = downloadFeedOffline,
    toggleNotebookSubscription: toggleNotebookFn = toggleNotebookSubscription,
    runFeedSync: runAllSync = runFeedSync,
    probeFeedManifest: probeFn = probeFeedManifest,
    unsubscribeFeedSource: unsubscribeFn = unsubscribeFeedSource,
    deleteFeedSource: deleteFn = deleteFeedSource,
  } = deps

  const [status, setStatus] = useState<FeedStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [probingUpdates, setProbingUpdates] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<null | 'all' | string>(null)
  const [subscribingId, setSubscribingId] = useState<string | null>(null)
  const [progress, setProgress] = useState<SourceProgress[]>([])

  const [newLabel, setNewLabel] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [probingCustom, setProbingCustom] = useState(false)
  const [probedCustom, setProbedCustom] = useState<ProbedFeedManifest | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  const [subscribedOnly, setSubscribedOnly] = useState(false)
  const [feedFilter, setFeedFilter] = useState<string | undefined>()

  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmAction | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const refresh = useCallback(async (probe = false) => {
    setLoadError(null)
    if (probe) setProbingUpdates(true)
    try {
      setStatus(await readStatus(probe ? { probe: true } : undefined))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
      if (probe) setProbingUpdates(false)
    }
  }, [readStatus])

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  useEffect(() => subscribeFeedSubscriptions(() => { void refresh(false) }), [refresh])
  useEffect(() => subscribeFeedUpdates(() => { void refresh(false) }), [refresh])

  const makeProgressHandler = useCallback(() => {
    return (event: FeedSyncProgress) => setProgress(previous => {
      const prior = previous.find(source => source.event.sourceId === event.sourceId)
      const imported = event.phase === 'checking' || event.phase === 'finished' ? prior?.imported ?? null : event
      const next = {
        event,
        imported,
        chunks: event.phase === 'committed' && event.chunkId !== null
          ? [...(prior?.chunks ?? []), event.chunkId]
          : prior?.chunks ?? [],
      }
      return prior
        ? previous.map(source => source.event.sourceId === event.sourceId ? next : source)
        : [...previous, next]
    })
  }, [])

  const handleSync = useCallback(async (id: null | string) => {
    setBusyId(id ?? 'all')
    setProgress([])
    const onProgress = makeProgressHandler()
    try {
      const outcome = id
        ? await syncSource(id, { force: true, onProgress })
        : await runAllSync({ force: true, onProgress })
      const label = id ? (status?.sources.find(s => s.id === id)?.label ?? id) : 'All sources'
      announceOutcome(outcome, label)
      await refresh(false)
    } finally {
      setBusyId(null)
    }
  }, [makeProgressHandler, refresh, runAllSync, status, syncSource])

  const handleSubscribe = useCallback(async (id: string) => {
    setBusyId(id)
    setSubscribingId(id)
    setProgress([])
    const onProgress = makeProgressHandler()
    try {
      let outcome: FeedSyncOutcome
      if (deps.subscribeFeed) {
        outcome = await subscribeFn(id, { offlinePolicy: 'index-only', onProgress })
      } else {
        setFeedSubscribed(id, true)
        setFeedOfflinePolicy(id, 'index-only')
        await flushFeedStatePersistence()
        outcome = await syncSource(id, { offlinePolicy: 'index-only', subscribe: true, onProgress })
      }
      const label = status?.sources.find(s => s.id === id)?.label ?? id
      announceOutcome(outcome, label)
      await refresh(false)
    } finally {
      setSubscribingId(null)
      setBusyId(null)
    }
  }, [deps.subscribeFeed, makeProgressHandler, refresh, status, subscribeFn, syncSource])

  const handleDownloadOffline = useCallback(async (id: string) => {
    setBusyId(id)
    setProgress([])
    const onProgress = makeProgressHandler()
    try {
      const outcome = await downloadOfflineFn(id, undefined, { onProgress })
      const label = status?.sources.find(s => s.id === id)?.label ?? id
      announceOutcome(outcome, label)
      await refresh(false)
    } finally {
      setBusyId(null)
    }
  }, [downloadOfflineFn, makeProgressHandler, refresh, status])

  const handleSwitchIndexOnly = useCallback((id: string) => {
    setFeedOfflinePolicy(id, 'index-only')
    void flushFeedStatePersistence()
    const label = status?.sources.find(s => s.id === id)?.label ?? id
    toast({ title: `${label} set to index-only`, description: 'Future updates will sync lightweight indexes only.' })
    void refresh(false)
  }, [refresh, status])

  const handleToggleNotebook = useCallback(async (feedId: string, chunkId: string, sub: boolean) => {
    setBusyId(feedId)
    try {
      const result = await toggleNotebookFn(feedId, chunkId, sub)
      if (!sub && (result.preservedPinned ?? 0) > 0) {
        toast({
          title: 'Notebook unsubscribed',
          description: `${(result.deleted ?? 0).toLocaleString()} cached items removed. ${result.preservedPinned!.toLocaleString()} logged workouts kept pinned locally.`,
        })
      }
      await refresh(false)
    } finally {
      setBusyId(null)
    }
  }, [refresh, toggleNotebookFn])

  const handleInspectCustomUrl = useCallback(async (event?: SyntheticEvent) => {
    event?.preventDefault()
    if (!newUrl.trim() || probingCustom) return
    setAddError(null)
    setProbedCustom(null)
    setProbingCustom(true)
    try {
      const probed = await probeFn(newUrl.trim())
      setProbedCustom(probed)
    } catch (err) {
      setAddError(formatFeedProbeError(err))
    } finally {
      setProbingCustom(false)
    }
  }, [newUrl, probeFn, probingCustom])

  const handleAutoSync = useCallback((id: string, enabled: boolean) => {
    if (!setFeedAutoSync(id, enabled)) {
      toast({
        title: "Couldn't save Auto-sync",
        description: 'Browser storage is unavailable. The choice lasts this session only.',
        variant: 'destructive',
      })
    } else {
      void flushFeedStatePersistence()
    }
    void refresh(false)
  }, [refresh])

  const requestUnsubscribe = useCallback((id: string) => {
    const label = status?.sources.find(s => s.id === id)?.label ?? id
    setPendingConfirm({ kind: 'unsubscribe', id, label })
  }, [status])

  const requestDelete = useCallback((id: string) => {
    const label = status?.sources.find(s => s.id === id)?.label ?? id
    setPendingConfirm({ kind: 'delete', id, label })
  }, [status])

  const handleConfirmAction = useCallback(async () => {
    if (!pendingConfirm || confirmBusy) return
    setConfirmBusy(true)
    const { kind, id, label } = pendingConfirm
    try {
      if (kind === 'unsubscribe') {
        const { deleted, preservedPinned } = await unsubscribeFn(id)
        const pinnedCount = preservedPinned ?? 0
        toast({
          title: `${label} unsubscribed`,
          description:
            pinnedCount > 0
              ? `${deleted.toLocaleString()} cached ${deleted === 1 ? 'item' : 'items'} removed. ${pinnedCount.toLocaleString()} logged ${pinnedCount === 1 ? 'workout' : 'workouts'} kept pinned locally.`
              : `${deleted.toLocaleString()} cached ${deleted === 1 ? 'item' : 'items'} removed. Any logged workouts and your own notes remain intact.`,
        })
      } else {
        const { deleted, preservedPinned } = await deleteFn(id)
        const pinnedCount = preservedPinned ?? 0
        toast({
          title: `${label} deleted`,
          description:
            pinnedCount > 0
              ? `${deleted.toLocaleString()} cached ${deleted === 1 ? 'item' : 'items'} removed and source unregistered. ${pinnedCount.toLocaleString()} logged ${pinnedCount === 1 ? 'workout' : 'workouts'} kept pinned locally.`
              : `${deleted.toLocaleString()} cached ${deleted === 1 ? 'item' : 'items'} removed and source unregistered.`,
        })
      }
      setPendingConfirm(null)
      await refresh(false)
    } catch (err) {
      toast({
        title: `${label} ${kind} failed`,
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setConfirmBusy(false)
    }
  }, [confirmBusy, deleteFn, pendingConfirm, refresh, unsubscribeFn])

  const current = progress.at(-1)?.event

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <CloudDownload className="size-4 text-primary" aria-hidden="true" />
              Content Sources
            </h2>
            <p className="text-sm text-muted-foreground text-pretty max-w-prose">
              Each feed publishes notebooks and workouts from its own repository. Subscribing indexes the catalog immediately and loads individual workouts when you open them, or you can opt into a full offline download.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh(true)}
            disabled={probingUpdates || busyId !== null}
            className="gap-2 shrink-0"
          >
            <RefreshCw className={`size-3.5 ${probingUpdates ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{probingUpdates ? 'Checking…' : 'Check updates'}</span>
          </Button>
        </div>

        {loadError && (
          <div className="flex items-center gap-1.5 text-xs text-destructive" data-testid="feed-status-error">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            Couldn&apos;t read the feed status from the active storage: {loadError}
          </div>
        )}

        {current && (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="feed-sync-progress">
            <div className="flex items-center justify-between gap-4 text-sm font-medium">
              <span>{busyId !== null ? 'Syncing…' : progress.some(source => source.event.phase === 'finished' && source.event.outcome === 'error') ? 'Sync finished with errors' : 'Sync finished'}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                Source {current.sourceIndex} of {current.totalSources}
              </span>
            </div>
            <p role="status" aria-live="polite" className="sr-only" data-testid="feed-sync-live-status">
              {current.sourceLabel}: {progressLabel(current)}
            </p>
            {progress.map(({ event, imported, chunks }) => (
              <div key={event.sourceId} className="space-y-2 border-t border-border/50 pt-3">
                <p className={`text-xs ${event.phase === 'finished' && event.outcome === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                  <span className="font-medium text-foreground">{event.sourceLabel}</span> · {progressLabel(event)}
                </p>
                {imported && imported.totalChunks > 0 ? (
                  <ProgressBar value={imported.completedChunks} max={imported.totalChunks} label={`Chunks committed · ${event.sourceLabel}`} />
                ) : event.phase !== 'finished' ? (
                  <progress aria-label={`Checking ${event.sourceLabel}`} className="h-2 w-full" />
                ) : null}
                {imported && (
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums" data-testid="feed-sync-totals">
                    <span>{imported.totalNotes.toLocaleString()} notes</span>
                    <span>{imported.totalEfforts.toLocaleString()} efforts</span>
                    <span>{imported.totalBlocks.toLocaleString()} blocks</span>
                    {imported.skippedUserOwned > 0 && <span>{imported.skippedUserOwned.toLocaleString()} user-owned rows preserved</span>}
                    {imported.deleted > 0 && <span>{imported.deleted.toLocaleString()} feed rows removed</span>}
                  </p>
                )}
                {chunks.length > 0 && (
                  <details className="text-xs" data-testid="feed-sync-chunks">
                    <summary className="cursor-pointer text-muted-foreground">Committed chunks ({chunks.length})</summary>
                    <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto font-mono text-muted-foreground">
                      {chunks.map(chunk => <li key={chunk}>{chunk}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Subscription filter and feed selector */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-lg border border-border bg-card text-xs">
          <label className="flex items-center gap-2 cursor-pointer select-none text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={subscribedOnly}
              onChange={(e) => setSubscribedOnly(e.target.checked)}
              data-testid="sync-subscribed-only-toggle"
              className="size-3.5 accent-primary rounded"
            />
            <span className="font-medium text-foreground">Subscribed only</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Source:</span>
            <select
              value={feedFilter ?? ''}
              onChange={(e) => setFeedFilter(e.target.value ? e.target.value : undefined)}
              data-testid="sync-feed-source-filter"
              aria-label="Filter notebooks by feed"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors hover:border-foreground/25 focus:border-primary/50"
            >
              <option value="">All feeds</option>
              {status?.sources.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-3" data-testid="feed-source-list">
          {status?.sources
            .filter((source) => {
              if (feedFilter && source.id !== feedFilter) return false
              if (subscribedOnly) {
                const hasSubscribedNotebook = source.notebooks.some((n) => n.subscribed)
                if (!source.subscribed && !hasSubscribedNotebook) return false
              }
              return true
            })
            .map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                running={busyId === source.id || busyId === 'all'}
                subscribing={subscribingId === source.id}
                disabled={busyId !== null}
                onSync={(id) => { void handleSync(id) }}
                onSubscribe={(id) => { void handleSubscribe(id) }}
                onDownloadOffline={(id) => { void handleDownloadOffline(id) }}
                onSwitchIndexOnly={handleSwitchIndexOnly}
                onUnsubscribe={requestUnsubscribe}
                onDelete={requestDelete}
                onAutoSync={handleAutoSync}
                onToggleNotebook={(feedId, chunkId, sub) => { void handleToggleNotebook(feedId, chunkId, sub) }}
              />
            ))}
          {isLoading && status === null && (
            <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
              Checking sources…
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/50">
          <span className="text-xs text-muted-foreground text-pretty max-w-prose">
            Syncing refreshes subscribed sources. Your own notes, workout results, and logged sessions are never overwritten.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void handleSync(null) }}
            disabled={busyId !== null || isLoading}
            data-testid="feed-resync-button"
            className="gap-2"
          >
            <RefreshCw className={`size-3.5 ${busyId === 'all' ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{busyId === 'all' ? 'Syncing all…' : 'Sync All Sources'}</span>
          </Button>
        </div>
      </section>

      <section className="space-y-4 pt-4 border-t border-border/50">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Link2 className="size-4 text-primary" aria-hidden="true" />
            Add a Source
          </h2>
          <p className="text-sm text-muted-foreground text-pretty max-w-prose">
            Inspect any URL serving a Wod Wiki feed (a directory with <code>manifest.json</code>). The host must allow cross-origin reads (CORS). Nothing is saved until you review the feed and confirm Subscribe.
          </p>
        </div>

        <form
          onSubmit={(e) => void handleInspectCustomUrl(e)}
          className="rounded-xl border border-border bg-card p-4 space-y-3"
          data-testid="feed-add-source-form"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="feed-source-label" className="block text-xs font-medium text-muted-foreground mb-1">
                Label (optional)
              </label>
              <Input
                id="feed-source-label"
                value={newLabel}
                onValueChange={setNewLabel}
                placeholder="Defaults to manifest name"
                className="h-10"
                disabled={busyId !== null || probingCustom}
              />
            </div>
            <div>
              <label htmlFor="feed-source-url" className="block text-xs font-medium text-muted-foreground mb-1">
                Feed directory URL
              </label>
              <Input
                id="feed-source-url"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={newUrl}
                onValueChange={(value) => {
                  setNewUrl(value)
                  if (probedCustom) setProbedCustom(null)
                  if (addError) setAddError(null)
                }}
                placeholder="https://example.com/feed/library/"
                className="h-10 font-mono"
                disabled={busyId !== null || probingCustom}
              />
            </div>
          </div>
          {addError && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive" data-testid="feed-add-error">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{addError}</span>
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              size="default"
              disabled={busyId !== null || probingCustom || !newUrl.trim()}
              data-testid="feed-add-button"
              className="h-10 gap-2"
            >
              {probingCustom ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  <span>Inspecting…</span>
                </>
              ) : (
                <span>Inspect Feed</span>
              )}
            </Button>
          </div>
        </form>

        {probedCustom && (
          <FeedInspectCard
            preProbed={probedCustom}
            initialLabel={newLabel}
            cancelLabel="Cancel"
            onCancel={() => setProbedCustom(null)}
            onSubscribed={() => {
              setProbedCustom(null)
              setNewLabel('')
              setNewUrl('')
              void refresh(false)
            }}
          />
        )}
      </section>

      <EditorDialog
        open={pendingConfirm !== null}
        onClose={() => {
          if (!confirmBusy) setPendingConfirm(null)
        }}
        title={
          pendingConfirm?.kind === 'delete'
            ? `Delete "${pendingConfirm.label}"?`
            : `Unsubscribe from "${pendingConfirm?.label ?? ''}"?`
        }
        description={
          pendingConfirm?.kind === 'delete'
            ? 'Remove cached content and unregister this feed source.'
            : 'Remove cached content from your library and stop syncing.'
        }
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={confirmBusy}
              onClick={() => setPendingConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={confirmBusy}
              onClick={() => void handleConfirmAction()}
            >
              {confirmBusy
                ? (pendingConfirm?.kind === 'delete' ? 'Deleting…' : 'Unsubscribing…')
                : (pendingConfirm?.kind === 'delete' ? 'Delete source' : 'Unsubscribe')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-foreground">
          <p className="text-pretty">
            {pendingConfirm?.kind === 'delete'
              ? `Imported content and cached indexes for "${pendingConfirm.label}" will be removed and the source will be unregistered.`
              : `Imported content and cached indexes for "${pendingConfirm?.label ?? ''}" will be removed from your library, and automatic syncing will stop. The source stays listed so you can subscribe again anytime.`}
          </p>
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground text-pretty">
            Workouts you have logged sessions against remain safely pinned locally and will not be deleted. Your own notes and workout history are never touched.
          </div>
        </div>
      </EditorDialog>
    </div>
  )
}
