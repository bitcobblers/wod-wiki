/**
 * TourSectionRunway.tsx — one tagged section of the redesigned home page:
 * a static half-viewport tagline header followed by its own sticky demo
 * runway (own scroll driver, pips, captions column, ring).
 *
 * The old single 1300vh runway was split into four of these — Write it in
 * Markdown / Run it as a Timer / Own the Metrics / Explore your analytics —
 * so each tagline level gets a real scroll-past header and a focused stage
 * group. Heavy screens mount lazily on first section entry and stay alive
 * after (session analytics/result panes mount only while their stage is
 * shown), matching the old single-driver `entered` contract; the write
 * section's editor stays mounted from load exactly as before (the hero view
 * above it is a separate HomeTour-level display of the same shared doc).
 *
 * The sticky window/pip/context-row chrome is the shared canvas RunwayShell
 * (also used by guide runways and the chapter section); this component keeps
 * the scroll driver, screens, ring and TV/toast scrub logic.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { MacOSChrome } from '../components/atoms/MacOSChrome'
import type { ScriptBlock, Sessions } from '@/components/Editor/types'
import type { IScriptRuntime } from '@bitcobblers/wod-wiki-engine'
import type { ScrollStage } from '../canvas/parseCanvasMarkdown'
import { useScrollRunway, scrollRunwayTo } from '../canvas/useScrollRunway'
import { ScrollGate } from '../scroll/ScrollTrackProvider'
import { RunwayShell } from '../canvas/RunwayShell'
import type { ScrollSlice } from '../canvas/scrollRunway'
import {
  SCREEN_TITLES,
  TOUR_ACCENTS,
  type TourScreen,
  type RingTargetKey,
} from './tourConstants'
import { RingElementRegistrar, RingTargetsProvider, TourRing } from './TourRing'
import { TourTvCard } from './TourTvCard'
import { TourEditorScreen } from './screens/TourEditorScreen'
import { TourTimerScreen } from './screens/TourTimerScreen'
import { TourSessionAnalytics } from './screens/TourSessionAnalytics'
import { TourSessionResult } from './screens/TourSessionResult'
import { TourCaptions, type TourCaption } from './TourCaptions'

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export interface TourSectionEditorWiring {
  doc: string
  theme: string
  onDocChange: (next: string) => void
  onBlocksChange: (blocks: ScriptBlock[]) => void
  onRun: () => void
}

export interface TourSectionTimerWiring {
  sessionKey: number
  block: ScriptBlock | null
  autoStart: boolean
  /** Host-driven finalize stop (metrics arrival / reset chaining). */
  externalStop?: boolean
  onClose: () => void
  onComplete: (blockId: string, results: Sessions) => void
  onRuntimeReady: (runtime: IScriptRuntime) => void
  /** First idle→running transition of the current pane's execution. */
  onRunStarted?: () => void
  /** Idle-clock CTA when no block is wired yet (fresh-note save-first). */
  onStart?: () => void
  onReset: () => void
}

/** Session WQL/dashboard/result wiring for a section's stage pane. */
export interface TourSectionSessionWiring {
  noteId: string | null
  queryKey: string
  boardSlug: string
  /** Pin the pane to one stage (e.g. the run section's dashboard board). */
  fixedStage?: string
  /**
   * Recorded run results — the run section's result stage renders them via
   * TourSessionResult; without a result the stage shows an empty-state note.
   */
  result?: Sessions | null
}

export interface TourSectionRunwayProps {
  /** Stable section slug — drives testids. */
  id: string
  /** Track height, e.g. '420vh'. */
  heightVh: string
  /** Static half-viewport header scrolled past before the sticky window. */
  header?: ReactNode
  stages: ScrollStage[]
  /** Caption subset matching `stages` order. */
  captions: TourCaption[]
  /** Discrete active-stage notifications (quest marking, pause derivation). */
  onActiveStageChange?: (stageId: string) => void
  /** Persistent viewport signal (scroll-out pause derivation for the host). */
  onViewportChange?: (inView: boolean) => void
  /** Persistent signal when section top reaches or passes viewport top. */
  onReachedChange?: (reached: boolean) => void
  /** Caption command buttons (Try it / query presets / board picks). */
  onCommand?: (captionId: string, key: string) => void
  /** Session WQL/dashboard pane (explore section). Omitted → static showcase. */
  session?: TourSectionSessionWiring
  editor?: TourSectionEditorWiring
  timer?: TourSectionTimerWiring
  /** Ambient runtime feeding the cast TV card (run section). */
  tvRuntime?: IScriptRuntime | null
  /**
   * Stage whose local progress raises the TV card (run section: timer-cast).
   * Omitted → no TV card.
   */
  tvStageId?: string
  /** Toast label shown during the section's final beat (explore section). */
  toastLabel?: string | null
}

export interface TourSectionRunwayApi {
  /** Smooth-scroll the section track onto a stage's early span. */
  scrollToStage: (stageId: string) => void
  /** Per-frame scrub subscription for host-driven effects (typewriter reset). */
  subscribe: (cb: (slice: ScrollSlice, progress: number) => void) => () => void
  /** Force a re-sync from the current scroll position (playground exit). */
  resync: () => void
}

/** Cross-fade wrapper for a screen inside the section window. */
function Screen({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <div
      className="absolute inset-0 transition-opacity duration-500"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
      aria-hidden={!visible}
      inert={!visible}
    >
      {children}
    </div>
  )
}

export const TourSectionRunway = forwardRef<TourSectionRunwayApi, TourSectionRunwayProps>(
  function TourSectionRunway(
    {
      id,
      heightVh,
      header,
      stages,
      captions,
      onActiveStageChange,
      onViewportChange,
      onReachedChange,
      onCommand,
      session,
      editor,
      timer,
      tvRuntime,
      tvStageId,
      toastLabel,
    },
    ref,
  ) {
    const runwayRef = useRef<HTMLElement | null>(null)
    const canvasInnerRef = useRef<HTMLDivElement | null>(null)
    const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null)
    // The whole section window (outside the chrome) is the 'editor.window'
    // ring target. It is registered via <RingElementRegistrar> rendered
    // INSIDE the section's RingTargetsProvider — a useRingRef in this
    // component body would resolve to the outer (shared) provider.
    const canvasInnerRingRef = useCallback((el: HTMLDivElement | null) => {
      canvasInnerRef.current = el
      setCanvasEl(el)
    }, [])
    const tvCardRef = useRef<HTMLDivElement | null>(null)
    const toastRef = useRef<HTMLDivElement | null>(null)

    // The scroll driver: useScrollRunway — inside a ScrollTrackProvider
    // (the home page) it delegates measurement to the shared track, so
    // all four sections resolve from one continuous track position;
    // outside a track it runs its own driver, unchanged. The section id
    // keys its track segment (and its scroll gates).
    const { slice, subscribe, resync, runwayReached } = useScrollRunway(runwayRef, false, stages, id)
    const inView = useInView(runwayRef)
    useEffect(() => {
      onViewportChange?.(inView)
    }, [inView, onViewportChange])
    useEffect(() => {
      onReachedChange?.(runwayReached)
    }, [runwayReached, onReachedChange])


    const [everReached, setEverReached] = useState(false)
    const reachedOnce = useReachedOnce(runwayRef)
    useEffect(() => {
      if (reachedOnce || runwayReached) setEverReached(true)
    }, [reachedOnce, runwayReached])

    const activeScreen: TourScreen =
      (slice.stage?.screen as TourScreen | undefined) ?? 'editor'
    const sessionStageShown =
      activeScreen === 'analytics' || activeScreen === 'metrics' || activeScreen === 'result'
    // Heavy panes mount once their section first enters; keep alive. The
    // runtime-carrying timer pane additionally mounts only after its stage
    // was ACTIVELY visited — skipping straight past the run stages (e.g.
    // jump-to-metrics) never creates a runtime.
    const [timerEngaged, setTimerEngaged] = useState(false)
    useEffect(() => {
      if (activeScreen === 'timer') setTimerEngaged(true)
    }, [activeScreen])
    const showScreens = everReached

    // Notify once per stage change — never per render. Parent handlers are
    // inline closures; re-running on their identity would loop
    // setActiveStages -> render -> effect forever (max update depth).
    const lastNotifiedStageRef = useRef<string | null>(null)
    useEffect(() => {
      if (!everReached) return
      if (lastNotifiedStageRef.current === slice.stage?.id) return
      lastNotifiedStageRef.current = slice.stage?.id ?? null
      if (slice.stage?.id) onActiveStageChange?.(slice.stage.id)
    }, [slice.stage?.id, onActiveStageChange, everReached])

    // Imperative scrub: TV parallax + stop toast — transform/opacity only.
    useEffect(() => {
      return subscribe((s: ScrollSlice) => {
        const tv = tvCardRef.current
        if (tv) {
          if (tvStageId && s.stage.id === tvStageId) {
            const k = clamp01((s.t - 0.2) / 0.5)
            const e = 1 - Math.pow(1 - k, 2)
            tv.style.opacity = String(k)
            tv.style.transform = `translateY(${lerp(90, 0, e)}px)`
          } else {
            tv.style.opacity = '0'
          }
        }

        const toast = toastRef.current
        if (toast) {
          if (toastLabel != null && s.index === stages.length - 1) {
            const tIn = clamp01((s.t - 0.04) / 0.2)
            const tOut = clamp01((s.t - 0.7) / 0.2)
            toast.style.opacity = String(Math.max(0, tIn - tOut))
            toast.style.transform = `translateY(${lerp(-14, 0, tIn)}px)`
          } else {
            toast.style.opacity = '0'
          }
        }
      })
    }, [subscribe, tvStageId, toastLabel, stages.length])

    useImperativeHandle(
      ref,
      () => ({
        scrollToStage: (stageId: string) => {
          const el = runwayRef.current
          const stage = stages.find((s) => s.id === stageId)
          if (!el || !stage) return
          scrollRunwayTo(el, Math.min(stage.range[0] + 0.02, stage.range[1] - 0.005))
        },
        subscribe,
        resync,
      }),
      [stages, subscribe, resync],
    )

    return (
      <section id={`tour-section-${id}`} data-testid={`tour-section-${id}`}>
        {header}
        <RunwayShell
          trackRef={runwayRef}
          height={heightVh}
          stages={stages}
          activeIndex={slice.index}
          segmentId={id}
          testId="tour-runway"
          status={
            toastLabel != null ? (
              <div
                ref={toastRef}
                className="pointer-events-none flex items-center gap-2.5 whitespace-nowrap rounded-full border border-primary/40 bg-card px-5 py-2.5 font-mono text-[10.5px] tracking-[0.04em] opacity-0 shadow-xl"
              >
                <span className="size-[9px] rounded-sm bg-primary" />
                {toastLabel}
              </div>
            ) : undefined
          }
          pane={
            /* the RingTargetsProvider scopes the ring registry to THIS
               section; every runway registers 'editor.window', so a shared
               registry lets later sections steal earlier ones' ring targets
               (ring drawn around an off-screen window). */
            <div ref={canvasInnerRingRef} className="absolute inset-0 flex flex-col justify-center">
              <RingTargetsProvider>
              <RingElementRegistrar ringKey="editor.window" el={canvasEl} />
              {/* Card hugs a sane cap instead of impersonating the full
                  dwell window — on tall viewports the demo stops stretching
                  into mostly-empty chrome (audit F3). */}
              <MacOSChrome title={SCREEN_TITLES[activeScreen]} className="relative h-full max-h-[760px]">
                {/* The pane is a scroll gate: its inner scrollers (editor)
                    yield to the page track until the user edits inside. */}
                <ScrollGate gateId={`${id}-pane`} segmentId={id} className="relative h-full">
                  {editor && (
                    <Screen visible={activeScreen === 'editor'}>
                      <TourEditorScreen
                        doc={editor.doc}
                        onDocChange={editor.onDocChange}
                        onBlocksChange={editor.onBlocksChange}
                        onRun={editor.onRun}
                        theme={editor.theme}
                        withRingTargets
                      />
                    </Screen>
                  )}
                  {showScreens && timer && timerEngaged && (
                    <Screen visible={activeScreen === 'timer'}>
                      <TourTimerScreen
                        key={timer.sessionKey}
                        block={timer.block}
                        autoStart={timer.autoStart}
                        onClose={timer.onClose}
                        onComplete={timer.onComplete}
                        onRuntimeReady={timer.onRuntimeReady}
                        onRunStarted={timer.onRunStarted}
                        onStart={timer.onStart}
                        onReset={timer.onReset}
                        externalStop={timer.externalStop}
                      />
                    </Screen>
                  )}
                  {showScreens && session && sessionStageShown && inView && (
                    <Screen visible={sessionStageShown}>
                      {activeScreen === 'result' ? (
                        session.result ? (
                          <TourSessionResult result={session.result} />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center p-6 text-sm text-muted-foreground" data-testid="tour-result-empty">
                            Run the example above to see your output here.
                          </div>
                        )
                      ) : (
                        <TourSessionAnalytics
                          activeStageId={session.fixedStage ?? slice.stage.id}
                          noteId={session.noteId}
                          queryKey={session.queryKey}
                          boardSlug={session.boardSlug}
                        />
                      )}
                    </Screen>
                  )}
                </ScrollGate>
              </MacOSChrome>

              {tvStageId && <TourTvCard ref={tvCardRef} runtime={tvRuntime ?? null} />}

              <TourRing
                target={!slice.ring?.key ? null : { key: slice.ring.key as RingTargetKey }}
                accent={slice.stage.accent ?? TOUR_ACCENTS.editor}
                canvasRef={canvasInnerRef}
              />
              </RingTargetsProvider>
            </div>
          }
          captions={
            <TourCaptions
              activeIndex={slice.index}
              captions={captions}
              onCommand={onCommand}
            />
          }
        />
      </section>
    )
  },
)

/**
 * One-shot section-entry observer: true after any part of the sticky track
 * first scrolls into view; never resets. Drives lazy screen mounting.
 * Without IntersectionObserver (jsdom) it reports entered immediately.
 */
function useReachedOnce(runwayRef: React.RefObject<HTMLElement | null>): boolean {
  const [reached, setReached] = useState(false)
  useEffect(() => {
    const el = runwayRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setReached(true)
          observer.disconnect()
        }
      },
      { threshold: 0.05 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [runwayRef])
  return reached
}

/**
 * Persistent viewport signal for the sticky track. Without IntersectionObserver
 * (jsdom, ancient browsers) the section reports in-view — the pause contract
 * degrades to "never externally paused" rather than freezing mid-demo.
 */
function useInView(runwayRef: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = runwayRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.05,
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [runwayRef])
  return inView
}
