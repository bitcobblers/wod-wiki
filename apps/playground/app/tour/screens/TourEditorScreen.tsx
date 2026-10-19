import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Play, Copy, Check, ExternalLink } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { NoteEditor } from '@/components/organisms/editor/NoteEditor'
import type { ScriptBlock } from '@/components/Editor/types'
import type { ScriptCommand } from '@/components/Editor/overlays/ScriptCommand'
import { shareBlock, openBlockInPlaygroundNewTab } from '../../services/openInPlayground'
import { useRingRef } from '../TourRing'
import { TEST_IDS } from '@/testing/contracts/TestIdContract'
export interface TourEditorScreenProps {
  doc: string
  onDocChange: (next: string) => void
  onBlocksChange: (blocks: ScriptBlock[]) => void
  /** Starts the fullscreen playground bound to this editor's first block. */
  onRun: () => void
  theme: string
  /**
   * Opt in to ring-target registration (#884): the measured fenced-block
   * region under 'editor.wodBlock' and the Run button under
   * 'editor.runButton'.
   */
  withRingTargets?: boolean
}

interface BlockBox {
  top: number
  left: number
  width: number
  height: number
}

export const TourEditorScreen: React.FC<TourEditorScreenProps> = ({
  doc,
  onDocChange,
  onBlocksChange,
  onRun,
  theme,
  withRingTargets = false,
}) => {
  const wodBlockRef = useRingRef('editor.wodBlock')
  const runButtonRef = useRingRef('editor.runButton')
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [blockBox, setBlockBox] = useState<BlockBox | null>(null)
  const [runBox, setRunBox] = useState<BlockBox | null>(null)
  // Card 2 highlight (#884): measure the styled fence lines
  // (.cm-wod-fence-open … .cm-wod-fence-close, drawn by previewDecorations)
  // and register an invisible proxy over exactly that region. Presets are
  // line-aligned so this box is identical for every adventure pick.
  const measure = useCallback(() => {
    if (!withRingTargets) return null
    const body = bodyRef.current
    if (!body) return null

    // Measure the styled fence lines (.cm-wod-fence-open … .cm-wod-fence-close,
    // drawn by previewDecorations) in VIEWPORT space and convert to body
    // space. getBoundingClientRect is scroll- and padding-correct; CM block
    // coordinates (lineBlockAt) are document-space and would misplace the
    // proxy by the scroller's scroll offset.
    let block: BlockBox | null = null
    const open = body.querySelector('.cm-wod-fence-open')
    const close = body.querySelector('.cm-wod-fence-close')
    if (open && close) {
      const bodyRect = body.getBoundingClientRect()
      const openRect = open.getBoundingClientRect()
      const closeRect = close.getBoundingClientRect()
      // A proxy is only registered while its source is actually on screen —
      // an absent/offscreen target must never draw a ring border at a
      // clipped or stale position.
      const visible =
        openRect.top >= bodyRect.top - 2 &&
        closeRect.bottom <= bodyRect.bottom + 2
      if (visible) {
        const scale = body.offsetWidth ? bodyRect.width / body.offsetWidth : 1
        block = {
          top: (openRect.top - bodyRect.top) / scale,
          left: (Math.min(openRect.left, closeRect.left) - bodyRect.left) / scale,
          width: (Math.max(openRect.right, closeRect.right) - Math.min(openRect.left, closeRect.left)) / scale,
          height: (closeRect.bottom - openRect.top) / scale,
        }
      }
    }
    setBlockBox(block)

    // Measure the Run command rendered on the workout block by
    // InlineCommandBar — by its testid, never a looser heuristic.
    let run: BlockBox | null = null
    const runPill = body.querySelector(`[data-testid="${TEST_IDS.EDITOR_START_WORKOUT}"]`)
    if (runPill) {
      const bodyRect = body.getBoundingClientRect()
      const pillRect = runPill.getBoundingClientRect()
      const visible =
        pillRect.width > 0 &&
        pillRect.height > 0 &&
        pillRect.top >= bodyRect.top - 2 &&
        pillRect.bottom <= bodyRect.bottom + 2 &&
        pillRect.left >= bodyRect.left - 2 &&
        pillRect.right <= bodyRect.right + 2
      if (visible) {
        const scale = body.offsetWidth ? bodyRect.width / body.offsetWidth : 1
        run = {
          top: (pillRect.top - bodyRect.top) / scale,
          left: (pillRect.left - bodyRect.left) / scale,
          width: pillRect.width / scale,
          height: pillRect.height / scale,
        }
      }
    }
    setRunBox(run)
    return { block, run }
  }, [withRingTargets])

  useLayoutEffect(() => {
    if (!withRingTargets) return
    const body = bodyRef.current
    if (!body) return

    measure()
    // Re-measure after CM decorates/fonts settle and on container resizes.
    const t1 = window.setTimeout(measure, 120)
    const t2 = window.setTimeout(measure, 480)
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(body)
      // Font load / decoration settle changes line heights INSIDE the
      // fixed-height editor without resizing the body — the fence proxy
      // goes stale unless the CM content itself is watched.
      const content = viewRef.current?.contentDOM
      if (content) ro.observe(content)
    }
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.target instanceof Element && record.target.closest('.cm-note-editor'))) measure()
    })
    mutations.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    // Settle loop: absolutely-positioned chrome (the InlineCommandBar Run
    // pill) shifts with section geometry when fonts swap, without resizing
    // anything the observers above watch, and its React re-render can land
    // AFTER fonts.ready fires. Re-measure every frame for a fixed window so
    // the proxies converge wherever the layout lands. Restarted by
    // fonts.ready — the swap can land later than the initial window.
    let raf = 0
    let started = 0
    const settle = () => {
      measure()
      if (performance.now() - started < 3000) raf = requestAnimationFrame(settle)
    }
    const startSettle = () => {
      started = performance.now()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(settle)
    }
    startSettle()
    // Webfonts resolve after the settle timers; line heights (and thus the
    // fence position) change when the monospace face swaps in.
    document.fonts?.ready?.then(startSettle).catch(() => {})
    // The proxies are body-absolute but the fence scrolls inside the CM
    // scroller — re-measure on scroll or the ring drifts off the block.
    const scroller = viewRef.current?.scrollDOM
    scroller?.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      ro?.disconnect()
      mutations.disconnect()
      scroller?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      cancelAnimationFrame(raf)
    }
  }, [doc, withRingTargets, measure])
  const handleStartWorkout = useCallback(() => {
    onRun()
  }, [onRun])

  const commands = useMemo<ScriptCommand[]>(() => [
    {
      id: 'run',
      label: 'Run',
      icon: <Play className="h-3 w-3 fill-current" />,
      primary: true,
      onClick: handleStartWorkout,
    },
    {
      id: 'playground',
      label: 'Playground',
      icon: <ExternalLink className="h-3 w-3" />,
      onClick: (block) => {
        openBlockInPlaygroundNewTab(block)
      },
      splitIcon: <Copy className="h-3 w-3" />,
      splitSuccessIcon: <Check className="h-3 w-3 text-emerald-500" />,
      onSplitClick: (block) => {
        shareBlock(block)
      },
    },
  ], [handleStartWorkout])

  return (
    <div className="relative flex h-full flex-col bg-background text-left">
      <div ref={bodyRef} className="relative flex-1 min-h-0">
        <NoteEditor
          noteId="canvas:home"
          value={doc}
          onChange={onDocChange}
          onBlocksChange={onBlocksChange}
          onStartWorkout={handleStartWorkout}
          commands={commands}
          onViewCreated={(view) => {
            viewRef.current = view
            if (withRingTargets) measure()
          }}
          theme={theme}
          readonly={false}
          showLineNumbers={false}
          showFrontmatter={false}
          enableOverlay={false}
          enableInlineRuntime={false}
          className="h-full"
        />
        {withRingTargets && blockBox && (
          <div
            ref={wodBlockRef}
            data-testid="tour-wod-block-region"
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              top: blockBox.top,
              left: blockBox.left,
              width: blockBox.width,
              height: blockBox.height,
            }}
          />
        )}
        {withRingTargets && runBox && (
          <div
            ref={runButtonRef}
            data-testid="tour-run-button-region"
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              top: runBox.top,
              left: runBox.left,
              width: runBox.width,
              height: runBox.height,
            }}
          />
        )}
      </div>
    </div>
  )
}
