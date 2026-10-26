/**
 * useScriptBlockCommands — action-matrix hook for WOD block inline command bars.
 *
 * Encodes the full per-context button matrix defined in
 * docs/navbar-wodblock-actions-assessment-2026-05-08.md §1.2.
 *
 * Returns a ScriptCommand[] containing only the actions permitted by the current
 * PageMode whose handler has been supplied. Pages provide only the handlers
 * they can implement; the hook silently omits buttons with no handler.
 *
 * Matrix:
 *   playground        → play, share, add-to-today, schedule
 *   journal-history   → share, schedule
 *   journal-active    → play, share, schedule
 *   journal-plan      → open-in-playground, share, schedule
 *   notebook-readonly (corpus notebook) → play, open-in-playground, share, schedule
 *
 * Per-block gating (#891/#894): for ```log blocks, InlineCommandBar swaps the
 * `log` command (emitted when `onLog` is supplied) in place of `play` and drops
 * add-to-today/schedule — see `commandsForAffordance` in ScriptCommand.ts.
 */

import { useMemo } from 'react'
import {
  PlayIcon,
  ShareIcon,
  PlusIcon,
  CalendarDaysIcon,
  PencilSquareIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/20/solid'
import type { ScriptCommand } from '@/components/Editor/overlays/ScriptCommand'
import type { ScriptBlock } from '@/components/Editor/types'
import type { PageMode } from '@/types/content-type'

export interface ScriptBlockHandlers {
  /** Start the workout immediately (navigate to tracker). */
  onPlay?: (block: ScriptBlock) => void
  /** Open the block in log mode (recorded entry) — replaces Play for ```log blocks. */
  onLog?: (block: ScriptBlock) => void
  /** Copy a deep-link URL to this block to the clipboard. */
  onShare?: (block: ScriptBlock) => void
  /** Append this block to today's journal entry (no date picker). */
  onAddToToday?: (block: ScriptBlock) => void
  /** Open a date picker so the user can schedule the block on any date. */
  onSchedule?: (block: ScriptBlock) => void
  /** Open the block in a new playground page. */
  onOpenInPlayground?: (block: ScriptBlock) => void
}

export function useScriptBlockCommands(
  mode: PageMode,
  handlers: ScriptBlockHandlers,
): ScriptCommand[] {
  return useMemo(() => {
    const cmds: ScriptCommand[] = []

    // ── play ─────────────────────────────────────────────────────────────
    if (
      handlers.onPlay &&
      (mode === 'playground' ||
        mode === 'journal-active' ||
        mode === 'notebook-readonly')
    ) {
      cmds.push({
        id: 'play',
        label: 'Play',
        icon: <PlayIcon className="h-3 w-3 fill-current" />,
        primary: true,
        onClick: handlers.onPlay,
      })
    }

    // ── log ──────────────────────────────────────────────────────────────
    // Emitted alongside play; InlineCommandBar swaps it in place of play for
    // log blocks via commandsForAffordance (#891/#894). Same mode matrix and
    // omit-without-handler rule as play.
    if (
      handlers.onLog &&
      (mode === 'playground' ||
        mode === 'journal-active' ||
        mode === 'notebook-readonly')
    ) {
      cmds.push({
        id: 'log',
        label: 'Log',
        icon: <ArrowDownTrayIcon className="h-3 w-3" />,
        primary: true,
        onClick: handlers.onLog,
      })
    }

    // ── open-in-playground ────────────────────────────────────────────────
    if (
      handlers.onOpenInPlayground &&
      (mode === 'journal-plan' || mode === 'notebook-readonly')
    ) {
      cmds.push({
        id: 'open-in-playground',
        label: 'Playground',
        icon: <PencilSquareIcon className="h-3 w-3" />,
        onClick: handlers.onOpenInPlayground,
      })
    }

    // ── share ─────────────────────────────────────────────────────────────
    if (handlers.onShare) {
      cmds.push({
        id: 'share',
        label: 'Share',
        icon: <ShareIcon className="h-3 w-3" />,
        onClick: handlers.onShare,
      })
    }

    // ── add-to-today ──────────────────────────────────────────────────────
    if (handlers.onAddToToday && mode === 'playground') {
      cmds.push({
        id: 'add-to-today',
        label: 'Today',
        icon: <PlusIcon className="h-3 w-3" />,
        onClick: handlers.onAddToToday,
      })
    }

    // ── schedule (calendar date picker) ───────────────────────────────────
    // Available on every mode except journal-history (past entries are immutable).
    // journal-history only gets share + schedule (user may clone to another date).
    if (handlers.onSchedule) {
      cmds.push({
        id: 'schedule',
        label: 'Schedule',
        icon: <CalendarDaysIcon className="h-3 w-3" />,
        onClick: handlers.onSchedule,
      })
    }

    return cmds
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, handlers.onPlay, handlers.onLog, handlers.onShare, handlers.onAddToToday, handlers.onSchedule, handlers.onOpenInPlayground])
}
