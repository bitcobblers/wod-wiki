/**
 * LibraryRow — one Entry in the Library. Clicking the row body navigates to
 * the Entry's deep-link (Open). The right-hand action stack exposes
 * Run (stages a pending runtime via startEntryRun — never a bare /run link)
 * and Compare (any row with a content id).
 * The Add-to-today action is a creation flow (not navigation); it is wired
 * in the Library page, not the row.
 */
import { useNavigate, Link } from 'react-router-dom'
import { FileTextIcon, PlayIcon, BarChart3Icon, PlusIcon, Activity, Trophy, Layers, Dumbbell, Rss, LayoutDashboard, Wrench, FlaskConical, BookOpen, FolderInput, Tag as TagIcon } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/atoms/primitives/dropdown-menu'
import type { Entry } from '../../lib/entryMapper'
import { entryOpenHref, entryCompareHref, entryCanAddToToday, entryNotebookHref } from '../../lib/entryActions'
import { entryCanRun } from '../../lib/entryRun'
import { effortPath } from '../../lib/routes'

export interface LibraryRowProps {
  entry: Entry
  /** Optional left-column decoration (e.g. timestamp). */
  leading?: React.ReactNode
  /** Optional right-column action stack (defaults to the wired stack). */
  actions?: React.ReactNode
  /** Per-card date label (#861) — survives scrolled-away group headers. */
  dateLabel?: string
  /** Optional projected visible fields. When omitted, all fields are shown by default. */
  visibleFieldIds?: readonly string[]
  /** Visual emphasis — `primary` for today's main row, `secondary` otherwise. */
  tone?: 'primary' | 'secondary'
  /**
   * Optional Add-to-today handler. The row renders the button only when
   * `entryCanAddToToday(entry)` is true; the page passes the actual
   * creation callback.
   */
  onAddToToday?: (entry: Entry) => void
  /**
   * Optional Run handler — stages a pending runtime and navigates (see
   * startEntryRun; Run is not a URL). The row renders the button only when
   * `entryCanRun(entry)` is true.
   */
  onRunStart?: (entry: Entry) => void
  /**
   * Notebook move (ticket 05): the user-owned notebooks a note can move
   * into, and the handler. The row renders the move dropdown only when both
   * are present and the entry is a note living in a user-owned notebook
   * (`notebookId` set — feed-delivered notebooks are read-only).
   */
  moveNotebookTargets?: ReadonlyArray<{ id: string; name: string; icon: string }>
  onMoveNotebook?: (entry: Entry, notebookId: string) => void
}

const KIND_ICON: Record<Entry['kind'], React.FC<{ className?: string }>> = {
  note: FileTextIcon,
  effort: Dumbbell,
  result: Trophy,
  segment: Layers,
  event: Activity,
  dashboard: LayoutDashboard,
  equipment: Wrench,
  tag: TagIcon,
}

const KIND_LABEL: Record<Entry['kind'], string> = {
  note: 'Note',
  effort: 'Effort',
  result: 'Result',
  segment: 'Segment',
  event: 'Event',
  dashboard: 'Dashboard',
  equipment: 'Equipment',
  tag: 'Tag',
}

const KIND_TONE: Record<Entry['kind'], string> = {
  note: 'bg-primary/10 text-primary group-hover:bg-primary/20',
  effort: 'bg-emerald-500/10 text-emerald-600 group-hover:bg-emerald-500/20',
  result: 'bg-sky-500/10 text-sky-600 group-hover:bg-sky-500/20',
  segment: 'bg-indigo-500/10 text-indigo-600 group-hover:bg-indigo-500/20',
  event: 'bg-indigo-500/10 text-indigo-600 group-hover:bg-indigo-500/20',
  dashboard: 'bg-cyan-500/10 text-cyan-600 group-hover:bg-cyan-500/20',
  equipment: 'bg-orange-500/10 text-orange-600 group-hover:bg-orange-500/20',
  tag: 'bg-violet-500/10 text-violet-600 group-hover:bg-violet-500/20',
}

export function LibraryRow({
  entry,
  leading,
  actions,
  dateLabel,
  visibleFieldIds,
  tone = 'secondary',
  onAddToToday,
  onRunStart,
  moveNotebookTargets,
  onMoveNotebook,
}: LibraryRowProps) {
  const navigate = useNavigate()
  // Annotation 4 — plain `note` kind conflates journal/guide/playground and
  // feed-delivered notebook notes by design; All-view rows pick the
  // icon/label by the entry's source so each note flavor shows its own type.
  // Distinct kinds (dashboard/effort/…) resolve through the records directly.
  const noteCatalog = entry.kind === 'note' ? entry.sourceNotebook : undefined
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
  const kindTone = isNotebookNote
    ? 'bg-amber-500/10 text-amber-600 group-hover:bg-amber-500/20'
    : KIND_TONE[entry.kind]
  const isPrimary = tone === 'primary'
  const notebookHref = entryNotebookHref(entry)
  const openHref = entryOpenHref(entry)
  const visibleSet = visibleFieldIds ? new Set(visibleFieldIds) : null
  const showDate = !visibleSet || visibleSet.has('date')
  const showSubtitle =
    !visibleSet ||
    visibleSet.has('sourceNotebook') ||
    visibleSet.has('protocol') ||
    visibleSet.has('elapsedTime') ||
    visibleSet.has('splitDuration') ||
    visibleSet.has('discipline') ||
    visibleSet.has('met') ||
    visibleSet.has('canonicalSlug')
  const showDetail =
    !visibleSet ||
    visibleSet.has('excerpt') ||
    visibleSet.has('movements') ||
    visibleSet.has('tags') ||
    visibleSet.has('aliases')
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(entryOpenHref(entry))}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(entryOpenHref(entry)) } }}
      className={`flex items-center gap-4 px-6 py-3.5 hover:bg-muted/40 transition-colors text-left group w-full cursor-pointer ${
        isPrimary ? 'bg-primary/[0.025]' : ''
      }`}
      data-testid={`library-row-${entry.kind}`}
    >
      {leading}
      <div className={`flex-shrink-0 size-9 rounded-xl flex items-center justify-center transition-colors ${kindTone}`}>
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        {/* Title first: on narrow screens the secondary badges wrap under the
            title instead of squeezing the truncated title out. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-bold text-foreground min-w-0 basis-full sm:basis-auto sm:truncate">{entry.title}</h3>
          {entry.block && (
            <span
              className="text-[9px] font-black uppercase tracking-widest text-sky-600 border border-sky-500/40 bg-sky-500/10 rounded-full px-1.5 py-0.5"
              data-testid="library-row-block-type"
            >
              {entry.block.dataType}
            </span>
          )}
          <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 border border-border rounded-full px-1.5 py-0.5">
            {kindLabel}
          </span>
          {entry.execution?.effortSlug && (
            <Link
              to={effortPath(entry.execution.effortSlug)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
              data-testid="library-row-effort-link"
              className="text-[9px] font-bold tracking-wide text-primary/80 hover:text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-full px-2 py-0.5 transition-colors shrink-0"
              title={`View movement history for ${entry.detail ?? entry.execution.effortSlug}`}
            >
              {entry.detail ?? entry.execution.effortSlug}
            </Link>
          )}
          {notebookHref && (
            <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
              <Link
                to={openHref}
                data-testid="library-row-details-link"
                className="text-[9px] font-bold tracking-wide text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted border border-border rounded-full px-2 py-0.5 transition-colors"
                title="View notebook details"
              >
                Details
              </Link>
              <Link
                to={notebookHref}
                data-testid="library-row-feed-link"
                className="text-[9px] font-bold tracking-wide text-primary/80 hover:text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-full px-2 py-0.5 transition-colors"
                title="View feed"
              >
                Feed
              </Link>
            </div>
          )}
          {entry.subtitle && showSubtitle && (
            <span className="text-[10px] text-muted-foreground/60 truncate">{entry.subtitle}</span>
          )}
        </div>
        {showDetail && (
          entry.block ? (
            <div className="mt-0.5" data-testid="library-row-block-preview">
              {entry.block.preview.map((line, i) => (
                <p key={i} className="text-[11px] text-muted-foreground truncate font-mono">{line}</p>
              ))}
            </div>
          ) : entry.detail ? (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{entry.detail}</p>
          ) : null
        )}
      </div>
      {dateLabel && showDate && (
        <span className="flex-shrink-0 text-[10px] text-muted-foreground/70 tabular-nums" data-testid="library-row-date">
          {dateLabel}
        </span>
      )}
      {actions ?? (
        <RowActions
          entry={entry}
          onAddToToday={onAddToToday}
          onRunStart={onRunStart}
          moveNotebookTargets={moveNotebookTargets}
          onMoveNotebook={onMoveNotebook}
        />
      )}
    </div>
  )
}

interface RowActionsProps {
  entry: Entry
  onAddToToday?: (entry: Entry) => void
  onRunStart?: (entry: Entry) => void
  moveNotebookTargets?: ReadonlyArray<{ id: string; name: string; icon: string }>
  onMoveNotebook?: (entry: Entry, notebookId: string) => void
}

function RowActions({ entry, onAddToToday, onRunStart, moveNotebookTargets, onMoveNotebook }: RowActionsProps) {
  const navigate = useNavigate()
  const compareHref = entryCompareHref(entry)
  const notebookHref = entryNotebookHref(entry)
  const canAdd = entryCanAddToToday(entry) && !!onAddToToday
  const canRun = entryCanRun(entry) && !!onRunStart
  // A note in a user-owned notebook can move between user-owned notebooks
  // (feed-delivered notebooks are read-only; move targets already exclude
  // them). Journal notes stay put — the journal is their notebook.
  const moveable = !!onMoveNotebook
    && !!entry.noteId
    && !!entry.notebookId
    && entry.notebookId !== 'notebook/journal'
    && !!moveNotebookTargets?.length
  const targets = moveNotebookTargets?.filter((target) => target.id !== entry.notebookId) ?? []

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
      <ActionButton title={notebookHref ? "Details" : "Open"} testId="action-open" onClick={() => navigate(entryOpenHref(entry))}>
        <PlayIcon className="size-3.5" />
      </ActionButton>
      {notebookHref && (
        <ActionButton title="Notebook" testId="action-notebook" onClick={() => navigate(notebookHref)}>
          <Rss className="size-3.5" />
        </ActionButton>
      )}
      {canAdd && (
        <ActionButton title="Add to today" testId="action-add" onClick={() => onAddToToday?.(entry)}>
          <PlusIcon className="size-3.5" />
        </ActionButton>
      )}
      {canRun && (
        <ActionButton title="Run" testId="action-run" onClick={() => onRunStart?.(entry)}>
          <PlayIcon className="size-3.5" />
        </ActionButton>
      )}
      {moveable && targets.length > 0 && (
        <MoveToNotebookMenu
          targets={targets}
          triggerTestId="action-move"
          itemTestIdPrefix="action-move-"
          triggerClassName="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          onMove={(notebookId) => onMoveNotebook?.(entry, notebookId)}
        />
      )}
      {compareHref && (
        <ActionButton title="Compare" testId="action-compare" onClick={() => navigate(compareHref)}>
          <BarChart3Icon className="size-3.5" />
        </ActionButton>
      )}
    </div>
  )
}

export interface MoveNotebookTarget {
  id: string
  name: string
  icon: string
}

/** The move-to-notebook dropdown shared by the cards/table row actions and
 *  the feed layout (ticket 05): one menu, two trigger styles (icon button vs
 *  feed chip) via testid/class props. */
export function MoveToNotebookMenu({
  targets,
  triggerTestId,
  itemTestIdPrefix,
  triggerClassName,
  onMove,
}: {
  targets: ReadonlyArray<MoveNotebookTarget>
  triggerTestId: string
  itemTestIdPrefix: string
  triggerClassName: string
  onMove: (notebookId: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Move to notebook"
          data-testid={triggerTestId}
          className={triggerClassName}
        >
          <FolderInput className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Move to notebook</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {targets.map((target) => (
          <DropdownMenuItem
            key={target.id}
            data-testid={`${itemTestIdPrefix}${target.id}`}
            onClick={() => onMove(target.id)}
          >
            <span className="w-5 text-center">{target.icon}</span>
            <span className="flex-1 truncate">{target.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface ActionButtonProps {
  title: string
  testId: string
  onClick?: () => void
  children: React.ReactNode
}

function ActionButton({ title, testId, onClick, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      data-testid={testId}
      className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
    >
      {children}
    </button>
  )
}
