import { useCallback, useRef, useState } from 'react'
import { v7 as uuidv7 } from 'uuid'
import type { ScriptBlock, Sessions } from '@/components/Editor/types'
import { playgroundRecorder } from '@/services/resultRecorder'
import type { ResultRecorder } from '@/services/resultRecorder'
import { playgroundIntake, type PlaygroundIntake } from '../services/createPlaygroundPage'

/** One captured run: persisted snapshot note + pre-allocated result id + the block that ran. */
export interface PlaygroundRun {
  readonly noteId: string
  readonly resultId: string
  readonly block: ScriptBlock
}

export interface PlaygroundRunMeta {
  /** Page title — first segment of the snapshot note name. */
  pageTitle: string
  /** Optional section title — second segment of the snapshot note name. */
  sectionTitle?: string
}

export interface PlaygroundRunResetContext extends PlaygroundRunMeta {
  /**
   * Caller-provided runtime outputs finalized as a partial (completed:false)
   * against the active run BEFORE the reset snapshot is minted. Omit for a
   * zero-output reset (the snapshot note is still retained).
   */
  results?: Sessions
}

export interface UsePlaygroundRunOptions {
  /** Test seams; production defaults to the singleton intake + recorder. */
  intake?: PlaygroundIntake
  recorder?: ResultRecorder
}

export interface UsePlaygroundRunReturn {
  /**
   * The one current immutable run identity; stays current after finalize
   * (scope WQL/tables off run.noteId) until reset or the next start.
   */
  run: PlaygroundRun | null
  /** Whether the current run's results have been saved (drives reset/stop flows). */
  recorded: boolean
  /** Unsaved outputs retained after a failed finalize — retry via finalize. */
  pendingResults: { results: Sessions; completed: boolean } | null
  /**
   * Persist a FRESH snapshot note named `<page> <section> <timestamp>` and
   * return the captured run identity. Nothing runs until the save succeeds.
   * Throws while an unrecorded run is active or an earlier save failed —
   * a recorded run does not block the next start (every Run gets a new note).
   */
  start(document: string, block: ScriptBlock, meta: PlaygroundRunMeta): Promise<PlaygroundRun>
  /**
   * Record exactly once against the captured note+block. Repeated calls
   * (re-completion, scroll re-entry) are no-ops after success. On save
   * failure the results stay pending on the run — retry finalize — and
   * start() refuses until a save succeeds.
   */
  finalize(results: Sessions, completed: boolean): Promise<void>
  /**
   * Finalize the active partial via caller-provided outputs (failure aborts
   * the reset and preserves everything), then persist a fresh unstarted
   * reset snapshot note and clear the run. Zero-output resets retained.
   */
  reset(document: string, context: PlaygroundRunResetContext): Promise<void>
  /**
   * Close out the active run WITHOUT a new snapshot: finalize caller-provided
   * partial outputs if still unrecorded (failure aborts — outputs preserved),
   * then clear the identity. Stage/overlay exits use this so leaving mid-run
   * persists the partial exactly once instead of discarding it.
   */
  end(results?: Sessions): Promise<void>
}

/** Owns playground run identity: fresh snapshot per run/reset, record-once, fail-safe results. */
export function usePlaygroundRun({
  intake = playgroundIntake,
  recorder = playgroundRecorder,
}: UsePlaygroundRunOptions = {}): UsePlaygroundRunReturn {
  const [run, setRun] = useState<PlaygroundRun | null>(null)
  const [recorded, setRecorded] = useState(false)
  /** Mirrors pendingRef: unsaved outputs from a failed finalize (UI gate for retry paths). */
  const [pendingResults, setPendingResults] = useState<{ results: Sessions; completed: boolean } | null>(null)
  const runRef = useRef<PlaygroundRun | null>(null)
  const recordedRef = useRef(false)
  // ponytail: refs mirror state so the async callbacks stay identity-stable;
  // swap to a reducer if a third status flag ever lands here.
  const pendingRef = useRef<{ results: Sessions; completed: boolean } | null>(null)
  /** Single-flight attempts: concurrent callers join the SAME promise or are refused synchronously. */
  const startAttemptRef = useRef<Promise<PlaygroundRun> | null>(null)
  const saveAttemptRef = useRef<Promise<void> | null>(null)

  const start = useCallback(
    async (document: string, block: ScriptBlock, meta: PlaygroundRunMeta): Promise<PlaygroundRun> => {
      // Synchronous gates BEFORE any await — concurrent starts are refused,
      // never double-minting snapshots or overwriting the identity.
      if (startAttemptRef.current) throw new Error('A workout is already starting.')
      if (runRef.current && !recordedRef.current) throw new Error('A workout is already running.')
      if (pendingRef.current) throw new Error('Previous workout results are not saved yet.')
      const attempt = (async () => {
        const entry = await intake.snapshotEntry(document, {
          pageTitle: meta.pageTitle,
          sectionTitle: meta.sectionTitle,
        })
        const identity: PlaygroundRun = { noteId: entry.noteId, resultId: uuidv7(), block }
        runRef.current = identity
        recordedRef.current = false
        setRecorded(false)
        pendingRef.current = null
        setPendingResults(null)
        setRun(identity)
        return identity
      })()
      startAttemptRef.current = attempt
      try {
        return await attempt
      } finally {
        if (startAttemptRef.current === attempt) startAttemptRef.current = null
      }
    },
    [intake],
  )

  const finalize = useCallback(
    async (results: Sessions, completed: boolean): Promise<void> => {
      if (startAttemptRef.current) {
        try {
          await startAttemptRef.current
        } catch {
          // start failure is handled by caller
        }
      }
      const identity = runRef.current
      // Record-exactly-once: later completion/scroll re-entries are no-ops.
      if (!identity || recordedRef.current) return
      // Single-flight: a concurrent caller awaits the SAME in-flight write
      // instead of silently succeeding or double-recording.
      if (saveAttemptRef.current) return saveAttemptRef.current
      // A retry must preserve the FIRST failed snapshot — newer caller args
      // (e.g. empty outputs from a disposed runtime) never overwrite it.
      const captured = pendingRef.current ?? { results, completed }
      const attempt = (async () => {
        // Pending first: if the write throws, the outputs stay preserved here.
        pendingRef.current = captured
        setPendingResults(pendingRef.current)
        try {
          await recorder.record({
            runBlock: identity.block,
            blockId: identity.block.id,
            noteId: identity.noteId,
            resultId: identity.resultId,
            data: captured.results,
            createdAt: captured.results.endTime ?? Date.now(),
            origin: 'playground',
          })
        } finally {
          if (saveAttemptRef.current === attempt) saveAttemptRef.current = null
        }
        recordedRef.current = true
        setRecorded(true)
        pendingRef.current = null
        setPendingResults(null)
      })()
      saveAttemptRef.current = attempt
      return attempt
    },
    [recorder],
  )

  /** Drains any in-flight start/save so reset/end never race a live attempt. */
  const drainAttempts = useCallback(async () => {
    if (startAttemptRef.current) {
      try {
        await startAttemptRef.current
      } catch {
        // A failed start leaves nothing behind to reset or end.
      }
    }
    if (saveAttemptRef.current) await saveAttemptRef.current
  }, [])

  const reset = useCallback(
    async (document: string, context: PlaygroundRunResetContext): Promise<void> => {
      await drainAttempts()
      const identity = runRef.current
      if (identity && !recordedRef.current && context.results) {
        // A failed partial save aborts the reset with outputs preserved.
        await finalize(context.results, false)
      }
      if (pendingRef.current) throw new Error('Previous workout results are not saved yet.')
      await intake.snapshotEntry(document, {
        pageTitle: context.pageTitle,
        sectionTitle: context.sectionTitle,
      })
      runRef.current = null
      recordedRef.current = false
      setRecorded(false)
      pendingRef.current = null
      setPendingResults(null)
      setRun(null)
    },
    [drainAttempts, finalize, intake],
  )

  const end = useCallback(
    async (results?: Sessions): Promise<void> => {
      await drainAttempts()
      const identity = runRef.current
      if (identity && !recordedRef.current && results) {
        // A failed partial save aborts the exit with outputs preserved.
        await finalize(results, false)
      }
      if (pendingRef.current) throw new Error('Previous workout results are not saved yet.')
      runRef.current = null
      recordedRef.current = false
      setRecorded(false)
      pendingRef.current = null
      setPendingResults(null)
      setRun(null)
    },
    [drainAttempts, finalize],
  )

  return { run, recorded, pendingResults, start, finalize, reset, end }
}
