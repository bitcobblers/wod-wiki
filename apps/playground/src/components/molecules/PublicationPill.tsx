import { useCallback, useEffect, useState } from 'react';
import { Globe, Lock, Database, Share2, Download, FolderOutput, Loader2 } from 'lucide-react';
import {
  derivePublicationVisibility,
  getNotePublicationSummary,
  setNotebookPublic,
  setSessionPublic,
  type PublicationVisibility,
  type PublicationVisibilitySummary,
} from '@bitcobblers/wod-wiki-engine';
import type { Session } from '@/types/storage';
import { storage, storageBackend, whenStorageReady } from '@/hooks/useBrowserServices';
import {
  exportFeedRepositoryToDirectory,
  exportFeedRepositoryZip,
  publishSelfHostedFeed,
  supportsDirectoryPicker,
} from '@/hooks/useWorkbenchServices';
import { Button } from '@/components/atoms/primitives/button';
import { toast } from '@/hooks/use-toast';

export interface PublicationPillProps {
  noteId: string;
  notebookId?: string;
  sessions?: readonly Session[];
  isReadOnlyFeedNote?: boolean;
  onChanged?: () => void;
}

const PILL_STYLES: Record<PublicationVisibility, string> = {
  Private:
    'border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted',
  'Published Note':
    'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20',
  'Published Note + Data':
    'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400 hover:bg-sky-500/20',
};

export function PublicationPill({
  noteId,
  notebookId: propNotebookId,
  sessions: externalSessions,
  isReadOnlyFeedNote = false,
  onChanged,
}: PublicationPillProps) {
  const [summary, setSummary] = useState<PublicationVisibilitySummary>(() =>
    derivePublicationVisibility({
      notebookPublic: false,
      publicSessions: 0,
      totalSessions: 0,
      notebookId: propNotebookId ?? 'notebook/journal',
    }),
  );
  const [noteSessions, setNoteSessions] = useState<Session[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      await whenStorageReady();
      const [nextSummary, loadedSessions] = await Promise.all([
        getNotePublicationSummary(storage, noteId),
        externalSessions
          ? Promise.resolve([...externalSessions])
          : storage
              .readonly('sessions')
              .getAllFromIndex('by-note', noteId)
              .catch(async () => (await storage.readonly('sessions').getAll()).filter((s) => s.noteId === noteId)),
      ]);
      setSummary(nextSummary);
      setNoteSessions(loadedSessions);
    } catch {
      // Ignore transient uninitialized storage during cold mount
    }
  }, [noteId, externalSessions]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggleNotebookPublic = async (nextPublic: boolean) => {
    if (!summary.notebookId || busy || isReadOnlyFeedNote) return;
    const prevSummary = summary;
    setSummary(
      derivePublicationVisibility({
        notebookPublic: nextPublic,
        publicSessions: summary.publicSessions,
        totalSessions: summary.totalSessions,
        notebookId: summary.notebookId,
      }),
    );
    setBusy(true);
    try {
      await whenStorageReady();
      await setNotebookPublic(storage, summary.notebookId, nextPublic);
      await refresh();
      onChanged?.();
      toast({
        title: nextPublic ? 'Notebook marked Public' : 'Notebook marked Private',
        description: nextPublic
          ? 'Notes in this notebook will be included when you publish or export your Feed.'
          : 'This notebook is now private and excluded from your published Feed.',
      });
    } catch (err) {
      setSummary(prevSummary);
      toast({
        title: 'Could not update notebook visibility',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSessionPublic = async (session: Session, nextPublic: boolean) => {
    if (busy) return;
    const prevSessions = noteSessions;
    const prevSummary = summary;
    const nextSessions = noteSessions.map((s) => (s.id === session.id ? { ...s, public: nextPublic } : s));
    const nextPubCount = nextSessions.filter((s) => s.public === true).length;
    setNoteSessions(nextSessions);
    setSummary(
      derivePublicationVisibility({
        notebookPublic: summary.notebookPublic,
        publicSessions: nextPubCount,
        totalSessions: nextSessions.length,
        notebookId: summary.notebookId,
      }),
    );
    setBusy(true);
    try {
      await whenStorageReady();
      await setSessionPublic(storage, session.id, nextPublic);
      await refresh();
      onChanged?.();
    } catch (err) {
      setNoteSessions(prevSessions);
      setSummary(prevSummary);
      toast({
        title: 'Could not update session visibility',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePublishAction = async (target: 'server' | 'zip' | 'folder') => {
    if (busy) return;
    setBusy(true);
    try {
      if (target === 'server') {
        const res = await publishSelfHostedFeed();
        toast({
          title: `Published Feed v${res.report.manifest.version}`,
          description: `${res.report.totalNotes} note(s) and ${res.report.totalPublicSessions} session(s) live at ${res.feedUrl}`,
        });
      } else if (target === 'folder') {
        const report = await exportFeedRepositoryToDirectory();
        if (report) {
          toast({
            title: 'Exported wod-wiki-feed-repository to folder',
            description: `${report.totalNotes} note(s) and ${report.totalPublicSessions} session(s) written.`,
          });
        }
      } else {
        const report = await exportFeedRepositoryZip();
        toast({
          title: 'Downloaded wod-wiki-feed-repository.zip',
          description: `${report.totalNotes} note(s) and ${report.totalPublicSessions} session(s) packaged.`,
        });
      }
    } catch (err) {
      toast({
        title: 'Feed publish failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const Icon =
    summary.visibility === 'Private'
      ? Lock
      : summary.visibility === 'Published Note + Data'
        ? Database
        : Globe;

  const label =
    summary.visibility === 'Published Note + Data'
      ? `Published Note + Data (${summary.publicSessions})`
      : summary.visibility;

  const nbLabel = summary.notebookId ? summary.notebookId.replace(/^notebook\//, '') : 'journal';

  return (
    <details className="relative inline-block" data-testid="publication-pill-details">
      <summary
        data-testid="publication-pill"
        data-visibility={summary.visibility}
        className={`inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors [&::-webkit-details-marker]:hidden ${PILL_STYLES[summary.visibility]}`}
      >
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </summary>

      <div
        className="absolute left-0 z-30 mt-1.5 w-80 max-w-[90vw] rounded-xl border border-border bg-card p-3.5 text-xs shadow-lg space-y-3"
        data-testid="publication-pill-popover"
      >
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-foreground">Publication Visibility</span>
            <span className="font-mono text-[10px] text-muted-foreground">notebook/{nbLabel}</span>
          </div>
          {isReadOnlyFeedNote ? (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              This note belongs to a subscribed upstream Feed notebook (read-only). Clone it into one of your own notebooks to edit or publish it in your Feed.
            </p>
          ) : (
            <label className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2 cursor-pointer">
              <div>
                <div className="font-medium text-foreground">Public Notebook</div>
                <div className="text-[10px] text-muted-foreground">
                  Share notes in <code>{nbLabel}</code> to your Feed
                </div>
              </div>
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={summary.notebookPublic}
                disabled={busy || !summary.notebookId}
                onChange={(e) => void handleToggleNotebookPublic(e.target.checked)}
                data-testid="publication-notebook-public-toggle"
              />
            </label>
          )}
        </div>

        <div className="space-y-1.5 border-t border-border/60 pt-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">Sessions on this Note</span>
            <span className="text-[10px] text-muted-foreground">
              {summary.publicSessions} of {noteSessions.length} public
            </span>
          </div>
          {noteSessions.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No recorded sessions yet. Sessions stay private unless individually opted in.
            </p>
          ) : (
            <ul className="max-h-40 overflow-y-auto divide-y divide-border/50 rounded-lg border border-border/60">
              {noteSessions.map((sess) => {
                const dateStr = new Date(sess.startTime || sess.createdAt).toLocaleDateString();
                const durSec = Math.round((sess.duration || 0) / 1000);
                return (
                  <li key={sess.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{dateStr}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {durSec}s · {sess.completed ? 'completed' : 'partial'}
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-[11px] cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-primary"
                        checked={sess.public === true}
                        disabled={busy}
                        onChange={(e) => void handleToggleSessionPublic(sess, e.target.checked)}
                        data-testid={`publication-session-toggle-${sess.id}`}
                      />
                      <span>{sess.public ? 'Public' : 'Private'}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {!summary.notebookPublic && summary.publicSessions > 0 && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              Opted-in sessions remain Private until the owning notebook is marked Public.
            </p>
          )}
        </div>

        {summary.notebookPublic && !isReadOnlyFeedNote && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
            {storageBackend === 'api' ? (
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5 flex-1"
                disabled={busy}
                onClick={() => void handlePublishAction('server')}
                data-testid="publication-publish-server-btn"
              >
                {busy ? <Loader2 className="size-3 animate-spin" /> : <Share2 className="size-3" />}
                <span>Publish to Server Feed</span>
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 flex-1"
                  disabled={busy}
                  onClick={() => void handlePublishAction('zip')}
                  data-testid="publication-export-repo-zip-btn"
                >
                  {busy ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                  <span>Export Feed Repo (.zip)</span>
                </Button>
                {supportsDirectoryPicker() && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    disabled={busy}
                    onClick={() => void handlePublishAction('folder')}
                    data-testid="publication-export-repo-folder-btn"
                  >
                    <FolderOutput className="size-3" />
                    <span>Folder</span>
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
