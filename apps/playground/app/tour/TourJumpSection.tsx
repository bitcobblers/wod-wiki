/**
 * TourJumpSection.tsx — "Library & Community Feeds": direct exits + the
 * feed gallery.
 *
 * The unit is the SEED: one published Markdown repository (its own Pages
 * build, its own manifest and version). A feed publishes one or more
 * NOTEBOOKS (chunks) and one Subscribe imports all of them — so each group
 * renders its feed's header (what it delivers, where it publishes) over its
 * notebook cards. Cards carry the identity (declared `image:` or a
 * deterministic monogram), curated one-line description, category chips and
 * live stats once imported; installed notebooks deep-link to their detail
 * surface.
 *
 * Controls: text search (label + description), kind facets (Feeds /
 * Collections), and three sort orders (Updated / Name / Size) — they filter
 * notebooks, and a feed with nothing left drops out. The Library exit stays
 * disabled until at least one feed has been synced; re-sync and removal live
 * in Settings → Sync.
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
import { listNotebooks, listFeedSources } from '@/services/feed/feedSources'
import { isNotebookSubscribed, setNotebookSubscribed, setFeedSubscribed, subscribeFeedSubscriptions } from '@/services/feed/feedSubscriptions'
import { syncFeedSource, readFeedCoverage } from '@/services/feed/feedSync'
import { feedProgressLabel } from '@/services/feed/feedProgress'
import { useSeedContent } from '@/services/content/seedContent'
import { cn } from '@/lib/utils'
import { TaglineHeader } from './TaglineHeader'
import { FeedCard } from '../views/notebook-gallery/FeedCard'
import { MarqueeRow } from '../views/notebook-gallery/MarqueeRow'
import {
  buildFeedCatalog,
  filterFeeds,
  sortFeeds,
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


export function TourJumpSection() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<NotebookKind | undefined>()
  const [sort, setSort] = useState<NotebookSort>('updated')
  const [importingFeedId, setImportingFeedId] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, { text: string; tone: 'muted' | 'error' }>>({})
  const [subscribedOnly, setSubscribedOnly] = useState(false)
  const [selectedFeedId, setSelectedFeedId] = useState<string | undefined>()
  const [subTick, setSubTick] = useState(0)

  useEffect(() => {
    return subscribeFeedSubscriptions(() => setSubTick((t) => t + 1))
  }, [])

  const anyBusy = importingFeedId !== null
  const files = useSeedContent()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // ponytail: feeds and their notebooks come from the registry; upgrade to dynamic remote manifest discovery when an index catalog is published.
  const catalog = useMemo(
    () => buildFeedCatalog(listNotebooks(), files, listFeedSources(), (feedId, chunkId) => isNotebookSubscribed(feedId, chunkId)),
    [files, subTick],
  )
  const visible = useMemo(
    () => sortFeeds(filterFeeds(catalog, { text: search, kind, feedId: selectedFeedId, subscribedOnly }), sort),
    [catalog, search, kind, sort, selectedFeedId, subscribedOnly],
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
      readFeedCoverage()
        .then(coverage => { if (!cancelled) setLibraryHasContent(coverage.libraryImported) })
        .catch(() => { /* storage unavailable — leave the card enabled */ })
    }
    check()
    const unsubscribe = subscribeFeedSubscriptions(check)
    return () => { cancelled = true; unsubscribe() }
  }, [anyBusy])

  /** Import = subscribe the FEED: every notebook it publishes, one checkpoint. */
  const handleImport = useCallback(async (feedId: string) => {
    if (importingFeedId) return
    setImportingFeedId(feedId)
    const setStatus = (status: { text: string; tone: 'muted' | 'error' }) =>
      setStatuses(prev => ({ ...prev, [feedId]: status }))
    setStatus({ text: 'Checking the feed…', tone: 'muted' })
    try {
      const outcome = await syncFeedSource(feedId, {
        onProgress: (e) => setStatus({ text: feedProgressLabel(e), tone: 'muted' }),
      })
      if (outcome === 'imported' || outcome === 'current') {
        const persisted = setFeedSubscribed(feedId, true)
        setStatus({
          text: !persisted
            ? 'Subscribed for this session only — browser storage is unavailable.'
            : outcome === 'imported'
              ? 'Imported — this feed is available offline.'
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
      setImportingFeedId(null)
    }
  }, [importingFeedId])

  const handleToggleNotebook = useCallback(async (feedId: string, chunkId: string, sub: boolean) => {
    setNotebookSubscribed(feedId, chunkId, sub)
    if (sub) {
      void syncFeedSource(feedId, { force: false })
    }
  }, [])

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
        index="03"
        before="Library & "
        accentText="Community Feeds"
        after=""
        accent=""
        blurb="Subscribe to a feed — one Markdown repository compiled with npx wod build into a versioned manifest, served from its own GitHub Pages. One Subscribe imports every notebook the feed publishes; browse the feeds below, notebooks and all."
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
              placeholder="Search feeds…"
              aria-label="Search feeds"
              data-testid="package-search-input"
              className="h-11 w-full rounded-full border border-border bg-background pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-primary/50"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-0 top-1/2 -translate-y-1/2 size-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
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
                    'inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-[10px] font-black uppercase tracking-widest transition-colors',
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

          {/* Subscribed only toggle */}
          <label className="flex min-h-11 items-center gap-2 cursor-pointer select-none text-muted-foreground hover:text-foreground px-2">
            <input
              type="checkbox"
              checked={subscribedOnly}
              onChange={(e) => setSubscribedOnly(e.target.checked)}
              data-testid="filter-subscribed-only"
              className="size-4 accent-primary rounded"
            />
            <span className="text-[10px] font-black uppercase tracking-widest">Subscribed only</span>
          </label>

          {/* Feed selector */}
          <select
            value={selectedFeedId ?? ''}
            onChange={(e) => setSelectedFeedId(e.target.value ? e.target.value : undefined)}
            aria-label="Filter by feed"
            data-testid="filter-feed-source"
            className="min-h-11 h-11 rounded-full border border-border bg-background px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground outline-none transition-colors hover:border-foreground/25 focus:border-primary/50"
          >
            <option value="">All feeds</option>
            {listFeedSources().map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-1.5" role="group" aria-label="Sort feeds">
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
                    'inline-flex min-h-11 items-center justify-center rounded-full px-3 text-[10px] font-black uppercase tracking-widest transition-colors',
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
        </div>
      </div>

      {/* Card rows run edge to edge: the marquee is the section's own band,
          outside the readable column that holds the controls and exits. */}
      <div data-testid="jump-rows" className="mt-6">
        {visible.length > 0 ? (
          isDesktop ? (
            <>
              {/* Two rows sliding in opposite ways — one card per feed. */}
              <MarqueeRow direction="left" testId="jump-row-a">
                {rowA.map(feed => (
                  <FeedCard
                    key={feed.feedId ?? feed.slug}
                    feed={feed}
                    testId={`feed-card-${feed.feedId ?? feed.slug}`}
                    className="w-[290px] sm:w-[320px] shrink-0"
                    onImport={handleImport}
                    importing={!!feed.feedId && importingFeedId === feed.feedId}
                    busy={anyBusy}
                    status={feed.feedId ? statuses[feed.feedId] : undefined}
                    onToggleNotebookSubscription={handleToggleNotebook}
                  />
                ))}
              </MarqueeRow>
              {rowB.length > 0 && (
                <MarqueeRow direction="right" testId="jump-row-b" className="mt-4">
                  {rowB.map(feed => (
                    <FeedCard
                      key={feed.feedId ?? feed.slug}
                      feed={feed}
                      testId={`feed-card-${feed.feedId ?? feed.slug}`}
                      className="w-[290px] sm:w-[320px] shrink-0"
                      onImport={handleImport}
                      importing={!!feed.feedId && importingFeedId === feed.feedId}
                      busy={anyBusy}
                      status={feed.feedId ? statuses[feed.feedId] : undefined}
                      onToggleNotebookSubscription={handleToggleNotebook}
                    />
                  ))}
                </MarqueeRow>
              )}
            </>
          ) : (
            /* One row, sliding out and back — the mobile alternating-sides effect. */
            <MarqueeRow direction="alternate" testId="jump-row-mobile">
              {visible.map(feed => (
                <FeedCard
                  key={feed.feedId ?? feed.slug}
                  feed={feed}
                  testId={`feed-card-${feed.feedId ?? feed.slug}`}
                  className="w-[290px] shrink-0"
                  onImport={handleImport}
                  importing={!!feed.feedId && importingFeedId === feed.feedId}
                  busy={anyBusy}
                  status={feed.feedId ? statuses[feed.feedId] : undefined}
                  onToggleNotebookSubscription={handleToggleNotebook}
                />
              ))}
            </MarqueeRow>
          )
        ) : (
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div
              data-testid="jump-empty"
              className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-10 text-center"
            >
              <p className="text-sm font-bold text-muted-foreground">No feeds match your search.</p>
              <p className="mt-1 text-xs text-muted-foreground/70">Try a different term or clear the filters.</p>
              {hasFilters && (
                <button
                  type="button"
                  data-testid="jump-clear-filters"
                  onClick={() => { setSearch(''); setKind(undefined); setSelectedFeedId(undefined); setSubscribedOnly(false) }}
                  className="mt-3 h-8 rounded-full border border-border px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 xl:text-[11px]">
          — or keep scrolling ↓
        </p>
      </div>
    </section>
  )
}
