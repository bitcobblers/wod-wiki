/**
 * SyncSection — /settings/sync, and (via NotebookManageDrawer) the /notebooks
 * manager. Content sync feeds for the active data location: the bundled core
 * feed (auto-imports at boot), the bundled community library, and
 * user-registered custom feeds. Per-feed identity, Auto-sync,
 * Subscribe/Unsubscribe/Delete, Sync All, and feed registration. Where data
 * LIVES is /settings/storage; this page is where content COMES FROM.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { CloudDownload, RefreshCw, CheckCircle2, AlertCircle, Plus, Link2 } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import { Input } from '@/components/atoms/primitives/input'
import { deleteFeedSource, readFeedStatus, runFeedSync, subscribeFeedUpdates, syncFeedSource, unsubscribeFeedSource, type FeedSourceStatus, type FeedStatus, type FeedSyncOutcome, type FeedSyncProgress } from '@/services/feed/feedSync'
import type { FeedImportProgress } from '@/services/feed/FeedImporter'
import { addCustomFeedSource, type CustomFeedSource } from '@/services/feed/feedSources'
import { isNotebookSubscribed, isFeedAutoSync, setNotebookSubscribed, setFeedAutoSync, subscribeFeedSubscriptions } from '@/services/feed/feedSubscriptions'
import { ProgressBar } from '../components/atoms/ProgressBar'
import { toast } from '@/hooks/use-toast'
import { formatDateTimeMediumShort } from '@/lib/dateFormat'

const formatFeedVersion = (version: number): string =>
  formatDateTimeMediumShort(new Date(version))

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`
}

/** One toast per sync outcome, labeled with the source that produced it. */
function announceOutcome(outcome: string, label: string): void {
  if (outcome === 'imported') {
    toast({ title: `${label} synced`, description: 'Content was imported from the published feed. Your own edits were kept.' })
  } else if (outcome === 'error') {
    toast({ title: `${label} sync failed`, description: 'Check your connection and the browser console for details.', variant: 'destructive' })
  } else if (outcome === 'busy') {
    toast({ title: 'Another tab is already syncing', description: 'Wait for it to finish, then try again.' })
  } else {
    toast({ title: `${label}: nothing to import (${outcome})` })
  }
}

type SourceProgress = {
  event: FeedSyncProgress
  imported: FeedImportProgress | null
  chunks: string[]
}

/** Exported for the stream surfaces' inline sync notice — one vocabulary for
 *  every sync outcome in the app (Settings rows and the feeds
 *  notice must never word the same outcome differently). */
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

/** Status + actions for one registered feed — the same card serves
 *  /settings/sync and the /notebooks manager drawer. Identity (origin, counts,
 *  size, versions, last check/sync, subscription) comes from readFeedStatus;
 *  lifecycle actions ride the shared feed service contract. */
function SourceCard({ source, running, disabled, onSync, onSubscribe, onUnsubscribe, onDelete, onAutoSync, onToggleNotebook, subscribedOnly }: {
  source: FeedSourceStatus
  /** This source's sync is the one in flight — spin its button. */
  running: boolean
  /** Any sync is in flight — lock every competing action. */
  disabled: boolean
  onSync: (id: string) => void
  onSubscribe: (id: string) => void
  onUnsubscribe: (id: string) => void
  onDelete: (id: string) => void
  onAutoSync: (id: string, enabled: boolean) => void
  onToggleNotebook?: (feedId: string, chunkId: string, subscribed: boolean) => void
  subscribedOnly?: boolean
}) {
  // Read the preference synchronously so React cannot restore a stale checked prop.
  const autoSync = useSyncExternalStore(subscribeFeedSubscriptions, () => isFeedAutoSync(source.id))
  const allNotebooks = source.notebooks.filter(notebook => notebook.id !== source.id)
  const notebooks = subscribedOnly
    ? allNotebooks.filter(notebook => notebook.subscribed)
    : allNotebooks
  const core = source.autoImport
  // Primary Sync ONLY while a subscribed source has a detected update; a
  // current source shows status text instead of a redundant button.
  const pending = source.subscribed && !source.upToDate && source.remote !== null

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid={`feed-source-${source.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">{source.label}</span>
          <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${source.subscribed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
            {source.subscribed ? 'Subscribed' : 'Not subscribed'}
          </span>
          {core && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              Core
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {!source.subscribed ? (
            <Button
              size="sm"
              onClick={() => onSubscribe(source.id)}
              disabled={disabled}
              data-testid={`feed-subscribe-${source.id}`}
              className="gap-2"
            >
              <CloudDownload className="size-3.5" />
              <span>Subscribe</span>
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
              <RefreshCw className={`size-3.5 ${running ? 'animate-spin' : ''}`} />
              <span>{running ? 'Syncing…' : 'Sync'}</span>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5" data-testid={`feed-current-${source.id}`}>
              <CheckCircle2 className="size-3.5 text-emerald-500" />
              {source.remote === null ? 'Remote unreachable' : 'Up to date'}
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
          {/* Native details/summary overflow — opens without JavaScript, the
              summary is keyboard reachable, links carry noopener. */}
          <details className="relative shrink-0" data-testid={`feed-more-${source.id}`}>
            <summary
              aria-label={`More actions for ${source.label}`}
              className="flex cursor-pointer list-none items-center justify-center rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden"
            >
              …
            </summary>
            <div className="absolute right-0 z-20 mt-1 flex w-64 max-w-[80vw] flex-col items-stretch gap-1.5 rounded-lg border border-border bg-card p-2 text-xs shadow-lg">
              {source.url ? (
                <a href={source.url} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-primary hover:underline">
                  Published HTML: {source.url}
                </a>
              ) : (
                <span className="text-muted-foreground">Published HTML: bundled with this app (no standalone URL)</span>
              )}
              {source.repositoryUrl ? (
                <a href={source.repositoryUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
                  Git source directory
                </a>
              ) : (
                <span className="text-muted-foreground">Git repository: not published</span>
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
        <p className="text-xs text-muted-foreground" data-testid={`feed-description-${source.id}`}>{source.description}</p>
      )}

      {/* What one Subscribe brings: every notebook the feed publishes (they
          are never synced on their own). A custom feed's contents are unknown
          until its manifest is read — its id-keyed placeholder row would only
          repeat the row title, so it is dropped. */}
      {notebooks.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2" data-testid={`feed-notebooks-${source.id}`}>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
            {notebooks.length === 1 ? '1 notebook' : `${notebooks.length} notebooks`} · {subscribedOnly ? 'subscribed' : 'available in this feed'}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {notebooks.map(notebook => (
              <li
                key={notebook.chunkId}
                data-testid={`feed-notebook-${source.id}-${notebook.chunkId}`}
                className="flex items-center justify-between gap-4 text-xs"
              >
                <span className={notebook.imported ? 'flex min-w-0 items-center gap-1.5 text-foreground' : 'flex min-w-0 items-center gap-1.5 text-muted-foreground'}>
                  {notebook.imported
                    ? <CheckCircle2 className="size-3 shrink-0 text-emerald-500" aria-hidden />
                    : <CloudDownload className="size-3 shrink-0 opacity-60" aria-hidden />}
                  <span className="truncate">{notebook.label}</span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="tabular-nums text-muted-foreground">
                    {notebook.count.toLocaleString()} {notebook.count === 1 ? 'item' : 'items'}
                  </span>
                  {!core && onToggleNotebook && (
                    <button
                      type="button"
                      onClick={() => onToggleNotebook(source.id, notebook.chunkId, !notebook.subscribed)}
                      data-testid={`feed-notebook-toggle-${source.id}-${notebook.chunkId}`}
                      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded shrink-0 transition-colors ${
                        notebook.subscribed
                          ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                          : 'border border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {notebook.subscribed ? 'Subscribed' : 'Subscribe'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-1 text-sm" data-testid="feed-status-card">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">Library</span>
          <span className="font-medium text-foreground text-xs tabular-nums" data-testid="feed-source-size">
            {source.count.toLocaleString()} feed {source.count === 1 ? 'item' : 'items'} · {formatBytes(source.bytes)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">Local database</span>
          <span className="font-medium text-foreground text-xs" data-testid="feed-local-version">
            {source.stored
              ? `v${source.stored.version} · schema ${source.stored.schema} · imported ${formatFeedVersion(source.stored.importedAt)}`
              : 'Not imported yet'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">Published version</span>
          <span className="font-medium text-foreground text-xs flex items-center gap-1.5" data-testid="feed-remote-version">
            {source.remote
              ? `v${source.remote.version} · schema ${source.remote.schema}`
              : source.remoteError
                ? (
                    <>
                      <AlertCircle className="size-3.5 text-muted-foreground" />
                      Unavailable
                    </>
                  )
                : 'Checking…'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">Last check</span>
          <span className="font-medium text-foreground text-xs" data-testid="feed-last-check">
            {source.checkedAt ? formatFeedVersion(source.checkedAt) : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">Last sync</span>
          <span className="font-medium text-foreground text-xs" data-testid="feed-last-sync">
            {source.stored ? formatFeedVersion(source.stored.importedAt) : 'Never'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">Status</span>
          <span className="font-medium text-xs flex items-center gap-1.5" data-testid="feed-sync-status">
            {!source.subscribed ? (
              'Not subscribed'
            ) : source.upToDate ? (
              <>
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                Up to date
              </>
            ) : source.remote == null ? (
              'Unknown (remote unreachable)'
            ) : autoSync ? (
              'Update available — applied automatically on next load'
            ) : (
              'Update available — sync to apply'
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * SyncSection — the content sync registry, one card per FEED. A feed is the
 * subscription unit: subscribing imports every notebook it publishes, in one
 * checkpoint at one published version. Boot auto-imports the core feed only;
 * every other feed (theme repo or custom library) syncs from here, one at a
 * time or all at once.
 */
export function SyncSection() {
  const [status, setStatus] = useState<FeedStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<null | 'all' | string>(null)
  const [progress, setProgress] = useState<SourceProgress[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [subscribedOnly, setSubscribedOnly] = useState(true)
  const [feedFilter, setFeedFilter] = useState<string | undefined>()


  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      setStatus(await readFeedStatus())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Re-read status when subscriptions change elsewhere (home cards) and when
  // the load-time background check publishes its feed-updates snapshot —
  // pending badges reflect the latest check without a manual reload.
  useEffect(() => subscribeFeedSubscriptions(() => { void refresh() }), [refresh])
  useEffect(() => subscribeFeedUpdates(() => { void refresh() }), [refresh])

  const handleSync = useCallback(async (id: null | string) => {
    setBusyId(id ?? 'all')
    setProgress([])
    const onProgress = (event: FeedSyncProgress) => setProgress(previous => {
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
    try {
      const outcome = id
        ? await syncFeedSource(id, { force: true, onProgress })

        : await runFeedSync({ force: true, onProgress })
      const label = id ? (status?.sources.find(s => s.id === id)?.label ?? id) : 'All sources'
      announceOutcome(outcome, label)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }, [refresh, status])

  const handleToggleNotebook = useCallback(async (feedId: string, chunkId: string, sub: boolean) => {
    setNotebookSubscribed(feedId, chunkId, sub)
    if (sub) {
      await handleSync(feedId)
    } else {
      await refresh()
    }
  }, [handleSync, refresh])

  const handleAdd = useCallback(async () => {
    setAddError(null)
    let added: CustomFeedSource
    try {
      added = addCustomFeedSource(newLabel, newUrl)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
      return
    }
    setNewLabel('')
    setNewUrl('')
    // A source is added to be imported — sync it immediately.
    await handleSync(added.id)
  }, [newLabel, newUrl, handleSync])

  // Auto-sync persists independently of subscription (shared feed contract).
  // setFeedAutoSync returns false when the choice could NOT be persisted —
  // say so instead of implying a durable preference.
  const handleAutoSync = useCallback((id: string, enabled: boolean) => {
    if (!setFeedAutoSync(id, enabled)) {
      toast({ title: "Couldn't save Auto-sync", description: 'Browser storage is unavailable — the choice lasts this session only.', variant: 'destructive' })
    }
    void refresh()
  }, [refresh])

  // Unsubscribe removes the source's imported content + checkpoints and stops
  // syncing, but keeps the source entry so it can be subscribed again.
  // Failures stay visible; confirmation follows the existing window.confirm
  // convention (OfferingTiers).
  const handleUnsubscribe = useCallback(async (id: string) => {
    const label = status?.sources.find(s => s.id === id)?.label ?? id
    if (!window.confirm(`Unsubscribe from "${label}"? Imported content for this feed's content is removed from your library; the source stays listed so you can subscribe again. Your own notes are never touched.`)) return
    try {
      const { deleted } = await unsubscribeFeedSource(id)
      toast({ title: `${label} unsubscribed`, description: `${deleted.toLocaleString()} imported ${deleted === 1 ? 'item' : 'items'} removed. The source stays listed for a later Subscribe.` })
    } catch (err) {
      toast({ title: `${label} unsubscribe failed`, description: err instanceof Error ? err.message : String(err), variant: 'destructive' })
      return
    }
    await refresh()
  }, [status, refresh])

  // Delete removes imported content AND the source entry itself. Neither
  // lifecycle action ever touches user-authored notes.
  const handleDelete = useCallback(async (id: string) => {
    const label = status?.sources.find(s => s.id === id)?.label ?? id
    if (!window.confirm(`Delete "${label}"? Imported content is removed and the source is unregistered. Your own notes are never touched.`)) return
    try {
      const { deleted } = await deleteFeedSource(id)
      toast({ title: `${label} deleted`, description: `${deleted.toLocaleString()} imported ${deleted === 1 ? 'item' : 'items'} removed and the source unregistered.` })
    } catch (err) {
      toast({ title: `${label} delete failed`, description: err instanceof Error ? err.message : String(err), variant: 'destructive' })
      return
    }
    await refresh()
  }, [status, refresh])

  const current = progress.at(-1)?.event

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <CloudDownload className="size-4 text-primary" />
            Content Sources
          </h2>
          <p className="text-sm text-muted-foreground">
            A feed is one published Markdown repository — its notebooks, notes, guides, dashboards, and
            efforts import into your active data location together. Subscribed feeds are checked against
            their published manifest on every load: Auto-sync applies updates by itself, otherwise you
            press Sync when an update is pending. The core feed imports automatically at launch and is
            always subscribed.
          </p>
        </div>

        {loadError && (
          <div className="flex items-center gap-1.5 text-xs text-destructive" data-testid="feed-status-error">
            <AlertCircle className="size-3.5 shrink-0" />
            Couldn't read the feed status from the active storage: {loadError}
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
        <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-xl border border-border bg-card text-xs">
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
                disabled={busyId !== null}
                onSync={(id) => { void handleSync(id) }}
                onSubscribe={(id) => { void handleSync(id) }}
                onUnsubscribe={(id) => { void handleUnsubscribe(id) }}
                onDelete={(id) => { void handleDelete(id) }}
                onAutoSync={handleAutoSync}
                onToggleNotebook={handleToggleNotebook}
                subscribedOnly={subscribedOnly}
              />
            ))}
          {isLoading && status === null && (
            <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
              Checking sources…
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border/50">
          <span className="text-xs text-muted-foreground">
            Sync re-applies every published chunk. Your own notes, results, and edits are never overwritten.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void handleSync(null) }}
            disabled={busyId !== null || isLoading}
            data-testid="feed-resync-button"
            className="gap-2"
          >
            <RefreshCw className={`size-3.5 ${busyId === 'all' ? 'animate-spin' : ''}`} />
            <span>{busyId === 'all' ? 'Syncing all…' : 'Sync All Sources'}</span>
          </Button>
        </div>
      </section>

      <section className="space-y-4 pt-4 border-t border-border/50">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Link2 className="size-4 text-primary" />
            Add a Source
          </h2>
          <p className="text-sm text-muted-foreground">
            Register any URL serving a Wod Wiki feed (a directory with <code>manifest.json</code> and{' '}
            <code>chunks/</code>) — a community library mirror or one you compiled yourself. The host must
            allow cross-origin reads (CORS). Added sources sync immediately and start subscribed; manage
            Auto-sync, Unsubscribe, and Delete on each source card above.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="feed-add-source-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="feed-source-label" className="block text-xs font-medium text-muted-foreground mb-1">
                Label
              </label>
              <Input
                id="feed-source-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="My library (optional — defaults to the host name)"
                disabled={busyId !== null}
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
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://example.com/feed/library/"
                className="font-mono"
                disabled={busyId !== null}
              />
            </div>
          </div>
          {addError && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive" data-testid="feed-add-error">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
              <span>{addError}</span>
            </p>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => { void handleAdd() }}
              disabled={busyId !== null || !newUrl.trim()}
              data-testid="feed-add-button"
              className="gap-2"
            >
              <Plus className="size-3.5" />
              <span>Add & Sync</span>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
