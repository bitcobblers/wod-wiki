/**
 * ScrollRunwaySection.tsx — the NORMAL-MOTION presentation of a ```scroll
 * runway (the slide runway): stage bar, typewriter-driven live editor,
 * cross-fading captions, editor ring, transient toasts, playground mode —
 * driven entirely by the parsed ScrollSpec and rendered through the shared
 * RunwayShell (the home first-four chrome). One branch of the Runway Adapter
 * (#936): the adapter routes every normal-motion form factor here (the
 * shell's context-measured row adapts 60/40 vs stack) and reduced-motion to
 * RunwayReduced — so this file no longer self-detects breakpoint or motion
 * preference; the adapter decides Form Factor.
 *
 * Deliberately page-agnostic: no fullscreen runtime, trailing sections, or
 * page-level quest validation (those stay on ScrollCanvasPage). Run and
 * stage-entry are surfaced via callbacks so the host page wires its own
 * actions / quest completion.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorWindow } from '../components/organisms/editor/EditorWindow'
import type { ScriptBlock } from '@/components/Editor/types'
import {
  type ScrollSpec,
} from './parseCanvasMarkdown'
import { resolveSource } from './canvasUtils'
import { clamp01, isStageTextLoaded, lerp, quadOut } from './scrollRunway'
import { useScrollRunway } from './useScrollRunway'
import { useScrollTypewriter } from './useScrollTypewriter'
import { RunwayShell } from './RunwayShell'
import { ScrollCaption } from './ScrollCaption'
import { ScrollToast } from './ScrollToast'
import { ScrollRing } from './ScrollRing'

export interface ScrollRunwaySectionProps {
  scroll: ScrollSpec
  wodFiles: Record<string, string>
  theme: string
  /** Window-chrome title (e.g. `chapters.md`). */
  noteTitle?: string
  showFrontmatter?: boolean
  /** Controlled editor document (with `onDocChange`) — a host that owns the runway's doc (ScrollCanvasPage: swapSource + runtime) passes it; omit for an uncontrolled runway (home chapter tour). */
  doc?: string
  onDocChange?: (doc: string) => void
  /** Fired when the compiled blocks change (feeds the host's live block). */
  onBlocksChange?: (blocks: ScriptBlock[]) => void
  /** Called when a stage enters (non-interactive). Wire chapter quest completion / telemetry. */
  onStageEnter?: (stageId: string) => void
  /** Run handler — opens the host's playground with the current doc + compiled block. When omitted, Run is hidden. */
  onRun?: (doc: string, block: ScriptBlock | null) => void
  className?: string
}

export function ScrollRunwaySection({
  scroll,
  wodFiles,
  theme,
  noteTitle = 'note.md',
  showFrontmatter,
  doc: controlledDoc,
  onDocChange,
  onBlocksChange,
  onStageEnter,
  onRun,
  className,
}: ScrollRunwaySectionProps) {
  const stages = scroll.stages

  const runwayRef = useRef<HTMLElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const toastRef = useRef<HTMLDivElement | null>(null)
  const touchedEffectsRef = useRef<Set<string>>(new Set())

  const sourcesByStageId = useMemo(
    () =>
      Object.fromEntries(
        stages.map((s) => [s.id, s.source ? resolveSource(s.source, wodFiles) : '']),
      ),
    [stages, wodFiles],
  )
  // Controlled-or-uncontrolled document: a host that owns the runway's doc
  // (ScrollCanvasPage — swapSource + runtime) passes doc/onDocChange; otherwise
  // the runway keeps its own.
  const [internalDoc, setInternalDoc] = useState(() => sourcesByStageId[stages[0]?.id] ?? '')
  const doc = controlledDoc ?? internalDoc
  const setDoc = onDocChange ?? setInternalDoc

  const [interactive, setInteractive] = useState(false)

  const { slice, subscribe, resync } = useScrollRunway(runwayRef, interactive, stages)

  // Only report stage entry once the runway is actually on-screen — the
  // section may be embedded far down a page, so resolving stage 0 at mount
  // must not fire the host's stage-enter side effects before the user
  // scrolls the runway into view.
  const [runwayVisible, setRunwayVisible] = useState(false)
  useEffect(() => {
    const el = runwayRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setRunwayVisible(true) },
      { rootMargin: '100px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { userDiverged } = useScrollTypewriter({
    sourcesByStageId,
    doc,
    setDoc,
    subscribe,
    enabled: !interactive && scroll.typewriter,
  })

  const stageId = slice.stage.id
  // Focus follows load: the ring waits for the stage's full script — both
  // for the typewriter's completion and for auto-loaded (instant) text —
  // so it never frames lines that are still being written.
  const stageTextLoaded = isStageTextLoaded(sourcesByStageId[stageId] ?? '', doc)
  useEffect(() => {
    if (!interactive && runwayVisible) onStageEnter?.(stageId)
  }, [interactive, stageId, runwayVisible, onStageEnter])

  // Re-sync after exiting playground mode and on stage change so newly-mounted
  // visuals get their first imperative frame immediately.
  useEffect(() => {
    if (!interactive) {
      const id = requestAnimationFrame(resync)
      return () => cancelAnimationFrame(id)
    }
  }, [interactive, resync])
  useEffect(() => {
    const id = requestAnimationFrame(resync)
    return () => cancelAnimationFrame(id)
  }, [stageId, resync])

  // Typing diverges from the typewriter trace → playground mode.
  useEffect(() => {
    if (userDiverged) setInteractive(true)
  }, [userDiverged])

  // Imperative scrub: toast fade + author-declared effects.
  useEffect(() => {
    const allEffects = stages.flatMap((s) => s.effects ?? [])
    return subscribe((s) => {
      const toast = toastRef.current
      if (toast) {
        const tIn = clamp01((s.t - 0.04) / 0.12)
        const tOut = clamp01((s.t - 0.5) / 0.2)
        toast.style.opacity = String(Math.max(0, tIn - tOut))
        toast.style.transform = `translateX(-50%) translateY(${lerp(-14, 0, tIn)}px)`
      }
      const root = rootRef.current
      if (!root) return
      const touched = new Set<string>()
      for (const fx of allEffects) {
        if (!fx.stages.includes(s.stage.id)) continue
        touched.add(fx.target)
        const [inStart, inEnd] = fx.in ?? [0, 1]
        const k = inEnd > inStart ? clamp01((s.t - inStart) / (inEnd - inStart)) : 1
        const e = fx.ease === 'linear' ? k : quadOut(k)
        root.querySelectorAll<HTMLElement>(`[data-effect-target="${fx.target}"]`).forEach((el) => {
          if (fx.opacity) el.style.opacity = String(lerp(fx.opacity[0], fx.opacity[1], e))
          if (fx.translateY) el.style.transform = `translateY(${lerp(fx.translateY[0], fx.translateY[1], e)}px)`
        })
      }
      for (const target of touchedEffectsRef.current) {
        if (touched.has(target)) continue
        root.querySelectorAll<HTMLElement>(`[data-effect-target="${target}"]`).forEach((el) => {
          el.style.opacity = ''
          el.style.transform = ''
        })
      }
      touchedEffectsRef.current = touched
    })
  }, [subscribe, stages])

  const activeAccent = slice.stage.accent ?? 'hsl(var(--foreground))'

  // Presentation is the shared extracted shell (the home first-four pattern):
  // sticky 65px/lg104px dvh window, context-measured 60/40 split versus
  // stack — the same chrome mobile-normal-motion uses via RunwayAdapter. The
  // stage indicator renders in the pane's mac window header (shell context).
  // Host-owned here: scroll driver, typewriter, playground
  // mode, ring, toast, Run.
  return (
    <div ref={rootRef} className={className} data-testid="scroll-runway-section">
      <RunwayShell
        trackRef={runwayRef}
        height={scroll.runway}
        stages={stages}
        activeIndex={slice.index}
        status={
          <div className="truncate font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {interactive ? 'Playground mode' : slice.stage.id.replace(/-/g, ' ')}
          </div>
        }
        pane={
          <div className="absolute inset-0">
            <EditorWindow
              title={noteTitle ?? ''}
              noteId="canvas:scroll-runway"
              doc={doc}
              onDocChange={setDoc}
              onBlocksChange={onBlocksChange}
              theme={theme}
              showFrontmatter={showFrontmatter}
              run={onRun ? { onRun } : undefined}
              className="absolute inset-x-2 top-2 bottom-2"
            >
              {slice.stage.toast && (
                <ScrollToast ref={toastRef} text={slice.stage.toast} accent={activeAccent} />
              )}
            </EditorWindow>
            {slice.ring && !interactive && stageTextLoaded && (
              <ScrollRing accent={activeAccent} lines={slice.ring.lines} />
            )}
          </div>
        }
        captions={<ScrollCaption stages={stages} activeIndex={slice.index} />}
      />

      {/* playground-mode exit pill */}
      {interactive && (
        <button
          type="button"
          onClick={() => setInteractive(false)}
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-5 py-2.5 font-mono text-[10px] tracking-[0.06em] text-background opacity-95 transition-opacity hover:opacity-100"
        >
          ▶ Playground mode — {userDiverged ? 'your edits are kept' : 'editing'} · tap here to return to the tour
        </button>
      )}
    </div>
  )
}
