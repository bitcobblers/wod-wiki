import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  isNonPublishableNotebook,
  isPublishableNotebookLanding,
  notebookSlugFromId,
  toNotebookId,
  type NotebookId,
  type PublicationVisibilitySummary,
  type Session,
} from '@bitcobblers/wod-wiki-core';
import {
  createUserNotebookLanding,
  getNoteNotebooks,
  promoteNoteToNotebooks,
  removeNoteFromNotebook,
  resolveUpstreamProvenance,
  setNotebookPublic,
  setSessionPublic,
  type ResolvedUpstreamProvenance,
} from '@bitcobblers/wod-wiki-engine';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import { storageBackend } from '@/hooks/useBrowserServices';
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
  onRefresh: () => Promise<void>;
  onCloneRequest?: () => void;
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
  onRefresh,
  onCloneRequest,
}: NotePromotionSheetProps) {
  const [userNotebooks, setUserNotebooks] = useState<UserNotebookRow[]>([]);
  const [linkedIds, setLinkedIds] = useState<NotebookId[]>([]);
  const [provenance, setProvenance] = useState<ResolvedUpstreamProvenance | null>(null);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [busy, setBusy] = useState(false);
  const [localSessions, setLocalSessions] = useState<Session[]>(() => [...noteSessions]);

  useEffect(() => {
    setLocalSessions([...noteSessions]);
  }, [noteSessions]);
  const loadSheetState = useCallback(async () => {
    try {
      const [allNotes, currentLinks] = await Promise.all([
        storageInstance.readonly('notes').getAll(),
        getNoteNotebooks(storageInstance, noteId),
      ]);
      const currentNote = allNotes.find((n) => n.id === noteId);
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
    } catch {
      // Ignore transient unmount/storage errors
    }
  }, [storageInstance, noteId]);

  useEffect(() => {
    if (open) {
      void loadSheetState();
    }
  }, [open, loadSheetState, summary]);

  if (!open) return null;

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
    setBusy(true);
    try {
      if (linkedIds.includes(nbId)) {
        await removeNoteFromNotebook(storageInstance, noteId, nbId);
      } else {
        await promoteNoteToNotebooks(storageInstance, {
          noteId,
          notebookIds: [nbId],
          sessionIds: noteSessions.map((s) => s.id),
        });
      }
      await onRefresh();
      await loadSheetState();
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

  const handleCreateAndPromote = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newNotebookName.trim();
    if (!trimmed || busy || isReadOnlyFeedNote) return;
    setBusy(true);
    try {
      const nbId = await createUserNotebookLanding(storageInstance, trimmed);
      await promoteNoteToNotebooks(storageInstance, {
        noteId,
        notebookIds: [nbId],
        sessionIds: noteSessions.map((s) => s.id),
      });
      setNewNotebookName('');
      await onRefresh();
      await loadSheetState();
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
    if (busy || isReadOnlyFeedNote) return;
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

  const handleToggleSessionPublic = async (sess: Session, nextPublic: boolean) => {
    if (busy) return;
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

  const content = (
    <div
      className="fixed inset-0 z-[80] flex items-end lg:items-center justify-center bg-black/25"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Notebook promotion and publication visibility"
        data-testid="publication-pill-popover"
        onClick={(e) => e.stopPropagation()}
        className="w-full lg:max-w-md max-h-[85dvh] overflow-y-auto rounded-t-xl lg:rounded-xl border border-[#EAEAEA] dark:border-zinc-800 bg-[#FFFFFF] dark:bg-zinc-950 text-[#111111] dark:text-zinc-100 p-5 sm:p-6 space-y-5"
      >
        {/* Mobile grab handle */}
        <div className="mx-auto h-1 w-10 rounded-full bg-[#EAEAEA] dark:bg-zinc-800 lg:hidden" />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#EAEAEA] dark:border-zinc-800 pb-3.5">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold tracking-tight">Notebooks &amp; Publication</h3>
            <p className="text-xs text-[#787774] dark:text-zinc-400">
              {summary.visibility} · Journal stays private
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close promotion sheet"
            className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-md border border-[#EAEAEA] dark:border-zinc-800 text-xs font-mono text-[#787774] hover:text-[#111111] dark:hover:text-zinc-100"
          >
            <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Upstream Provenance Banner */}
        {provenance && (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border border-[#EAEAEA] dark:border-zinc-800 bg-[#FBFBFA] dark:bg-zinc-900 px-3 py-2.5 text-xs"
            data-testid="promotion-provenance-row"
          >
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#787774]">Origin</span>
            {provenance.exists ? (
              <Link
                to={`/notes/${provenance.sourceNoteId}`}
                onClick={() => onOpenChange(false)}
                className="rounded-full bg-[#E1F3FE] text-[#1F6C9F] px-2.5 py-0.5 font-mono text-[11px] hover:underline"
              >
                {provenance.title ?? provenance.sourceNoteId}
                {provenance.sourceVersion !== undefined ? ` · v${provenance.sourceVersion}` : ''}
              </Link>
            ) : (
              <span className="rounded-full bg-[#FBF3DB] text-[#956400] px-2.5 py-0.5 font-mono text-[11px]">
                {provenance.sourceNotebookId?.replace(/^notebook\//, '') ?? provenance.sourceNoteId}
                {provenance.sourceVersion !== undefined ? ` · v${provenance.sourceVersion}` : ''} (archived)
              </span>
            )}
          </div>
        )}

        {/* Read-only upstream notice vs Many-to-many Notebook Promotion */}
        {isReadOnlyFeedNote ? (
          <div className="rounded-lg border border-[#EAEAEA] dark:border-zinc-800 bg-[#FBFBFA] dark:bg-zinc-900 p-4 space-y-3">
            <p className="text-xs text-[#787774] dark:text-zinc-400 leading-relaxed">
              Read-only upstream Note. Running any workout on this Note automatically snapshots a versioned copy into your private Journal, or you can clone it directly.
            </p>
            {onCloneRequest && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onCloneRequest();
                }}
                data-testid="promotion-clone-readonly-btn"
                className="min-h-11 w-full rounded-md bg-[#111111] text-white text-xs font-medium px-4 py-2 hover:bg-[#333333] transition-colors"
              >
                Clone to Journal
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-[#787774]">
                Notebook Membership (Many-to-Many)
              </span>
            </div>

            {/* Locked private Journal anchor */}
            <div className="flex items-center justify-between min-h-11 rounded-lg border border-[#EAEAEA] dark:border-zinc-800 bg-[#F7F6F3] dark:bg-zinc-900 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <svg className="size-3.5 text-[#787774]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <rect x="3.5" y="7" width="9" height="6.5" rx="1.25" />
                  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                </svg>
                <span className="font-medium">Journal</span>
              </div>
              <span className="rounded-full bg-[#EAEAEA] dark:bg-zinc-800 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#787774]">
                Private · Permanent
              </span>
            </div>

            {/* User Notebooks multi-select list */}
            {userNotebooks.length > 0 && (
              <div className="space-y-1.5">
                {userNotebooks.map((nb) => {
                  const isMember = linkedIds.includes(nb.id);
                  const isPrimaryToggle = primaryUserNotebook?.id === nb.id;
                  return (
                    <div
                      key={nb.id}
                      data-testid={`promotion-notebook-chip-${nb.id}`}
                      className="flex items-center justify-between gap-2 min-h-11 rounded-lg border border-[#EAEAEA] dark:border-zinc-800 px-3 py-2 text-xs"
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
                              ? 'border-[#111111] bg-[#111111] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                              : 'border-[#EAEAEA] dark:border-zinc-700 bg-transparent'
                          }`}
                        >
                          {isMember && (
                            <svg className="size-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M2.5 6l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{nb.title}</div>
                          <div className="font-mono text-[10px] text-[#787774]">notebook/{nb.slug}</div>
                        </div>
                      </button>

                      {isMember && (
                        <label className="inline-flex items-center gap-1.5 cursor-pointer shrink-0 min-h-9 px-2 rounded-md border border-[#EAEAEA] dark:border-zinc-800 bg-[#FBFBFA] dark:bg-zinc-900">
                          <input
                            type="checkbox"
                            className="size-3.5 accent-[#111111]"
                            checked={nb.isPublic}
                            disabled={busy}
                            onChange={(e) => void handleToggleNotebookPublic(nb.id, e.target.checked)}
                            data-testid={
                              isPrimaryToggle
                                ? 'publication-notebook-public-toggle'
                                : `publication-notebook-public-toggle-${nb.slug}`
                            }
                          />
                          <span className="font-mono text-[10px] uppercase tracking-wider">
                            {nb.isPublic ? 'Public' : 'Private'}
                          </span>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Fallback Public Notebook toggle when note has a pre-stamped single notebookId before userNotebooks loaded */}
            {primaryUserNotebook && !userNotebooks.some((u) => u.id === primaryUserNotebook.id) && (
              <label className="flex items-center justify-between gap-2 min-h-11 rounded-lg border border-[#EAEAEA] dark:border-zinc-800 px-3 py-2 cursor-pointer text-xs">
                <div>
                  <div className="font-medium">Public Notebook</div>
                  <div className="font-mono text-[10px] text-[#787774]">notebook/{primaryUserNotebook.slug}</div>
                </div>
                <input
                  type="checkbox"
                  className="size-4 accent-[#111111]"
                  checked={summary.notebookPublic}
                  disabled={busy}
                  onChange={(e) => void handleToggleNotebookPublic(primaryUserNotebook.id, e.target.checked)}
                  data-testid="publication-notebook-public-toggle"
                />
              </label>
            )}

            {/* Quick-create user Notebook inline */}
            <form onSubmit={(e) => void handleCreateAndPromote(e)} className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newNotebookName}
                onChange={(e) => setNewNotebookName(e.target.value)}
                placeholder="Promote to new Notebook..."
                aria-label="New Notebook name"
                data-testid="promotion-new-notebook-input"
                className="min-h-11 flex-1 rounded-md border border-[#EAEAEA] dark:border-zinc-800 bg-[#FBFBFA] dark:bg-zinc-900 px-3 text-xs focus:outline-none focus:border-[#111111]"
              />
              <button
                type="submit"
                disabled={busy || !newNotebookName.trim()}
                data-testid="promotion-new-notebook-submit"
                className="min-h-11 rounded-md bg-[#111111] text-white px-3.5 text-xs font-medium disabled:opacity-40 hover:bg-[#333333] transition-colors"
              >
                + Promote
              </button>
            </form>
          </div>
        )}

        {/* Attached Sessions Section */}
        <div className="space-y-2 border-t border-[#EAEAEA] dark:border-zinc-800 pt-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#787774]">
              Attached Sessions
            </span>
            <span className="font-mono text-[11px] text-[#787774]">
              {summary.publicSessions} of {noteSessions.length} shared
            </span>
          </div>

          {localSessions.length === 0 ? (
            <p className="text-xs text-[#787774]">
              No recorded Sessions yet. Sessions stay private unless opted in.
            </p>
          ) : (
            <ul className="max-h-44 overflow-y-auto divide-y divide-[#EAEAEA] dark:divide-zinc-800 rounded-lg border border-[#EAEAEA] dark:border-zinc-800">
              {localSessions.map((sess) => {
                const dateStr = new Date(sess.startTime || sess.createdAt).toLocaleDateString();
                const durSec = Math.round((sess.duration || 0) / 1000);
                return (
                  <li key={sess.id} className="flex items-center justify-between gap-2 min-h-11 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{dateStr}</div>
                      <div className="font-mono text-[10px] text-[#787774]">
                        {durSec}s · {sess.completed ? 'completed' : 'partial'}
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer shrink-0 min-h-9">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-[#111111]"
                        checked={sess.public === true}
                        disabled={busy}
                        onChange={(e) => void handleToggleSessionPublic(sess, e.target.checked)}
                        data-testid={`publication-session-toggle-${sess.id}`}
                      />
                      <span className="font-mono text-[10px] uppercase tracking-wider">
                        {sess.public ? 'Public' : 'Private'}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {!summary.notebookPublic && summary.publicSessions > 0 && (
            <p className="rounded-md bg-[#FBF3DB] text-[#956400] px-3 py-2 text-[11px]">
              Shared Sessions stay Private until at least one linked user Notebook is marked Public.
            </p>
          )}
        </div>

        {/* Outbound Publish / Export Actions */}
        {summary.notebookPublic && !isReadOnlyFeedNote && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#EAEAEA] dark:border-zinc-800 pt-4">
            {storageBackend === 'api' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handlePublishAction('server')}
                data-testid="publication-publish-server-btn"
                className="min-h-11 flex-1 rounded-md bg-[#111111] text-white text-xs font-medium px-4 hover:bg-[#333333] disabled:opacity-50 transition-colors"
              >
                Publish to Server Feed
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePublishAction('zip')}
                  data-testid="publication-export-repo-zip-btn"
                  className="min-h-11 flex-1 rounded-md bg-[#111111] text-white text-xs font-medium px-4 hover:bg-[#333333] disabled:opacity-50 transition-colors"
                >
                  Export Feed Repo (.zip)
                </button>
                {supportsDirectoryPicker() && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handlePublishAction('folder')}
                    data-testid="publication-export-repo-folder-btn"
                    className="min-h-11 rounded-md border border-[#EAEAEA] dark:border-zinc-800 px-3.5 text-xs font-medium hover:bg-[#F7F6F3] dark:hover:bg-zinc-900 disabled:opacity-50 transition-colors"
                  >
                    Folder
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
