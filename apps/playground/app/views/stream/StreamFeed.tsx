/**
 * StreamFeed — the Feed layout mode for QueriableStreamView.
 *
 * Renders the SAME grouped sections the Cards mode produces (the caller's
 * groupEntriesByDimension output — date by default, week/month/year/
 * discipline/etc. when selected), so grouping survives every layout switch.
 * Within a section each entry is a rich-preview card:
 * - The preview is READABLE: the wod block's script (or prose excerpt lines)
 *   wraps at natural line breaks, collapsed to a bounded line count with a
 *   per-card "Show more" expand — never three truncated one-liners. No editor
 *   mounts per item; cards are pure presentation.
 * - Undated entries land in their explicit 'Undated' section (playground
 *   notes carry no journalDate — createdAt labels creation time only, never
 *   a scheduled journal date). The query's WQL window already bounded the
 *   set at the engine; the feed never widens it on scroll.
 * - Actions: Open (deep-link), Run (stages a pending runtime — the feed's
 *   onRunEntry seam — NOT a bare /run/:contentId link), Playground (sends
 *   non-playground content through the intake before navigating). All
 *   hit targets are at least 44px tall for touch.
 * - Incremental rendering rides the shared useBatchedItems sentinel.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { StickyGroupHeader } from '@/panels/page-shells'
import {
  CalendarIcon,
  FileTextIcon,
  PencilLineIcon,
  PlayIcon,
  Plus,
  Activity,
  Trophy,
  Layers,
  Dumbbell,
  Rss,
  LayoutDashboard,
  Wrench,
  FlaskConical,
  BookOpen,
} from 'lucide-react'
import type { Entry } from '../../lib/entryMapper'
import { formatDuration } from '../../lib/entryMapper'
import type { StreamGroup } from '../../lib/entryGrouping'
import { entryOpenHref, entryIsPlayground, entryCollectionFeedHref, entryCanAddToToday } from '../../lib/entryActions'
import { entryCanRun } from '../../lib/entryRun'
import { MoveToNotebookMenu } from '../library/LibraryRow'
import type { BatchedItems } from '../../hooks/useBatchedItems'

const KIND_ICON: Record<Entry['kind'], React.FC<{ className?: string }>> = {
  note: FileTextIcon,
  effort: Dumbbell,
  result: Trophy,
  segment: Layers,
  event: Activity,
  dashboard: LayoutDashboard,
  equipment: Wrench,
}

const KIND_LABEL: Record<Entry['kind'], string> = {
  note: 'Note',
  effort: 'Effort',
  result: 'Result',
  segment: 'Segment',
  event: 'Event',
  dashboard: 'Dashboard',
  equipment: 'Equipment',
}

/** Collapsed preview height: enough to read the workout's shape (schema,
 * first movements) without turning the list into documents. */
const PREVIEW_COLLAPSED_LINES = 8

function FeedMetrics({ entry }: { entry: Entry }) {
  const ex = entry.execution
  if (!ex) return null
  const chips: string[] = []
  if (ex.elapsedMs != null) chips.push(formatDuration(ex.elapsedMs))
  if (ex.reps != null) chips.push(`${ex.reps} reps`)
  if (ex.loadLbs != null) chips.push(`${ex.loadLbs} lb`)
  if (ex.distanceMeters != null) chips.push(`${(ex.distanceMeters / 1000).toFixed(2)} km`)
  if (ex.tis != null) chips.push(`TIS ${ex.tis}`)
  if (chips.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="stream-feed-metrics">
      {chips.map(chip => (
        <span
          key={chip}
          className="rounded-full bg-muted/70 border border-border/60 px-2 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground"
        >
          {chip}
        </span>
      ))}
    </div>
  )
}

/** The rich reading preview: the wod script when the entry carries one
 *  (workout content — meaningful to read), else the prose excerpt lines.
 *  Wraps naturally; collapses to PREVIEW_COLLAPSED_LINES with an expand. */
function FeedPreview({ entry }: { entry: Entry }) {
  const [expanded, setExpanded] = useState(false)
  const script = entry.wodBlock?.content.trim()
  const lines = script ? script.split('\n') : (entry.excerpt ?? entry.block?.preview ?? [])
  const collapsible = lines.length > PREVIEW_COLLAPSED_LINES
  const visible = expanded || !collapsible ? lines : lines.slice(0, PREVIEW_COLLAPSED_LINES)

  if (lines.length === 0 && !entry.detail) return null
  return (
    <div className="mt-1.5" data-testid="stream-feed-preview">
      {lines.length > 0 && (
        <pre
          className={`whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground ${
            collapsible && !expanded ? 'max-h-40 overflow-hidden' : ''
          }`}
        >
          {visible.join('\n')}
        </pre>
      )}
      {lines.length === 0 && entry.detail && (
        <p className="text-[11px] text-muted-foreground">{entry.detail}</p>
      )}
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          data-testid="stream-feed-preview-toggle"
          className="mt-1 min-h-[44px] px-2 -ml-2 text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors"
        >
          {expanded ? 'Show less' : `Show more (${lines.length - PREVIEW_COLLAPSED_LINES} lines)`}
        </button>
      )}
    </div>
  )
}

export interface StreamFeedProps {
  /** Grouped sections from the shared grouping pipeline (same as Cards mode). */
  groups: readonly StreamGroup[]
  /** Total entries across all groups (batch counts), sentinel state. */
  batch: BatchedItems<Entry>
  /** Stage a pending runtime for the entry and navigate (run readiness). */
  onRunEntry: (entry: Entry) => void
  /** Send a non-playground entry's content to the playground (intake persists
   *  before navigating). Omitted → the action is not offered. */
  onSendToPlayground?: (entry: Entry) => void
  /** Clone the entry onto today's journal date (same handler as Cards). */
  onAddToToday?: (entry: Entry) => void
  /** User-owned notebooks a note can move into (feed notebooks are read-only
   *  and excluded by the caller). Omitted → the move action is not offered. */
  moveNotebookTargets?: ReadonlyArray<{ id: string; name: string; icon: string }>
  onMoveNotebook?: (entry: Entry, notebookId: string) => void
  /** Viewport `top` for the sticky section header — the live bottom of the
   *  page's sticky boundary (StickyPageHeader on desktop, navbar on mobile),
   *  measured via useStickyBoundaryOffset in the caller. */
  stickyOffset: number
}

export function StreamFeed({ groups, batch, onRunEntry, onSendToPlayground, onAddToToday, moveNotebookTargets, onMoveNotebook, stickyOffset }: StreamFeedProps) {
  return (
    <div className="flex-1 divide-y divide-border/40" data-testid="stream-feed">
      {groups.map(group => (
        <section key={group.id} id={group.id} data-testid={`stream-feed-group-${group.key}`}>
          <StickyGroupHeader
            top={stickyOffset}
            icon={<CalendarIcon className="size-3 shrink-0 text-muted-foreground" />}
            label={group.label}
            badge={group.isToday ? (
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                Today
              </span>
            ) : undefined}
            meta={`${group.entries.length} ${group.entries.length === 1 ? 'entry' : 'entries'}`}
          />
          <div className="divide-y divide-border/30">
            {group.entries.map(entry => {
              // Same note-flavor rule as LibraryRow: guides/playground notes
              // carry their own icon/label inside the plain `note` kind.
              const noteCatalog = entry.kind === 'note' ? entry.sourceCatalog : undefined
              const isNotebookNote = !!noteCatalog && noteCatalog !== 'journal' && noteCatalog !== 'playground' && noteCatalog !== 'guides'
              const Icon =
                noteCatalog === 'playground' ? FlaskConical
                : noteCatalog === 'guides' ? BookOpen
                : isNotebookNote ? Rss
                : KIND_ICON[entry.kind]
              const kindLabel =
                noteCatalog === 'playground' ? 'Playground'
                : noteCatalog === 'guides' ? 'Guide'
                : isNotebookNote ? 'Notebook'
                : KIND_LABEL[entry.kind]
              const openHref = entryOpenHref(entry)
              const feedHref = entryCollectionFeedHref(entry)
              const sendToPlayground = !entryIsPlayground(entry) && entry.kind === 'note'
              const canAdd = entryCanAddToToday(entry) && !!onAddToToday
              // Same rule as the cards/table RowActions: a note in a user-owned
              // notebook can move between user-owned notebooks; journal notes
              // stay put, feed-delivered notebooks are read-only.
              const moveTargets = moveNotebookTargets?.filter((target) => target.id !== entry.notebookId) ?? []
              const moveable = !!onMoveNotebook
                && !!entry.noteId
                && !!entry.notebookId
                && entry.notebookId !== 'notebook/journal'
                && moveTargets.length > 0

              return (
                <article key={entry.id} data-testid="stream-feed-item" className="px-6 py-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 size-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon className="size-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Title first — on mobile the secondary badges wrap under
                          it instead of squeezing the title out. */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="text-sm font-bold text-foreground min-w-0 basis-full sm:basis-auto sm:truncate">
                          <Link to={openHref} className="hover:text-primary transition-colors">
                            {entry.title}
                          </Link>
                        </h3>
                        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 border border-border rounded-full px-1.5 py-0.5">
                          {kindLabel}
                        </span>
                        {entry.subtitle && (
                          <span className="text-[10px] text-muted-foreground/70 truncate">{entry.subtitle}</span>
                        )}
                      </div>
                      <FeedPreview entry={entry} />
                      <FeedMetrics entry={entry} />
                      {/* All action hit targets ≥44px for touch. */}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Link
                          to={openHref}
                          data-testid="stream-feed-open"
                          className="inline-flex min-h-[44px] items-center rounded-full border border-border px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                        >
                          {feedHref ? 'Details' : 'Open'}
                        </Link>
                        {feedHref && (
                          <Link
                            to={feedHref}
                            data-testid="stream-feed-collection-feed"
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-primary/10 border border-primary/30 px-3 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/20 transition-colors"
                          >
                            <Rss className="size-3" />
                            Feed
                          </Link>
                        )}
                        {entryCanRun(entry) && (
                          <button
                            type="button"
                            onClick={() => onRunEntry(entry)}
                            data-testid="stream-feed-run"
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-primary/10 border border-primary/30 px-3 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/20 transition-colors"
                          >
                            <PlayIcon className="size-3" />
                            Run
                          </button>
                        )}
                        {sendToPlayground && onSendToPlayground && (
                          <button
                            type="button"
                            onClick={() => onSendToPlayground(entry)}
                            data-testid="stream-feed-playground"
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                          >
                            <PencilLineIcon className="size-3" />
                            Playground
                          </button>
                        )}
                        {canAdd && (
                          <button
                            type="button"
                            onClick={() => onAddToToday?.(entry)}
                            data-testid="stream-feed-add"
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                          >
                            <Plus className="size-3" />
                            Add
                          </button>
                        )}
                        {moveable && (
                          <MoveToNotebookMenu
                            targets={moveTargets}
                            triggerTestId="stream-feed-move"
                            itemTestIdPrefix="stream-feed-move-"
                            triggerClassName="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                            onMove={(notebookId) => onMoveNotebook?.(entry, notebookId)}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ))}
      {batch.hasMore && (
        <div
          ref={batch.sentinelRef}
          className="px-6 py-4 text-center text-xs text-muted-foreground/60"
          data-testid="stream-feed-load-more"
        >
          Loading more — {batch.total - batch.visible.length} remaining…
        </div>
      )}
    </div>
  )
}
