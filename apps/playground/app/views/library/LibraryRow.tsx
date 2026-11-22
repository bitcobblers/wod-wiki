/**
 * LibraryRow — one Entry in the Library. Clicking the row body navigates to
 * the Entry's deep-link (Open). The right-hand action stack exposes
 * Run (stages a pending runtime via startEntryRun — never a bare /run link)
 * and Compare (any row with a content id).
 * The Add-to-today action is a creation flow (not navigation); it is wired
 * in the Library page, not the row.
 */
import { useNavigate, Link } from 'react-router-dom'
import { ArrowUpRight, FileTextIcon, PlayIcon, BarChart3Icon, PlusIcon, Activity, Trophy, Layers, Dumbbell, Rss, LayoutDashboard, Flame, FlaskConical, BookOpen, FolderInput, Tag as TagIcon, Globe, Lock, CloudDownload, Loader2, Copy, Share2, Pencil, Trash2, MoreHorizontal, ShieldCheck } from 'lucide-react'
import { getNotebookCapabilities, isSystemReadOnlyNotebook } from '@bitcobblers/wod-wiki-core'
import { resolveFeedDisplayLabel } from '@/components/molecules/PublicationPill'
import { feedSourceById } from '@/services/feed/feedSources'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '@bitcobblers/wod-wiki-ui/primitives'
import { TEST_IDS } from '@/lib/testIds'
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
  onToggleSubscribe?: (entry: Entry) => void
  /** True while this row's feed/notebook subscription sync is in flight. */
  subscribing?: boolean
  onCloneRemote?: (entry: Entry) => void
  onPublishFeed?: (entry: Entry) => void
  onTogglePublicNotebook?: (entry: Entry) => void
  onEditNotebook?: (entry: Entry) => void
  onDeleteNotebook?: (entry: Entry) => void
}

const KIND_ICON: Record<Entry['kind'], React.FC<{ className?: string }>> = {
  note: FileTextIcon,
  effort: Flame,
  result: Trophy,
  segment: Layers,
  event: Activity,
  dashboard: LayoutDashboard,
  equipment: Dumbbell,
  tag: TagIcon,
  feed: Rss,
  notebook: BookOpen,
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
  feed: 'Feed',
  notebook: 'Notebook',
}

const KIND_TONE: Record<Entry['kind'], string> = {
  note: 'bg-primary/15 text-primary group-hover:bg-primary/20',
  effort: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 group-hover:bg-emerald-500/20',
  result: 'bg-sky-500/15 text-sky-800 dark:text-sky-200 group-hover:bg-sky-500/20',
  segment: 'bg-indigo-500/15 text-indigo-800 dark:text-indigo-200 group-hover:bg-indigo-500/20',
  event: 'bg-indigo-500/15 text-indigo-800 dark:text-indigo-200 group-hover:bg-indigo-500/20',
  dashboard: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-200 group-hover:bg-cyan-500/20',
  equipment: 'bg-orange-500/15 text-orange-800 dark:text-orange-200 group-hover:bg-orange-500/20',
  tag: 'bg-violet-500/15 text-violet-800 dark:text-violet-200 group-hover:bg-violet-500/20',
  feed: 'bg-amber-500/15 text-amber-900 dark:text-amber-200 group-hover:bg-amber-500/20',
  notebook: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 group-hover:bg-emerald-500/20',
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
  onToggleSubscribe,
  subscribing,
  onCloneRemote,
  onPublishFeed,
  onTogglePublicNotebook,
  onEditNotebook,
  onDeleteNotebook,
}: LibraryRowProps) {
  const navigate = useNavigate()
  // Annotation 4 — plain `note` kind conflates journal/guide/playground and
  // feed-delivered notebook notes by design; All-view rows pick the
  // icon/label by the entry's source so each note flavor shows its own type.
  // Distinct kinds (dashboard/effort/…) resolve through the records directly.
  const noteCatalog = entry.kind === 'note' ? entry.sourceNotebook : undefined
  const isNotebookNote = !!noteCatalog && noteCatalog !== 'journal' && noteCatalog !== 'playground' && noteCatalog !== 'guides'
  const ownershipKind = entry.ownership?.kind
  const isArchivedNote = entry.kind === 'note' && ownershipKind === 'feed-archived'
  const isSystemNote = entry.kind === 'note' && (
    ownershipKind === 'system'
    || noteCatalog === 'guides'
    || (!!noteCatalog && isSystemReadOnlyNotebook(noteCatalog))
  )
  const isFeedNote = entry.kind === 'note' && !isArchivedNote && !isSystemNote && (
    ownershipKind === 'feed'
    || entry.isRemotePreview === true
    || (entry.editable === false && !!entry.feedId && entry.feedId !== 'local')
  )
  const isUserPersonalNotebookNote = entry.kind === 'note' && isNotebookNote && !isArchivedNote && !isSystemNote && !isFeedNote
  const noteFeedLabel = isFeedNote || isArchivedNote
    ? resolveFeedDisplayLabel(
        entry.ownership?.feedSourceId ?? (entry.feedId !== 'local' && entry.feedId !== 'core' ? entry.feedId : undefined),
        (id) => feedSourceById(id)?.label,
      )
    : undefined

  const Icon =
    noteCatalog === 'playground' ? FlaskConical
    : isArchivedNote ? ShieldCheck
    : isSystemNote ? BookOpen
    : isFeedNote ? Rss
    : isUserPersonalNotebookNote ? FileTextIcon
    : KIND_ICON[entry.kind]

  const kindLabel =
    noteCatalog === 'playground' ? 'Playground'
    : isArchivedNote ? (
      entry.ownership?.upstreamStatus === 'removed' || entry.ownership?.upstreamStatus === 'unsubscribed'
        ? 'Upstream Removed'
        : 'Saved Copy'
    )
    : isSystemNote ? (noteCatalog === 'guides' ? 'Guide' : 'System')
    : isFeedNote ? (noteFeedLabel ?? 'Feed')
    : isUserPersonalNotebookNote ? 'My Note'
    : KIND_LABEL[entry.kind]

  const kindTone =
    isArchivedNote ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200 group-hover:bg-amber-500/20'
    : isSystemNote ? 'bg-muted text-foreground group-hover:bg-muted/80'
    : isFeedNote ? 'bg-sky-500/15 text-sky-800 dark:text-sky-200 group-hover:bg-sky-500/20'
    : isUserPersonalNotebookNote ? 'bg-primary/15 text-primary group-hover:bg-primary/20'
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
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void navigate(entryOpenHref(entry)) } }}
      className={`flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3.5 hover:bg-muted/40 transition-colors text-left group w-full cursor-pointer ${
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
          <h3 className="text-sm font-bold text-foreground min-w-0 basis-full sm:basis-auto sm:truncate">
            <Link
              to={entryOpenHref(entry)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
              className="hover:underline focus-visible:outline-none focus-visible:underline"
            >
              {entry.title}
            </Link>
          </h3>
          {entry.block && (
            <span
              className="text-[11px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-200 border border-sky-700/30 dark:border-sky-400/30 bg-sky-500/15 rounded-full px-2 py-0.5"
              data-testid="library-row-block-type"
            >
              {entry.block.dataType}
            </span>
          )}
          <span
            data-ownership={entry.kind === 'note' ? (isArchivedNote ? 'feed-archived' : isFeedNote ? 'feed' : isSystemNote ? 'system' : 'user') : undefined}
            className={`text-[11px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border ${
              isArchivedNote
                ? 'border-amber-700/30 bg-amber-500/15 text-amber-900 dark:border-amber-400/30 dark:text-amber-200'
                : isFeedNote
                  ? 'border-sky-700/30 bg-sky-500/15 text-sky-800 dark:border-sky-400/30 dark:text-sky-200'
                  : 'text-foreground border-border bg-muted/50'
            }`}
          >
            {kindLabel}
          </span>
          {entry.kind === 'result' && entry.execution?.rpe != null && (
            <span className="text-[11px] font-mono font-semibold tabular-nums rounded-full border border-border bg-muted/60 px-2 py-0.5 text-foreground">
              RPE {entry.execution.rpe}/10
            </span>
          )}
          {entry.kind === 'result' && (entry.execution?.prCount ?? 0) > 0 && (
            <span className="text-[11px] font-bold uppercase tracking-wider rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-200">
              {entry.execution!.prCount} PR
            </span>
          )}
          {(entry.kind === 'feed' || entry.kind === 'notebook') && entry.feedId !== 'local' && entry.feedId !== 'core' && (
            <span
              className={`text-[11px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border ${
                entry.subscribed
                  ? 'border-emerald-700/30 dark:border-emerald-400/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                  : 'border-border bg-muted text-foreground'
              }`}
              data-testid={`library-row-sub-status-${entry.sourceNote}`}
            >
              {entry.subscribed ? 'Subscribed' : 'Unsubscribed'}
            </span>
          )}
          {entry.kind === 'notebook' && entry.feedId === 'local' && (() => {
            const caps = getNotebookCapabilities({
              slug: entry.sourceNotebook,
              notebookId: entry.notebookId,
              feedId: entry.feedId,
            })
            return caps.isSystem ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border border-border bg-muted text-foreground">
                <BookOpen className="size-3" aria-hidden="true" />
                System
              </span>
            ) : (
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border ${
                  entry.isPublic
                    ? 'border-emerald-700/30 dark:border-emerald-400/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                    : 'border-border bg-muted text-foreground'
                }`}
                data-testid={`library-row-visibility-${entry.sourceNotebook}`}
              >
                {entry.isPublic ? <Globe className="size-3" /> : <Lock className="size-3" />}
                {entry.isPublic ? 'Public' : 'Private'}
              </span>
            )
          })()}
          {entry.kind === 'feed' && entry.unpublishedChanges && (
            <span className="text-[11px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border border-amber-700/30 dark:border-amber-400/30 bg-amber-500/15 text-amber-900 dark:text-amber-200">
              Unpublished changes
            </span>
          )}
          {entry.isRemotePreview && (
            <span className="text-[11px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border border-sky-700/30 dark:border-sky-400/30 bg-sky-500/15 text-sky-800 dark:text-sky-200">
              Index Preview
            </span>
          )}
          {entry.execution?.effortSlug && (
            <Link
              to={effortPath(entry.execution.effortSlug)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
              data-testid="library-row-effort-link"
              className="text-[11px] font-semibold tracking-wide text-primary bg-primary/15 hover:bg-primary/20 border border-primary/25 rounded-full px-2 py-0.5 transition-colors shrink-0"
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
                className="text-[11px] font-semibold tracking-wide text-foreground bg-muted hover:bg-muted/80 border border-border rounded-full px-2 py-0.5 transition-colors"
                title="View notebook details"
              >
                Details
              </Link>
              <Link
                to={notebookHref}
                data-testid="library-row-feed-link"
                className="text-[11px] font-semibold tracking-wide text-primary bg-primary/15 hover:bg-primary/20 border border-primary/25 rounded-full px-2 py-0.5 transition-colors"
                title="View feed"
              >
                Feed
              </Link>
            </div>
          )}
          {entry.subtitle && showSubtitle && (
            <span className="text-[11px] text-muted-foreground truncate">{entry.subtitle}</span>
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
      {(() => {
        const effectiveDateLabel = dateLabel ?? (
          entry.execution?.timestamp
            ? new Date(entry.execution.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : undefined
        )
        return effectiveDateLabel && showDate ? (
          <span className="flex-shrink-0 text-[11px] text-muted-foreground tabular-nums self-start sm:self-auto pt-0.5 sm:pt-0" data-testid="library-row-date">
            {effectiveDateLabel}
          </span>
        ) : null
      })()}
      {actions ?? (
        <RowActions
          entry={entry}
          onAddToToday={onAddToToday}
          onRunStart={onRunStart}
          moveNotebookTargets={moveNotebookTargets}
          onMoveNotebook={onMoveNotebook}
          onToggleSubscribe={onToggleSubscribe}
          subscribing={subscribing}
          onCloneRemote={onCloneRemote}
          onPublishFeed={onPublishFeed}
          onTogglePublicNotebook={onTogglePublicNotebook}
          onEditNotebook={onEditNotebook}
          onDeleteNotebook={onDeleteNotebook}
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
  onToggleSubscribe?: (entry: Entry) => void
  /** True while this row's feed/notebook subscription sync is in flight. */
  subscribing?: boolean
  onCloneRemote?: (entry: Entry) => void
  onPublishFeed?: (entry: Entry) => void
  onTogglePublicNotebook?: (entry: Entry) => void
  onEditNotebook?: (entry: Entry) => void
  onDeleteNotebook?: (entry: Entry) => void
}

function RowActions({ entry, onAddToToday, onRunStart, moveNotebookTargets, onMoveNotebook, onToggleSubscribe, subscribing, onCloneRemote, onPublishFeed, onTogglePublicNotebook, onEditNotebook, onDeleteNotebook }: RowActionsProps) {
  const navigate = useNavigate()
  const compareHref = entryCompareHref(entry)
  const notebookHref = entryNotebookHref(entry)
  const canAdd = entryCanAddToToday(entry) && !!onAddToToday
  const canRun = entryCanRun(entry) && !!onRunStart
  // Notes can move between user-owned notebooks or in/out of Journal.
  const currentNotebookId = entry.notebookId ?? 'notebook/journal'
  const targets = moveNotebookTargets?.filter((target) => target.id !== currentNotebookId) ?? []
  const moveable = !!onMoveNotebook
    && entry.kind === 'note'
    && (entry.editable ?? true)
    && targets.length > 0

  const nbCaps =
    entry.kind === 'notebook'
      ? getNotebookCapabilities({
          slug: entry.sourceNotebook,
          notebookId: entry.notebookId,
          feedId: entry.feedId,
        })
      : null
  const canTogglePublicNotebook = Boolean(nbCaps?.canTogglePublic && onTogglePublicNotebook)
  const canEditNotebook = Boolean(nbCaps?.canEdit && onEditNotebook)
  const canDeleteNotebook = Boolean(nbCaps?.canDelete && onDeleteNotebook)

  const hasSubscribe = (entry.kind === 'feed' || entry.kind === 'notebook') && entry.feedId !== 'local' && entry.feedId !== 'core' && !!onToggleSubscribe
  const hasPublish = entry.kind === 'feed' && entry.sourceNote === 'local' && !!onPublishFeed
  const hasCloneRemote = !!entry.isRemotePreview && !!onCloneRemote
  const hasPrimaryRun = !hasSubscribe && !hasPublish && !hasCloneRemote && canRun
  const hasPrimaryOpen = !hasSubscribe && !hasPublish && !hasCloneRemote && !hasPrimaryRun
  const hasOverflowActions =
    !hasPrimaryOpen
    || !!notebookHref
    || (canRun && hasCloneRemote)
    || canAdd
    || !!compareHref
    || canTogglePublicNotebook
    || canEditNotebook
    || canDeleteNotebook
    || (moveable && targets.length > 0)

  return (
    <div className="flex items-center gap-1.5 ml-auto shrink-0" onClick={e => e.stopPropagation()}>
      {hasSubscribe && (
        <button
          type="button"
          disabled={Boolean(subscribing)}
          aria-busy={Boolean(subscribing)}
          onClick={() => onToggleSubscribe!(entry)}
          data-testid={entry.subscribed ? `row-unsubscribe-${entry.sourceNote}` : `row-subscribe-${entry.sourceNote}`}
          className={`h-8 max-sm:min-h-11 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-60 disabled:cursor-wait ${
            entry.subscribed
              ? 'border border-border text-foreground hover:text-destructive hover:border-destructive/40'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {subscribing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CloudDownload className="size-3.5" aria-hidden="true" />}
          <span>{subscribing ? (entry.subscribed ? 'Unsubscribing…' : 'Subscribing…') : (entry.subscribed ? 'Unsubscribe' : 'Subscribe')}</span>
        </button>
      )}
      {hasPublish && (
        <button
          type="button"
          onClick={() => onPublishFeed!(entry)}
          data-testid={TEST_IDS.LIBRARY_PUBLISH_LOCAL_FEED}
          className="h-8 max-sm:min-h-11 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Share2 className="size-3.5" aria-hidden="true" />
          <span>Publish / Export</span>
        </button>
      )}
      {hasCloneRemote && (
        <button
          type="button"
          onClick={() => onCloneRemote!(entry)}
          data-testid={`row-clone-remote-${entry.id}`}
          className="h-8 max-sm:min-h-11 px-3 rounded-lg border border-primary/40 bg-primary/15 text-primary hover:bg-primary/20 text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Copy className="size-3.5" aria-hidden="true" />
          <span>Clone</span>
        </button>
      )}
      {hasPrimaryRun && (
        <ActionButton title="Run" testId={TEST_IDS.LIBRARY_ACTION_RUN} onClick={() => onRunStart?.(entry)}>
          <PlayIcon className="size-3.5" aria-hidden="true" />
        </ActionButton>
      )}
      {hasPrimaryOpen && (
        <ActionButton title={notebookHref ? 'Details' : 'Open'} testId={TEST_IDS.LIBRARY_ACTION_OPEN} onClick={() => navigate(entryOpenHref(entry))}>
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </ActionButton>
      )}
      {hasOverflowActions && (
        <Menu>
          <MenuTrigger
            aria-label={`Actions for ${entry.title}`}
            title={`Actions for ${entry.title}`}
            data-testid={TEST_IDS.LIBRARY_ROW_OVERFLOW}
            className="size-8 max-sm:min-h-11 max-sm:min-w-11 inline-flex items-center justify-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <MoreHorizontal className="size-4 sm:size-5" aria-hidden="true" />
          </MenuTrigger>
          <MenuContent align="end" sideOffset={6}>
            <MenuGroup>
              {!hasPrimaryOpen && (
                <MenuItem
                  value="open"
                  data-testid={TEST_IDS.LIBRARY_ACTION_OPEN}
                  onClick={() => navigate(entryOpenHref(entry))}
                >
                  <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
                  <span>{notebookHref ? 'Details' : 'Open'}</span>
                </MenuItem>
              )}
              {notebookHref && (
                <MenuItem
                  value="notebook"
                  data-testid={TEST_IDS.LIBRARY_ACTION_NOTEBOOK}
                  onClick={() => navigate(notebookHref)}
                >
                  <Rss className="size-4 shrink-0" aria-hidden="true" />
                  <span>Open Notebook</span>
                </MenuItem>
              )}
              {canRun && hasCloneRemote && (
                <MenuItem
                  value="run"
                  data-testid={TEST_IDS.LIBRARY_ACTION_RUN}
                  onClick={() => onRunStart?.(entry)}
                >
                  <PlayIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span>Start workout</span>
                </MenuItem>
              )}
              {canAdd && (
                <MenuItem
                  value="add-to-today"
                  data-testid={TEST_IDS.LIBRARY_ACTION_ADD}
                  onClick={() => onAddToToday?.(entry)}
                >
                  <PlusIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span>Add to today</span>
                </MenuItem>
              )}
              {compareHref && (
                <MenuItem
                  value="compare"
                  data-testid={TEST_IDS.LIBRARY_ACTION_COMPARE}
                  onClick={() => navigate(compareHref)}
                >
                  <BarChart3Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span>Compare</span>
                </MenuItem>
              )}
              {canTogglePublicNotebook && (
                <MenuItem
                  value="toggle-public"
                  data-testid={`row-toggle-public-${entry.sourceNotebook}`}
                  onClick={() => onTogglePublicNotebook!(entry)}
                >
                  {entry.isPublic ? <Lock className="size-4 shrink-0" aria-hidden="true" /> : <Globe className="size-4 shrink-0" aria-hidden="true" />}
                  <span>{entry.isPublic ? 'Make Private' : 'Make Public'}</span>
                </MenuItem>
              )}
              {canEditNotebook && (
                <MenuItem
                  value="edit-notebook"
                  data-testid={`notebook-edit-${entry.sourceNotebook}`}
                  onClick={() => onEditNotebook!(entry)}
                >
                  <Pencil className="size-4 shrink-0" aria-hidden="true" />
                  <span>Edit notebook</span>
                </MenuItem>
              )}
              {canDeleteNotebook && (
                <MenuItem
                  value="delete-notebook"
                  data-testid={`notebook-delete-${entry.sourceNotebook}`}
                  onClick={() => onDeleteNotebook!(entry)}
                >
                  <Trash2 className="size-4 shrink-0" aria-hidden="true" />
                  <span>Delete notebook</span>
                </MenuItem>
              )}
            </MenuGroup>
            {moveable && targets.length > 0 && (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>Move to notebook</MenuGroupLabel>
                  {targets.map((target) => (
                    <MenuItem
                      key={target.id}
                      value={`move-${target.id}`}
                      data-testid={`action-move-${target.id}`}
                      onClick={() => onMoveNotebook?.(entry, target.id)}
                    >
                      <span className="w-5 text-center">{target.icon}</span>
                      <span className="flex-1 truncate">{target.name}</span>
                    </MenuItem>
                  ))}
                </MenuGroup>
              </>
            )}
          </MenuContent>
        </Menu>
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
    <div onClick={(e) => e.stopPropagation()}>
      <Menu>
        <MenuTrigger
          aria-label="Move to notebook"
          title="Move to notebook"
          data-testid={triggerTestId}
          className={`${triggerClassName} border-0 bg-transparent p-0`}
        >
          <FolderInput className="size-3.5" aria-hidden="true" />
        </MenuTrigger>
        <MenuContent align="end" sideOffset={6}>
          <MenuGroup>
            <MenuGroupLabel>Move to notebook</MenuGroupLabel>
            <MenuSeparator />
            {targets.map((target) => (
              <MenuItem
                key={target.id}
                value={target.id}
                data-testid={`${itemTestIdPrefix}${target.id}`}
                onClick={() => onMove(target.id)}
              >
                <span className="w-5 text-center">{target.icon}</span>
                <span className="flex-1 truncate">{target.name}</span>
              </MenuItem>
            ))}
          </MenuGroup>
        </MenuContent>
      </Menu>
    </div>
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
      aria-label={title}
      onClick={onClick}
      data-testid={testId}
      className="size-8 max-sm:min-h-11 max-sm:min-w-11 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
    >
      {children}
    </button>
  )
}
