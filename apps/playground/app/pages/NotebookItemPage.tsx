/**
 * NotebookItemPage — /notebook/:slug/:itemDate/:item
 *
 * Renders a single dated notebook item in the JournalPageShell.
 * Content is read-only at source (build-time), but local edits are
 * saved to playgroundContent under `notebook/{slug}/{date}/{item}` so
 * scratch edits are preserved across sessions.
 * Action bar exposes:
 *   - Add to Today   → appends the wod block to today's journal
 *   - Plan for date  → appends to a specific date's journal (calendar picker)
 *   - Run Now        → adopts to today's journal + navigates to start timer
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { v7 as uuidv7 } from 'uuid';
import { EditorView } from '@codemirror/view';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { JournalPageShell } from '@/panels/page-shells';
import type { ScriptBlock } from '@/components/Editor/types';
import { CalendarCard } from '@/components/atoms/CalendarCard';
import { EditorDialog } from '@bitcobblers/wod-wiki-ui';
import { Button } from '@bitcobblers/wod-wiki-ui/primitives';
import { toNotebookId } from '@bitcobblers/wod-wiki-core';
import { parseRemoteNoteId } from '@bitcobblers/wod-wiki-engine';
import { notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql';
import { buildScriptNotebooks, findNotebookItem } from '@/repositories/script-notebooks';
import { useSeedContent } from '@/services/content/seedContent';
import { storageService } from '@/services/storage';
import { onResultSaved } from '@/services/resultRecorder';
import { captureRun, captureStoredRun } from '@/services/runCapture';
import type { Note, Session } from '@/types/storage';
import {
  ForkToMyNotesDialog,
  OwnershipPillBadge,
  WorkoutSessionsList,
  resolveOwnershipPresentation,
} from '@/components/molecules/PublicationPill';
import {
  lookupRemoteRecord,
  playgroundFeedCatalogStore,
  resolveRemoteWorkout,
  type ResolvedRemoteWorkout,
} from '@/services/feed/feedCatalog';
import { usePlaygroundContent } from '../hooks/usePlaygroundContent';
import { createJournalNoteFromWorkout } from '../services/journalWorkout';
import { pendingRuntimes } from '../runtimeStore';
import { dayPath, notePath, runPath } from '../lib/routes';
import { GitFork, Play, RefreshCw } from 'lucide-react';
import { useNotePageNav } from './shared/useNotePageNav';
import {
  NoteContextNav,
  noteOwnership,
  useNoteContextLinks,
} from './shared/noteContextLinks';
import { useScriptBlockCommands } from '../hooks/useScriptBlockCommands';
import { shareBlock, openBlockInPlayground } from '../services/openInPlayground';
import { PageActions } from './shared/PageActions';
import { useNav } from '../nav/NavContext';
import { ResponsiveActions } from '../nav/ResponsiveActions';
import { toast } from '@/hooks/use-toast';
import { localDateKey } from '@/lib/dateFormat';

export interface NotebookItemPageProps {
  slug: string;
  itemDate: string;
  item: string;
  theme: string;
  onViewCreated?: (view: EditorView) => void;
  onScrollToSection?: (id: string) => void;
}

export function NotebookItemPage({
  slug,
  itemDate,
  item,
  theme,
  onViewCreated,
}: NotebookItemPageProps) {
  const navigate = useNavigate();
  const { openPeek, closePeek } = useNav();
  const [searchParams] = useSearchParams();
  const feedParam = searchParams.get('feed') ?? undefined;
  const remoteParam = searchParams.get('remote') ?? undefined;

  const files = useSeedContent();
  const [storedNote, setStoredNote] = useState<Note | null>(null);
  const [resolvedRemote, setResolvedRemote] = useState<ResolvedRemoteWorkout | null>(null);
  const [resolvingNote, setResolvingNote] = useState(true);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteRetryTick, setRemoteRetryTick] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [forkOpen, setForkOpen] = useState(false);

  const notebookItem = useMemo(() => {
    if (storedNote) {
      return { id: item, name: storedNote.title || item, content: storedNote.rawContent, date: itemDate };
    }
    if (!files) return undefined;
    return findNotebookItem(buildScriptNotebooks(files).find((n) => n.id === slug), itemDate, item);
  }, [storedNote, files, slug, itemDate, item]);

  useEffect(() => {
    let cancelled = false;
    setResolvingNote(true);
    setStoredNote(null);
    setResolvedRemote(null);
    setRemoteError(null);
    const targetSourceId = `notebook:${slug}/${itemDate}/${item}`;
    const resolveLocalOrRemote = async () => {
      try {
        const decodedItem = (() => {
          try { return decodeURIComponent(item); } catch { return item; }
        })();
        const itemLower = decodedItem.toLowerCase();
        const itemSlug = itemLower.trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const nbId = toNotebookId(slug);
        const notes = await storageService.getAllNotes().catch(() => [] as Note[]);
        if (cancelled) return;
        const inNotebook = (n: Note): boolean =>
          n.notebookId === nbId ||
          Boolean(n.notebookIds?.includes(nbId)) ||
          (slug === 'journal' && (n.type === 'journal' || !n.notebookId));
        const found = notes.find(
          (n) =>
            (remoteParam && n.id === remoteParam) ||
            n.id === decodedItem ||
            n.sourceId === targetSourceId ||
            n.sourcePath?.includes(`${slug}/${itemDate}/${decodedItem}`) ||
            (inNotebook(n) && (
              n.title?.toLowerCase() === itemLower ||
              (itemSlug.length > 0 && n.title?.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === itemSlug)
            )),
        );
        if (found) {
          setStoredNote(found);
          setResolvedRemote(null);
          return;
        }
        const bundledMatch = files
          ? findNotebookItem(buildScriptNotebooks(files).find((n) => n.id === slug), itemDate, item)
          : undefined;
        if (bundledMatch) return;

        const remoteCandidates = await playgroundFeedCatalogStore
          .getRemoteNotebookNotes(slug, feedParam)
          .catch(() => [] as Note[]);
        if (cancelled) return;
        const matchedRemote = remoteCandidates.find((r) => {
          const parsed = parseRemoteNoteId(r.id);
          const uuid = parsed.isRemote ? parsed.uuid : r.id;
          return (
            (remoteParam && (uuid === remoteParam || r.id === remoteParam)) ||
            r.title.toLowerCase() === item.toLowerCase() ||
            r.sourceId?.toLowerCase().endsWith(`/${item.toLowerCase()}`) ||
            r.sourcePath?.toLowerCase().includes(`/${item.toLowerCase()}.`)
          );
        });
        const locator =
          remoteParam && feedParam
            ? `remote:${feedParam}:${remoteParam}`
            : matchedRemote
              ? matchedRemote.id
              : remoteParam;
        if (!locator) return;

        setRemoteLoading(true);
        try {
          const res = await resolveRemoteWorkout(locator, {
            storage: storageService.storage,
            ...(feedParam ? { feedId: feedParam } : {}),
          });
          if (cancelled) return;
          if (!res) {
            setRemoteError('This workout could not be fetched from its feed.');
          } else {
            setResolvedRemote(res);
            setStoredNote(res.note);
          }
        } catch (err) {
          if (!cancelled) {
            setRemoteError(err instanceof Error ? err.message : 'Unable to fetch workout from feed.');
          }
        } finally {
          if (!cancelled) setRemoteLoading(false);
        }
      } finally {
        if (!cancelled) setResolvingNote(false);
      }
    };
    void resolveLocalOrRemote();
    return () => {
      cancelled = true;
    };
  }, [slug, itemDate, item, files, feedParam, remoteParam, remoteRetryTick]);

  const playgroundCategory = `notebook/${slug}/${itemDate}`;
  const { content, loading: contentLoading, noteBlocks, sourceRevision } = usePlaygroundContent({
    category: playgroundCategory,
    name: item,
    mdContent: resolvedRemote?.note.rawContent ?? notebookItem?.content ?? '',
    seedOnMount: false,
  });

  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([])
  const noteId = `notebook/${slug}/${itemDate}/${item}`;
  const canonicalNoteId = resolvedRemote?.canonicalNoteId ?? storedNote?.id ?? noteId;
  const runTargetId = resolvedRemote?.remoteNoteId ?? canonicalNoteId;
  const effectiveContent = resolvedRemote?.note.rawContent ?? storedNote?.rawContent ?? content;
  const effectiveBlocks = resolvedRemote?.note.blocks ?? storedNote?.blocks ?? noteBlocks;
  const effectiveRevision = resolvedRemote?.note.sourceRevision ?? storedNote?.sourceRevision ?? sourceRevision;
  const displayTitle = resolvedRemote?.note.title || notebookItem?.name || item;

  useEffect(() => {
    setSessions([]);
    const refresh = () => {
      void storageService.getSessionsForNote(canonicalNoteId).then(setSessions).catch(() => {});
    };
    refresh();
    const unsub = onResultSaved((saved) => {
      if (saved.noteId === canonicalNoteId) refresh();
    });
    return () => {
      unsub();
    };
  }, [canonicalNoteId]);

  const ownershipMeta = useMemo(() => {
    const stub = resolvedRemote?.note ?? storedNote;
    return resolveOwnershipPresentation(stub, {
      noteId: runTargetId,
      notebookOrigin: stub ? notebookOriginOfItem(stub) : feedParam ? 'feed' : undefined,
      resolvedNotebookId: toNotebookId(slug),
      fallbackReadOnly: true,
    });
  }, [resolvedRemote?.note, storedNote, runTargetId, feedParam, slug]);

  const buildRemoteResolver = useCallback(
    () => async (id: string) => {
      const res = await resolveRemoteWorkout(id, {
        storage: storageService.storage,
        ...(feedParam ? { feedId: feedParam } : {}),
      }).catch(() => undefined);
      if (!res) return undefined;
      const meta = lookupRemoteRecord(id);
      return {
        ...(res.note ? { note: res.note } : {}),
        row: res.row,
        canonicalNoteId: res.canonicalNoteId,
        remoteNoteId: res.remoteNoteId,
        feedId: res.feedId,
        notebookSlug: meta?.notebookSlug ?? slug,
        record: meta?.record,
      };
    },
    [feedParam, slug],
  );

  const itemPath = `/notebook/${encodeURIComponent(slug)}/${itemDate}/${encodeURIComponent(item)}`;

  const handleStartWorkout = useCallback(
    async (block: ScriptBlock) => {
      try {
        const runtimeId = uuidv7();
        const resolveRemote = buildRemoteResolver();
        const noteExists = Boolean(storedNote || resolvedRemote);
        if (noteExists) {
          const captured = await captureStoredRun(runTargetId, block, runtimeId, 'journal', {
            resolveRemoteWorkout: resolveRemote,
          });
          const refreshed = await storageService.getNote(captured.note.id).catch(() => undefined);
          if (refreshed) setStoredNote(refreshed);
          pendingRuntimes.set(runtimeId, { block: captured.block, noteId: captured.note.id, captured, returnTo: itemPath });
          void navigate(runPath(captured.session.id));
          return;
        }
        const captured = await captureRun(
          {
            noteId: canonicalNoteId,
            rawContent: effectiveContent,
            blocks: effectiveBlocks,
            expectedSourceRevision: effectiveRevision,
            metadata: { title: displayTitle },
          },
          block,
          runtimeId,
          'journal',
          undefined,
          { deferPersist: true },
        );
        pendingRuntimes.set(runtimeId, { block: captured.block, noteId: captured.note.id, captured, returnTo: itemPath });
        void navigate(runPath(captured.session.id));
      } catch (error) {
        toast({ title: 'Workout not started', description: error instanceof Error ? error.message : 'Save failed. Your draft is kept.', variant: 'destructive' });
      }
    },
    [buildRemoteResolver, storedNote, resolvedRemote, runTargetId, canonicalNoteId, effectiveContent, effectiveBlocks, effectiveRevision, displayTitle, itemPath, navigate],
  );

  const handleAddToToday = useCallback(async (block: ScriptBlock) => {
    try {
      const journalNote = await createJournalNoteFromWorkout({
        workoutName: displayTitle,
        category: slug,
        sourceNoteId: runTargetId,
        sourceNoteLabel: ownershipMeta.feedLabel ?? slug,
        sourceNotePath: itemPath,
        wodContent: block.content,
        resolveRemoteWorkout: buildRemoteResolver(),
      });
      const today = localDateKey(new Date());
      toast({
        title: 'Added to journal',
        description: journalNote.journalDate === today ? `Added to today's journal` : `Added to ${journalNote.journalDate}`,
        action: {
          label: 'Open',
          onAction: () => navigate(dayPath(journalNote.journalDate ?? today)),
        },
      });
    } catch {
      toast({ title: 'Error', description: 'Could not add to journal', variant: 'destructive' });
    }
  }, [slug, displayTitle, itemPath, runTargetId, ownershipMeta.feedLabel, buildRemoteResolver, navigate]);

  const [pendingScheduleBlock, setPendingScheduleBlock] = useState<ScriptBlock | null>(null);

  const handleScheduleBlock = useCallback(async (block: ScriptBlock, date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;
    try {
      await createJournalNoteFromWorkout({
        workoutName: displayTitle,
        category: slug,
        sourceNoteId: runTargetId,
        sourceNoteLabel: ownershipMeta.feedLabel ?? slug,
        sourceNotePath: itemPath,
        wodContent: block.content,
        date: date,
        resolveRemoteWorkout: buildRemoteResolver(),
      });
      void navigate(dayPath(dateKey));
      toast({
        title: 'Scheduled',
        description: `Added to journal for ${dateKey}`,
        action: {
          label: 'Open',
          onAction: () => navigate(dayPath(dateKey)),
        },
      });
    } catch {
      toast({ title: 'Error', description: 'Could not schedule workout', variant: 'destructive' });
    }
  }, [slug, displayTitle, itemPath, runTargetId, ownershipMeta.feedLabel, buildRemoteResolver, navigate]);

  // Whiteboard notebook-member L3: Add to today, Plan, Open in playground
  // after the outline — page-level shortcuts over the first runnable block
  // (each block keeps its own command bar). Index deps on scriptBlocks keep
  // the published closures fresh.
  const firstWodBlock = useMemo(
    () => scriptBlocks.find(b => b.dialect === 'time' || b.dialect === 'log') ?? null,
    [scriptBlocks],
  );
  const itemHelpfulActions = useMemo(() => {
    if (!firstWodBlock) return [];
    return [
      { id: 'add-to-today', label: 'Add to today', onRun: () => void handleAddToToday(firstWodBlock) },
      { id: 'plan', label: 'Plan for a date', onRun: () => setPendingScheduleBlock(firstWodBlock) },
      { id: 'open-in-playground', label: 'Open in playground', onRun: () => void openBlockInPlayground(firstWodBlock, navigate) },
    ];
  }, [firstWodBlock, handleAddToToday, navigate]);

  // Canonical corpus id (`notebook/<slug>/<date>/<item>`) drives ownership
  // and the block indexes. Notebook runs stamp the listing path as
  // sourceNote, so per-item journal-copy backlinks don't exist in the data.
  const corpusId = `notebook/${slug}/${itemDate}/${item}`;

  useNotePageNav({
    content: effectiveContent,
    scriptBlocks,
    onStartWorkout: (block) => {
      void handleStartWorkout(block);
    },
    noteId: corpusId,
    helpfulActions: itemHelpfulActions,
  });

  const ownership = useMemo(() => noteOwnership({ id: corpusId, type: 'note' }), [corpusId]);
  const contextData = useNoteContextLinks({
    noteId: corpusId,
    stamps: ownership.stamps,
    liveContent: effectiveContent,
    revision: effectiveRevision,
  });

  const commands = useScriptBlockCommands('notebook-readonly', {
    onPlay: (block) => {
      void handleStartWorkout(block);
    },
    onShare: shareBlock,
    onAddToToday: (block) => {
      void handleAddToToday(block);
    },
    onSchedule: setPendingScheduleBlock,
    onOpenInPlayground: (block) => {
      void openBlockInPlayground(block, navigate);
    },
  });

  const ownershipHeaderBar = (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <OwnershipPillBadge presentation={ownershipMeta} />
        <span className="text-xs text-muted-foreground">{ownershipMeta.guidanceCopy}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {firstWodBlock && (
          <Button
            type="button"
            size="sm"
            onClick={() => void handleStartWorkout(firstWodBlock)}
            className="h-8 gap-1.5 px-3 text-xs"
          >
            <Play className="size-3.5" aria-hidden="true" />
            Start / Log Workout
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setForkOpen(true)}
          className="h-8 gap-1.5 px-3 text-xs"
        >
          <GitFork className="size-3.5" aria-hidden="true" />
          Fork to My Notes
        </Button>
      </div>
    </div>
  );

  if (contentLoading || resolvingNote || remoteLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground" role="status">
        {remoteLoading ? 'Loading workout from feed…' : 'Loading…'}
      </div>
    );
  }

  if (remoteError || (!storedNote && !notebookItem && !resolvedRemote && !effectiveContent.trim())) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
        <p className="text-sm font-semibold text-foreground">Workout unavailable</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {remoteError ?? `Could not find "${item}" in notebook "${slug}".`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={() => setRemoteRetryTick(t => t + 1)} className="gap-1.5">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Retry
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/feeds')}>
            Browse feeds
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <JournalPageShell
        title={displayTitle}
        actions={
          <div className="flex items-center gap-2">
            <ResponsiveActions label="Workout actions" />
            <PageActions
              mode="notebook-readonly"
              currentWorkout={{ name: displayTitle, content: effectiveContent }}
              index={[]}
            />
          </div>
        }
        editor={
          <div className="flex flex-col gap-3 px-4 py-6 sm:px-6">
            <NoteContextNav data={contextData} up={ownership.up} peekMode onPeekEntity={openPeek} />
            {ownershipHeaderBar}
            <NoteEditor
              key={canonicalNoteId}
              readonly={true}
              value={effectiveContent}
              onChange={() => {}}
              noteId={canonicalNoteId}
              noteBlocks={effectiveBlocks}
              sourceRevision={effectiveRevision}
              commands={commands}
              enableInlineRuntime={false}
              onViewCreated={onViewCreated}
              theme={theme}
              showLineNumbers={false}
              onBlocksChange={setScriptBlocks}
              onPeekEntity={openPeek}
              onClosePeek={closePeek}
            />
            <WorkoutSessionsList sessions={sessions} />
          </div>
        }
      />
      <ForkToMyNotesDialog
        open={forkOpen}
        onOpenChange={setForkOpen}
        sourceNoteId={runTargetId}
        sourceTitle={displayTitle}
        storageInstance={storageService.storage}
        resolveRemoteWorkoutFn={buildRemoteResolver()}
        fallbackRemote={!storedNote && effectiveContent ? {
          title: displayTitle,
          content: effectiveContent,
          feedId: feedParam,
          notebookSlug: slug,
        } : undefined}
        onForked={(forked) => { void navigate(`${notePath(forked.id)}?edit=1`); }}
      />
      {pendingScheduleBlock && (
        <EditorDialog
          open
          onClose={() => setPendingScheduleBlock(null)}
          title="Schedule workout"
        >
            <CalendarCard
              selectedDate={null}
              onDateSelect={(date) => {
                void handleScheduleBlock(pendingScheduleBlock, date)
                setPendingScheduleBlock(null)
              }}
            />
        </EditorDialog>
      )}
    </>
  );
}
