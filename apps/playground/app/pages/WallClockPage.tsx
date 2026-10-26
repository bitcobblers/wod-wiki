/**
 * WallClockPage — /run/:runtimeId
 *
 * Runs a workout from a pending runtime stored in the in-memory pendingRuntimes
 * map. On completion the result is persisted to IndexedDB and the user is
 * redirected to the review page.
 */

import { useRef, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { parseNoteId } from '@/lib/noteIdentity'
import { noteRefToPath } from '../lib/noteIdentity'
import { sessionDetailPath } from '../lib/routes'
import { FullscreenTimer } from '@/components/organisms/review/FullscreenTimer'
import { playgroundRecorder } from '@/services/resultRecorder'
import { pendingRuntimes } from '../runtimeStore'
import type { Sessions } from '@/components/Editor/types'
import { captureRun, captureStoredRun, type CapturedRun } from '@/services/runCapture';
import { storageService } from '@/services/storage';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';

async function injectSessionQueryIntoNote(noteId: string, blockId: string, resultId: string): Promise<void> {
  // ponytail: insert query block at end of workout fence if not already present; upgrade to card widget when parser expands.
  const note = await storageService.getNote(noteId);
  if (!note) return;
  const wql = `:session{result:${resultId}}`;
  if (note.rawContent.includes(wql)) return;
  const block = Object.values(note.blocks ?? {}).find(b => b.id === blockId);
  if (!block || block.to == null) return;
  const newContent = `${note.rawContent.slice(0, block.to)}\n\n\`\`\`query:table\n${wql}\n\`\`\`${note.rawContent.slice(block.to)}`;
  const provider = new IndexedDBContentProvider();
  await provider.updateRecord(note.id, { rawContent: newContent, expectedSourceRevision: note.sourceRevision });
}
export function WallClockPage() {
  const { runtimeId } = useParams<{ runtimeId: string }>()
  const navigate = useNavigate()
  const pendingRef = useRef(runtimeId ? pendingRuntimes.get(runtimeId) : undefined)
  const captureRef = useRef<CapturedRun | null>(null);
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

  const pending = pendingRef.current
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
          } catch {}
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

  if (!pending) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400">
        Runtime not found. Please start the workout from the editor.
      </div>
    )
  }

  return (
    <FullscreenTimer
      block={pending.block}
      prepareRun={prepareRun}
      onClose={handleClose}
      onCompleteWorkout={handleComplete}
      resultId={runtimeId}
      autoStart
    />
  )
}
