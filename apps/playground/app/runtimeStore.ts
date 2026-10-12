/**
 * Shared in-memory store for pending runtimes.
 *
 * When a workout is started via route navigation (open: route), the ScriptBlock
 * is stashed here keyed by a UUID, then the app navigates to
 * /run/:runtimeId. WallClockPage reads and deletes the entry.
 */
import type { ScriptBlock } from '@/components/Editor/types'
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
 * Tracks currently active (running) runtimes, keyed by blockId.
 *
 * When a workout starts in view or dialog mode the block is registered here.
 * When it stops or completes it is removed.  Any component can check this
 * map to decide whether to show a "View" reconnect button instead of "Run".
 */
export const activeRuntimes = new Map<string, ScriptBlock>()
