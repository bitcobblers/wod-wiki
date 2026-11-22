import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import type { ScriptBlock } from '@/components/Editor/types';
import type { HistoryRecord } from '@/types/history';
import type { Session } from '@/types/storage';
import { journalNotes } from '../services/journalNotes';
import { journalSchedule, subscribeSchedule } from '../services/journalSchedule';
import { TEST_IDS } from '@/lib/testIds';
import type { JournalDayOverlay } from '@bitcobblers/wod-wiki-engine';
import { formatDurationMMSS } from '@bitcobblers/wod-wiki-core';
import { playgroundRecorder, onResultSaved } from '@/services/resultRecorder';
import { storageService } from '@/services/storage';
import { FullscreenTimer } from '@/components/organisms/review/FullscreenTimer';
import { useSearchParams, Link, Navigate, useNavigate } from 'react-router-dom';
import { Plus, Copy, CalendarDays, BookOpen, Dumbbell } from 'lucide-react';
import { v7 as uuidv7 } from 'uuid';
import { dayPath, notePath, runPath } from '../lib/routes';
import { formatDateKey } from '../services/dateUtils';
import { CreateJournalNoteDialog } from '../components/organisms/journal/CreateJournalNoteDialog';
import { CalendarCard } from '@/components/atoms/CalendarCard';
import { NoteContextNav, useJournalEntryDates } from './shared/noteContextLinks';
import { useNoteL1Zone } from '../nav/NavContext';
import { clearParkedRun, findParkedRunByDate, parkRun, pendingRuntimes, takeParkedRun } from '../runtimeStore';
import { ResponsiveActions } from '../nav/ResponsiveActions'
import { Button } from "@bitcobblers/wod-wiki-ui/primitives";
import { sessionQueryInsert, sessionQueryWql } from '@bitcobblers/wod-wiki-ui/extensions';
import { useNotePageNav, wirePageIndexLinks, type NoteHelpfulAction } from './shared/useNotePageNav';
import { buildNoteHelpfulActionsForEntry, useNoteActions } from './shared/useNoteActions';
import { NoteCardActions } from './shared/NoteCardActions';
import { PublicationPill } from '@/components/molecules/PublicationPill';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import { canGoBack, extractPageIndex, mapIndexToL3, appendTimerBlock } from './shared/pageUtils';
import type { NavItemL3 } from '../nav/navTypes';
import { useNav } from '../nav/NavContext';
import { SavedNoteEditor } from './shared/SavedNoteEditor';
import { captureRun, captureStoredRun, type CapturedRun } from '@/services/runCapture';
import type { ParkedRun, PendingRuntime } from '../runtimeStore';
import { reconcileNoteBlocks, KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core';
import { setSurfaceBusy } from '@/agent/surfaceBridges';
import { feedProgressLabel } from '@/services/feed/feedProgress';
import { useFeedSyncProgress } from '@/services/feed/feedReadiness';

import { JournalPageShell } from '@/panels/page-shells';

interface JournalDatePageProps {
  journalDate: string;
  theme: string;
  onViewCreated?: (view: EditorView) => void;
}


export function JournalDatePage({ journalDate, theme, onViewCreated }: JournalDatePageProps) {
  const [notes, setNotes] = useState<HistoryRecord[] | null>(null);
  const [dayOverlay, setDayOverlay] = useState<JournalDayOverlay | null>(null);
  const [overlayTick, setOverlayTick] = useState(0);
  useEffect(() => subscribeSchedule(() => setOverlayTick((t) => t + 1)), []);
  useEffect(() => onResultSaved(() => setOverlayTick((t) => t + 1)), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [createNoteMode, setCreateNoteMode] = useState<'write' | 'pick'>('write');
  const openCreateDialog = useCallback((mode: 'write' | 'pick' = 'write') => {
    setCreateNoteMode(mode);
    setCreateOpen(true);
  }, []);
  const [isTimerOpen, setIsTimerOpen] = useState(false);
  const [timerBlock, setTimerBlock] = useState<ScriptBlock | null>(null);
  const [activeRuntimeId, setActiveRuntimeId] = useState<string | null>(null);
  const [_activeNoteId, setActiveNoteId] = useState<string | null>(null);
  // A run that is still alive from a previous visit to this date: the user
  // navigated away mid-workout and the runtime was parked (not disposed),
  // so the clock kept running. Re-bound on return.
  const [parkedRun, setParkedRun] = useState<ParkedRun | null>(null);
  const parkedRunRef = useRef<ParkedRun | null>(null);
  parkedRunRef.current = parkedRun;
  // Identity of the run this surface owns (fresh or re-bound) — what gets
  // parked when the surface unmounts mid-workout.
  const runDescriptorRef = useRef<{ runtimeId: string; block: ScriptBlock; noteId: string; captured?: CapturedRun } | null>(null);
  // Set when the run is finished on purpose (closed or completed): the
  // surface unmounts, but the run must NOT be parked for a later re-bind.
  const discardRunRef = useRef(false);
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
      ? await captureRun(pending.snapshot, pending.block, activeRuntimeId, pending.origin, undefined, {
          deferPersist: true,
          ...(pending.scheduleItemId ? { scheduleItemId: pending.scheduleItemId } : {}),
          ...(pending.sessionDate ? { sessionDate: pending.sessionDate } : {}),
        })
      : await captureStoredRun(pending.noteId, pending.block, activeRuntimeId, pending.origin, {
          deferPersist: true,
          ...(pending.scheduleItemId ? { scheduleItemId: pending.scheduleItemId } : {}),
          ...(pending.sessionDate ? { sessionDate: pending.sessionDate } : {}),
        });
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
  const [_editorView, setEditorView] = useState<EditorView | null>(null);
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
      discardRunRef.current = false;
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
    setNotes((prev) => prev?.map((n) => (n.id === noteId && n.rawContent !== newContent
      ? { ...n, rawContent: newContent, blocks: reconcileNoteBlocks(newContent, { sourceRevision: Math.max(1, n.sourceRevision ?? 1), blocks: n.blocks, registeredWidgets: KNOWN_SECTION_WIDGETS }) }
      : n)) ?? prev);
  }, []);

  const handleCompleteWorkout = useCallback((_blockId: string, results: ScriptBlock['results'], editorResultId?: string, _editorRunBlock?: Pick<ScriptBlock, 'id' | 'contentId'>, _targetNoteId?: string): Promise<unknown> => {
    if (!results) return Promise.reject(new Error('This run produced no results to save.'));
    if (editorResultId) return Promise.resolve();
    const captured = capturedRunRef.current;
    if (!captured) return Promise.reject(new Error('The saved run pin is unavailable.'));
    // The run is over — it must not be re-bound on the next visit.
    discardRunRef.current = true;
    clearParkedRun(captured.session.id);
    const resultId = captured.session.id;
    const view = editorViewsRef.current.get(captured.session.noteId);
    if (view && !view.state.doc.toString().includes(sessionQueryWql(resultId))) {
      const insert = sessionQueryInsert(view.state, captured.session.blockId, resultId);
      if (insert) view.dispatch({ changes: insert });
    }
    return playgroundRecorder.record({ blockId: captured.session.blockId, noteId: captured.session.noteId, resultId, data: results, createdAt: results.endTime });
  }, []);

  const feedProgress = useFeedSyncProgress();
  const [slowLoad, setSlowLoad] = useState(false);

  const loadedDateRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (loadedDateRef.current !== journalDate) {
      loadedDateRef.current = journalDate;
      setNotes(null);
    }
    Promise.all([
      journalNotes.listByDate(journalDate),
      journalSchedule.getDayOverlay(journalDate).catch(() => null),
    ]).then(([entries, overlay]) => {
      if (cancelled) return;
      setNotes(entries);
      setDayOverlay(overlay);
    }).catch(() => {
      if (!cancelled) {
        setNotes([]);
        setDayOverlay(null);
      }
    });
    return () => { cancelled = true; };
  }, [journalDate, overlayTick]);

  useEffect(() => setSurfaceBusy(notes === null), [notes]);

  useEffect(() => {
    if (notes !== null) {
      setSlowLoad(false);
      return;
    }
    const timer = setTimeout(() => setSlowLoad(true), 3_000);
    return () => clearTimeout(timer);
  }, [notes]);

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
  const { setL3Items, setL3Actions } = useNav();
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
  const [actionTargetNote, setActionTargetNote] = useState<HistoryRecord | null>(null);
  const contentProvider = useMemo(() => new IndexedDBContentProvider(), []);
  const activeActionNote = singleNote ?? actionTargetNote;

  const noteActions = useNoteActions({
    entry: activeActionNote,
    isReadOnly: false,
    deleteRedirectTo: dayPath(journalDate),
    provider: contentProvider,
    onMutateContent: (note, nextContent) => handleNoteContentChange(note.id, nextContent),
    onUpdated: () => {
      journalNotes.listByDate(journalDate).then(setNotes).catch(() => {});
    },
    onDeleted: (deletedId) => {
      setActionTargetNote(null);
      setNotes((prev) => (prev ? prev.filter((n) => n.id !== deletedId) : prev));
    },
  });

  const buildCardActions = useCallback(
    (note: HistoryRecord): NoteHelpfulAction[] =>
      buildNoteHelpfulActionsForEntry({
        entry: note,
        liveContent: note.rawContent,
        isReadOnly: false,
        copied: noteActions.copied && activeActionNote?.id === note.id,
        deletingNote: noteActions.deletingNote && activeActionNote?.id === note.id,
        onMutateContent: (target, nextContent) => handleNoteContentChange(target.id, nextContent),
        onOpenPromotion: (target) => {
          setActionTargetNote(target);
          noteActions.setPromotionOpen(true);
        },
        onOpenPlacement: (target, mode) => {
          setActionTargetNote(target);
          noteActions.setPlacement(mode);
        },
        onCopyLink: (target) => {
          setActionTargetNote(target);
          noteActions.handleCopyLink(target);
        },
        onRequestDelete: (target) => {
          setActionTargetNote(target);
          noteActions.setConfirmDeleteOpen(true);
        },
        provider: contentProvider,
      }),
    [
      activeActionNote?.id,
      contentProvider,
      handleNoteContentChange,
      noteActions,
    ],
  );

  const startOutlineRun = useCallback(async (noteId: string, block: ScriptBlock, explicitScheduleItemId?: string) => {
    try {
      const start = noteRunStarts.current.get(noteId);
      if (!start) throw new Error('The saved note editor is unavailable.');
      const runtimeId = uuidv7();
      const matchedScheduleId =
        explicitScheduleItemId ??
        dayOverlay?.planned.find((p) => p.item.noteId === noteId && p.item.status === 'planned')?.item.id;
      const captured = await start(block, runtimeId);
      pendingRuntimes.set(runtimeId, {
        noteId,
        block: captured.block,
        captured,
        returnTo: dayPath(journalDate),
        ...(matchedScheduleId ? { scheduleItemId: matchedScheduleId } : {}),
        sessionDate: journalDate,
      });
      void navigate(runPath(runtimeId));
    } catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
  }, [journalDate, navigate, dayOverlay]);
  const handleOutlineRun = useCallback((block: ScriptBlock) => {
    if (singleNote) void startOutlineRun(singleNote.id, block);
  }, [singleNote, startOutlineRun]);

  useNotePageNav({
    content: singleNote?.rawContent ?? '',
    scriptBlocks: singleNote ? (blocksByNote[singleNote.id] ?? []) : [],
    onStartWorkout: handleOutlineRun,
    results,
    noteId: singleNote?.id,
    helpfulActions: singleNote ? noteActions.helpfulActions : [],
    enabled: Boolean(singleNote),
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

  const multiNoteFirst = notes && notes.length > 1 ? notes[0]! : null;
  // Publish-on-mount / clear-on-unmount, guarded so the single-note outline
  // published by useNotePageNav is never clobbered on transitions (destroy
  // phase runs before create phase, so the flag keeps clear/create paired).
  const publishedGroupedRef = useRef(false);
  useEffect(() => {
    if (!multiNoteFirst) return;
    publishedGroupedRef.current = true;
    setL3Items(groupedL3);
    setL3Actions?.([
      {
        id: 'helpful-add-timer',
        label: 'Add timer',
        onRun: () => handleNoteContentChange(multiNoteFirst.id, appendTimerBlock(multiNoteFirst.rawContent)),
      },
    ]);
    return () => {
      if (publishedGroupedRef.current) {
        publishedGroupedRef.current = false;
        setL3Items([]);
        setL3Actions?.([]);
      }
    };
  }, [groupedL3, multiNoteFirst, handleNoteContentChange, setL3Items, setL3Actions]);

  // Always publish L1 journal zone and L2 calendar context on /day/:date (even when empty).
  useNoteL1Zone('notebooks');
  const journalDates = useJournalEntryDates();
  const dayCalendar = useMemo(
    () =>
      isDateKey ? (
        <CalendarCard
          selectedDate={new Date(`${journalDate}T12:00:00`)}
          onDateSelect={(d) => navigate(dayPath(formatDateKey(d)))}
          entryDates={journalDates}
        />
      ) : undefined,
    [isDateKey, journalDate, journalDates, navigate],
  );

  // Day-level L3 Page Options when the date has 0 notes (note-level Delete/Clone/Export/Notebooks
  // stay on note cards and /note/:id).
  const isEmptyDay = notes !== null && notes.length === 0;
  const publishedEmptyDayRef = useRef(false);
  useEffect(() => {
    if (!isEmptyDay) return;
    publishedEmptyDayRef.current = true;
    setL3Items([]);
    setL3Actions?.([
      {
        id: 'day-add-note',
        label: 'Add note',
        icon: Plus,
        onRun: () => openCreateDialog('write'),
      },
      {
        id: 'day-pick-workout',
        label: 'Pick / Log workout',
        icon: Dumbbell,
        onRun: () => openCreateDialog('pick'),
      },
      {
        id: 'day-copy-link',
        label: 'Copy day link',
        icon: Copy,
        onRun: () => {
          const href = typeof window !== 'undefined'
            ? `${window.location.origin}${dayPath(journalDate)}`
            : dayPath(journalDate);
          void navigator.clipboard?.writeText(href).catch(() => undefined);
        },
      },
      {
        id: 'day-jump-today',
        label: 'Jump to today',
        icon: CalendarDays,
        onRun: () => navigate(dayPath(formatDateKey(new Date()))),
      },
      {
        id: 'day-open-journal',
        label: 'Open Journal',
        icon: BookOpen,
        onRun: () => navigate('/journal'),
      },
    ]);
    return () => {
      if (publishedEmptyDayRef.current) {
        publishedEmptyDayRef.current = false;
        setL3Items([]);
        setL3Actions?.([]);
      }
    };
  }, [isEmptyDay, journalDate, navigate, openCreateDialog, setL3Actions, setL3Items]);

  if (!notes) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex-1 flex flex-col items-center justify-center gap-1.5 p-8 text-muted-foreground"
      >
        <span className="text-sm">Loading…</span>
        {slowLoad && (
          <span className="text-xs" data-testid="journal-slow-loading-hint">
            {feedProgress
              ? feedProgressLabel(feedProgress)
              : 'Opening local journal index — large vaults may take a few seconds…'}
          </span>
        )}
      </div>
    );
  }

  // Deep links: /day/:date?note=<uuid> opens the canonical single-note editor.
  if (selectedNoteId) {
    return <Navigate to={notePath(selectedNoteId)} replace />;
  }


  const handleCreated = (created: HistoryRecord) => {
    journalNotes.listByDate(journalDate).then(setNotes).catch(() => {});
    void navigate(notePath(created.id));
  };

  return (
    <>
      <NoteContextNav
        data={{ efforts: [], related: [], backlinks: [] }}
        up={{ id: 'journal', title: 'Journal', to: '/journal' }}
        calendar={dayCalendar}
      />
      <JournalPageShell
          title={journalDate}
          subtitle={`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
          actions={
            <ResponsiveActions
              primary={
                <Button
                  type="button"
                  onClick={() => openCreateDialog('write')}
                  aria-label="+ Add note"
                  title="New note"
                >
                  <Plus className="size-4 mr-1.5" aria-hidden="true" />
                  + Add
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
                <Link to={dayPath(prevNext.prev)} aria-label="Previous day" className="hover:bg-accent hover:text-foreground rounded-pill border border-border px-2 py-0.5 transition-colors">
                  ‹ {prevNext.prev}
                </Link>
                <span className="font-semibold text-foreground">{journalDate}</span>
                <Link to={dayPath(prevNext.next)} aria-label="Next day" className="hover:bg-accent hover:text-foreground rounded-pill border border-border px-2 py-0.5 transition-colors">
                  {prevNext.next} ›
                </Link>
              </span>
            )}
          </nav>
          {dayOverlay && (dayOverlay.planned.length > 0 || dayOverlay.adhocSessions.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              {dayOverlay.planned.length > 0 && (
                <section
                  data-testid={TEST_IDS.DAY_SCHEDULED_SECTION}
                  aria-label="Scheduled workouts"
                  className="rounded-lg border border-border/60 bg-muted/20 p-3.5 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Scheduled Plans ({dayOverlay.planned.length})
                    </h2>
                  </div>
                  <ul className="space-y-2">
                    {dayOverlay.planned.map(({ item, note: planNote, pairedSessions }) => {
                      const done = item.status === 'completed' || pairedSessions.length > 0;
                      const skipped = item.status === 'skipped';
                      return (
                        <li
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-background px-3 py-2 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link to={notePath(item.noteId)} className="font-semibold text-foreground hover:underline truncate">
                                {planNote?.title || 'Untitled workout'}
                              </Link>
                              {item.slot && (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                                  {item.slot}
                                </span>
                              )}
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  done
                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                    : skipped
                                      ? 'bg-muted text-muted-foreground line-through'
                                      : 'bg-primary/10 text-primary'
                                }`}
                              >
                                {done ? 'Completed' : skipped ? 'Skipped' : 'Planned'}
                              </span>
                            </div>
                            {item.notes && <p className="mt-0.5 text-[11px] text-muted-foreground">{item.notes}</p>}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {!skipped && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void journalSchedule.updateItem(item.id, { status: 'skipped' })}
                                className="h-7 px-2 text-[11px]"
                              >
                                Skip
                              </Button>
                            )}
                            {skipped && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void journalSchedule.updateItem(item.id, { status: 'planned' })}
                                className="h-7 px-2 text-[11px]"
                              >
                                Restore
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => void journalSchedule.removeItem(item.id)}
                              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                            >
                              Unschedule
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {(dayOverlay.planned.some((p) => p.pairedSessions.length > 0) || dayOverlay.adhocSessions.length > 0) && (
                <section
                  data-testid={TEST_IDS.DAY_LOGGED_SECTION}
                  aria-label="Logged sessions"
                  className="rounded-lg border border-border/60 bg-muted/20 p-3.5 space-y-2.5"
                >
                  <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Logged Sessions
                  </h2>
                  <ul className="space-y-2">
                    {dayOverlay.planned.flatMap(({ item, note: planNote, pairedSessions }) =>
                      pairedSessions.map((sess) => (
                        <li
                          key={sess.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-background px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <Link to={`/results/${encodeURIComponent(sess.id)}`} className="font-semibold text-foreground hover:underline">
                              {planNote?.title || 'Session'}
                            </Link>
                            <div className="text-[11px] text-muted-foreground">
                              Paired with {item.slot ? `${item.slot} plan` : 'scheduled plan'}
                              {sess.noteSourceRevision ? ` · v${sess.noteSourceRevision}` : ''}
                            </div>
                          </div>
                          {typeof sess.duration === 'number' && sess.duration > 0 && (
                            <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                              {formatDurationMMSS(sess.duration)}
                            </span>
                          )}
                        </li>
                      )),
                    )}
                    {dayOverlay.adhocSessions.map(({ session: sess, note: sessNote }) => (
                      <li
                        key={sess.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-500/30 bg-background px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <Link to={`/results/${encodeURIComponent(sess.id)}`} className="font-semibold text-foreground hover:underline">
                            {sessNote?.title || 'Ad-hoc workout'}
                          </Link>
                          <div className="text-[11px] text-muted-foreground">
                            Ad-hoc log{sess.noteSourceRevision ? ` · v${sess.noteSourceRevision}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {dayOverlay.planned
                            .filter((p) => p.item.noteId === sess.noteId && p.pairedSessions.length === 0)
                            .slice(0, 1)
                            .map((match) => (
                              <Button
                                key={match.item.id}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  void journalSchedule.attributeSession({
                                    sessionId: sess.id,
                                    sessionDate: journalDate,
                                    scheduleItemId: match.item.id,
                                  })
                                }
                                className="h-7 px-2 text-[11px]"
                              >
                                Pair with plan
                              </Button>
                            ))}
                          {typeof sess.duration === 'number' && sess.duration > 0 && (
                            <span className="font-mono text-[11px] text-sky-700 dark:text-sky-300">
                              {formatDurationMMSS(sess.duration)}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
          {notes.length > 1 && (
            <nav aria-label="Notes on this date" className="flex flex-wrap gap-2">
              {notes.map((note) => (
                <Link
                  key={note.id}
                  to={notePath(note.id)}
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
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="lg" onClick={() => openCreateDialog('write')}>
                  <Plus className="size-4 mr-1.5" aria-hidden="true" />
                  Create a note
                </Button>
                <Button type="button" variant="outline" size="lg" onClick={() => openCreateDialog('pick')}>
                  <Dumbbell className="size-4 mr-1.5" aria-hidden="true" />
                  Pick / Log workout
                </Button>
              </div>
            </div>
          ) : notes.length === 1 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
                <Link
                  to={notePath(notes[0].id)}
                  className="text-sm font-semibold hover:underline text-foreground"
                  aria-label={`Open note page for ${notes[0].title || 'untitled note'}`}
                >
                  {notes[0].title || 'Untitled note'}
                </Link>
                <div className="flex items-center gap-2">
                  <PublicationPill
                    noteId={notes[0].id}
                    notebookId={notes[0].notebookId}
                    sessions={resultsByNote[notes[0].id]}
                    isReadOnlyFeedNote={false}
                    open={noteActions.promotionOpen && activeActionNote?.id === notes[0].id}
                    onOpenChange={(open) => {
                      if (open) setActionTargetNote(notes[0]);
                      noteActions.setPromotionOpen(open);
                    }}
                    onCloneRequest={() => {
                      setActionTargetNote(notes[0]);
                      noteActions.setPlacement('clone');
                    }}
                    onChanged={() => {
                      journalNotes.listByDate(journalDate).then(setNotes).catch(() => {});
                    }}
                  />
                  <NoteCardActions
                    noteId={notes[0].id}
                    noteTitle={notes[0].title}
                    actions={buildCardActions(notes[0])}
                  />
                </div>
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
                <div key={note.id} id={`note-${note.id}`} className="border-t border-border/60 pt-6 first:border-t-0 first:pt-0 space-y-2">
                  <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
                    <Link
                      to={notePath(note.id)}
                      className="text-sm font-semibold hover:underline text-foreground"
                    >
                      {note.title || `Note ${index + 1}`}
                    </Link>
                    <div className="flex items-center gap-2">
                      <PublicationPill
                        noteId={note.id}
                        notebookId={note.notebookId}
                        sessions={resultsByNote[note.id]}
                        isReadOnlyFeedNote={false}
                        open={noteActions.promotionOpen && activeActionNote?.id === note.id}
                        onOpenChange={(open) => {
                          if (open) setActionTargetNote(note);
                          noteActions.setPromotionOpen(open);
                        }}
                        onCloneRequest={() => {
                          setActionTargetNote(note);
                          noteActions.setPlacement('clone');
                        }}
                        onChanged={() => {
                          journalNotes.listByDate(journalDate).then(setNotes).catch(() => {});
                        }}
                      />
                      <NoteCardActions
                        noteId={note.id}
                        noteTitle={note.title || `Note ${index + 1}`}
                        actions={buildCardActions(note)}
                      />
                    </div>
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
      {noteActions.dialogs}
      <CreateJournalNoteDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDate={journalDate}
        defaultNoteMode={createNoteMode}
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
            // The run is over on purpose — the unmount below must not park it.
            discardRunRef.current = true;
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
            // The registry is the only state written here: React state would
            // churn on every park (and re-trigger the adoption effect).
            const descriptor = runDescriptorRef.current;
            if (!descriptor || discardRunRef.current) {
              // The run was closed or completed: it must not come back.
              runtime.dispose();
              return;
            }
            parkRun({
              runtimeId: descriptor.runtimeId,
              block: descriptor.block,
              noteId: descriptor.noteId,
              captured: descriptor.captured,
              runtime,
              journalDate,
            });
          }}
          onRuntimeReady={(runtime) => {
            // The panel owns a (possibly new) runtime for this run: drop any
            // stale parked entry so a later visit re-binds the live one.
            const descriptor = runDescriptorRef.current;
            if (!descriptor) return;
            const stale = takeParkedRun(descriptor.runtimeId);
            if (stale && stale.runtime !== runtime) stale.runtime.dispose();
          }}
        />
      )}
    </>
  );
}
