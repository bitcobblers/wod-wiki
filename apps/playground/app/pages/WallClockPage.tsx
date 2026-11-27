/**
 * WallClockPage — /run/:runtimeId
 *
 * Runs a workout from a pending runtime stored in the in-memory pendingRuntimes
 * map. On completion the result is persisted to IndexedDB and the user is
 * redirected to the review page.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FileQuestion, Home } from 'lucide-react'
import { v7 as uuidv7 } from 'uuid'
import { KNOWN_SECTION_WIDGETS, parseDocumentSections } from '@bitcobblers/wod-wiki-core'
import { createParser, type IScriptRuntime } from '@bitcobblers/wod-wiki-engine'
import { parseNoteId, noteRefToPath } from '@/lib/noteIdentity'
import { sessionDetailPath } from '../lib/routes'
import { FullscreenTimer } from '@/components/organisms/review/FullscreenTimer'
import { HaltedRunNotice } from '@/components/organisms/editor/RuntimeTimerPanel'
import { playgroundRecorder } from '@/services/resultRecorder'
import { clearParkedRun, parkRun, peekParkedRun, pendingRuntimes, takeParkedRun, type PendingRuntime } from '../runtimeStore'
import type { ScriptBlock, Sessions } from '@/components/Editor/types'
import { captureRun, captureStoredRun, type CapturedRun } from '@/services/runCapture';
import { storageService } from '@/services/storage';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import { notifyScheduleChanged } from '../services/journalSchedule';
import { TEST_IDS } from '@/lib/testIds';
import { sessionQueryFence, sessionQueryWql } from '@bitcobblers/wod-wiki-ui/extensions';

async function injectSessionQueryIntoNote(noteId: string, blockId: string, resultId: string): Promise<void> {
  const note = await storageService.getNote(noteId);
  if (!note) return;
  // ADR 0009: Never inject query fences into feed/pinned/Notebook workout recipes —
  // only standalone unfiled Journal or Playground scratchpads receive inline queries.
  const isNotebookRecipe =
    note.feedOrigin === 'feed' ||
    note.retention === 'schedule-pinned' ||
    note.retention === 'session-pinned' ||
    (Array.isArray(note.notebookIds) && note.notebookIds.length > 0 && note.type !== 'journal' && note.type !== 'playground');
  if (isNotebookRecipe) return;
  const wql = sessionQueryWql(resultId);
  if (note.rawContent.includes(wql)) return;
  const block = Object.values(note.blocks ?? {}).find(b => b.id === blockId);
  if (!block || block.to == null) return;
  const newContent = `${note.rawContent.slice(0, block.to)}\n\n${sessionQueryFence(resultId)}${note.rawContent.slice(block.to)}`;
  const provider = new IndexedDBContentProvider();
  await provider.updateRecord(note.id, { rawContent: newContent, expectedSourceRevision: note.sourceRevision });
}

interface InitialWallClockRun {
  pending: PendingRuntime | undefined;
  adoptedRuntime: IScriptRuntime | null;
}

function resolveInitialWallClockRun(runtimeId: string | undefined): InitialWallClockRun {
  if (!runtimeId) return { pending: undefined, adoptedRuntime: null }
  const direct = pendingRuntimes.get(runtimeId)
  if (direct) return { pending: direct, adoptedRuntime: null }
  const parked = peekParkedRun(runtimeId)
  if (!parked) return { pending: undefined, adoptedRuntime: null }
  return {
    pending: {
      block: parked.block,
      noteId: parked.noteId,
      captured: parked.captured,
      origin: parked.origin,
      returnTo: parked.returnTo,
      scheduleItemId: parked.scheduleItemId,
      sessionDate: parked.sessionDate,
    },
    adoptedRuntime: parked.runtime,
  }
}

export function WallClockPage() {
  const { runtimeId } = useParams<{ runtimeId: string }>()
  return <WallClockRouteView key={runtimeId ?? 'missing'} runtimeId={runtimeId} />
}

function WallClockRouteView({ runtimeId }: { runtimeId: string | undefined }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [initial] = useState<InitialWallClockRun>(() => resolveInitialWallClockRun(runtimeId))
  const pendingRef = useRef<PendingRuntime | undefined>(initial.pending)
  const coldNoteParam = searchParams.get('note')
  const coldBlockParam = searchParams.get('block')
  const [coldLoading, setColdLoading] = useState<boolean>(() => !initial.pending && Boolean(coldNoteParam))
  const [coldBootPending, setColdBootPending] = useState<PendingRuntime | undefined>(undefined)
  const captureRef = useRef<CapturedRun | null>(initial.pending?.captured ?? null)
  // Effective result ID for this run — starts as `runtimeId`, but automatically
  // branches to a fresh UUIDv7 if `runtimeId` already exists in IndexedDB (e.g.
  // resuming from a saved partial reload session) so Retry never dead-ends.
  const [effectiveResultId, setEffectiveResultId] = useState<string | undefined>(runtimeId)
  const effectiveResultIdRef = useRef<string | undefined>(runtimeId)
  const [hydratedNoteMeta, setHydratedNoteMeta] = useState<{ title?: string; sessionDate?: string } | null>(null)
  // Flips true once the run completes or is explicitly closed so unmount
  // disposes finished runtimes instead of parking them for Back/Forward resume.
  const discardRunRef = useRef(false)

  useEffect(() => {
    if (pendingRef.current || !coldNoteParam || !runtimeId) {
      setColdLoading(false)
      return
    }
    let cancelled = false
    setColdLoading(true)
    storageService
      .getNote(coldNoteParam)
      .then((note) => {
        if (cancelled) return
        if (!note) {
          setColdLoading(false)
          return
        }
        const blocks = Object.values(note.blocks ?? {}).filter((b) => b.kind === 'wod')
        const target = coldBlockParam ? blocks.find((b) => b.id === coldBlockParam) : blocks[0]
        if (!target) {
          setColdLoading(false)
          return
        }
        const slice = note.rawContent.slice(target.from, target.to)
        const sec = parseDocumentSections(slice, { registeredWidgets: KNOWN_SECTION_WIDGETS })[0]
        const body = sec?.scriptBlock?.content ?? slice
        const statements = createParser().read(body, target.sport).statements ?? []
        const scriptBlock: ScriptBlock = {
          id: target.id,
          contentId: sec?.scriptBlock?.contentId,
          dialect: target.dialect ?? 'time',
          sport: target.sport,
          startLine: 0,
          endLine: Math.max(0, slice.split(/\r?\n/).length - 1),
          content: body,
          statements,
          state: 'idle',
          version: target.version,
          createdAt: note.createdAt,
          widgetIds: {},
        }
        const recovered: PendingRuntime = {
          block: scriptBlock,
          noteId: note.id,
        }
        pendingRef.current = recovered
        setColdBootPending(recovered)
        setColdLoading(false)
      })
      .catch(() => {
        if (!cancelled) setColdLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [coldNoteParam, coldBlockParam, runtimeId])

  const prepareRun = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending || !runtimeId) throw new Error('The pending workout is unavailable.');
    if (pending.captured) { captureRef.current = pending.captured; return pending.captured.block; }
    let targetResultId = effectiveResultIdRef.current ?? runtimeId;
    if (!captureRef.current) {
      // Guard against resuming a URL whose sessionId is already persisted in
      // IndexedDB (e.g. partial session saved on reload) — branch to a fresh
      // continuation UUID instead of looping on "Session already exists".
      const existing = await storageService.getSessionById(targetResultId).catch(() => undefined);
      if (existing) {
        targetResultId = uuidv7();
        effectiveResultIdRef.current = targetResultId;
        setEffectiveResultId(targetResultId);
      }
      captureRef.current = pending.snapshot
        ? await captureRun(pending.snapshot, pending.block, targetResultId, pending.origin, undefined, {
            deferPersist: true,
            ...(pending.scheduleItemId ? { scheduleItemId: pending.scheduleItemId } : {}),
            ...(pending.sessionDate ? { sessionDate: pending.sessionDate } : {}),
          })
        : await captureStoredRun(pending.noteId, pending.block, targetResultId, pending.origin, {
            deferPersist: true,
            ...(pending.scheduleItemId ? { scheduleItemId: pending.scheduleItemId } : {}),
            ...(pending.sessionDate ? { sessionDate: pending.sessionDate } : {}),
          });
    }
    return captureRef.current.block;
  }, [runtimeId]);

  // Consume from the pending store on mount so it doesn't leak
  useEffect(() => {
    if (runtimeId) pendingRuntimes.delete(runtimeId)
  }, [runtimeId])

  const pending = initial.pending ?? coldBootPending
  useEffect(() => {
    const targetNoteId = pending?.noteId;
    if (!targetNoteId) {
      setHydratedNoteMeta(null);
      return;
    }
    let cancelled = false;
    storageService
      .getNote(targetNoteId)
      .then((note) => {
        if (cancelled || !note) return;
        const ts = note.date;
        const sessionDate =
          typeof ts === 'number' && Number.isFinite(ts)
            ? new Date(ts).toISOString().slice(0, 10)
            : undefined;
        setHydratedNoteMeta({
          ...(note.title ? { title: note.title } : {}),
          ...(sessionDate ? { sessionDate } : {}),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pending?.noteId]);
  // The run reached natural completion — its review/queue dismissal routes to
  // the session detail (navigation is deferred until the overlay closes so
  // the post-run queue can run).
  const completedRef = useRef(false)

  const handleComplete = useCallback(
    (_blockId: string, results: Sessions | undefined): Promise<unknown> => {
      // Surfaced, not silent — the overlay awaits this and offers Retry.
      if (!results || !runtimeId || !pending) {
        return Promise.reject(new Error('Run cannot be saved — its session data or runtime id is missing.'))
      }
      const saveResultId = effectiveResultIdRef.current ?? runtimeId;
      completedRef.current = results.completed
      return playgroundRecorder.record({
        runBlock: pending.block,
        blockId: pending.block.id,
        noteId: pending.noteId,
        resultId: saveResultId,
        ...(pending.block.content ? { blockContent: pending.block.content } : {}),
        ...(pending.block.dialect ? { blockDialect: pending.block.dialect } : {}),
        ...(pending.block.sport ? { blockSport: pending.block.sport } : {}),
        data: results,
        createdAt: results.endTime || Date.now(),
        ...(pending.origin ? { origin: pending.origin } : {}),
        ...(pending.scheduleItemId ? { scheduleItemId: pending.scheduleItemId } : {}),
        ...(pending.sessionDate ? { sessionDate: pending.sessionDate } : {}),
      }).then(async () => {
        notifyScheduleChanged()
        discardRunRef.current = true
        clearParkedRun(runtimeId)
        if (results.completed) {
          try {
            await injectSessionQueryIntoNote(pending.noteId, pending.block.id, saveResultId);
          } catch {
            // Best-effort post-run query injection
          }
          // No eager navigation here: the overlay keeps control through the
          // post-run actuals queue + review; handleClose routes on dismissal.
        }
      })
    },
    [runtimeId, pending],
  )

  const handleClose = useCallback(() => {
    discardRunRef.current = true
    if (runtimeId) clearParkedRun(runtimeId)
    if (!pending) { void navigate('/'); return }
    // A completed run's review/queue has been dismissed — the deferred
    // destination is the session detail page.
    if (completedRef.current && (effectiveResultIdRef.current ?? runtimeId)) {
      void navigate(sessionDetailPath((effectiveResultIdRef.current ?? runtimeId)!), { replace: true })
      return
    }
    if (pending.returnTo) {
      void navigate(pending.returnTo, { replace: true })
      return
    }
    // Route back to the note via the typed NoteRef — the kind→path rule lives
    // in noteRefToPath, not an ad-hoc noteId.split('/') switch here.
    void navigate(noteRefToPath(parseNoteId(pending.noteId)), { replace: true })
  }, [runtimeId, pending, navigate])

  const handlePark = useCallback((runtime: IScriptRuntime) => {
    const activePending = pendingRef.current
    if (!runtimeId || !activePending || discardRunRef.current) {
      runtime.dispose()
      return
    }
    parkRun({
      runtimeId,
      block: activePending.block,
      noteId: activePending.noteId,
      captured: captureRef.current ?? activePending.captured,
      origin: activePending.origin,
      returnTo: activePending.returnTo,
      scheduleItemId: activePending.scheduleItemId,
      sessionDate: activePending.sessionDate,
      runtime,
    })
  }, [runtimeId])

  const handleRuntimeReady = useCallback((runtime: IScriptRuntime) => {
    if (!runtimeId) return
    const stale = takeParkedRun(runtimeId)
    if (stale && stale.runtime !== runtime) stale.runtime.dispose()
  }, [runtimeId])

  if (coldLoading) {
    return (
      <main
        data-agent-status="loading"
        aria-busy={true}
        role="status"
        className="flex-1 flex items-center justify-center text-muted-foreground"
      >
        Preparing workout timer…
      </main>
    )
  }

  if (!pending) {
    return (
      <div className="h-full flex flex-col">
        <nav
          aria-label="Workout runner navigation"
          className="flex items-center gap-5 px-6 py-3 border-b bg-background"
        >
          <span className="text-sm font-semibold tracking-tight">WOD Wiki</span>
          <button
            type="button"
            data-testid="run-notfound-nav-home"
            onClick={() => navigate('/')}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Home
          </button>
          <button
            type="button"
            data-testid="run-notfound-nav-journal"
            onClick={() => navigate('/journal')}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Journal
          </button>
          <button
            type="button"
            data-testid="run-notfound-nav-notebooks"
            onClick={() => navigate('/notebooks')}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Notebooks
          </button>
        </nav>
        <main
          data-agent-status="ready"
          aria-busy={false}
          className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center"
        >
          <HaltedRunNotice />
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted">
            <FileQuestion className="w-8 h-8 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Workout session not found</h1>
            <p className="text-muted-foreground max-w-sm">
              Runtime not found. Please start the workout from the editor.
            </p>
          </div>
          <button
            type="button"
            data-testid="run-notfound-go-home"
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Home className="w-4 h-4" />
            Go home
          </button>
        </main>
      </div>
    )
  }

  const noteContent = pending.captured?.note.rawContent ?? pending.snapshot?.rawContent;
  const resolvedSessionDate = pending.sessionDate ?? hydratedNoteMeta?.sessionDate;
  const resolvedNoteTitle = pending.captured?.note.title ?? hydratedNoteMeta?.title;
  const attributionLabel = pending.scheduleItemId
    ? `Scheduled${resolvedSessionDate ? ` · ${resolvedSessionDate}` : ''}`
    : resolvedNoteTitle && resolvedSessionDate
      ? `${resolvedNoteTitle} · ${resolvedSessionDate}`
      : resolvedSessionDate
        ? `Logged for ${resolvedSessionDate}`
        : resolvedNoteTitle
          ? `${resolvedNoteTitle} · Today`
          : 'Ad-hoc · Today';

  return (
    <main data-agent-status="ready" aria-busy={false} className="contents">
      <div
        data-testid={TEST_IDS.RUNNER_CONTEXT_PILL}
        className="pointer-events-none fixed left-1/2 top-2.5 z-50 -translate-x-1/2 rounded-full border border-border/70 bg-background/90 px-3 py-1 text-[11px] font-semibold text-foreground shadow-sm backdrop-blur-sm"
      >
        {attributionLabel}
      </div>
      <FullscreenTimer
        block={pending.block}
        noteContent={noteContent}
        prepareRun={prepareRun}
        onClose={handleClose}
        onCompleteWorkout={handleComplete}
        resultId={effectiveResultId ?? runtimeId}
        noteId={pending.noteId}
        autoStart
        adoptRuntime={initial.adoptedRuntime}
        parkOnUnmount
        onPark={handlePark}
        onRuntimeReady={handleRuntimeReady}
      />
    </main>
  )
}
