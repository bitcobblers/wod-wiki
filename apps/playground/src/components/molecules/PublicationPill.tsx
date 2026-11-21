import { useCallback, useEffect, useState } from 'react';
import {
  derivePublicationVisibility,
  getNotePublicationSummary,
  type PublicationVisibility,
  type PublicationVisibilitySummary,
} from '@bitcobblers/wod-wiki-engine';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import type { Session } from '@/types/storage';
import { storage, whenStorageReady } from '@/hooks/useBrowserServices';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Clock,
  FolderPlus,
  GitFork,
  Loader2,
  Rss,
  ShieldCheck,
} from 'lucide-react';
import {
  derivePublicationStatusLabel,
  isPublishableNotebookLanding,
  isSystemReadOnlyNotebook,
  notebookSlugFromId,
  resolveNoteOwnership,
  toNotebookId,
  type Note,
  type NotebookId,
  type NoteOwnershipInput,
  type NoteOwnershipKind,
  type ResolvedNoteOwnership,
} from '@bitcobblers/wod-wiki-core';
import {
  createUserNotebookLanding,
  forkNoteToUserNotebook,
  parseRemoteNoteId,
  type RemoteWorkoutResolution,
} from '@bitcobblers/wod-wiki-engine';
import { notebookOfItem, notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql';
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { toast } from '@/hooks/use-toast';
import { NotePromotionSheet } from '@/components/organisms/notebook/NotePromotionSheet';

export interface PublicationPillProps {
  noteId: string;
  notebookId?: string;
  sessions?: readonly Session[];
  isReadOnlyFeedNote?: boolean;
  note?: NoteOwnershipInput;
  ownershipOverride?: ResolvedNoteOwnership;
  resolveFeedLabel?: (feedSourceId: string) => string | undefined;
  resolveRemoteWorkoutFn?: (noteId: string) => Promise<RemoteWorkoutResolution | undefined>;
  storageOverride?: IStorage;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloneRequest?: () => void;
  onForked?: (forked: Note) => void;
  onChanged?: () => void;
}

const PILL_STYLES: Record<PublicationVisibility, string> = {
  Private:
    'border-[#D9D7D0] dark:border-zinc-700 bg-[#F7F6F3] dark:bg-zinc-900 text-[#4F4E4A] dark:text-zinc-200 hover:text-[#111111] dark:hover:text-zinc-100',
  'Published Note':
    'border-[#BDD8BC] dark:border-emerald-500/40 bg-[#EDF3EC] dark:bg-emerald-950/60 text-[#224F26] dark:text-emerald-200',
  'Published Note + Data':
    'border-[#B3DCF6] dark:border-sky-500/40 bg-[#E1F3FE] dark:bg-sky-950/60 text-[#14527A] dark:text-sky-200',
};

export interface OwnershipPresentation {
  ownership: ResolvedNoteOwnership;
  kind: NoteOwnershipKind;
  feedLabel?: string;
  badgeLabel: string;
  shortLabel: string;
  guidanceCopy: string;
  badgeClassName: string;
  isEditable: boolean;
  isNonOwned: boolean;
  isArchived: boolean;
}

const KNOWN_FEED_LABELS: Record<string, string> = {
  'sport-crossfit': 'CrossFit',
  'sport-hyrox': 'HYROX',
  'sport-kettlebell': 'Kettlebell',
  'sport-yoga': 'Yoga',
  'seed-crossfit': 'CrossFit',
};

/**
 * Resolve a clean feed human label from a feed ID, returning undefined when absent.
 */
export function resolveFeedDisplayLabel(
  feedSourceId?: string,
  lookupLabel?: (feedSourceId: string) => string | undefined,
): string | undefined {
  if (!feedSourceId) return undefined;
  const lookedUp = lookupLabel?.(feedSourceId);
  if (lookedUp) return lookedUp;
  if (KNOWN_FEED_LABELS[feedSourceId]) return KNOWN_FEED_LABELS[feedSourceId];
  let decoded: string;
  try {
    decoded = decodeURIComponent(feedSourceId);
  } catch {
    decoded = feedSourceId;
  }
  if (KNOWN_FEED_LABELS[decoded]) return KNOWN_FEED_LABELS[decoded];
  return decoded
    .replace(/^(?:sport|seed)-/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Derive unambiguous 3-state authorship UI metadata (My Note / Feed or System Read-only / Archived Local Copy).
 */
export function resolveOwnershipPresentation(
  noteOrStub: (NoteOwnershipInput & { id?: string; title?: string }) | undefined | null,
  options: {
    noteId?: string;
    notebookOrigin?: 'default' | 'user' | 'feed';
    resolvedNotebookId?: string;
    fallbackReadOnly?: boolean;
    ownershipOverride?: ResolvedNoteOwnership;
    resolveFeedLabel?: (feedSourceId: string) => string | undefined;
  } = {},
): OwnershipPresentation {
  const targetId = noteOrStub?.id ?? options.noteId ?? '';
  const parsedRemote = targetId ? parseRemoteNoteId(targetId) : { isRemote: false as const };
  const effectiveStub: NoteOwnershipInput | undefined =
    noteOrStub ??
    (parsedRemote.isRemote
      ? {
          id: parsedRemote.uuid,
          feedOrigin: 'feed',
          feedSourceId: parsedRemote.feedId,
          retention: 'cached',
          upstreamStatus: 'live',
        }
      : undefined);

  let ownership =
    options.ownershipOverride ??
    (effectiveStub
      ? resolveNoteOwnership(
          effectiveStub,
          options.notebookOrigin,
          options.resolvedNotebookId,
        )
      : undefined);

  if (!ownership) {
    if (options.resolvedNotebookId && isSystemReadOnlyNotebook(options.resolvedNotebookId)) {
      ownership = {
        kind: 'system',
        editable: false,
        canPublish: false,
      };
    } else if (options.fallbackReadOnly) {
      ownership = {
        kind: 'feed',
        editable: false,
        canPublish: false,
        upstreamStatus: 'live',
      };
    } else {
      ownership = {
        kind: 'user',
        editable: true,
        canPublish: true,
      };
    }
  } else if (options.fallbackReadOnly && ownership.kind === 'user') {
    const isSystemNb =
      options.resolvedNotebookId ? isSystemReadOnlyNotebook(options.resolvedNotebookId) : false;
    ownership = {
      ...ownership,
      kind: isSystemNb ? 'system' : 'feed',
      editable: false,
      canPublish: false,
    };
  }

  const effectiveFeedId =
    ownership.feedSourceId ?? (parsedRemote.isRemote ? parsedRemote.feedId : undefined);
  const feedLabel = resolveFeedDisplayLabel(effectiveFeedId, options.resolveFeedLabel);
  const isArchived =
    ownership.kind === 'feed-archived' || noteOrStub?.retention === 'session-pinned';

  if (isArchived) {
    const upstreamLost =
      ownership.upstreamStatus === 'removed' || ownership.upstreamStatus === 'unsubscribed';
    return {
      ownership: { ...ownership, kind: 'feed-archived', editable: false, canPublish: false },
      kind: 'feed-archived',
      feedLabel,
      badgeLabel: upstreamLost
        ? 'Upstream removed — local copy preserved'
        : feedLabel
          ? `Saved locally from ${feedLabel}`
          : 'Saved locally',
      shortLabel: upstreamLost ? 'Upstream Removed · Local Copy' : 'Archived Local Copy',
      guidanceCopy: upstreamLost
        ? 'The upstream feed was removed or unsubscribed. This local copy stays pinned with your logged sessions and remains private.'
        : 'Protected local copy pinned by your logged workouts. Upstream syncs will never overwrite or delete it, and your sessions stay private.',
      badgeClassName:
        'border-amber-700/35 bg-amber-500/15 text-amber-900 dark:border-amber-400/35 dark:bg-amber-500/15 dark:text-amber-100',
      isEditable: false,
      isNonOwned: true,
      isArchived: true,
    };
  }

  if (ownership.kind === 'feed') {
    return {
      ownership,
      kind: 'feed',
      feedLabel,
      badgeLabel: feedLabel ? `From ${feedLabel} · Read-only` : 'Feed · Read-only',
      shortLabel: feedLabel ? `${feedLabel} · Read-only` : 'Feed · Read-only',
      guidanceCopy: feedLabel
        ? `Read-only upstream workout from ${feedLabel}. Start or log a workout to pin a local archival copy, or fork it to My Notes to customize.`
        : 'Read-only upstream workout. Start or log a workout to pin a local archival copy, or fork it to My Notes to customize.',
      badgeClassName:
        'border-sky-700/35 bg-sky-500/15 text-sky-900 dark:border-sky-400/35 dark:bg-sky-500/15 dark:text-sky-100',
      isEditable: false,
      isNonOwned: true,
      isArchived: false,
    };
  }

  if (ownership.kind === 'system') {
    return {
      ownership,
      kind: 'system',
      feedLabel,
      badgeLabel: 'System · Read-only',
      shortLabel: 'System · Read-only',
      guidanceCopy:
        'Built-in read-only system workout. Start or log a workout to record results, or fork it to My Notes to customize.',
      badgeClassName:
        'border-border bg-muted text-foreground',
      isEditable: false,
      isNonOwned: true,
      isArchived: false,
    };
  }

  return {
    ownership,
    kind: 'user',
    feedLabel,
    badgeLabel: 'My Note',
    shortLabel: 'My Note',
    guidanceCopy: 'Owned by you. Edit freely or manage notebook and publication visibility.',
    badgeClassName: 'border-border bg-secondary text-foreground',
    isEditable: true,
    isNonOwned: false,
    isArchived: false,
  };
}

export interface WritableNotebookTarget {
  id: NotebookId;
  slug: string;
  name: string;
}

/**
 * List writable user notebooks (strictly excluding read-only system & feed notebooks).
 */
export async function listWritableNotebooks(activeStorage: IStorage): Promise<WritableNotebookTarget[]> {
  let notes: Note[];
  try {
    notes = await activeStorage.readonly('notes').getAll();
  } catch {
    notes = [];
  }
  const byId = new Map<NotebookId, WritableNotebookTarget>();
  byId.set('notebook/journal', { id: 'notebook/journal', slug: 'journal', name: 'Journal' });
  byId.set('notebook/custom', { id: 'notebook/custom', slug: 'custom', name: 'My Notes' });
  for (const n of notes) {
    if (!isPublishableNotebookLanding(n)) continue;
    const id = toNotebookId(n.id);
    const slug = notebookSlugFromId(id);
    if (isSystemReadOnlyNotebook(id) || isSystemReadOnlyNotebook(slug)) continue;
    byId.set(id, { id, slug, name: n.title || slug });
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export interface ForkToMyNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceNoteId: string;
  sourceTitle?: string;
  storageInstance: IStorage;
  resolveRemoteWorkoutFn?: (noteId: string) => Promise<RemoteWorkoutResolution | undefined>;
  fallbackRemote?: {
    title?: string;
    content: string;
    feedId?: string;
    notebookSlug?: string;
  };
  onForked?: (forked: Note) => void;
}

export function ForkToMyNotesDialog({
  open,
  onOpenChange,
  sourceNoteId,
  sourceTitle,
  storageInstance,
  resolveRemoteWorkoutFn,
  fallbackRemote,
  onForked,
}: ForkToMyNotesDialogProps) {
  const navigate = useNavigate();
  const [notebooks, setNotebooks] = useState<WritableNotebookTarget[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>('notebook/journal');
  const [newNotebookName, setNewNotebookName] = useState('');
  const [showNewNotebook, setShowNewNotebook] = useState(false);
  const [forking, setForking] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listWritableNotebooks(storageInstance).then((list) => {
      if (cancelled) return;
      setNotebooks(list);
      setSelectedNotebookId((prev) =>
        list.some((nb) => nb.id === prev) ? prev : (list[0]?.id ?? 'notebook/journal'),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, storageInstance]);

  const handleConfirm = async () => {
    if (forking) return;
    setForking(true);
    try {
      let targetNotebookId = selectedNotebookId;
      if (showNewNotebook && newNotebookName.trim()) {
        const cleanName = newNotebookName.trim();
        const slug = cleanName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'custom';
        const candidateId = `notebook/${slug}`;
        if (isSystemReadOnlyNotebook(candidateId)) {
          toast({
            title: 'Reserved notebook name',
            description: `"${cleanName}" is reserved for a read-only system notebook. Choose another name.`,
            variant: 'destructive',
          });
          return;
        }
        targetNotebookId = await createUserNotebookLanding(storageInstance, cleanName);
      }

      const forked = await forkNoteToUserNotebook(
        storageInstance,
        sourceNoteId,
        targetNotebookId,
        {
          resolveRemoteWorkout: async (id) => {
            if (resolveRemoteWorkoutFn) {
              const resolved = await resolveRemoteWorkoutFn(id).catch(() => undefined);
              if (resolved) return resolved;
            }
            if (fallbackRemote) {
              const parsed = parseRemoteNoteId(id);
              const canonical = parsed.isRemote ? parsed.uuid : id;
              return {
                row: {
                  content: fallbackRemote.content,
                  path: fallbackRemote.notebookSlug
                    ? `${fallbackRemote.notebookSlug}/${canonical}.md`
                    : `${canonical}.md`,
                  blocks: {},
                },
                canonicalNoteId: canonical,
                remoteNoteId: id,
                feedId: fallbackRemote.feedId ?? (parsed.isRemote ? parsed.feedId : undefined),
                notebookSlug: fallbackRemote.notebookSlug,
              };
            }
            return undefined;
          },
        },
      );

      toast({
        title: 'Forked to My Notes',
        description: `Created editable copy "${forked.title || sourceTitle || 'Workout'}"`,
      });
      onOpenChange(false);
      setNewNotebookName('');
      setShowNewNotebook(false);
      if (onForked) {
        onForked(forked);
      } else {
        void navigate(`/note/${encodeURIComponent(forked.id)}?edit=1`);
      }
    } catch (err) {
      toast({
        title: 'Could not fork workout',
        description: err instanceof Error ? err.message : 'Unable to create a personal copy.',
        variant: 'destructive',
      });
    } finally {
      setForking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogBackdrop />
      <DialogContent className="max-w-md bg-popover text-popover-foreground border border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <GitFork className="size-4 text-primary" aria-hidden="true" />
            Fork to My Notes
          </DialogTitle>
          <DialogDescription>
            Create an independent, editable copy of {sourceTitle ? `"${sourceTitle}"` : 'this workout'} in one of your writable notebooks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <label htmlFor="fork-target-notebook" className="block text-xs font-medium text-foreground">
              Destination notebook
            </label>
            <select
              id="fork-target-notebook"
              value={selectedNotebookId}
              onChange={(e) => {
                setSelectedNotebookId(e.target.value);
                setShowNewNotebook(false);
              }}
              disabled={showNewNotebook || forking}
              className="w-full min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.name || nb.slug}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowNewNotebook((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline underline-offset-2"
            >
              <FolderPlus className="size-3.5" aria-hidden="true" />
              {showNewNotebook ? 'Use existing notebook instead' : 'Or create a new notebook'}
            </button>
            {showNewNotebook && (
              <input
                type="text"
                value={newNotebookName}
                onChange={(e) => setNewNotebookName(e.target.value)}
                placeholder="e.g., Competition Prep"
                aria-label="New notebook name"
                className="w-full min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" disabled={forking} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={forking || (showNewNotebook && !newNotebookName.trim())}
            onClick={() => void handleConfirm()}
            className="gap-1.5"
          >
            {forking ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <GitFork className="size-3.5" aria-hidden="true" />}
            Fork to My Notes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatSessionDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round((ms || 0) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
}

export interface WorkoutSessionsListProps {
  sessions: readonly Session[];
  className?: string;
}

export function WorkoutSessionsList({ sessions, className = '' }: WorkoutSessionsListProps) {
  const sorted = [...sessions].sort((a, b) => (b.startTime || b.createdAt) - (a.startTime || a.createdAt));
  return (
    <section
      aria-label="Logged workouts"
      className={`border-t border-border/50 pt-4 space-y-2 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Logged Workouts ({sorted.length})
        </span>
        <span className="text-[11px] text-muted-foreground">Private to your vault</span>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No workouts logged against this note yet. Start a workout to record your first session.
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {sorted.slice(0, 6).map((sess) => {
            const when = new Date(sess.startTime || sess.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
            const statusText =
              sess.status === 'completed' || sess.completed
                ? 'Completed'
                : sess.status === 'in-progress'
                  ? 'In progress'
                  : 'Logged';
            return (
              <li key={sess.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <Link
                  to={`/results/${encodeURIComponent(sess.id)}`}
                  className="font-medium text-foreground hover:text-primary hover:underline underline-offset-2 truncate"
                >
                  {when} · {formatSessionDuration(sess.duration)}
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  {typeof sess.roundsCompleted === 'number' && (
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                      {sess.roundsCompleted} rounds
                    </span>
                  )}
                  <span className="text-[11px] font-medium text-muted-foreground">{statusText}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export interface OwnershipPillBadgeProps {
  presentation: OwnershipPresentation;
}

export function OwnershipPillBadge({ presentation }: OwnershipPillBadgeProps) {
  const Icon =
    presentation.kind === 'feed-archived'
      ? ShieldCheck
      : presentation.kind === 'feed'
        ? Rss
        : BookOpen;
  return (
    <span
      data-ownership={presentation.kind}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none ${presentation.badgeClassName}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{presentation.badgeLabel}</span>
    </span>
  );
}

export function PublicationPill({
  noteId,
  notebookId: propNotebookId,
  sessions: externalSessions,
  isReadOnlyFeedNote = false,
  note: noteProp,
  ownershipOverride,
  resolveFeedLabel,
  resolveRemoteWorkoutFn,
  storageOverride,
  open: controlledOpen,
  onOpenChange,
  onCloneRequest,
  onForked,
  onChanged,
}: PublicationPillProps) {
  const activeStorage = storageOverride ?? storage;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const [loadedNote, setLoadedNote] = useState<Note | null>(null);
  const [summary, setSummary] = useState<PublicationVisibilitySummary>(() =>
    derivePublicationVisibility({
      notebookPublic: false,
      publicSessions: 0,
      totalSessions: 0,
      notebookId: propNotebookId ?? 'notebook/journal',
    }),
  );
  const [noteSessions, setNoteSessions] = useState<Session[]>([]);

  const parsedRemote = parseRemoteNoteId(noteId);
  const canonicalLookupId = parsedRemote.isRemote ? parsedRemote.uuid : noteId;

  const refresh = useCallback(async () => {
    try {
      if (!storageOverride) {
        await whenStorageReady();
      }
      const [nextSummary, loadedSessions, fetchedNote] = await Promise.all([
        getNotePublicationSummary(activeStorage, canonicalLookupId),
        activeStorage
          .readonly('sessions')
          .getAllFromIndex('by-note', canonicalLookupId)
          .catch(async () => {
            const all = await activeStorage.readonly('sessions').getAll();
            return all.filter((s) => s.noteId === canonicalLookupId || s.noteId === noteId);
          })
          .then((stored) => (stored.length > 0 ? stored : [...(externalSessions ?? [])])),
        activeStorage.readonly('notes').get(canonicalLookupId).catch(() => undefined),
      ]);
      setSummary(nextSummary);
      setNoteSessions(loadedSessions);
      setLoadedNote(fetchedNote ?? null);
      onChanged?.();
    } catch {
      // Ignore transient uninitialized storage during cold mount
    }
  }, [activeStorage, storageOverride, canonicalLookupId, noteId, externalSessions, onChanged]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const effectiveNote = (noteProp ?? loadedNote ?? undefined) as
    | (NoteOwnershipInput & { id?: string })
    | undefined;
  const resolvedNotebook =
    (loadedNote ? notebookOfItem(loadedNote) : undefined) ?? propNotebookId;
  const resolvedOrigin = loadedNote ? notebookOriginOfItem(loadedNote) : undefined;
  const ownershipMeta = resolveOwnershipPresentation(effectiveNote, {
    noteId,
    notebookOrigin: resolvedOrigin,
    resolvedNotebookId: resolvedNotebook,
    fallbackReadOnly: isReadOnlyFeedNote,
    ownershipOverride,
    resolveFeedLabel,
  });

  const userVisibilityLabel = derivePublicationStatusLabel(
    summary.visibility,
    ownershipMeta.ownership,
  );
  const label = ownershipMeta.isNonOwned
    ? ownershipMeta.badgeLabel
    : userVisibilityLabel === 'Published Note + Data'
      ? `Published Note + Data (${summary.publicSessions})`
      : userVisibilityLabel;

  const NonOwnedIcon =
    ownershipMeta.kind === 'feed-archived'
      ? ShieldCheck
      : ownershipMeta.kind === 'feed'
        ? Rss
        : BookOpen;

  return (
    <div className="inline-block" data-testid="publication-pill-details">
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        data-testid="publication-pill"
        data-ownership={ownershipMeta.kind}
        data-visibility={ownershipMeta.isNonOwned ? ownershipMeta.shortLabel : summary.visibility}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
          ownershipMeta.isNonOwned
            ? ownershipMeta.badgeClassName
            : `${PILL_STYLES[summary.visibility]} uppercase tracking-wider`
        }`}
      >
        {ownershipMeta.isNonOwned ? (
          <NonOwnedIcon className="size-3 shrink-0" aria-hidden="true" />
        ) : (
          <svg className="size-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            {summary.visibility === 'Private' ? (
              <>
                <rect x="3.5" y="7" width="9" height="6.5" rx="1.25" />
                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
              </>
            ) : (
              <>
                <circle cx="8" cy="8" r="5.5" />
                <path d="M2.5 8h11M8 2.5c1.6 1.6 1.6 9.4 0 11M8 2.5c-1.6 1.6-1.6 9.4 0 11" />
              </>
            )}
          </svg>
        )}
        <span>{label}</span>
      </button>

      <NotePromotionSheet
        open={isOpen}
        onOpenChange={setOpen}
        noteId={noteId}
        storageInstance={activeStorage}
        summary={summary}
        noteSessions={noteSessions}
        isReadOnlyFeedNote={ownershipMeta.isNonOwned}
        ownershipPresentation={ownershipMeta}
        note={effectiveNote}
        resolveFeedLabel={resolveFeedLabel}
        resolveRemoteWorkoutFn={resolveRemoteWorkoutFn}
        onRefresh={refresh}
        onCloneRequest={onCloneRequest}
        onForked={onForked}
      />
    </div>
  );
}
