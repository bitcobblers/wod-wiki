/**
 * useNotePageNav — Shared L3-nav + page-index plumbing for note pages.
 *
 * Every note-style page (Journal, Playground, WorkoutEditor) does the same
 * thing:
 *   1. Run `extractPageIndex(content)` to produce `PageNavLink[]`.
 *   2. For each `time` or `log` link, look up the matching `ScriptBlock` by start-line and
 *      attach an `onRun` callback (and optional result-count badging).
 *   3. Mirror that index into the L3 nav via `setL3Items` and clear it on
 *      unmount.
 *
 * That ~40-line block was duplicated verbatim across three pages; this hook
 * collapses it into a single call.
 */

import { useEffect, useMemo, useRef } from 'react'
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'
import type { ScriptBlock } from '@/components/Editor/types'
import type { Session } from '@/types/storage'
import type { NavItemL3 } from '../../nav/navTypes'
import { useNav } from '../../nav/NavContext'
import { extractPageIndex, mapIndexToL3 } from './pageUtils'
import { groupResultsByVersion } from '@/utils/groupResultsByVersion';

export interface UseNotePageNavOptions {
  /** Current editor content. */
  content: string
  /** Parsed time/log blocks (from `<NoteEditor onBlocksChange>`). */
  scriptBlocks: ScriptBlock[]
  /** Callback invoked when the user runs a time/log link. Omit on note
   *  pages whose bodies are reference material (e.g. equipment) — time
   *  links then stay display-only, like `log` links. */
  onStartWorkout?: (block: ScriptBlock) => void
  /**
   * Optional results to badge each time/log link with `hasResult` / `resultCount`.
   * Only the JournalPage uses this today.
   */
  results?: Session[]
  /** Optional callback to edit the note from the L3 header item. */
  onEditNote?: () => void
  /**
   * Per-page L3 helpful actions (Clone, Placements, Reset, Copy link…),
   * published after the outline so "On this page" stays first. They ride
   * the same NavContext l3Items channel as the outline, so the 2xl+ rail,
   * the lg–2xl ⋯ menu and the mobile right drawer all carry them.
   */
  helpfulActions?: NoteHelpfulAction[]
  /** Set to false on pages/modes where outline is managed elsewhere (e.g. multi-note dates). */
  enabled?: boolean
}
/** A per-page L3 helpful action rendered after the page outline. */
export interface NoteHelpfulAction {
  id: string
  label: string
  onRun: () => void
  /**
   * Bump to re-publish when the handler closes over freshly loaded data
   * (e.g. the resolved effort). ids/labels already re-publish.
   */
  key?: string
}

/** Helpful actions as NavItemL3 call rows (whole-row click runs). */
export function helpfulActionsToL3(
  actions: readonly NoteHelpfulAction[],
  actionsRef?: { current: readonly NoteHelpfulAction[] },
): NavItemL3[] {
  return actions.map(a => ({
    id: `helpful-${a.id}`,
    label: a.label,
    level: 3 as const,
    action: {
      type: 'call' as const,
      handler: () => {
        if (actionsRef) {
          const latest = actionsRef.current.find(item => item.id === a.id)
          if (latest) {
            latest.onRun()
            return
          }
        }
        a.onRun()
      },
    },
  }))
}

/**
 * Attach result badges and the Run callback to a page index. `log` links stay
 * display-only (#891/#894): scroll target + badges, no Run affordance.
 * Exported so multi-editor pages (journal date) can wire per-note outlines.
 */
export function wirePageIndexLinks(
  base: PageNavLink[],
  scriptBlocks: ScriptBlock[],
  onStartWorkout: ((block: ScriptBlock) => void) | undefined,
  results?: Session[],
  onEditNote?: () => void,
): PageNavLink[] {
  const wired = base.map(link => {
    if (link.type !== 'time' && link.type !== 'log') return link
    const lineNum = parseInt(link.id.replace(`${link.type}-line-`, ''), 10)
    const block = scriptBlocks.find(b => b.startLine + 1 === lineNum)
    let badge: { hasResult?: boolean; resultCount?: number } = {}
    if (results && block) {
      const { current } = groupResultsByVersion(results, block.id, block.contentId)
      badge = {
        hasResult: current.length > 0,
        resultCount: current.length,
      }
    }

    // Log links are display-only (#891/#894): badges yes, Run affordance no.
    if (link.type === 'log') return { ...link, ...badge }

    // Pages without a run handler (reference-material bodies) keep time
    // links display-only too.
    if (!onStartWorkout) return { ...link, ...badge }

    return {
      ...link,
      ...badge,
      onRun: () => {
        // Re-resolve at click time in case `scriptBlocks` changed.
        // Falls back to `scriptBlocks[0]` to preserve prior behavior of all
        // parser has produced a precise match still runs *something*.
        const resolvedBlock =
          block || scriptBlocks.find(b => b.startLine + 1 === lineNum) || scriptBlocks[0]
        if (resolvedBlock) onStartWorkout(resolvedBlock)
      },
    }
  })
  if (onEditNote) {
    const headerIdx = wired.findIndex(l => l.type === 'heading')
    const targetIdx = headerIdx !== -1 ? headerIdx : 0
    if (wired[targetIdx]) {
      return wired.map((link, idx) =>
        idx === targetIdx ? { ...link, onRun: onEditNote, runIcon: 'edit' as const } : link,
      )
    }
  }
  return wired
}

/**
 * Build the page index, wire each `time` link's `onRun`, and publish to L3 nav.
 * Returns the resolved `PageNavLink[]` so the page can pass it to its shell.
 */
export function useNotePageNav({
  content,
  scriptBlocks,
  onStartWorkout,
  results,
  onEditNote,
  helpfulActions,
  enabled = true,
}: UseNotePageNavOptions): PageNavLink[] {
  const index = useMemo(
    () => wirePageIndexLinks(extractPageIndex(content), scriptBlocks, onStartWorkout, results, onEditNote),
    [content, scriptBlocks, onStartWorkout, results, onEditNote],
  )

  // Latest helpful actions by ref; the publish effect re-runs when their
  // signature (ids + labels + keys) changes, so freshly loaded closures
  // replace the published handlers without re-running every render.
  const helpfulRef = useRef<readonly NoteHelpfulAction[]>(helpfulActions ?? [])
  helpfulRef.current = helpfulActions ?? []
  const helpfulSig = helpfulRef.current.map(a => [a.id, a.label, a.key ?? ''].join(':')).join(';')

  const { setL3Items } = useNav()
  useEffect(() => {
    if (!enabled) return
    return () => setL3Items([])
  }, [enabled, setL3Items])

  useEffect(() => {
    if (!enabled) return
    setL3Items([...mapIndexToL3(index), ...helpfulActionsToL3(helpfulRef.current, helpfulRef)])
  }, [enabled, index, setL3Items, helpfulSig])
  return index
}
