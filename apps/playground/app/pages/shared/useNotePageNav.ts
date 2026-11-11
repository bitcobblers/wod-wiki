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

import { useEffect, useMemo, useRef, type ComponentType } from 'react'
import { PlusCircle } from 'lucide-react'
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'
import type { ScriptBlock } from '@/components/Editor/types'
import type { Session } from '@/types/storage'
import { openCreateReferenceDialog } from '../../components/organisms/references/CreateReferenceFromLabelDialog'
import { useNav, type L3ActionItem } from '../../nav/NavContext'
import { extractPageIndex, mapIndexToL3 } from './pageUtils'
import { useLiveNoteFacets } from './useLiveNoteFacets'
import { groupResultsByVersion } from '@/utils/groupResultsByVersion';

const QUERY_FENCE_RE = /^[ \t]*```query\b/m

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
   * Per-page L3 context actions (Add timer, Clone, Note placements, Reset,
   * Copy link…), published into L3 Slot 3 ("Actions") via `setL3Actions`
   * so "On this page" remains purely structural Goto anchors.
   */
  helpfulActions?: NoteHelpfulAction[]
  /** Optional canonical note id so unrecognized-label creation rebuilds this note's containment index. */
  noteId?: string
  /** Set false on YAML entity definition pages (Effort/Equipment) so unsaved self-definitions don't prompt. */
  enableUnrecognizedActions?: boolean
  /** Set to false on pages/modes where outline is managed elsewhere (e.g. multi-note dates). */
  enabled?: boolean
}

/** A per-page L3 context action rendered under the "Actions" section. */
export interface NoteHelpfulAction {
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
  onRun: () => void
  disabled?: boolean
  testId?: string
  /**
   * Bump to re-publish when the handler closes over freshly loaded data
   * (e.g. the resolved effort). ids/labels already re-publish.
   */
  key?: string
}

/** Convert note helpful actions into L3 Slot 3 action rows with latest-closure lookup. */
export function helpfulActionsToL3Actions(
  actions: readonly NoteHelpfulAction[],
  actionsRef?: { current: readonly NoteHelpfulAction[] },
): L3ActionItem[] {
  return actions.map(a => ({
    id: `helpful-${a.id}`,
    label: a.label,
    icon: a.icon,
    disabled: a.disabled,
    testId: a.testId,
    onRun: () => {
      if (actionsRef) {
        const latest = actionsRef.current.find(item => item.id === a.id)
        if (latest) {
          latest.onRun()
          return
        }
      }
      a.onRun()
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
  noteId,
  enableUnrecognizedActions = true,
  enabled = true,
}: UseNotePageNavOptions): PageNavLink[] {
  const index = useMemo(
    () => wirePageIndexLinks(extractPageIndex(content), scriptBlocks, onStartWorkout, results, onEditNote),
    [content, scriptBlocks, onStartWorkout, results, onEditNote],
  )

  const hasEmbeddedQueryBlocks = useMemo(() => QUERY_FENCE_RE.test(content), [content])

  const liveFacets = useLiveNoteFacets(content, {
    enabled: enabled && enableUnrecognizedActions,
  })

  const defineActions = useMemo<NoteHelpfulAction[]>(() => {
    if (!enableUnrecognizedActions) return []
    return liveFacets.unrecognized.slice(0, 6).map(item => {
      const displayLabel = item.suggestedKind === 'tag' ? `#${item.rawLabel}` : item.rawLabel
      return {
        id: `define-${item.suggestedKind}-${item.candidateSlug}`,
        label: `Define "${displayLabel}"…`,
        icon: PlusCircle,
        testId: `l3-define-${item.candidateSlug}`,
        key: noteId ?? '',
        onRun: () => openCreateReferenceDialog({ item, noteId }),
      }
    })
  }, [enableUnrecognizedActions, liveFacets.unrecognized, noteId])

  const combinedActions = useMemo<readonly NoteHelpfulAction[]>(
    () => (defineActions.length > 0 ? [...defineActions, ...(helpfulActions ?? [])] : (helpfulActions ?? [])),
    [defineActions, helpfulActions],
  )

  // Latest helpful actions by ref; the publish effect re-runs when their
  // signature (ids + labels + keys + disabled) changes, so freshly loaded
  // closures replace the published handlers without re-running every render.
  const helpfulRef = useRef<readonly NoteHelpfulAction[]>(combinedActions)
  helpfulRef.current = combinedActions
  const helpfulSig = helpfulRef.current
    .map(a => [a.id, a.label, a.key ?? '', a.disabled ? '1' : '0'].join(':'))
    .join(';')

  const { setL3Items, setL3Actions, setAnalyticsControls } = useNav()

  useEffect(() => {
    if (!enabled) return
    return () => {
      setL3Items([])
      setL3Actions?.([])
      setAnalyticsControls?.(null)
    }
  }, [enabled, setL3Items, setL3Actions, setAnalyticsControls])

  useEffect(() => {
    if (!enabled) return
    setL3Items(mapIndexToL3(index))
  }, [enabled, index, setL3Items])

  useEffect(() => {
    if (!enabled) return
    setL3Actions?.(helpfulActionsToL3Actions(helpfulRef.current, helpfulRef))
  }, [enabled, setL3Actions, helpfulSig])

  useEffect(() => {
    if (!enabled) return
    setAnalyticsControls?.(hasEmbeddedQueryBlocks ? { showRange: false, showUnits: true } : null)
  }, [enabled, hasEmbeddedQueryBlocks, setAnalyticsControls])

  return index
}
