import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { ScriptBlock, Sessions } from '@/components/Editor/types'
import { toast } from '@/hooks/use-toast'
import type { RunButtonState } from '../components/molecules/SectionButtons'
import { usePlaygroundRun, type PlaygroundRun } from './usePlaygroundRun'

export type FullscreenState =
  | { kind: 'timer'; block: ScriptBlock; results: Sessions | null }
  | null

export interface UseCanvasRuntimeOptions {
  /** Page title for persisted snapshot names ('<title> <timestamp>'). */
  title?: string
  getBlock: () => ScriptBlock | null
  getContent: () => string
}

export interface UseCanvasRuntimeReturn {
  fullscreen: FullscreenState
  startRun: (block?: ScriptBlock | null, content?: string) => Promise<void>
  /** Closes the stage; persists an unrecorded partial via `partial.results` (failure aborts the close). */
  closeRun: (partial?: { results?: Sessions }) => Promise<void>
  completedResults: Sessions | null
  runState: RunButtonState
  handleWorkoutComplete: (results: Sessions) => Promise<void>
  /** Current run identity (fresh note per run) — scope run-scoped views off `run.noteId`. */
  run: PlaygroundRun | null
  /** Whether the current run's results have been saved. */
  recorded: boolean
  /** Unsaved outputs retained after a failed finalize — retry via complete/reset. */
  pendingResults: { results: Sessions; completed: boolean } | null
  /** Drive the mounted panel's `externalStop` while a reset is in flight. */
  resetRequested: boolean
  /**
   * Real reset: a live unrecorded run is stopped via the panel's
   * `externalStop` (partial reported → recorded → fresh snapshot chained);
   * otherwise a fresh reset snapshot is minted directly. Every reset leaves
   * a fresh archive note — partials are never discarded. Resolves `true`
   * only after the reset persisted; `false` after a toasted failure (callers
   * must not mutate drafts unless `true`).
   */
  resetRun: (document?: string) => Promise<boolean>
}

/** Owns persistence-before-run and record-once against the exact started entry (via usePlaygroundRun). */
export function useCanvasRuntime({
  title,
  getBlock,
  getContent,
}: UseCanvasRuntimeOptions): UseCanvasRuntimeReturn {
  const playground = usePlaygroundRun()
  const [fullscreen, setFullscreen] = useState<FullscreenState>(null)
  const [completedResults, setCompletedResults] = useState<Sessions | null>(null)
  const [resetRequested, setResetRequested] = useState(false)
  const starting = useRef(false)
  const generation = useRef(0)
  // Set while a reset waits for the panel's externalStop partial report.
  const resetSettledRef = useRef<(() => void) | null>(null)
  // Reset doc/meta captured at request time — the completion chain must not
  // re-read mutable editor content after the panel reported.
  const resetDocRef = useRef<{ doc: string; meta: { pageTitle: string } } | null>(null)

  useEffect(() => () => { generation.current += 1 }, [])

  const closeRun = useCallback(async (partial?: { results?: Sessions }) => {
    const request = ++generation.current
    try {
      // Persist any unrecorded partial before discarding the run — a failed
      // save aborts the close (overlay stays up, outputs retried on next stop).
      await playground.end(partial?.results)
    } catch (error) {
      if (request === generation.current) {
        toast({
          title: 'Could not save workout results',
          description: error instanceof Error ? error.message : 'Your results are kept — try stopping again.',
          variant: 'destructive',
        })
      }
      return
    }
    if (request === generation.current) {
      setFullscreen(null)
    }
  }, [playground])

  const startRun = useCallback(async (selectedBlock?: ScriptBlock | null, content?: string) => {
    const block = selectedBlock ?? getBlock()
    if (!block || starting.current) return
    starting.current = true
    const request = ++generation.current
    try {
      const captured = await playground.start(content ?? getContent(), block, { pageTitle: title ?? 'Playground' });
      if (request !== generation.current) return
      setCompletedResults(null)
      setFullscreen({ kind: 'timer', block: captured.block, results: null });
    } catch (error) {
      if (request === generation.current) {
        toast({
          title: 'Could not save playground workout',
          description: error instanceof Error ? error.message : 'The workout was not started. Please try again.',
          variant: 'destructive',
        })
      }
    } finally {
      starting.current = false
    }
  }, [playground, title, getBlock, getContent])

  const handleWorkoutComplete = useCallback(async (results: Sessions) => {
    const request = generation.current
    try {
      await playground.finalize(results, results.completed ?? false)
    } catch (error) {
      // Outputs stay pending on the run — a later completion retries the save.
      if (request === generation.current) {
        toast({
          title: 'Could not save workout results',
          description: error instanceof Error ? error.message : 'Your results are kept — try completing again.',
          variant: 'destructive',
        })
      }
      return
    }
    if (request !== generation.current) return
    setCompletedResults(results)
    setFullscreen(null)
    // A reset asked the panel for this partial: once the save landed, chain
    // the fresh-snapshot reset (a pending-save failure surfaces via toast and
    // keeps the run for retry).
    if (resetSettledRef.current) {
      const settle = resetSettledRef.current
      resetSettledRef.current = null
      setResetRequested(false)
      const captured = resetDocRef.current ?? { doc: getContent(), meta: { pageTitle: title ?? 'Playground' } }
      resetDocRef.current = null
      try {
        await playground.reset(captured.doc, captured.meta)
      } catch (error) {
        toast({
          title: 'Could not save reset snapshot',
          description: error instanceof Error ? error.message : 'Your partial results are kept — try resetting again.',
          variant: 'destructive',
        })
      } finally {
        settle()
      }
    }
  }, [playground, getContent, title])

  const resetRun = useCallback(async (document?: string): Promise<boolean> => {
    const doc = document ?? getContent()
    const meta = { pageTitle: title ?? 'Playground' }
    try {
      if (playground.run && !playground.recorded && fullscreen) {
        if (playground.pendingResults) {
          // Panel halted (a finalize failed earlier): externalStop would
          // no-op — retry the retained outputs ourselves, then chain reset.
          await playground.finalize(playground.pendingResults.results, false)
          await playground.reset(doc, meta)
          return true
        }
        // Live run: never tear down without its outputs — flip the panel's
        // externalStop so it reports the partial (onComplete above records it
        // and chains this reset). ponytail: if a future panel state can
        // swallow externalStop without reporting, add a settle timeout.
        resetDocRef.current = { doc, meta }
        setResetRequested(true)
        const settled = Promise.withResolvers<void>();
        resetSettledRef.current = settled.resolve;
        await settled.promise;
        return true
      }
      await playground.reset(doc, meta)
      return true
    } catch (error) {
      toast({
        title: 'Could not save workout results',
        description: error instanceof Error ? error.message : 'Your results are kept — try resetting again.',
        variant: 'destructive',
      })
      return false
    }
  }, [playground, getContent, title, fullscreen])

  const runState = useMemo<RunButtonState>(() => ({
    isReconnect: false,
    onReconnect: () => {},
    onRun: () => { void startRun() },
  }), [startRun])

  return { fullscreen, startRun, closeRun, completedResults, runState, handleWorkoutComplete, run: playground.run, recorded: playground.recorded, pendingResults: playground.pendingResults, resetRequested, resetRun }
}
