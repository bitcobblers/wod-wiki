/**
 * TourJumpSection.tsx — "Library & Community Feeds": direct exits + the
 * community notebook gallery.
 *
 * Browse-first, registry-driven cards: every sync package renders with its
 * cover (declared `image:` or a deterministic monogram), curated one-line
 * description, category chips, and live stats once its chunk is imported —
 * review before install, one-click Import, deep-link once installed. One
 * primary action per card; re-sync and removal live in Settings → Sync.
 *
 * Controls: text search (label + description), kind facets (Feeds /
 * Collections), and three sort orders (Updated / Name / Size) — they scale
 * without clutter as the registry grows. The Library exit stays disabled
 * until at least one feed has been synchronized.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Library,
  CalendarPlus,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react'
import { telemetry, HOME_EVENTS } from '@/services/telemetry'
import { journalNotes } from '../services/journalNotes'
import { noteByIdPath } from '../lib/routes'
import { getTodayDateKey } from '../services/dateUtils'
import { listSyncPackages } from '@/services/seed/seedSources'
import { setSeedSubscribed, subscribeSeedSubscriptions } from '@/services/seed/seedSubscriptions'
import { syncSeedSource, readSeedCoverage } from '@/services/seed/seedSync'
import { useSeedContent } from '@/services/content/seedContent'
import { cn } from '@/lib/utils'
import { TaglineHeader } from './TaglineHeader'
import { NotebookCard } from '../views/notebook-gallery/NotebookCard'
import { MarqueeRow } from '../views/notebook-gallery/MarqueeRow'
import {
  buildNotebookCatalog,
  filterNotebooks,
  sortNotebooks,
} from '../views/notebook-gallery/notebookGalleryModel'
import type { NotebookKind, NotebookSort } from '../views/notebook-gallery/notebookGalleryModel'
import { useMediaQuery } from '../hooks/useMediaQuery'

const KIND_OPTIONS: { value: NotebookKind; label: string }[] = [
  { value: 'feed', label: 'Feeds' },
  { value: 'collection', label: 'Collections' },
]

const SORT_OPTIONS: { value: NotebookSort; label: string }[] = [
  { value: 'updated', label: 'Updated' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Size' },
]

const EXIT_CARD_BASE =
  'group flex flex-col justify-between rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

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

function feedProgressLabel(event: { phase: string; chunkId?: string }): string {
  switch (event.phase) {
    case 'checking': return 'Checking source…'
    case 'fetching': return `Downloading ${event.chunkId ?? 'package'}…`
    case 'applying': return `Importing ${event.chunkId ?? 'package'}…`
    case 'committed': return `Committed ${event.chunkId ?? 'package'}`
    case 'finalizing': return 'Finalizing checkpoints…'
    case 'finished': return 'Done'
    default: return 'Working…'
  }
}

export function TourJumpSection() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<NotebookKind | undefined>()
  const [sort, setSort] = useState<NotebookSort>('updated')
  const [anyBusy, setAnyBusy] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, { text: string; tone: 'muted' | 'error' }>>({})

  const files = useSeedContent()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // ponytail: packages derive from Common categories and custom seed sources; upgrade to dynamic remote manifest discovery when endpoints publish index catalogs.
  const packages = useMemo(() => listSyncPackages(), [])
  const catalog = useMemo(() => buildNotebookCatalog(packages, files), [packages, files])
  const visible = useMemo(
    () => sortNotebooks(filterNotebooks(catalog, { text: search, kind }), sort),
    [catalog, search, kind, sort],
  )
  // Two rows sliding opposite ways on desktop: split the catalog in half.
  const half = Math.ceil(visible.length / 2)
  const rowA = visible.slice(0, half)
  const rowB = visible.slice(half)

  const handleLibrary = useCallback(() => {
    telemetry.record(HOME_EVENTS.libraryOpened)
  }, [])

  // Library card stays disabled until a feed actually has content (a synced
  // checkpoint). Re-check after every import round and subscription change;
  // default enabled so first paint never flickers disabled.
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

  const handleImport = useCallback(async (packageId: string) => {
    if (anyBusy) return
    setAnyBusy(true)
    setImportingId(packageId)
    const setStatus = (status: { text: string; tone: 'muted' | 'error' }) =>
      setStatuses(prev => ({ ...prev, [packageId]: status }))
    setStatus({ text: 'Checking source…', tone: 'muted' })
    try {
      const outcome = await syncSeedSource(packageId, {
        onProgress: (e) => setStatus({ text: feedProgressLabel(e), tone: 'muted' }),
      })
      if (outcome === 'imported' || outcome === 'current') {
        const persisted = setSeedSubscribed(packageId, true)
        setStatus({
          text: !persisted
            ? 'Subscribed for this session only — browser storage is unavailable.'
            : outcome === 'imported'
              ? 'Imported — workouts are available offline.'
              : 'Already up to date.',
          tone: 'muted',
        })
      } else {
        setStatus({
          text: outcome === 'server-stale'
            ? 'Published version is older than stored copy.'
            : outcome === 'busy'
              ? 'Another tab is syncing. Try again shortly.'
              : 'Sync failed. Check connection and try again.',
          tone: 'error',
        })
      }
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), tone: 'error' })
    } finally {
      setImportingId(null)
      setAnyBusy(false)
    }
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

  const hasFilters = Boolean(search.trim()) || kind !== undefined

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
        blurb="Subscribe to Markdown repositories and sync while you keep scrolling. Publishers run npx wod build to compile manifests and chunks, then deploy them through GitHub Pages. Browse the registry below — every notebook imports in one click."
      />

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* Controls: search · kind chips · sort toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notebooks…"
              aria-label="Search notebooks"
              data-testid="package-search-input"
              className="h-9 w-full rounded-full border border-border bg-background pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-primary/50"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </label>

          <div className="flex items-center gap-1.5" role="group" aria-label="Filter by kind">
            {KIND_OPTIONS.map(option => {
              const active = kind === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  data-testid={`package-kind-${option.value}`}
                  onClick={() => setKind(active ? undefined : option.value)}
                  className={cn(
                    'h-8 rounded-full border px-3 text-[10px] font-black uppercase tracking-widest transition-colors',
                    active
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          <div className="ml-auto flex items-center gap-0.5" role="group" aria-label="Sort notebooks">
            {SORT_OPTIONS.map(option => {
              const active = sort === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  data-testid={`package-sort-${option.value}`}
                  onClick={() => setSort(option.value)}
                  className={cn(
                    'h-8 rounded-full px-3 text-[10px] font-black uppercase tracking-widest transition-colors',
                    active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Card area: static workspace exits, then the sliding notebook rows */}
        <div data-testid="jump-grid" className="mt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Library — disabled until a feed has been synced */}
            {libraryHasContent ? (
              <Link to="/catalogs" onClick={handleLibrary} data-testid="jump-library" className={EXIT_CARD_BASE}>
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
                className={`${EXIT_CARD_BASE} cursor-not-allowed opacity-60`}
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

            {/* Start your own journal */}
            <button type="button" onClick={() => { void handleNewNote() }} data-testid="jump-new-note" className={EXIT_CARD_BASE}>
              <BoxFace
                icon={CalendarPlus}
                title="Start your own journal"
                description="Create today's note and log your first workout."
                action="Create today's note"
              />
            </button>
          </div>

          {visible.length > 0 ? (
            isDesktop ? (
              <>
                {/* Two rows sliding in opposite directions. */}
                <MarqueeRow direction="left" testId="jump-row-a" className="mt-4">
                  {rowA.map(notebook => (
                    <NotebookCard
                      key={notebook.packageId}
                      notebook={notebook}
                      testId={`demo-feed-${notebook.packageId}`}
                      className="w-[290px] sm:w-[320px] shrink-0"
                      onImport={handleImport}
                      importing={importingId === notebook.packageId}
                      busy={anyBusy}
                      status={statuses[notebook.packageId]}
                    />
                  ))}
                </MarqueeRow>
                {rowB.length > 0 && (
                  <MarqueeRow direction="right" testId="jump-row-b" className="mt-4">
                    {rowB.map(notebook => (
                      <NotebookCard
                        key={notebook.packageId}
                        notebook={notebook}
                        testId={`demo-feed-${notebook.packageId}`}
                        className="w-[290px] sm:w-[320px] shrink-0"
                        onImport={handleImport}
                        importing={importingId === notebook.packageId}
                        busy={anyBusy}
                        status={statuses[notebook.packageId]}
                      />
                    ))}
                  </MarqueeRow>
                )}
              </>
            ) : (
              /* One row, sliding out and back — the mobile alternating-sides effect. */
              <MarqueeRow direction="alternate" testId="jump-row-mobile" className="mt-4">
                {visible.map(notebook => (
                  <NotebookCard
                    key={notebook.packageId}
                    notebook={notebook}
                    testId={`demo-feed-${notebook.packageId}`}
                    className="w-[290px] shrink-0"
                    onImport={handleImport}
                    importing={importingId === notebook.packageId}
                    busy={anyBusy}
                    status={statuses[notebook.packageId]}
                  />
                ))}
              </MarqueeRow>
            )
          ) : (
            <div
              data-testid="jump-empty"
              className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-10 text-center"
            >
              <p className="text-sm font-bold text-muted-foreground">No notebooks match your search.</p>
              <p className="mt-1 text-xs text-muted-foreground/70">Try a different term or clear the filters.</p>
              {hasFilters && (
                <button
                  type="button"
                  data-testid="jump-clear-filters"
                  onClick={() => { setSearch(''); setKind(undefined) }}
                  className="mt-3 h-8 rounded-full border border-border px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>

        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 xl:text-[11px]">
          — or keep scrolling ↓
        </p>
      </div>
    </section>
  )
}
