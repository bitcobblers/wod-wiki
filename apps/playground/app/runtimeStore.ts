/**
 * Shared in-memory store for pending runtimes.
 *
 * When a workout is started via route navigation (open: route), the ScriptBlock
 * is stashed here keyed by a UUID, then the app navigates to
 * /run/:runtimeId. WallClockPage reads and deletes the entry.
 */
import type { ScriptBlock } from '@/components/Editor/types'
import type { IScriptRuntime } from '@bitcobblers/wod-wiki-engine'
import type { ResultOrigin } from '@/types/storage'
import type { SaveNoteInput } from '@/services/persistence';
import type { CapturedRun } from '@/services/runCapture';

export interface PendingRuntime {
  block: ScriptBlock
  snapshot?: SaveNoteInput;
  captured?: CapturedRun;
  /**
   * Canonical Note UUID (or legacy composite id). Pass `origin` explicitly
   * when the id doesn't self-describe ('playground/<name>' → 'playground',
   * everything else → 'journal') — e.g. UUID-keyed playground notes.
   */
  noteId: string
  /** Overrides the recorder's origin derivation (see noteId). */
  origin?: ResultOrigin
  /** Overrides the post-run back-navigation (parseNoteId can't route UUIDs). */
  returnTo?: string
}

export const pendingRuntimes = new Map<string, PendingRuntime>()

/**
 * Runs that are still alive but whose surface unmounted — the user navigated
 * away mid-workout. The runtime is parked (NOT disposed) so the clock keeps
 * running; the surface that owns the run re-binds it on the way back.
 *
 * Keyed by runtime id (the same key `pendingRuntimes` uses), so a returning
 * route finds its run by id; the date index lets a surface find a run whose
 * URL no longer carries the id.
 */
export interface ParkedRun {
  runtimeId: string
  block: ScriptBlock
  noteId: string
  /** Live runtime — ownership transfers between surfaces. */
  runtime: IScriptRuntime
  captured?: CapturedRun
  /** Journal date the run belongs to — the surface that re-binds it. */
  journalDate?: string
}

export const parkedRuns = new Map<string, ParkedRun>()

/** Park a live run so a later mount can re-bind it. */
export function parkRun(run: ParkedRun): void {
  parkedRuns.set(run.runtimeId, run)
}

/**
 * Take ownership of a parked run (read + remove). The caller becomes the
 * runtime's owner and is responsible for disposing it.
 */
export function takeParkedRun(runtimeId: string): ParkedRun | undefined {
  const run = parkedRuns.get(runtimeId)
  if (run) parkedRuns.delete(runtimeId)
  return run
}

/** Find a parked run by id without taking ownership (read-only lookup). */
export function peekParkedRun(runtimeId: string): ParkedRun | undefined {
  return parkedRuns.get(runtimeId)
}

/** Find a parked run for a journal date (read-only lookup). */
export function findParkedRunByDate(journalDate: string): ParkedRun | undefined {
  for (const run of parkedRuns.values()) {
    if (run.journalDate === journalDate) return run
  }
  return undefined
}

/** Drop a parked run (it completed, was stopped, or was closed). */
export function clearParkedRun(runtimeId: string): void {
  parkedRuns.delete(runtimeId)
}

/**
 * Tracks currently active (running) runtimes, keyed by blockId.
 *
 * When a workout starts in view or dialog mode the block is registered here.
 * When it stops or completes it is removed.  Any component can check this
 * map to decide whether to show a "View" reconnect button instead of "Run".
 */
export const activeRuntimes = new Map<string, ScriptBlock>()
