/**
 * SyncSection — /settings/sync. Content sync sources for the active data
 * location: the bundled core seed (auto-imports at boot), the bundled
 * community library, and user-registered custom libraries. Per-source
 * status + Sync, Sync All, and source registration. Where data LIVES is
 * /settings/database; this page is where content COMES FROM.
 */

import { useCallback, useEffect, useState } from 'react'
import { CloudDownload, RefreshCw, CheckCircle2, AlertCircle, Plus, Trash2, Link2 } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import { Input } from '@/components/atoms/primitives/input'
import { readSeedStatus, runSeedSync, syncSeedSource, type SeedSourceStatus, type SeedStatus, type SeedSyncOutcome, type SeedSyncProgress } from '@/services/seed/seedSync'
import type { SeedImportProgress } from '@/services/seed/SeedImporter'
import { addCustomSeedSource, customSeedSources, removeCustomSeedSource, type CustomSeedSource } from '@/services/seed/seedSources'
import { ProgressBar } from '../components/atoms/ProgressBar'
import { toast } from '@/hooks/use-toast'

const formatSeedVersion = (version: number): string =>
  new Date(version).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** One toast per sync outcome, labeled with the source that produced it. */
function announceOutcome(outcome: string, label: string): void {
  if (outcome === 'imported') {
    toast({ title: `${label} synced`, description: 'Content was imported from the published seed. Your own edits were kept.' })
  } else if (outcome === 'error') {
    toast({ title: `${label} sync failed`, description: 'Check your connection and the browser console for details.', variant: 'destructive' })
  } else if (outcome === 'busy') {
    toast({ title: 'Another tab is already syncing', description: 'Wait for it to finish, then try again.' })
  } else {
    toast({ title: `${label}: nothing to import (${outcome})` })
  }
}

type SourceProgress = {
  event: SeedSyncProgress
  imported: SeedImportProgress | null
  chunks: string[]
}

const OUTCOME_LABEL: Record<SeedSyncOutcome, string> = {
  imported: 'Synced',
  current: 'Up to date',
  'server-stale': 'Published version is older than the stored version',
  busy: 'Another tab is syncing',
  disabled: 'Seed import is disabled',
  error: 'Sync failed',
}

function progressLabel(event: SeedSyncProgress): string {
  switch (event.phase) {
    case 'checking': return 'Checking source…'
    case 'fetching': return `Downloading ${event.chunkId}…`
    case 'applying': return `Importing ${event.chunkId}…`
    case 'committed': return `Committed ${event.chunkId}`
    case 'finalizing': return 'Finalizing checkpoints…'
    case 'finished': return event.error ?? OUTCOME_LABEL[event.outcome]
  }
}

/** Status + actions for one registered seed source. */
function SourceCard({ source, custom, running, disabled, onSync, onRemove }: {
  source: SeedSourceStatus
  custom?: CustomSeedSource
  /** This source's sync is the one in flight — spin its button. */
  running: boolean
  /** Any sync is in flight — lock every competing action. */
  disabled: boolean
  onSync: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid={`seed-source-${source.id}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">{source.label}</span>
          {source.autoImport ? (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 shrink-0">
              Auto
            </span>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              Manual
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {custom && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemove(source.id)}
              disabled={disabled}
              data-testid={`seed-remove-${source.id}`}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              title="Remove this source from the sync list. Imported notes stay in your library."
            >
              <Trash2 className="size-3.5" />
              <span className="text-xs">Remove</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSync(source.id)}
            disabled={disabled}
            data-testid={`seed-sync-${source.id}`}
            className="gap-2"
          >
            <RefreshCw className={`size-3.5 ${running ? 'animate-spin' : ''}`} />
            <span>{running ? 'Syncing…' : 'Sync'}</span>
          </Button>
        </div>
      </div>

      {custom && (
        <div className="text-xs text-muted-foreground font-mono break-all">{custom.url}</div>
      )}

      <div className="grid gap-1 text-sm" data-testid="seed-status-card">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">Local database</span>
          <span className="font-medium text-foreground text-xs" data-testid="seed-local-version">
            {source.stored
              ? `v${source.stored.version} · schema ${source.stored.schema} · imported ${formatSeedVersion(source.stored.importedAt)}`
              : 'Not imported yet'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">Published version</span>
          <span className="font-medium text-foreground text-xs flex items-center gap-1.5" data-testid="seed-remote-version">
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
          <span className="text-xs text-muted-foreground">Status</span>
          <span className="font-medium text-xs flex items-center gap-1.5" data-testid="seed-sync-status">
            {source.upToDate ? (
              <>
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                Up to date
              </>
            ) : source.remote == null ? (
              'Unknown (remote unreachable)'
            ) : source.autoImport ? (
              'Update available — re-imports automatically on next launch'
            ) : (
              'Update available'
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * SyncSection — the content sync registry. Boot auto-imports the core seed
 * only; every library (community + custom) syncs from here, one at a time
 * or all at once.
 */
export function SyncSection() {
  const [status, setStatus] = useState<SeedStatus | null>(null)
  const [custom, setCustom] = useState<CustomSeedSource[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<null | 'all' | string>(null)
  const [progress, setProgress] = useState<SourceProgress[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setCustom(customSeedSources())
    setLoadError(null)
    try {
      setStatus(await readSeedStatus())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleSync = useCallback(async (id: null | string) => {
    setBusyId(id ?? 'all')
    setProgress([])
    const onProgress = (event: SeedSyncProgress) => setProgress(previous => {
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
        ? await syncSeedSource(id, { force: true, onProgress })
        : await runSeedSync({ force: true, onProgress })
      const label = id ? (status?.sources.find(s => s.id === id)?.label ?? id) : 'All sources'
      announceOutcome(outcome, label)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }, [refresh, status])

  const handleAdd = useCallback(async () => {
    setAddError(null)
    let added: CustomSeedSource
    try {
      added = addCustomSeedSource(newLabel, newUrl)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
      return
    }
    setNewLabel('')
    setNewUrl('')
    // A source is added to be imported — sync it immediately.
    await handleSync(added.id)
  }, [newLabel, newUrl, handleSync])

  const handleRemove = useCallback(async (id: string) => {
    removeCustomSeedSource(id)
    toast({ title: 'Source removed', description: 'Imported notes stay in your library; only the source was unregistered.' })
    await refresh()
  }, [refresh])

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
            Catalogs, feeds, guides, dashboards, and efforts import into your active data location from
            seed sources. The core seed (home page, template) imports automatically on launch; community
            and custom libraries sync when you ask — one at a time or all at once.
          </p>
        </div>

        {loadError && (
          <div className="flex items-center gap-1.5 text-xs text-destructive" data-testid="seed-status-error">
            <AlertCircle className="size-3.5 shrink-0" />
            Couldn't read the seed status from the active storage: {loadError}
          </div>
        )}

        {current && (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="seed-sync-progress">
            <div className="flex items-center justify-between gap-4 text-sm font-medium">
              <span>{busyId !== null ? 'Syncing…' : progress.some(source => source.event.phase === 'finished' && source.event.outcome === 'error') ? 'Sync finished with errors' : 'Sync finished'}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                Source {current.sourceIndex} of {current.totalSources}
              </span>
            </div>
            <p role="status" aria-live="polite" className="sr-only" data-testid="seed-sync-live-status">
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
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums" data-testid="seed-sync-totals">
                    <span>{imported.totalNotes.toLocaleString()} notes</span>
                    <span>{imported.totalEfforts.toLocaleString()} efforts</span>
                    <span>{imported.totalBlocks.toLocaleString()} blocks</span>
                    {imported.skippedUserOwned > 0 && <span>{imported.skippedUserOwned.toLocaleString()} user-owned rows preserved</span>}
                    {imported.deleted > 0 && <span>{imported.deleted.toLocaleString()} seed rows removed</span>}
                  </p>
                )}
                {chunks.length > 0 && (
                  <details className="text-xs" data-testid="seed-sync-chunks">
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

        <div className="grid gap-3" data-testid="seed-source-list">
          {status?.sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              custom={custom.find(c => c.id === source.id)}
              running={busyId === source.id || busyId === 'all'}
              disabled={busyId !== null}
              onSync={(id) => { void handleSync(id) }}
              onRemove={(id) => { void handleRemove(id) }}
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
            data-testid="seed-resync-button"
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
            Register any URL serving a Wod Wiki seed (a directory with <code>manifest.json</code> and{' '}
            <code>chunks/</code>) — a community library mirror or one you compiled yourself. The host must
            allow cross-origin reads (CORS). Added sources sync immediately.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="seed-add-source-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="seed-source-label" className="block text-xs font-medium text-muted-foreground mb-1">
                Label
              </label>
              <Input
                id="seed-source-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="My library (optional — defaults to the host name)"
                disabled={busyId !== null}
              />
            </div>
            <div>
              <label htmlFor="seed-source-url" className="block text-xs font-medium text-muted-foreground mb-1">
                Seed directory URL
              </label>
              <Input
                id="seed-source-url"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://example.com/seed/library/"
                className="font-mono"
                disabled={busyId !== null}
              />
            </div>
          </div>
          {addError && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive" data-testid="seed-add-error">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
              <span>{addError}</span>
            </p>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => { void handleAdd() }}
              disabled={busyId !== null || !newUrl.trim()}
              data-testid="seed-add-button"
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
