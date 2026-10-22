import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import type { ScriptBlock } from '@/components/Editor/types';
import type { HistoryEntry } from '@/types/history';
import type { Session } from '@/types/storage';
import { journalNotes } from '../services/journalNotes';
import { playgroundRecorder, onResultSaved } from '@/services/resultRecorder';
import { storageService } from '@/services/storage';
import { FullscreenTimer } from '@/components/organisms/review/FullscreenTimer';
import { useSearchParams, Link, Navigate, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { v7 as uuidv7 } from 'uuid';
import { journalDatePath, noteByIdPath, runPath } from '../lib/routes';
import { formatDateKey } from '../services/dateUtils';
import { CreateJournalNoteDialog } from '../components/organisms/journal/CreateJournalNoteDialog';
import { clearParkedRun, findParkedRunByDate, parkRun, pendingRuntimes } from '../runtimeStore';
import { WorkbenchSessionProvider } from '@/stores/workbenchSessionStore';
import { ResponsiveActions } from '../nav/ResponsiveActions'
import { Button } from '@/components/atoms/primitives/button'
import { notePersistence } from '@/services/persistence';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import { sessionQueryInsert, sessionQueryWql } from '@bitcobblers/wod-wiki-ui/extensions';
import { useNotePageNav, wirePageIndexLinks } from './shared/useNotePageNav';
import { canGoBack, extractPageIndex, mapIndexToL3 } from './shared/pageUtils';
import type { NavItemL3 } from '../nav/navTypes';
import { useNav } from '../nav/NavContext';
import { SavedNoteEditor } from './shared/SavedNoteEditor';
import { captureRun, captureStoredRun, type CapturedRun } from '@/services/runCapture';
import type { ParkedRun, PendingRuntime } from '../runtimeStore';
import { sectionField } from '@bitcobblers/wod-wiki-ui/extensions';

import { JournalPageShell } from '@/panels/page-shells';
const journalContentProvider = new IndexedDBContentProvider();

interface JournalDatePageProps {
  journalDate: string;
  theme: string;
  onViewCreated?: (view: EditorView) => void;
}


export function JournalDatePage({ journalDate, theme, onViewCreated }: JournalDatePageProps) {
  const [notes, setNotes] = useState<HistoryEntry[] | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [isTimerOpen, setIsTimerOpen] = useState(false);
  const [timerBlock, setTimerBlock] = useState<ScriptBlock | null>(null);
  const [activeRuntimeId, setActiveRuntimeId] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  // A run that is still alive from a previous visit to this date: the user
  // navigated away mid-workout and the runtime was parked (not disposed),
  // so the clock kept running. Re-bound on return.
  const [parkedRun, setParkedRun] = useState<ParkedRun | null>(null);
  const parkedRunRef = useRef<ParkedRun | null>(null);
  parkedRunRef.current = parkedRun;
  // Identity of the run this surface owns (fresh or re-bound) — what gets
  // parked when the surface unmounts mid-workout.
  const runDescriptorRef = useRef<{ runtimeId: string; block: ScriptBlock; noteId: string; captured?: CapturedRun } | null>(null);
  const pendingRunRef = useRef<PendingRuntime | null>(null);
  const capturedRunRef = useRef<CapturedRun | null>(null);
  const noteRunStarts = useRef(new Map<string, (block: ScriptBlock, resultId: string) => Promise<CapturedRun>>());
  const [runError, setRunError] = useState<string | null>(null);
  const prepareRun = useCallback(async () => {
    // A re-bound run is already live and already captured — nothing to
    // prepare; the parked block is the run's block.
    const parked = parkedRunRef.current;
    if (parked) return parked.block;
    const pending = pendingRunRef.current;
    if (!pending || !activeRuntimeId) throw new Error('The pending workout is unavailable.');
    if (pending.captured) { capturedRunRef.current = pending.captured; return pending.captured.block; }
    if (!capturedRunRef.current) capturedRunRef.current = pending.snapshot
      ? await captureRun(pending.snapshot, pending.block, activeRuntimeId, pending.origin)
      : await captureStoredRun(pending.noteId, pending.block, activeRuntimeId, pending.origin);
    return capturedRunRef.current.block;
  }, [activeRuntimeId]);

  // Per-editor script blocks, keyed by note id — the shared state this
  // replaces let the last-mounted editor win, which mis-attributed Run
  // and completion to the wrong note on multi-note dates.
  const [blocksByNote, setBlocksByNote] = useState<Record<string, ScriptBlock[]>>({});
  const handleBlocksForNote = useCallback((noteId: string, nextBlocks: ScriptBlock[]) => {
    setBlocksByNote((prev) => (prev[noteId] === nextBlocks ? prev : { ...prev, [noteId]: nextBlocks }));
  }, []);
  const editorViewsRef = useRef<Map<string, EditorView>>(new Map());
  const editorViewRef = useRef<EditorView | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const handleViewCreatedForNote = useCallback((noteId: string, view: EditorView) => {
    editorViewsRef.current.set(noteId, view);
    if (!editorViewRef.current) {
      editorViewRef.current = view;
      setEditorView(view);
      onViewCreated?.(view);
    }
  }, [onViewCreated]);

  const selectedNoteId = searchParams.get('note');
  useEffect(() => {
    if (!selectedNoteId || !notes) return;
    const el = document.getElementById(`note-${selectedNoteId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedNoteId, notes]);
  // ponytail: depend on the search STRING, not the URLSearchParams object —
  // react-router v7 returns a fresh object identity per render, which would
  // re-run this effect (and its setSearchParams replace) every render.
  const searchKey = searchParams.toString();
  useEffect(() => {
    const autoStartId = new URLSearchParams(searchKey).get('autoStart');
    if (!autoStartId) return;
    const pending = pendingRuntimes.get(autoStartId);
    if (pending) {
      pendingRuntimes.delete(autoStartId);
      pendingRunRef.current = pending;
      capturedRunRef.current = null;
      runDescriptorRef.current = { runtimeId: autoStartId, block: pending.block, noteId: pending.noteId, captured: pending.captured };
      setTimerBlock(pending.block);
      setActiveRuntimeId(autoStartId);
      setActiveNoteId(pending.noteId);
      setIsTimerOpen(true);
    }
    setSearchParams((prev) => {
      prev.delete('autoStart');
      return prev;
    }, { replace: true });
  }, [searchKey, setSearchParams]);

  // Re-bind a run that is still alive for this date. The URL no longer
  // carries the run id (the autoStart param is stripped on first mount), so
  // the parked registry is the lookup: it holds the live runtime the
  // previous visit parked when the surface unmounted.
  useEffect(() => {
    if (isTimerOpen) return;
    const parked = findParkedRunByDate(journalDate);
    if (!parked) return;
    setParkedRun(parked);
    pendingRunRef.current = { block: parked.block, noteId: parked.noteId, captured: parked.captured };
    capturedRunRef.current = parked.captured ?? null;
    runDescriptorRef.current = { runtimeId: parked.runtimeId, block: parked.block, noteId: parked.noteId, captured: parked.captured };
    setTimerBlock(parked.block);
    setActiveRuntimeId(parked.runtimeId);
    setActiveNoteId(parked.noteId);
    setIsTimerOpen(true);
  }, [journalDate, isTimerOpen]);

  const handleNoteContentChange = useCallback((noteId: string, newContent: string) => {
    setNotes((prev) => prev?.map((n) => (n.id === noteId ? { ...n, rawContent: newContent } : n)) ?? prev);
  }, []);

  const handleCompleteWorkout = useCallback((_blockId: string, results: ScriptBlock['results'], editorResultId?: string, _editorRunBlock?: Pick<ScriptBlock, 'id' | 'contentId'>, _targetNoteId?: string): Promise<unknown> => {
    if (!results) return Promise.reject(new Error('This run produced no results to save.'));
    if (editorResultId) return Promise.resolve();
    const captured = capturedRunRef.current;
    if (!captured) return Promise.reject(new Error('The saved run pin is unavailable.'));
    // The run is over — it must not be re-bound on the next visit.
    clearParkedRun(captured.session.id);
    const resultId = captured.session.id;
    const view = editorViewsRef.current.get(captured.session.noteId);
    if (view && !view.state.doc.toString().includes(sessionQueryWql(resultId))) {
      const insert = sessionQueryInsert(view.state, captured.session.blockId, resultId);
      if (insert) view.dispatch({ changes: insert });
    }
    return playgroundRecorder.record({ blockId: captured.session.blockId, noteId: captured.session.noteId, resultId, data: results, createdAt: results.endTime });
  }, []);

  useEffect(() => {
    let cancelled = false;
    journalNotes.listByDate(journalDate).then((entries) => {
      if (cancelled) return;
      setNotes(entries);
    }).catch(() => {
      if (!cancelled) setNotes([]);
    });
    return () => { cancelled = true; };
  }, [journalDate]);

  // ── Per-date navigation: journal stream back (state intact) + day stepping
  const isDateKey = /^\d{4}-\d{2}-\d{2}$/.test(journalDate);
  const prevNext = useMemo(() => {
    if (!isDateKey) return null;
    const [y, m, d] = journalDate.split('-').map(Number) as [number, number, number];
    return {
      prev: formatDateKey(new Date(y, m - 1, d - 1)),
      next: formatDateKey(new Date(y, m - 1, d + 1)),
    };
  }, [journalDate, isDateKey]);

  // ── L3 outline: full per-note outline with Run + badges for single-note
  // dates; grouped per-note outline (one entry per note card) otherwise.
  const { setL3Items } = useNav();
  // Result badges per note (keyed like blocks). Stable ids key the fetch so
  // content edits don't re-query.
  const [resultsByNote, setResultsByNote] = useState<Record<string, Session[]>>({});
  const noteIdsKey = notes?.map((n) => n.id).join('|') ?? '';
  const noteIds = useMemo(() => (noteIdsKey ? noteIdsKey.split('|') : []), [noteIdsKey]);
  useEffect(() => {
    if (noteIds.length === 0) return;
    let cancelled = false;
    for (const id of noteIds) {
      storageService.getSessionsForNote(id).then((rows) => {
        if (!cancelled) setResultsByNote((prev) => ({ ...prev, [id]: rows }));
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [noteIds]);
  useEffect(() => onResultSaved((saved) => {
    storageService.getSessionsForNote(saved.noteId).then((rows) => {
      setResultsByNote((prev) => ({ ...prev, [saved.noteId]: rows }));
    }).catch(() => {});
  }), []);
  const singleNote = notes !== null && notes.length === 1 ? notes[0] : null;
  const results = singleNote ? resultsByNote[singleNote.id] : undefined;

  const startOutlineRun = useCallback(async (noteId: string, block: ScriptBlock) => {
    try {
      const start = noteRunStarts.current.get(noteId);
      if (!start) throw new Error('The saved note editor is unavailable.');
      const runtimeId = uuidv7();
      const captured = await start(block, runtimeId);
      pendingRuntimes.set(runtimeId, { noteId, block: captured.block, captured, returnTo: journalDatePath(journalDate) });
      navigate(runPath(runtimeId));
    } catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
  }, [journalDate, navigate]);
  const handleOutlineRun = useCallback((block: ScriptBlock) => {
    if (singleNote) void startOutlineRun(singleNote.id, block);
  }, [singleNote, startOutlineRun]);

  useNotePageNav({
    content: singleNote?.rawContent ?? '',
    scriptBlocks: singleNote ? (blocksByNote[singleNote.id] ?? []) : [],
    onStartWorkout: handleOutlineRun,
    results,
  });

  // Multi-note outline: real per-note entries (headings + fences) with Run
  // wired to THAT note's blocks. Entry ids are prefixed with the note-card
  // DOM id (`note-<uuid>:…`) so the scroll fallback lands on the right
  // note's card; Run secondary navigates with the per-note closure.
  const handleOutlineRunFor = useCallback((noteId: string) => (block: ScriptBlock) => { void startOutlineRun(noteId, block); }, [startOutlineRun]);

  const groupedL3 = useMemo(() => {
    if (!notes || notes.length <= 1) return [];
    const items: NavItemL3[] = [];
    for (const note of notes) {
      const labelPrefix = note.title || 'Untitled note';
      const wired = wirePageIndexLinks(
        extractPageIndex(note.rawContent),
        blocksByNote[note.id] ?? [],
        handleOutlineRunFor(note.id),
        resultsByNote[note.id],
      );
      for (const link of wired) {
        items.push(...mapIndexToL3([{ ...link, id: `note-${note.id}:${link.id}`, label: `${labelPrefix} · ${link.label}` }]));
      }
    }
    return items;
  }, [notes, blocksByNote, resultsByNote, handleOutlineRunFor]);
  // Publish-on-mount / clear-on-unmount, guarded so the single-note outline
  // published by useNotePageNav is never clobbered on transitions (destroy
  // phase runs before create phase, so the flag keeps clear/create paired).
  const publishedGroupedRef = useRef(false);
  useEffect(() => {
    if (groupedL3.length === 0) return;
    publishedGroupedRef.current = true;
    setL3Items(groupedL3);
    return () => {
      if (publishedGroupedRef.current) {
        publishedGroupedRef.current = false;
        setL3Items([]);
      }
    };
  }, [groupedL3, setL3Items]);

  if (!notes) return <div className="flex-1 flex items-center justify-center text-zinc-400">Loading…</div>;

  // Legacy deep links: /journal/:date?note=<uuid> now opens the canonical
  // single-note editor (#link-crosswalk).
  if (selectedNoteId) {
    return <Navigate to={noteByIdPath(selectedNoteId)} replace />;
  }


  const handleCreated = (created: HistoryEntry) => {
    journalNotes.listByDate(journalDate).then(setNotes).catch(() => {});
    navigate(noteByIdPath(created.id));
  };

  return (
    <WorkbenchSessionProvider notePersistence={notePersistence} provider={journalContentProvider}>
      <JournalPageShell
          title={journalDate}
          subtitle={`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
          actions={
            <ResponsiveActions
              primary={
                <Button type="button" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4 mr-1.5" aria-hidden="true" />
                  New note
                </Button>
              }
            />
          }
          editor={
        <div className="flex flex-col gap-8 px-4 py-6 sm:px-6">
          {runError && <p role="alert">Workout not started. {runError} Your draft is kept.</p>}
          <nav aria-label="Journal navigation" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => (canGoBack() ? navigate(-1) : navigate('/journal'))}
              className="rounded-pill border border-border px-2 py-0.5 hover:bg-accent hover:text-foreground transition-colors"
            >
              ‹ Journal
            </button>
            {prevNext && (
              <span className="flex items-center gap-2">
                <Link to={journalDatePath(prevNext.prev)} aria-label="Previous day" className="hover:bg-accent hover:text-foreground rounded-pill border border-border px-2 py-0.5 transition-colors">
                  ‹ {prevNext.prev}
                </Link>
                <span className="font-semibold text-foreground">{journalDate}</span>
                <Link to={journalDatePath(prevNext.next)} aria-label="Next day" className="hover:bg-accent hover:text-foreground rounded-pill border border-border px-2 py-0.5 transition-colors">
                  {prevNext.next} ›
                </Link>
              </span>
            )}
          </nav>
          {notes.length > 1 && (
            <nav aria-label="Notes on this date" className="flex flex-wrap gap-2">
              {notes.map((note) => (
                <Link
                  key={note.id}
                  to={noteByIdPath(note.id)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  {note.title}
                </Link>
              ))}
            </nav>
          )}
          {notes.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-6">
              <p className="text-sm text-muted-foreground">No Notes on this date yet.</p>
              <Button type="button" size="lg" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4 mr-1.5" aria-hidden="true" />
                Create a note
              </Button>
            </div>
          ) : notes.length === 1 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <Link
                  to={noteByIdPath(notes[0].id)}
                  className="text-sm font-semibold hover:underline text-foreground"
                  aria-label={`Open note page for ${notes[0].title || 'untitled note'}`}
                >
                  {notes[0].title || 'Untitled note'}
                </Link>
              </div>
              <SavedNoteEditor
                key={notes[0].id}
                entry={notes[0]}
                registerRun={start => { if (start) noteRunStarts.current.set(notes[0].id, start); else noteRunStarts.current.delete(notes[0].id); }}
                onChange={(val) => handleNoteContentChange(notes[0].id, val)}
                readonly={false}
                theme={theme}
                showLineNumbers={false}
                onBlocksChange={(blks) => handleBlocksForNote(notes[0].id, blks)}
                onCompleteWorkout={(bId, res, resId, runB) => handleCompleteWorkout(bId, res, resId, runB, notes[0].id)}
                onViewCreated={(view) => handleViewCreatedForNote(notes[0].id, view)}
              />
            </div>
          ) : (
            <div className="space-y-6">
              {notes.map((note, index) => (
                <div key={note.id} id={`note-${note.id}`} className="rounded-lg border border-border/60 p-4 space-y-2">
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <Link
                      to={noteByIdPath(note.id)}
                      className="text-sm font-semibold hover:underline text-foreground"
                    >
                      {note.title || `Note ${index + 1}`}
                    </Link>
                  </div>
                  <SavedNoteEditor
                    entry={note}
                    registerRun={start => { if (start) noteRunStarts.current.set(note.id, start); else noteRunStarts.current.delete(note.id); }}
                    onChange={(val) => handleNoteContentChange(note.id, val)}
                    readonly={false}
                    theme={theme}
                    showLineNumbers={false}
                    onBlocksChange={(blks) => handleBlocksForNote(note.id, blks)}
                    onCompleteWorkout={(bId, res, resId, runB) => handleCompleteWorkout(bId, res, resId, runB, note.id)}
                    onViewCreated={(view) => handleViewCreatedForNote(note.id, view)}
                  />
                </div>
              ))}
            </div>
          )}
      </div>
          }
      />
      <CreateJournalNoteDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDate={journalDate}
        onCreated={handleCreated}
      />
      {isTimerOpen && timerBlock && (
        <FullscreenTimer
          block={timerBlock}
          prepareRun={prepareRun}
          onClose={() => {
            setIsTimerOpen(false);
            setActiveRuntimeId(null);
            setActiveNoteId(null);
            setParkedRun(null);
            const descriptor = runDescriptorRef.current;
            if (descriptor) clearParkedRun(descriptor.runtimeId);
            runDescriptorRef.current = null;
          }}
          resultId={activeRuntimeId ?? undefined}
          onCompleteWorkout={(blockId, results) => handleCompleteWorkout(blockId, results)}
          autoStart
          adoptRuntime={parkedRun?.runtime ?? null}
          parkOnUnmount
          onPark={(runtime) => {
            // The surface went away with the run still live — park it so
            // the next visit re-binds the SAME runtime (clock keeps running).
            const descriptor = runDescriptorRef.current;
            if (!descriptor) return;
            const next: ParkedRun = {
              runtimeId: descriptor.runtimeId,
              block: descriptor.block,
              noteId: descriptor.noteId,
              captured: descriptor.captured,
              runtime,
              journalDate,
            };
            parkRun(next);
            setParkedRun(next);
          }}
        />
      )}
    </WorkbenchSessionProvider>
  );
}
