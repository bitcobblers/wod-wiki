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
import { KNOWN_SECTION_WIDGETS, parseDocumentSections } from '@bitcobblers/wod-wiki-core'
import { createParser } from '@bitcobblers/wod-wiki-engine'
import { parseNoteId, noteRefToPath } from '@/lib/noteIdentity'
import { sessionDetailPath } from '../lib/routes'
import { FullscreenTimer } from '@/components/organisms/review/FullscreenTimer'
import { HaltedRunNotice } from '@/components/organisms/editor/RuntimeTimerPanel'
import { playgroundRecorder } from '@/services/resultRecorder'
import { pendingRuntimes, type PendingRuntime } from '../runtimeStore'
import type { ScriptBlock, Sessions } from '@/components/Editor/types'
import { captureRun, captureStoredRun, type CapturedRun } from '@/services/runCapture';
import { storageService } from '@/services/storage';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import { sessionQueryFence, sessionQueryWql } from '@bitcobblers/wod-wiki-ui/extensions';

async function injectSessionQueryIntoNote(noteId: string, blockId: string, resultId: string): Promise<void> {
  const note = await storageService.getNote(noteId);
  if (!note) return;
  const wql = sessionQueryWql(resultId);
  if (note.rawContent.includes(wql)) return;
  const block = Object.values(note.blocks ?? {}).find(b => b.id === blockId);
  if (!block || block.to == null) return;
  const newContent = `${note.rawContent.slice(0, block.to)}\n\n${sessionQueryFence(resultId)}${note.rawContent.slice(block.to)}`;
  const provider = new IndexedDBContentProvider();
  await provider.updateRecord(note.id, { rawContent: newContent, expectedSourceRevision: note.sourceRevision });
}
export function WallClockPage() {
  const { runtimeId } = useParams<{ runtimeId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const pendingRef = useRef<PendingRuntime | undefined>(runtimeId ? pendingRuntimes.get(runtimeId) : undefined)
  const coldNoteParam = searchParams.get('note')
  const coldBlockParam = searchParams.get('block')
  const [coldLoading, setColdLoading] = useState<boolean>(() => !pendingRef.current && Boolean(coldNoteParam))
  const [coldBootPending, setColdBootPending] = useState<PendingRuntime | undefined>(undefined)
  const captureRef = useRef<CapturedRun | null>(null);

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
    if (!captureRef.current) captureRef.current = pending.snapshot
      ? await captureRun(pending.snapshot, pending.block, runtimeId, pending.origin)
      : await captureStoredRun(pending.noteId, pending.block, runtimeId, pending.origin);
    return captureRef.current.block;
  }, [runtimeId]);

  // Consume from the pending store on mount so it doesn't leak
  useEffect(() => {
    if (runtimeId) pendingRuntimes.delete(runtimeId)
  }, [runtimeId])

  const pending = pendingRef.current ?? coldBootPending
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
      completedRef.current = results.completed
      return playgroundRecorder.record({
        runBlock: pending.block,
        blockId: pending.block.id,
        noteId: pending.noteId,
        resultId: runtimeId,
        data: results,
        createdAt: results.endTime || Date.now(),
        ...(pending.origin ? { origin: pending.origin } : {}),
      }).then(async () => {
        if (results.completed) {
          try {
            await injectSessionQueryIntoNote(pending.noteId, pending.block.id, runtimeId);
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
    if (!pending) { navigate('/'); return }
    // A completed run's review/queue has been dismissed — the deferred
    // destination is the session detail page.
    if (completedRef.current) {
      navigate(sessionDetailPath(runtimeId), { replace: true })
      return
    }
    if (pending.returnTo) {
      navigate(pending.returnTo, { replace: true })
      return
    }
    // Route back to the note via the typed NoteRef — the kind→path rule lives
    // in noteRefToPath, not an ad-hoc noteId.split('/') switch here.
    navigate(noteRefToPath(parseNoteId(pending.noteId)), { replace: true })
  }, [runtimeId, pending, navigate])

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

  const noteContent = captureRef.current?.note.rawContent ?? pending.captured?.note.rawContent ?? pending.snapshot?.rawContent;

  return (
    <main data-agent-status="ready" aria-busy={false} className="contents">
      <FullscreenTimer
        block={pending.block}
        noteContent={noteContent}
        prepareRun={prepareRun}
        onClose={handleClose}
        onCompleteWorkout={handleComplete}
        resultId={runtimeId}
        noteId={pending.noteId}
        autoStart
      />
    </main>
  )
}
