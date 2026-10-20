/**
 * TourSectionRunway.tsx — one tagged section with a sticky demo runway:
 * a static half-viewport tagline header followed by its own sticky demo
 * runway (own scroll driver, pips, captions column, ring).
 *
 * Used by the Learn-the-Language section (TourChapterPicker, SyntaxView):
 * editor stages typed chapter by chapter as the visitor scrolls. The home
 * page no longer uses a runway — its hero run + insights/boards sections
 * replaced the four-section tour.
 *
 * The sticky window/pip/context-row chrome is the shared canvas RunwayShell
 * (also used by guide runways); this component keeps the scroll driver,
 * screens, ring and caption strip.
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
import type { ScriptBlock } from '@/components/Editor/types'
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
import { TourEditorScreen } from './screens/TourEditorScreen'
import { TourCaptions, type TourCaption } from './TourCaptions'

export interface TourSectionEditorWiring {
  doc: string
  theme: string
  onDocChange: (next: string) => void
  onBlocksChange: (blocks: ScriptBlock[]) => void
  onRun: () => void
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
  /** Caption command buttons (Try it). */
  onCommand?: (captionId: string, key: string) => void
  editor?: TourSectionEditorWiring
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
      editor,
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
                </ScrollGate>
              </MacOSChrome>

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
