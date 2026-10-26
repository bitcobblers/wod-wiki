/**
 * HomeDataOwnership + HomeCommunityFeeds — the two local-first sections at
 * the foot of the home tour. Data ownership shows the live storage mode
 * (browser only / browser + your Turso / API server build) with honest
 * pros/cons; Community feeds lists the two existing demo feeds with inline
 * subscribe + sync that never navigates or blocks scrolling.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Cloud, CloudDownload, Database, RefreshCw, Server } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import { cn } from '@/lib/utils'
import { readDataSettings, storageBackend } from '@/services/storage'
import { demoFeedSources, type DemoFeedSource } from '@/services/feed/feedSources'
import { syncFeedSource, type FeedSyncOutcome, type FeedSyncProgress } from '@/services/feed/feedSync'
import { isFeedSubscribed, setFeedSubscribed, subscribeFeedSubscriptions } from '@/services/feed/feedSubscriptions'

// ── Data ownership ────────────────────────────────────────────────────────────

interface ModeCard {
  id: string
  icon: typeof Database
  title: string
  active: boolean
  pros: string[]
  cons: string[]
  note?: string
}

function useModeCards(): ModeCard[] {
  // Read once per mount — every settings change path (enable/disable Turso,
  // repair invalid config) reloads the page, so mount-time state is live.
  const settings = readDataSettings()
  const backend = storageBackend
  const invalid = settings.state === 'invalid'
  const browserActive = backend === 'indexed-db' || backend === 'invalid'
  return [
    {
      id: 'browser',
      icon: Database,
      title: 'Browser only',
      active: browserActive,
      pros: ['Works fully offline', 'Private — data never leaves this browser', 'Fast — no network round-trips'],
      cons: ['Tied to this browser and profile', 'Moving machines means exporting and importing'],
      note: invalid
        ? 'Turso Sync is misconfigured — your data stays in this browser until it is fixed in settings.'
        : undefined,
    },
    {
      id: 'turso',
      icon: Cloud,
      title: 'Browser + your Turso',
      active: backend === 'turso',
      pros: ['Same local execution — you still read and write the local copy', 'Background backup to your own database', 'Syncs the same data across multiple browsers'],
      cons: ['You provide the database URL and an auth token', 'Background sync needs network access'],
    },
    {
      id: 'api',
      icon: Server,
      title: 'API server',
      active: backend === 'api',
      pros: ['Self-hosted — data access local or cloud', 'Centralized storage for a deployment'],
      cons: ['Server administration is on you (or the host)', 'Reads and writes need the network'],
      note: backend === 'api' ? undefined : 'Available in self-hosted API builds of the app.',
    },
  ]
}

export function HomeDataOwnership() {
  const cards = useModeCards()
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8" aria-labelledby="home-data-ownership-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="home-data-ownership-heading" className="text-lg font-semibold text-foreground">
            Your data, your choice
          </h2>
          <p className="text-sm text-muted-foreground">
            Where your notes and results live. The browser copy is always the one you edit;
            sync and backup are layered on top.
          </p>
        </div>
        <Link to="/settings/database" className="text-sm font-medium text-primary hover:underline">
          Configure data →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="home-data-ownership">
        {cards.map(({ id, icon: Icon, title, active, pros, cons, note }) => (
          <div
            key={id}
            data-testid={`home-mode-${id}`}
            className={cn(
              'relative flex flex-col rounded-xl border p-4',
              active ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-border bg-card',
            )}
          >
            <div className="mb-3 flex w-full items-center justify-between">
              <div className={cn('p-2 rounded-lg', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
                <Icon className="size-5" aria-hidden="true" />
              </div>
              {active && (
                <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                  Active
                </span>
              )}
            </div>
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
              {pros.map(pro => <li key={pro}>+ {pro}</li>)}
              {cons.map(con => <li key={con}>- {con}</li>)}
            </ul>
            {note && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{note}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Community feeds ───────────────────────────────────────────────────────────

const OUTCOME_STATUS: Record<FeedSyncOutcome, string> = {
  imported: 'Synced — new content imported',
  current: 'Up to date',
  'server-stale': 'Up to date (published version is older)',
  busy: 'Another tab is syncing — try again shortly',
  disabled: 'Feed import is disabled',
  error: 'Sync failed',
}

function progressText(event: FeedSyncProgress): string {
  switch (event.phase) {
    case 'checking': return 'Checking feed…'
    case 'fetching': return `Downloading ${event.chunkId}…`
    case 'applying': return `Importing ${event.chunkId}…`
    case 'committed': return `Committed ${event.chunkId}`
    case 'finalizing': return 'Finalizing…'
    case 'finished': return event.error ?? OUTCOME_STATUS[event.outcome]
  }
}

/** A manual sync subscribes only after a successful commit. */
function outcomeSubscribes(outcome: FeedSyncOutcome): boolean {
  return outcome === 'imported' || outcome === 'current' || outcome === 'server-stale'
}

function FeedCard({ feed }: { feed: DemoFeedSource }) {
  const [subscribed, setSubscribed] = useState(() => isFeedSubscribed(feed.id))
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => subscribeFeedSubscriptions(() => {
    setSubscribed(isFeedSubscribed(feed.id))
  }), [feed.id])

  const handleSync = async () => {
    setBusy(true)
    setFailed(false)
    setStatus('Checking feed…')
    try {
      const outcome = await syncFeedSource(feed.id, {
        onProgress: event => setStatus(progressText(event)),
      })
      const ok = outcomeSubscribes(outcome)
      setStatus(OUTCOME_STATUS[outcome])
      setFailed(!ok)
      // Subscribe only after a successful commit — never before, never on error.
      if (ok && !isFeedSubscribed(feed.id)) setFeedSubscribed(feed.id, true)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4" data-testid={`home-feed-${feed.id}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CloudDownload className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate text-sm font-medium text-foreground">{feed.label}</span>
        </div>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Demo
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{feed.description}</p>
      <a
        href={feed.repositoryUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 truncate font-mono text-xs text-primary hover:underline"
      >
        {feed.repositoryUrl}
      </a>

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { void handleSync() }}
          disabled={busy}
          data-testid={`home-feed-sync-${feed.id}`}
          className="gap-2"
        >
          <RefreshCw className={cn('size-3.5', busy && 'motion-safe:animate-spin')} aria-hidden="true" />
          <span>{busy ? 'Syncing…' : 'Sync'}</span>
        </Button>
        <button
          type="button"
          onClick={() => setFeedSubscribed(feed.id, !subscribed)}
          disabled={busy}
          data-testid={`home-feed-subscribe-${feed.id}`}
          className={cn(
            'text-xs font-medium disabled:opacity-50',
            subscribed ? 'text-muted-foreground hover:text-destructive' : 'text-primary hover:underline',
          )}
        >
          {subscribed ? 'Unsubscribe' : 'Subscribe'}
        </button>
      </div>

      {status && (
        <p
          role="status"
          data-testid={`home-feed-status-${feed.id}`}
          className={cn('mt-2 flex items-center gap-1.5 text-xs', failed ? 'text-destructive' : 'text-muted-foreground')}
        >
          {failed
            ? <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            : <CheckCircle2 className={cn('size-3.5 shrink-0', busy && 'text-primary')} aria-hidden="true" />}
          <span>{status}</span>
        </p>
      )}
    </div>
  )
}

export function HomeCommunityFeeds() {
  const feeds = demoFeedSources()
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8" aria-labelledby="home-community-feeds-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="home-community-feeds-heading" className="text-lg font-semibold text-foreground">
            Community feeds
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            A feed is a markdown repository compiled into a versioned manifest with{' '}
            <code className="font-mono text-xs">wod build</code> (this repo publishes its own with{' '}
            <code className="font-mono text-xs">bun run generate:seed</code>) and hosted anywhere —
            each feed repo publishes to its own GitHub Pages. Subscribe to a feed and the app syncs
            every notebook it publishes at launch; the two feeds below are demos you can try right now.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium">
          <Link to="/settings/sync" className="text-primary hover:underline">Manage feeds →</Link>
          <Link to="/notebooks" className="text-primary hover:underline">Catalog →</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="home-community-feeds">
        {feeds.map(feed => <FeedCard key={feed.id} feed={feed} />)}
      </div>
    </section>
  )
}
