import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { Link, useInRouterContext, useNavigate } from 'react-router-dom';
import {
  Button,
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  Input,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { X } from 'lucide-react';
import {
  derivePublicationStatusLabel,
  isNonPublishableNotebook,
  isPublishableNotebookLanding,
  notebookSlugFromId,
  toNotebookId,
  type Note,
  type NotebookId,
  type NoteOwnershipInput,
  type PublicationVisibilitySummary,
  type Session,
} from '@bitcobblers/wod-wiki-core';
import {
  createUserNotebookLanding,
  forkNoteToUserNotebook,
  getNoteNotebooks,
  parseRemoteNoteId,
  promoteNoteToNotebooks,
  removeNoteFromNotebook,
  resolveUpstreamProvenance,
  setNotebookPublic,
  setSessionPublic,
  type RemoteWorkoutResolution,
  type ResolvedUpstreamProvenance,
} from '@bitcobblers/wod-wiki-engine';
import { notebookOfItem, notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import { notebookService, storageBackend } from '@/hooks/useBrowserServices';
import {
  listWritableNotebooks,
  resolveOwnershipPresentation,
  type OwnershipPresentation,
  type WritableNotebookTarget,
} from '@/components/molecules/PublicationPill';
import {
  exportFeedRepositoryToDirectory,
  exportFeedRepositoryZip,
  publishSelfHostedFeed,
  supportsDirectoryPicker,
} from '@/hooks/useWorkbenchServices';
import { toast } from '@/hooks/use-toast';

export interface NotePromotionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  storageInstance: IStorage;
  summary: PublicationVisibilitySummary;
  noteSessions: readonly Session[];
  isReadOnlyFeedNote?: boolean;
  ownershipPresentation?: OwnershipPresentation;
  note?: NoteOwnershipInput;
  resolveFeedLabel?: (feedSourceId: string) => string | undefined;
  resolveRemoteWorkoutFn?: (noteId: string) => Promise<RemoteWorkoutResolution | undefined>;
  onRefresh: () => Promise<void>;
  onCloneRequest?: () => void;
  onForked?: (forked: Note) => void;
}

interface UserNotebookRow {
  id: NotebookId;
  slug: string;
  title: string;
  isPublic: boolean;
}


export function NotePromotionSheet({
  open,
  onOpenChange,
  noteId,
  storageInstance,
  summary,
  noteSessions,
  isReadOnlyFeedNote = false,
  ownershipPresentation,
  note: noteProp,
  resolveFeedLabel,
  resolveRemoteWorkoutFn,
  onRefresh,
  onCloneRequest,
  onForked,
}: NotePromotionSheetProps) {
  const inRouter = useInRouterContext();
  const navigate = useNavigate();
  const [userNotebooks, setUserNotebooks] = useState<UserNotebookRow[]>([]);
  const [writableForkTargets, setWritableForkTargets] = useState<WritableNotebookTarget[]>([]);
  const [forkTargetNotebookId, setForkTargetNotebookId] = useState<string>('notebook/journal');
  const [forking, setForking] = useState(false);
  const [loadedNote, setLoadedNote] = useState<Note | null>(null);
  const [linkedIds, setLinkedIds] = useState<NotebookId[]>([]);
  const [provenance, setProvenance] = useState<ResolvedUpstreamProvenance | null>(null);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [localSessions, setLocalSessions] = useState<Session[]>(() => [...noteSessions]);

  useEffect(() => {
    setLocalSessions([...noteSessions]);
  }, [noteSessions]);

  const parsedRemote = parseRemoteNoteId(noteId);
  const canonicalNoteId = parsedRemote.isRemote ? parsedRemote.uuid : noteId;

  const loadSheetState = useCallback(async () => {
    try {
      const [allNotes, currentLinks, writable] = await Promise.all([
        storageInstance.readonly('notes').getAll(),
        getNoteNotebooks(storageInstance, canonicalNoteId),
        listWritableNotebooks(storageInstance),
      ]);
      const currentNote =
        allNotes.find((n) => n.id === canonicalNoteId) ??
        allNotes.find((n) => n.id === noteId);
      setLoadedNote(currentNote ?? null);
      setWritableForkTargets(writable);
      setForkTargetNotebookId((prev) =>
        writable.some((nb) => nb.id === prev) ? prev : (writable[0]?.id ?? 'notebook/journal'),
      );
      if (currentNote) {
        setProvenance(await resolveUpstreamProvenance(storageInstance, currentNote));
      } else {
        setProvenance(null);
      }

      const byId = new Map<NotebookId, UserNotebookRow>();
      for (const n of allNotes) {
        if (isPublishableNotebookLanding(n)) {
          const nbId = toNotebookId(n.id);
          byId.set(nbId, {
            id: nbId,
            slug: notebookSlugFromId(nbId),
            title: n.title || notebookSlugFromId(nbId),
            isPublic: n.public === true,
          });
        }
      }
      for (const linked of currentLinks) {
        if (!isNonPublishableNotebook(linked) && !byId.has(linked)) {
          byId.set(linked, {
            id: linked,
            slug: notebookSlugFromId(linked),
            title: notebookSlugFromId(linked),
            isPublic: false,
          });
        }
      }
      setUserNotebooks([...byId.values()]);
      setLinkedIds(currentLinks);
      setHydrated(true);
    } catch {
      // Ignore transient unmount/storage errors
      setHydrated(true);
    }
  }, [storageInstance, noteId, canonicalNoteId]);

  useEffect(() => {
    if (open) {
      setHydrated(false);
      void loadSheetState();
    }
  }, [open, loadSheetState]);

  const activeUserNotebooks = userNotebooks.filter((nb) => linkedIds.includes(nb.id));
  const primaryUserNotebook =
    activeUserNotebooks[0] ??
    (summary.notebookId && !isNonPublishableNotebook(summary.notebookId)
      ? {
          id: toNotebookId(summary.notebookId),
          slug: notebookSlugFromId(summary.notebookId),
          title: notebookSlugFromId(summary.notebookId),
          isPublic: summary.notebookPublic,
        }
      : null);

  const handleToggleMembership = async (nbId: NotebookId) => {
    if (busy || isReadOnlyFeedNote) return;
    const wasMember = linkedIds.includes(nbId);
    const nbTitle = userNotebooks.find((n) => n.id === nbId)?.title ?? notebookSlugFromId(nbId);
    setBusy(true);
    try {
      if (wasMember) {
        await removeNoteFromNotebook(storageInstance, canonicalNoteId, nbId);
      } else {
        await promoteNoteToNotebooks(storageInstance, {
          noteId: canonicalNoteId,
          notebookIds: [nbId],
          sessionIds: noteSessions.map((s) => s.id),
        });
      }
      notebookService.notify();
      await onRefresh();
      await loadSheetState();
      toast({
        title: wasMember ? 'Removed from Notebook' : 'Added to Notebook',
        description: wasMember ? `Removed from ${nbTitle}.` : `Promoted to ${nbTitle}.`,
      });
    } catch (err) {
      toast({
        title: 'Could not update Notebook membership',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAndPromote = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = newNotebookName.trim();
    if (!trimmed || busy || isReadOnlyFeedNote) return;
    setBusy(true);
    try {
      const nbId = await createUserNotebookLanding(storageInstance, trimmed);
      await promoteNoteToNotebooks(storageInstance, {
        noteId: canonicalNoteId,
        notebookIds: [nbId],
        sessionIds: noteSessions.map((s) => s.id),
      });
      setNewNotebookName('');
      notebookService.notify();
      await onRefresh();
      await loadSheetState();
      toast({
        title: 'Added to Notebook',
        description: `Promoted to ${trimmed}.`,
      });
    } catch (err) {
      toast({
        title: 'Could not create Notebook',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleNotebookPublic = async (nbId: NotebookId, nextPublic: boolean) => {
    if (busy || isNonOwned) return;
    setUserNotebooks((prev) =>
      prev.some((n) => n.id === nbId)
        ? prev.map((n) => (n.id === nbId ? { ...n, isPublic: nextPublic } : n))
        : [
            ...prev,
            {
              id: nbId,
              slug: notebookSlugFromId(nbId),
              title: notebookSlugFromId(nbId),
              isPublic: nextPublic,
            },
          ],
    );
    setBusy(true);
    try {
      await setNotebookPublic(storageInstance, nbId, nextPublic);
      notebookService.notify();
      await onRefresh();
      await loadSheetState();
    } catch (err) {
      await loadSheetState();
      toast({
        title: 'Failed to update Notebook visibility',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const ownershipMeta = useMemo(() => {
    const resolvedNote = (noteProp ?? loadedNote ?? undefined) as
      | (NoteOwnershipInput & { id?: string })
      | undefined;
    return (
      ownershipPresentation ??
      resolveOwnershipPresentation(resolvedNote, {
        noteId,
        notebookOrigin: loadedNote ? notebookOriginOfItem(loadedNote) : undefined,
        resolvedNotebookId: loadedNote ? notebookOfItem(loadedNote) : undefined,
        fallbackReadOnly: isReadOnlyFeedNote,
        resolveFeedLabel,
      })
    );
  }, [ownershipPresentation, noteProp, loadedNote, noteId, isReadOnlyFeedNote, resolveFeedLabel]);

  const isNonOwned = isReadOnlyFeedNote || ownershipMeta.isNonOwned;
  const userVisibilityLabel = derivePublicationStatusLabel(
    summary.visibility,
    ownershipMeta.ownership,
  );

  const handleForkToMyNotes = async () => {
    if (forking) return;
    setForking(true);
    try {
      const forked = await forkNoteToUserNotebook(
        storageInstance,
        noteId,
        forkTargetNotebookId,
        {
          resolveRemoteWorkout: resolveRemoteWorkoutFn,
        },
      );
      toast({
        title: 'Forked to My Notes',
        description: `Created editable copy "${forked.title || 'Workout'}"`,
      });
      onOpenChange(false);
      await onRefresh();
      if (onForked) {
        onForked(forked);
      } else if (inRouter) {
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

  const handleToggleSessionPublic = async (sess: Session, nextPublic: boolean) => {
    if (busy || isNonOwned) return;
    setLocalSessions((prev) =>
      prev.map((s) => (s.id === sess.id ? { ...s, public: nextPublic } : s)),
    );
    setBusy(true);
    try {
      await setSessionPublic(storageInstance, sess.id, nextPublic);
      await onRefresh();
      await loadSheetState();
    } catch (err) {
      setLocalSessions([...noteSessions]);
      toast({
        title: 'Failed to update Session visibility',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePublishAction = async (target: 'server' | 'zip' | 'folder') => {
    setBusy(true);
    try {
      if (target === 'server') {
        const res = await publishSelfHostedFeed();
        toast({
          title: 'Feed published',
          description: `Published v${res.report.manifest.version} (${res.report.totalNotes} notes, ${res.report.totalPublicSessions} public sessions).`,
        });
      } else if (target === 'zip') {
        const res = await exportFeedRepositoryZip();
        toast({
          title: 'Feed repository exported',
          description: `Downloaded (.zip) with ${res.totalNotes} notes and ${res.totalPublicSessions} public sessions.`,
        });
      } else {
        const res = await exportFeedRepositoryToDirectory();
        if (res) {
          toast({
            title: 'Feed repository written',
            description: `Wrote ${res.totalNotes} notes and ${res.totalPublicSessions} public sessions.`,
          });
        }
      }
      await onRefresh();
    } catch (err) {
      toast({
        title: 'Publish / Export failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerBackdrop className="bg-black/30" />
      <DrawerContent
        initialFocus="content"
        aria-label="Notebook promotion and publication visibility"
        data-testid="publication-pill-popover"
        className="w-full lg:max-w-md max-h-[85dvh] overflow-y-auto rounded-t-xl border border-border bg-card text-foreground p-5 sm:p-6 space-y-5"
      >
        <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-border lg:hidden" />

        <div className="flex items-start justify-between gap-3 border-b border-border pb-3.5">
          <div className="space-y-0.5">
            <DrawerTitle className="text-sm font-semibold tracking-tight">
              {isNonOwned ? 'Provenance & Local Copy' : 'Notebooks & Publication'}
            </DrawerTitle>
            <DrawerDescription className="text-xs text-muted-foreground">
              {isNonOwned ? `${ownershipMeta.badgeLabel} · Sessions stay private` : `${userVisibilityLabel} · Journal stays private`}
            </DrawerDescription>
          </div>
          <DrawerClose
            aria-label="Close promotion sheet"
            className="min-h-9 min-w-9 h-auto w-auto p-0 inline-flex items-center justify-center rounded-md border border-border bg-transparent text-xs font-mono text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </DrawerClose>
        </div>

        {provenance && (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs"
            data-testid="promotion-provenance-row"
          >
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Origin</span>
            {provenance.exists ? (
              <Link
                to={`/note/${provenance.sourceNoteId}`}
                onClick={() => onOpenChange(false)}
                className="rounded-full bg-primary/15 text-primary px-2.5 py-0.5 font-mono text-[11px] hover:underline"
              >
                {provenance.title ?? provenance.sourceNoteId}
                {provenance.sourceVersion !== undefined ? ` · v${provenance.sourceVersion}` : ''}
              </Link>
            ) : (
              <span className="rounded-full bg-warning/15 text-warning px-2.5 py-0.5 font-mono text-[11px]">
                {provenance.sourceNotebookId?.replace(/^notebook\//, '') ?? provenance.sourceNoteId}
                {provenance.sourceVersion !== undefined ? ` · v${provenance.sourceVersion}` : ''} (archived)
              </span>
            )}
          </div>
        )}

        {isNonOwned ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {ownershipMeta.guidanceCopy}
            </p>
            <div className="space-y-2 rounded-md border border-border/80 bg-background/80 p-3">
              <label htmlFor="promotion-fork-notebook" className="block text-xs font-medium text-foreground">
                Fork to editable personal notebook
              </label>
              <select
                id="promotion-fork-notebook"
                value={forkTargetNotebookId}
                onChange={(e) => setForkTargetNotebookId(e.target.value)}
                disabled={forking}
                className="w-full min-h-9 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {writableForkTargets.map((nb) => (
                  <option key={nb.id} value={nb.id}>
                    {nb.name || nb.slug}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                disabled={forking}
                onClick={() => void handleForkToMyNotes()}
                className="min-h-10 w-full text-xs gap-1.5"
              >
                {forking ? 'Forking…' : 'Fork to My Notes'}
              </Button>
            </div>
            {onCloneRequest && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onCloneRequest();
                }}
                data-testid="promotion-clone-readonly-btn"
                className="min-h-10 w-full text-xs"
              >
                Place in Journal / Page…
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Notebook Membership (Many-to-Many)
              </span>
            </div>

            <div className="flex items-center justify-between min-h-11 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <svg className="size-3.5 text-muted-foreground" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                  <rect x="3.5" y="7" width="9" height="6.5" rx="1.25" />
                  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                </svg>
                <span className="font-medium">Journal</span>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Private · Permanent
              </span>
            </div>

            {userNotebooks.length > 0 && (
              <div className="space-y-1.5">
                {userNotebooks.map((nb) => {
                  const isMember = linkedIds.includes(nb.id);
                  const isPrimaryToggle = primaryUserNotebook?.id === nb.id;
                  return (
                    <div
                      key={nb.id}
                      data-testid={`promotion-notebook-chip-${nb.id}`}
                      className="flex items-center justify-between gap-2 min-h-11 rounded-lg border border-border px-3 py-2 text-xs"
                    >
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleToggleMembership(nb.id)}
                        className="flex flex-1 items-center gap-2.5 text-left min-h-9"
                      >
                        <span
                          className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border ${
                            isMember
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-transparent'
                          }`}
                        >
                          {isMember && (
                            <svg className="size-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <path d="M2.5 6l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{nb.title}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">notebook/{nb.slug}</div>
                        </div>
                      </button>

                      {isMember ? (
                        <label className="inline-flex items-center gap-1.5 cursor-pointer shrink-0 min-h-9 px-2 rounded-md border border-border bg-muted/30">
                          <input
                            type="checkbox"
                            className="size-3.5 accent-primary"
                            checked={nb.isPublic}
                            disabled={busy}
                            onChange={(e) => void handleToggleNotebookPublic(nb.id, e.target.checked)}
                            data-testid={
                              isPrimaryToggle
                                ? 'publication-notebook-public-toggle'
                                : `publication-notebook-public-toggle-${nb.slug}`
                            }
                          />
                          <span className="font-mono text-[11px] uppercase tracking-wider">
                            {nb.isPublic ? 'Public' : 'Private'}
                          </span>
                        </label>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void handleToggleMembership(nb.id)}
                          data-testid={`promotion-notebook-promote-${nb.slug}`}
                          className="min-h-9 h-9 px-2.5 text-[11px] shrink-0"
                        >
                          + Promote
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {hydrated && primaryUserNotebook && !userNotebooks.some((u) => u.id === primaryUserNotebook.id) && (
              <label className="flex items-center justify-between gap-2 min-h-11 rounded-lg border border-border px-3 py-2 cursor-pointer text-xs">
                <div>
                  <div className="font-medium">Public Notebook</div>
                  <div className="font-mono text-[11px] text-muted-foreground">notebook/{primaryUserNotebook.slug}</div>
                </div>
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={summary.notebookPublic}
                  disabled={busy}
                  onChange={(e) => void handleToggleNotebookPublic(primaryUserNotebook.id, e.target.checked)}
                  data-testid="publication-notebook-public-toggle"
                />
              </label>
            )}

            <form onSubmit={(e) => void handleCreateAndPromote(e)} className="flex items-center gap-2 pt-1">
              <Input
                type="text"
                value={newNotebookName}
                onValueChange={setNewNotebookName}
                placeholder="Promote to new Notebook..."
                aria-label="New Notebook name"
                data-testid="promotion-new-notebook-input"
                className="min-h-11 h-11 flex-1 text-xs"
              />
              <Button
                type="submit"
                disabled={busy || !newNotebookName.trim()}
                data-testid="promotion-new-notebook-submit"
                className="min-h-11 px-3.5 text-xs"
              >
                + Create &amp; Promote
              </Button>
            </form>
          </div>
        )}

        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Attached Sessions
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {summary.publicSessions} of {noteSessions.length} shared
            </span>
          </div>

          {localSessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No recorded Sessions yet. Sessions stay private unless opted in.
            </p>
          ) : (
            <ul className="max-h-44 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {localSessions.map((sess) => {
                const dateStr = new Date(sess.startTime || sess.createdAt).toLocaleDateString();
                const durSec = Math.round((sess.duration || 0) / 1000);
                return (
                  <li key={sess.id} className="flex items-center justify-between gap-2 min-h-11 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{dateStr}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {durSec}s · {sess.completed ? 'completed' : 'partial'}
                      </div>
                    </div>
                    {isNonOwned ? (
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-foreground">
                        Private (local)
                      </span>
                    ) : (
                      <label className="inline-flex items-center gap-1.5 cursor-pointer shrink-0 min-h-9">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={sess.public === true}
                          disabled={busy}
                          onChange={(e) => void handleToggleSessionPublic(sess, e.target.checked)}
                          data-testid={`publication-session-toggle-${sess.id}`}
                        />
                        <span className="font-mono text-[11px] uppercase tracking-wider">
                          {sess.public ? 'Public' : 'Private'}
                        </span>
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!isNonOwned && !summary.notebookPublic && summary.publicSessions > 0 && (
            <p className="rounded-md border border-amber-700/25 bg-amber-500/15 text-amber-900 dark:text-amber-100 px-3 py-2 text-[11px]">
              Shared Sessions stay Private until at least one linked user Notebook is marked Public.
            </p>
          )}
        </div>

        {summary.notebookPublic && !isNonOwned && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            {storageBackend === 'api' ? (
              <Button
                disabled={busy}
                onClick={() => void handlePublishAction('server')}
                data-testid="publication-publish-server-btn"
                className="min-h-11 flex-1 text-xs px-4"
              >
                Publish to Server Feed
              </Button>
            ) : (
              <>
                <Button
                  disabled={busy}
                  onClick={() => void handlePublishAction('zip')}
                  data-testid="publication-export-repo-zip-btn"
                  className="min-h-11 flex-1 text-xs px-4"
                >
                  Export Feed Repo (.zip)
                </Button>
                {supportsDirectoryPicker() && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void handlePublishAction('folder')}
                    data-testid="publication-export-repo-folder-btn"
                    className="min-h-11 px-3.5 text-xs"
                  >
                    Folder
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
