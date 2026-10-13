/**
 * TourJumpSection.tsx — "Know where you're going?" direct-exit & packages carousel.
 *
 * Combines direct exits (Library, today's journal note) with syncable packages
 * from community sources (Common and registered mirrors) in a single story-driven
 * carousel with search filtering, on/off library toggles, sync, and delete controls.
 * The Library exit stays disabled until at least one feed has been synchronized.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Library,
  CalendarPlus,
  RefreshCw,
  Trash2,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { telemetry, HOME_EVENTS } from '@/services/telemetry'
import { journalNotes } from '../services/journalNotes'
import { noteByIdPath } from '../lib/routes'
import { getTodayDateKey } from '../services/dateUtils'
import { listSyncPackages, type SyncPackage } from '@/services/seed/seedSources'
import { isSeedSubscribed, setSeedSubscribed, subscribeSeedSubscriptions } from '@/services/seed/seedSubscriptions'
import { syncSeedSource, removePackageFromLibrary, readSeedCoverage, type SeedSyncProgress } from '@/services/seed/seedSync'
import { TaglineHeader } from './TaglineHeader'

const CARD_BASE =
  'w-[290px] sm:w-[320px] md:w-[340px] shrink-0 snap-start flex flex-col justify-between rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

function BoxFace(props: {
  icon: LucideIcon
  title: string
  description: string
  action: string
  /** Replaces the action row — used by disabled cards to say why. */
  note?: string
}) {
  const Icon = props.icon
  return (
    <>
      <div>
        <span className="flex size-10 items-center justify-center rounded-lg bg-foreground text-background">
          <Icon className="size-5" aria-hidden />
        </span>
        <h3 className="mt-4 text-base font-semibold text-foreground">{props.title}</h3>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{props.description}</p>
      </div>
      {props.note ? (
        <span className="mt-4 text-xs font-medium text-muted-foreground">{props.note}</span>
      ) : (
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          <span>{props.action}</span>
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      )}
    </>
  )
}

function feedProgressLabel(event: SeedSyncProgress): string {
  switch (event.phase) {
    case 'checking': return 'Checking source…'
    case 'fetching': return `Downloading ${event.chunkId ?? 'package'}…`
    case 'applying': return `Importing ${event.chunkId ?? 'package'}…`
    case 'committed': return `Committed ${event.chunkId ?? 'package'}`
    case 'finalizing': return 'Finalizing checkpoints…'
    case 'finished': return event.error ?? 'Done'
  }
}

function PackageCard(props: {
  pkg: SyncPackage
  anyBusy: boolean
  onBusyChange: (busy: boolean) => void
}) {
  const { pkg, anyBusy, onBusyChange } = props
  const [inLibrary, setInLibrary] = useState(() => isSeedSubscribed(pkg.id))
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setInLibrary(isSeedSubscribed(pkg.id))
    return subscribeSeedSubscriptions(() => setInLibrary(isSeedSubscribed(pkg.id)))
  }, [pkg.id])

  const runSync = async () => {
    setRunning(true)
    onBusyChange(true)
    setError(null)
    setProgress('Checking source…')
    try {
      const outcome = await syncSeedSource(pkg.id, {
        onProgress: (e) => setProgress(feedProgressLabel(e)),
      })
      if (outcome === 'imported' || outcome === 'current') {
        const persisted = setSeedSubscribed(pkg.id, true)
        setInLibrary(true)
        setProgress(
          !persisted
            ? 'Subscribed for this session only — browser storage is unavailable.'
            : outcome === 'imported'
              ? 'Imported — package added to your library.'
              : 'Already up to date.',
        )
      } else {
        setProgress(null)
        setError(
          outcome === 'server-stale'
            ? 'Published version is older than stored copy.'
            : outcome === 'busy'
              ? 'Another tab is syncing. Try again shortly.'
              : 'Sync failed. Check connection and try again.',
        )
      }
    } catch (err) {
      setProgress(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
      onBusyChange(false)
    }
  }

  const handleDelete = async () => {
    setRunning(true)
    onBusyChange(true)
    setError(null)
    setProgress('Removing package…')
    try {
      await removePackageFromLibrary(pkg.id)
      setInLibrary(false)
      setProgress('Removed from library.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete package')
    } finally {
      setRunning(false)
      onBusyChange(false)
    }
  }

  const handleToggle = () => {
    if (inLibrary) {
      void handleDelete()
    } else {
      void runSync()
    }
  }

  const busy = running || anyBusy

  return (
    <article
      className={CARD_BASE}
      data-testid={`demo-feed-${pkg.id}`}
      aria-label={`${pkg.label} package`}
    >
      <div>
        {/* Source, category badge, and On/Off toggle */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {pkg.sourceLabel}
            </span>
            <span className="rounded-full border border-border/80 bg-accent/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {pkg.category}
            </span>
            {pkg.category === 'feeds' && (
              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                Demo
              </span>
            )}
          </div>

          {/* On/Off toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={inLibrary}
            aria-label={`Toggle ${pkg.label} in library`}
            onClick={handleToggle}
            disabled={busy}
            data-testid={`demo-feed-toggle-${pkg.id}`}
            title={inLibrary ? 'Remove from library' : 'Add to library'}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
              inLibrary ? 'bg-emerald-600' : 'bg-muted-foreground/30'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block size-3.5 transform rounded-full bg-background shadow transition-transform ${
                inLibrary ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        <h3 className="mt-3.5 text-base font-semibold text-foreground">{pkg.label}</h3>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground line-clamp-3">{pkg.description}</p>
      </div>

      <div className="mt-4 pt-2 border-t border-border/60">
        {/* Status text */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {inLibrary ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
              <CheckCircle2 className="size-3.5" aria-hidden />
              In library
            </span>
          ) : (
            <span className="text-muted-foreground">Not in library</span>
          )}
        </div>

        {progress && (
          <p
            role="status"
            aria-live="polite"
            className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"
            data-testid={`demo-feed-progress-${pkg.id}`}
          >
            {running && <RefreshCw className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />}
            <span className="truncate">{progress}</span>
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive"
            data-testid={`demo-feed-error-${pkg.id}`}
          >
            <XCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        )}

        {/* Buttons: Sync and Delete */}
        <div className="mt-3 flex items-center gap-2">
          {inLibrary ? (
            <>
              <button
                type="button"
                onClick={() => { void runSync() }}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                data-testid={`demo-feed-sync-${pkg.id}`}
              >
                <RefreshCw className={`size-3 ${running ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
                <span>{running ? 'Syncing…' : 'Sync now'}</span>
              </button>
              <button
                type="button"
                onClick={() => { void handleDelete() }}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-destructive/20 px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
                data-testid={`demo-feed-unsubscribe-${pkg.id}`}
                title="Remove package from library"
              >
                <Trash2 className="size-3" aria-hidden />
                <span>Delete</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => { void runSync() }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
              data-testid={`demo-feed-subscribe-${pkg.id}`}
            >
              <RefreshCw className={`size-3 ${running ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
              <span>{running ? 'Syncing…' : 'Subscribe & sync'}</span>
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

export function TourJumpSection() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [anyBusy, setAnyBusy] = useState(false)
  const carouselRef = useRef<HTMLDivElement>(null)

  // ponytail: packages derive from Common categories and custom seed sources; upgrade to dynamic remote manifest discovery when endpoints publish index catalogs.
  const packages = useMemo(() => listSyncPackages(), [])

  const filteredPackages = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return packages
    return packages.filter(
      (pkg) =>
        pkg.label.toLowerCase().includes(q) ||
        pkg.category.toLowerCase().includes(q) ||
        pkg.sourceLabel.toLowerCase().includes(q) ||
        pkg.description.toLowerCase().includes(q),
    )
  }, [packages, search])

  const scrollCarousel = (direction: 'left' | 'right') => {
    if (!carouselRef.current) return
    const offset = carouselRef.current.clientWidth * 0.75
    carouselRef.current.scrollBy({
      left: direction === 'left' ? -offset : offset,
      behavior: 'smooth',
    })
  }

  const handleLibrary = useCallback(() => {
    telemetry.record(HOME_EVENTS.libraryOpened)
  }, [])

  // Library card stays disabled until a feed actually has content (a synced
  // checkpoint). Re-check after every sync/delete round (anyBusy flips) and
  // subscription change; default enabled so first paint never flickers disabled.
  const [libraryHasContent, setLibraryHasContent] = useState(true)
  useEffect(() => {
    let cancelled = false
    const check = () => {
      readSeedCoverage()
        .then(coverage => { if (!cancelled) setLibraryHasContent(coverage.libraryImported) })
        .catch(() => { /* storage unavailable — leave the card enabled */ })
    }
    check()
    const unsubscribe = subscribeSeedSubscriptions(check)
    return () => { cancelled = true; unsubscribe() }
  }, [anyBusy])

  const handleNewNote = useCallback(async () => {
    const today = getTodayDateKey()
    const note = await journalNotes.create({
      journalDate: today,
      title: today,
      rawContent: '',
    })
    telemetry.record(HOME_EVENTS.noteCreated)
    navigate(noteByIdPath(note.id))
  }, [navigate])

  return (
    <section
      id="tour-section-community-feeds"
      data-testid="tour-jump-section"
      className="flex flex-col border-b border-border bg-muted/20 pb-8 xl:pb-12"
      aria-label="Library and community feeds"
    >
      <TaglineHeader
        index="00"
        before="Library & "
        accentText="Community Feeds"
        after=""
        accent=""
        blurb="Subscribe to Markdown repositories and sync while you keep scrolling. Publishers run npx wod build to compile manifests and chunks, then deploy them through GitHub Pages. CrossFit Programming and Dan John 40-Day Program are demo feeds; other packages and workspace shortcuts are available here too."
      />
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* Controls */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Search box to filter packages */}
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter packages…"
              data-testid="package-search-input"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Carousel navigation buttons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollCarousel('left')}
              aria-label="Previous cards"
              className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollCarousel('right')}
              aria-label="Next cards"
              className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        {/* Carousel containing the exit cards + package cards */}
        <div
          ref={carouselRef}
          data-testid="jump-carousel-track"
          className="mt-6 flex w-full gap-4 overflow-x-auto pb-4 pt-1 snap-x snap-mandatory scroll-smooth"
          style={{ scrollbarWidth: 'thin' }}
        >
          {/* Card 1: Library — leftmost; disabled until a feed has been synced */}
          {libraryHasContent ? (
            <Link to="/catalogs" onClick={handleLibrary} data-testid="jump-library" className={`group ${CARD_BASE}`}>
              <BoxFace
                icon={Library}
                title="Library"
                description="Curated workouts and sessions, organized by tag."
                action="Open the library"
              />
            </Link>
          ) : (
            <div
              data-testid="jump-library"
              aria-disabled="true"
              className={`${CARD_BASE} cursor-not-allowed opacity-60`}
            >
              <BoxFace
                icon={Library}
                title="Library"
                description="Curated workouts and sessions, organized by tag."
                action="Open the library"
                note="0 feeds synchronized"
              />
            </div>
          )}

          {/* Card 2: Start your own journal */}
          <button type="button" onClick={handleNewNote} data-testid="jump-new-note" className={`group ${CARD_BASE}`}>
            <BoxFace
              icon={CalendarPlus}
              title="Start your own journal"
              description="Create today's note and log your first workout."
              action="Create today's note"
            />
          </button>

          {/* Community feed + package cards */}
          {filteredPackages.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              anyBusy={anyBusy}
              onBusyChange={setAnyBusy}
            />
          ))}


          {filteredPackages.length === 0 && search && (
            <div className="flex w-64 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              <p>No packages match &ldquo;{search}&rdquo;.</p>
              <button
                type="button"
                onClick={() => setSearch('')}
                className="mt-2 font-medium text-foreground underline underline-offset-4"
              >
                Clear filter
              </button>
            </div>
          )}
        </div>

        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 xl:text-[11px]">
          — or keep scrolling ↓
        </p>
      </div>
    </section>
  )
}
