/**
 * HomeTour.tsx — the home page: hero + the Run it as a Timer walkthrough
 * section, then the Library & Community Feeds jump section, the offerings,
 * and the footer.
 *
 * The run section owns a sticky mini-runway (TourSectionRunway) driven by its
 * own scroll progress over the timer-* partition of the canonical ```scroll
 * spec.
 *
 * The section opens on an editor pane showing home-example.md (click Run —
 * or just keep scrolling — to start the demo timer; sliding back resets it
 * into a fresh playground session) and ends with the recorded output and a
 * dashboard view of the same data.
 *
 * One shared editor document lives in the hero viewport; the run-section
 * intro pane hosts its own home-example.md document.
 *
 * Preserved contracts:
 *  - Arrival (#882): /load?z= shared script replaces welcome-1.md in the hero.
 *  - quick-start quests (qs-arrive / qs-edit / qs-run) plus scroll quests
 *    fired as each tour stage scrolls into view
 *  - ChallengeHeaderBadge on '/' (mounted by App.tsx) — home quests only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { clearHomeShared, loadHomeShared, type HomeSharedScript } from '../services/homeSharedScript'
import { resolveSource } from '../canvas/canvasUtils'
import { GuideIndexFooter } from '../canvas/GuideIndexFooter'
import { NextEvent } from '@bitcobblers/wod-wiki-engine'
import type { IScriptRuntime } from '@bitcobblers/wod-wiki-engine'
import type { ScriptBlock, Sessions } from '@/components/Editor/types'
import type { Quest } from '../hooks/usePageQuests'
import type { Chapter, ScrollSpec, ScrollStage } from '../canvas/parseCanvasMarkdown'
import { useQuickStartAutoComplete } from '../hooks/useQuickStartAutoComplete'
import { useCompletionChallenge } from '../hooks/useCompletionChallenge'
import { useRunStartedChallenge } from '../hooks/useRunStartedChallenge'
import { useTourScrollQuests } from '../hooks/useTourScrollQuests'
import { usePlaygroundRun } from '../hooks/usePlaygroundRun'
import { useNav } from '../nav/NavContext'
import type { NavItemL3 } from '../nav/navTypes'
import { RingTargetsProvider } from './TourRing'
import { TOUR_ACCENTS, SCREEN_TITLES, type TourStageId } from './tourConstants'
import { TourHeroHeading } from './TourHero'
import { TourFooter } from './TourFooter'
import { OfferingTiers } from '../components/molecules/OfferingTiers'
import { MacOSChrome } from '../components/atoms/MacOSChrome'
import { TourEditorScreen } from './screens/TourEditorScreen'
import { FullscreenTimer } from '@/components/organisms/review/FullscreenTimer'
import { TourSessionResult } from './screens/TourSessionResult'
import {
  TOUR_CAPTIONS,
  type TourCaption,
} from './TourCaptions'
import {
  TourSectionRunway,
  type TourSectionRunwayApi,
} from './TourSectionRunway'
import { CelebrationBridge } from './CelebrationBridge'
import { TourFlatStack } from './TourFlatStack'
import { TourJumpSection } from './TourJumpSection'
import {
  ScrollGate,
  ScrollTrackProvider,
  useTrackAnchor,
} from '../scroll/ScrollTrackProvider'
import { TaglineHeader } from './TaglineHeader'
import { HOME_EVENTS, useTelemetry, useScrollTelemetry } from '@/services/telemetry'
import { toast } from '@/hooks/use-toast'
import { useMediaQuery } from '../hooks/useMediaQuery'
import {
  DEFAULT_BOARD_SLUG,
  DEFAULT_TABLE_QUERY_KEY,
} from './screens/TourSessionAnalytics'

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const HOME_DEMO_SOURCE = 'wods/examples/home/welcome-1.md'
/** The run-section intro pane example — a standalone file (copy of welcome-1.md for now). */
const HOME_EXAMPLE_SOURCE = 'wods/examples/home/home-example.md'

/**
 * Renormalize a partition of stages onto [0, 1] so each section's driver
 * resolves its own progress independently.
 */
function renormalize(stages: ScrollStage[]): ScrollStage[] {
  if (stages.length === 0) return stages
  const first = stages[0]!.range[0]
  const last = stages[stages.length - 1]!.range[1]
  const span = last - first
  return stages.map((s) => ({
    ...s,
    range: [
      span > 0 ? (s.range[0] - first) / span : 0,
      span > 0 ? (s.range[1] - first) / span : 1,
    ] as [number, number],
  }))
}

const DEFAULT_HOME_STAGES: ScrollStage[] = [
  {
    id: 'timer-intro',
    range: [0.10, 0.20],
    screen: 'editor',
    accent: TOUR_ACCENTS.editor,
    label: 'Click Run to Start the Timer',
    source: HOME_EXAMPLE_SOURCE,
    caption: 'Click Run to start the Timer. Weight, distance, reps & effort notation.',
    ring: { key: 'editor.runButton', tag: 'Run Button' },
  },
  {
    id: 'timer-wallclock',
    range: [0.20, 0.32],
    screen: 'timer',
    accent: TOUR_ACCENTS.timer,
    label: 'What Happens When It Runs',
    source: HOME_EXAMPLE_SOURCE,
    caption: 'What Happens When It Runs. The script becomes the clock.',
    ring: { key: 'timer.floor', tag: 'Clock' },
  },
  {
    id: 'timer-next',
    range: [0.32, 0.42],
    screen: 'timer',
    accent: TOUR_ACCENTS.timer,
    label: 'Advance Rounds with Next',
    source: HOME_EXAMPLE_SOURCE,
    caption: 'Next Advances the Workout. Every click locks a time.',
    ring: { key: 'timer.nextButton', tag: 'Next Button' },
  },
  {
    id: 'timer-cast',
    range: [0.42, 0.50],
    screen: 'timer',
    accent: TOUR_ACCENTS.timer,
    label: 'Cast to the Big Screen',
    source: HOME_EXAMPLE_SOURCE,
    caption: 'Cast to the Big Screen. Real-time mirror for the gym floor.',
    ring: { key: 'timer.castButton', tag: 'Cast' },
  },
  {
    id: 'timer-output',
    range: [0.50, 0.58],
    screen: 'result',
    accent: TOUR_ACCENTS.timer,
    label: 'Stop and See What You Logged',
    source: HOME_EXAMPLE_SOURCE,
    caption: 'Stop and See What You Logged. The run becomes a saved note.',
  },
  {
    id: 'timer-dashboard',
    range: [0.58, 0.66],
    screen: 'analytics',
    accent: TOUR_ACCENTS.analytics,
    label: 'Your Data Becomes a Dashboard',
    source: HOME_EXAMPLE_SOURCE,
    caption: 'Your Data Becomes a Dashboard. Every widget one query away.',
    ring: { key: 'analytics.dashboard', tag: 'Dashboard' },
  },
]

function captionsForStages(stages: ScrollStage[]): TourCaption[] {
  const byId: Record<string, TourCaption> = Object.fromEntries(
    TOUR_CAPTIONS.map((c) => [c.id as string, c]),
  )
  return stages.map((s) => byId[s.id]).filter((c): c is TourCaption => !!c)
}

// ── Props ───────────────────────────────────────────────────────────────────

export interface HomeTourProps {
  wodFiles: Record<string, string>
  theme: string
  /** Quick-start + scroll quests from the home canvas markdown. */
  quests: Quest[]
  /** Page-level chapters from the home canvas markdown (home-tour first). */
  chapters: Chapter[]
  /** Main tour ```scroll runway spec (partitioned across the two sections). */
  scroll?: ScrollSpec | null
}

// ── Inner (needs RingTargetsContext) ──────────────────────────────────────────

function HomeTourInner({ wodFiles, theme, quests, chapters, scroll }: HomeTourProps) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const telemetry = useTelemetry()
  const track = telemetry?.track
  useScrollTelemetry('/')

  // ── Editor document ──
  // Arrival contract (#882): the initial load content is the shared script
  // stored by /load?z= when present, else welcome-1.md (home intro page).
  //
  // ONE editor document: the desktop hero view and the write-section sticky
  // pane are two displays of the same doc state. Edits in either place are
  // edits to the run document.
  const welcomeScript = useMemo(() => resolveSource(HOME_DEMO_SOURCE, wodFiles), [wodFiles])
  const homeExampleScript = useMemo(() => resolveSource(HOME_EXAMPLE_SOURCE, wodFiles), [wodFiles])
  const [sharedScript, setSharedScript] = useState<HomeSharedScript | null>(() => loadHomeShared())
  const initialContent = sharedScript?.content ?? welcomeScript
  const sharedBy = sharedScript ? sharedScript.by?.trim() || 'anonymous' : undefined

  useEffect(() => {
    const onShared = (e: Event) => {
      const detail = (e as CustomEvent<HomeSharedScript | null>).detail
      if (detail?.content) {
        setSharedScript(detail)
        setDoc(detail.content)
      }
    }
    window.addEventListener('wodwiki:home-shared', onShared)
    return () => window.removeEventListener('wodwiki:home-shared', onShared)
  }, [])
  const [doc, setDoc] = useState(initialContent)
  const docRef = useRef(doc)
  docRef.current = doc
  const blocksRef = useRef<ScriptBlock[]>([])
  const editedRecordedRef = useRef(false)

  // The run-section intro pane hosts its OWN document (home-example.md) —
  // separate from the hero's shared welcome doc. Its Run button starts the
  // demo timer from this example, and slide-back resets restart it.
  const [exampleDoc, setExampleDoc] = useState(homeExampleScript)
  const exampleDocRef = useRef(exampleDoc)
  exampleDocRef.current = exampleDoc
  const exampleBlocksRef = useRef<ScriptBlock[]>([])
  const handleExampleDocChange = useCallback((next: string) => setExampleDoc(next), [])
  const handleExampleBlocksChange = useCallback((blocks: ScriptBlock[]) => {
    exampleBlocksRef.current = blocks
  }, [])

  // Runway runtime — set by the run section's inline timer pane; feeds the TV
  // card and lets the host pop the auto-start gate.
  const [tourRuntime, setTourRuntime] = useState<IScriptRuntime | null>(null)

  // ── Runway: the run section owns every timer-* stage of the canonical
  // ```scroll spec (a markdown-provided spec may still list wql-* stages —
  // the explore section they belonged to is gone, so they are dropped here).
  const canonicalStages = useMemo(() =>
    (scroll?.stages ?? DEFAULT_HOME_STAGES).map((stage) => ({ ...stage, accent: 'hsl(var(--primary))' })),
    [scroll],
  )
  const runStages = useMemo(
    () => renormalize(canonicalStages.filter((s) => s.id.startsWith('timer-'))),
    [canonicalStages],
  )
  const runCaptions = useMemo(() => captionsForStages(runStages), [runStages])

  const runApiRef = useRef<TourSectionRunwayApi | null>(null)

  const [runInView, setRunInView] = useState(false)
  const handleRunViewport = useCallback((inView: boolean) => setRunInView(inView), [])
  const [runReached, setRunReached] = useState(false)
  const handleRunReached = useCallback((reached: boolean) => setRunReached(reached), [])
  const [runStageId, setRunStageId] = useState<string | null>(null)
  const handleRunStageChange = useCallback((stageId: string) => {
    setRunStageId(stageId)
    markStageViewedRef.current?.(stageId as TourStageId)
  }, [])

  // ── Session results (inline playground run) ──
  const [session, setSession] = useState<Sessions | null>(null)
  // True while the current identity's execution is actually running — drives
  // the L3 outline's stop-the-timer transition button on the metrics row.
  const [runLive, setRunLive] = useState(false)
  // True while a visitor-initiated in-place run owns the hero viewport
  // (editor → timer → result). The tour's run section yields its timer pane
  // for the duration so two runtimes never execute the same identity.
  const [runLocation, setRunLocation] = useState<'tour' | 'hero'>('tour')
  const heroRunActive = runLocation === 'hero'
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const startingRef = useRef(false)
  // Scroll-stage ids arrive as plain strings from the markdown spec; the
  // quest hook keys on the constants union.
  const markStageViewedRef = useRef<(id: TourStageId) => void>(() => {})

  // ── Playground run identity (usePlaygroundRun — fresh note per run) ──
  const { run, recorded, pendingResults, start, finalize, reset, end } = usePlaygroundRun()
  const runRef = useRef(run)
  runRef.current = run
  // Whether the current run's execution ever left idle (panel onRunStarted)
  // and whether its results are already recorded — both gate which stop
  // path a host request can take.
  const runStartedRef = useRef(false)
  const finalizedRef = useRef(false)
  // A failed finalize keeps the outputs here; every subsequent host action
  // retries the save before proceeding (hook preserves pending until then).
  const unsavedRef = useRef<Sessions | null>(null)

  // Host-driven finalize stop: flipping this halts the live panel execution
  // and reports partial results (externalStop on RuntimeTimerPanel).
  const [externalStop, setExternalStop] = useState(false)
  const externalStopRef = useRef(false)
  const pendingActionRef = useRef<
    | { kind: 'apply-doc'; doc: string }
    | { kind: 'restart'; doc: string; block: ScriptBlock; sectionTitle: string; location: 'tour' | 'hero' }
    | { kind: 'restart-unstarted'; doc: string; block: ScriptBlock; sectionTitle: string; location: 'tour' | 'hero' }
    | { kind: 'reset' }
    | null
  >(null)

  // ── Session key for remounting the inline timer pane between runs ──
  const [timerSessionKey, setTimerSessionKey] = useState(0)
  // Auto-start is consumed by the fresh pane mount of a new run identity.
  const [autoStart, setAutoStart] = useState(false)

  const clearSession = useCallback(() => {
    setSession(null)
    setTourRuntime(null)
    setRunLive(false)
    setRunLocation('tour')
    setFullscreenOpen(false)
    setActiveBlock(null)
  }, [])

  const scrollTimerStage = useCallback(() => {
    runApiRef.current?.scrollToStage('timer-wallclock')
    document.getElementById('tour-stack-timer')?.scrollIntoView?.({ behavior: 'instant', block: 'center' })
  }, [])

  const [demoRunning, setDemoRunning] = useState(false)
  const [activeBlock, setActiveBlock] = useState<ScriptBlock | null>(null)
  const hasResetRef = useRef(false)

  const doStart = useCallback(async (docText: string, block: ScriptBlock | null, sectionTitle: string, location: 'tour' | 'hero'): Promise<boolean> => {
    if (!block || startingRef.current) return false
    startingRef.current = true

    // Optimistic presentation: launch timer dialog immediately on click
    finalizedRef.current = false
    runStartedRef.current = false
    unsavedRef.current = null
    setActiveBlock(block)
    setTimerSessionKey((k) => k + 1)
    setAutoStart(true)
    setSession(null)
    setRunLocation(location)
    setFullscreenOpen(location === 'hero')

    try {
      await start(docText, block, { pageTitle: 'Home', sectionTitle })
    } catch (err) {
      console.error('[HomeTour] failed to persist playground run note:', err)
      setFullscreenOpen(false)
      setActiveBlock(null)
      toast({
        title: 'Could not start workout',
        description: 'The playground entry could not be saved.',
        variant: 'destructive',
      })
      return false
    } finally {
      startingRef.current = false
    }
    return true
  }, [start])

  // Fresh unstarted snapshot note (reset contract) — the previous partial is
  // expected to be finalized BEFORE doReset runs (requestStop chain).
  const doReset = useCallback(async (): Promise<boolean> => {
    try {
      await reset(docRef.current, { pageTitle: 'Home', sectionTitle: 'Run' })
    } catch (err) {
      console.error('[HomeTour] failed to reset playground run:', err)
      toast({
        title: 'Could not reset',
        description: 'The previous session is kept — nothing was lost.',
        variant: 'destructive',
      })
      return false
    }
    finalizedRef.current = false
    runStartedRef.current = false
    unsavedRef.current = null
    setTimerSessionKey((k) => k + 1)
    setAutoStart(false)
    setSession(null)
    setTourRuntime(null)
    setRunLive(false)
    setRunLocation('tour')
    setFullscreenOpen(false)
    return true
  }, [reset])

  // Runs the action parked by requestStop once the partial is recorded.
  const performPending = useCallback(async () => {
    externalStopRef.current = false
    setExternalStop(false)
    // Retry a previously failed save first — the hook refuses every other
    // operation while results are pending, so this is the recovery path.
    if (unsavedRef.current) {
      try {
        await finalize(unsavedRef.current, false)
        unsavedRef.current = null
      } catch (err) {
        console.error('[HomeTour] retry save failed:', err)
        toast({
          title: 'Session still not saved',
          description: 'The run is kept — try again.',
          variant: 'destructive',
        })
        return
      }
    }
    const action = pendingActionRef.current
    pendingActionRef.current = null
    if (!action) return
    switch (action.kind) {
      case 'apply-doc':
        // Adventure picks, hero re-arrival and clear-shared all restore a
        // clean editor over a settled run.
        editedRecordedRef.current = false
        setDoc(action.doc)
        clearSession()
        setTimerSessionKey((k) => k + 1)
        setAutoStart(false)
        break
      case 'restart': {
        const ok = await doStart(action.doc, action.block, action.sectionTitle, action.location)
        if (ok && action.location === 'tour') scrollTimerStage()
        break
      }
      case 'restart-unstarted':
        // Discard the never-started snapshot (end() — no note churn) and
        // mint the running note.
        await end()
        {
          const ok = await doStart(action.doc, action.block, action.sectionTitle, action.location)
          if (ok && action.location === 'tour') scrollTimerStage()
        }
        break
      case 'reset':
        await doReset()
        break
    }
  }, [doStart, doReset, clearSession, scrollTimerStage, end, finalize])

  // Finalize entry point for host-driven stops. When the run was never
  // started, is already recorded, or has an unsaved pending write (the
  // execution can no longer report), the pending action runs immediately —
  // performPending retries the save first.
  const requestStop = useCallback((pending: typeof pendingActionRef.current) => {
    if (pendingActionRef.current) return // a stop is already in flight
    if (!runRef.current || finalizedRef.current || !runStartedRef.current || unsavedRef.current) {
      pendingActionRef.current = pending
      void performPending()
      return
    }
    pendingActionRef.current = pending
    externalStopRef.current = true
    setExternalStop(true)
  }, [performPending])

  // ── Hero-reset contract (#882): re-entering the hero viewport resets the
  // editor to the initial load content, discarding edits and session state.
  // The initial entry (page load) is arrival, not a re-entry. ──
  const heroRef = useRef<HTMLDivElement | null>(null)
  // The hero is a stageless anchor segment of the scroll track — gates in
  // the hero hand off to the write section as the reading line moves on.
  const heroSectionRef = useRef<HTMLElement | null>(null)
  useTrackAnchor('hero', heroSectionRef)
  const heroVisibleRef = useRef(true) // the hero mounts at the top of the page
  const heroRunActiveRef = useRef(heroRunActive)
  heroRunActiveRef.current = heroRunActive
  const resetHeroToArrival = useCallback(() => {
    // An in-place run owns the hero viewport — re-entry shows its current
    // state (timer/result), not a reset to the arrival document.
    if (heroRunActiveRef.current) return
    requestStop({ kind: 'apply-doc', doc: initialContent })
  }, [initialContent, requestStop])

  useEffect(() => {
    const el = heroRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting
      if (visible && !heroVisibleRef.current) resetHeroToArrival()
      heroVisibleRef.current = visible
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [resetHeroToArrival])

  // Header Reset button: clear the stored shared script, back to welcome-1.md
  // (re-following the original /load?z= link would store it again).
  const handleClearShared = useCallback(() => {
    clearHomeShared()
    setSharedScript(null)
    requestStop({ kind: 'apply-doc', doc: welcomeScript })
  }, [welcomeScript, requestStop])

  const [stackTimerInView, setStackTimerInView] = useState(false)
  useEffect(() => {
    if (!prefersReducedMotion || typeof IntersectionObserver === 'undefined') return
    const timer = document.getElementById('tour-stack-timer')
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === timer) setStackTimerInView(entry.isIntersecting)
      }
    })
    if (timer) observer.observe(timer)
    return () => observer.disconnect()
  }, [prefersReducedMotion])
  // ── Timer-stage presence: the run section's sticky window with a timer-*
  // stage active (reduced motion: the flat stack's timer card in view). ──
  const stageInTimer = prefersReducedMotion
    ? stackTimerInView
    : (runReached || runLive) && runInView && runStageId != null && runStageId.startsWith('timer-')
  // The intro stage never auto-starts the demo — only the running stages do.
  // Arrival at the intro is the read-the-example beat; the timer starts when
  // the visitor clicks Run or scrolls on into the wallclock stage.
  const autoStartStage = runStageId != null && runStageId !== 'timer-intro' && runStageId.startsWith('timer-')

  const [everInTimer, setEverInTimer] = useState(false)
  useEffect(() => {
    if (stageInTimer) setEverInTimer(true)
  }, [stageInTimer])

  // Scroll-out save: leaving the run stages after they were visited halts the
  // live execution and records the partial exactly once (Stop-scroll save).
  const prevStageInTimerRef = useRef(stageInTimer)
  useEffect(() => {
    if (runLocation === 'tour' && everInTimer && !stageInTimer && prevStageInTimerRef.current) {
      if (runRef.current && runStartedRef.current && !finalizedRef.current) {
        requestStop(null)
      }
    }
    prevStageInTimerRef.current = stageInTimer
  }, [stageInTimer, everInTimer, requestStop, runLocation])

  // Slide-back reset: returning to the intro stage after a run started (or
  // finished) resets the pane — the saved playground stays saved, and the
  // next forward scroll or Run click mints a fresh session of the example.
  const prevRunStageRef = useRef<string | null>(null)
  useEffect(() => {
    const stage = runStageId ?? null
    const prev = prevRunStageRef.current
    prevRunStageRef.current = stage
    if (stage !== 'timer-intro' || prev === 'timer-intro') return
    if (runLocation !== 'tour') return
    if (runRef.current && (runStartedRef.current || finalizedRef.current)) {
      requestStop({ kind: 'reset' })
    }
  }, [runStageId, requestStop, runLocation])

  // Output-stage stop: dwelling on the result stage halts a live run so the
  // pane can show the recorded output. Never-started runs have nothing to
  // stop — the pane's empty state covers them.
  useEffect(() => {
    if (runLocation !== 'tour' || runStageId !== 'timer-output') return
    if (runRef.current && runStartedRef.current && !finalizedRef.current && !externalStopRef.current) {
      requestStop(null)
    }
  }, [runStageId, requestStop, runLocation])

  // ── Quest + challenge hooks ──
  useQuickStartAutoComplete({
    pageRoute: '/',
    quests,
    initialSource: initialContent,
    currentSource: doc,
  })
  useCompletionChallenge({ pageRoute: '/', quests, completedResults: session })

  const markStageViewed = useTourScrollQuests('/', quests)
  markStageViewedRef.current = markStageViewed

  // Chapter runs validate their own quest; explicit home runs validate this one.
  useRunStartedChallenge({ pageRoute: '/', quests, running: demoRunning })

  // ── Editor interactions: the hero hosts the shared welcome document; the
  // run-section intro pane hosts its own home-example.md (see above). ──
  const handleDocChange = useCallback(
    (next: string) => {
      setDoc(next)
      if (next !== initialContent && !editedRecordedRef.current) {
        editedRecordedRef.current = true
        track?.(HOME_EVENTS.demoEdited)
      }
    },
    [initialContent, track],
  )

  const handleBlocksChange = useCallback((blocks: ScriptBlock[]) => {
    blocksRef.current = blocks
  }, [])

  const beginRun = useCallback(
    (
      sectionTitle: string,
      doc: string,
      block: ScriptBlock | null,
      demo: boolean,
      location: 'tour' | 'hero' = 'tour',
    ) => {
      if (!block) return
      track?.(HOME_EVENTS.demoRun)
      if (demo) setDemoRunning(true)
      hasResetRef.current = false

      // Immediate UI response: open dialog or slide to timer on the click frame
      if (location === 'tour') {
        scrollTimerStage()
      } else {
        setActiveBlock(block)
        setRunLocation(location)
        setFullscreenOpen(true)
        setAutoStart(true)
        setTimerSessionKey((k) => k + 1)
        setSession(null)
      }

      if (startingRef.current || pendingActionRef.current) {
        pendingActionRef.current = { kind: 'restart', doc, block, sectionTitle, location }
        return
      }
      if (runRef.current && runStartedRef.current && !finalizedRef.current) {
        pendingActionRef.current = { kind: 'restart', doc, block, sectionTitle, location }
        externalStopRef.current = true
        setExternalStop(true)
        return
      }
      if (runRef.current && !finalizedRef.current) {
        pendingActionRef.current = { kind: 'restart-unstarted', doc, block, sectionTitle, location }
        void performPending()
        return
      }
      void doStart(doc, block, sectionTitle, location)
    },
    [doStart, performPending, scrollTimerStage, track],
  )

  // The run section's Run (intro pane + caption Try-it + L3 ▶): starts the
  // home-example.md demo and glides to the wallclock stage.
  const handleRun = useCallback(() => {
    beginRun('Run', exampleDocRef.current, exampleBlocksRef.current[0] ?? null, true)
  }, [beginRun])

  // Explicit hero/editor Run: start in place — the hero viewport switches
  // editor → timer → result without scrolling away from the editor context,
  // at every width (never forced fullscreen by the device).
  const handleHeroRun = useCallback(() => {
    beginRun('Run', docRef.current, blocksRef.current[0], true, 'hero')
  }, [beginRun])

  useEffect(() => {
    if (hasResetRef.current) return
    if (!stageInTimer || !autoStartStage || fullscreenOpen || startingRef.current || pendingActionRef.current) return
    if (run && runLocation === 'tour') return
    if (run && !finalizedRef.current) return
    setDemoRunning(true)
    void doStart(exampleDocRef.current, exampleBlocksRef.current[0] ?? null, 'Run', 'tour')
  }, [stageInTimer, autoStartStage, fullscreenOpen, run, runLocation, doStart])

  // ── L3 outline (right rail + ⋯ menu): links to the tour sections. The run
  // row's secondary ▶ button IS the idle→running state transition — clicking
  // it mints a fresh run identity and glides to the timer stage. ──
  const { setL3Items } = useNav()
  useEffect(() => {
    const outline: NavItemL3[] = [
      { id: 'tour-hero', label: 'Welcome', level: 3, action: { type: 'scroll', sectionId: 'tour-hero' } },
      {
        id: 'run',
        label: 'Run it as a Timer',
        level: 3,
        action: { type: 'scroll', sectionId: 'tour-section-run' },
        secondaryAction: { id: 'run-start', label: 'Start the run', action: { type: 'call', handler: handleRun } },
      },
      { id: 'community-feeds', label: 'Library & Community Feeds', level: 3, action: { type: 'scroll', sectionId: 'tour-section-community-feeds' } },
      { id: 'offerings', label: 'You Own the Data', level: 3, action: { type: 'scroll', sectionId: 'tour-section-offerings' } },
      { id: 'hosted', label: 'Wod-Wiki Hosted', level: 3, action: { type: 'scroll', sectionId: 'tour-section-hosted' } },
    ]
    setL3Items(outline)
    return () => setL3Items([])
  }, [setL3Items, handleRun])

  // Stop click / output-stage arrival / scroll-out: the panel reports partial
  // or completed results; finalize records them against the run's note
  // exactly once, then any parked action (reset/restart/doc swap) executes.
  // The completion never scrolls — the result state shows in place (hero
  // viewport for in-place runs, the run section's result stage for dwell
  // runs).
  const handleTimerComplete = useCallback(
    (_blockId: string, results: Sessions) => {
      // Record-once: a duplicate report (Stop after natural complete, or a
      // second pane's report) is absorbed unless a save is still pending.
      if (finalizedRef.current && !unsavedRef.current) return
      setRunLive(false)
      setSession(results)
      if ((results.logs ?? []).length === 0) {
        finalizedRef.current = true
        if (runLocation === 'hero') setFullscreenOpen(false)
        return performPending()
      }
      finalizedRef.current = true
      // The promise is returned so awaiting hosts (the fullscreen overlay)
      // hold dismissal and offer the same-report Retry on failure; the toast
      // stays for the embedded panes whose host ignores the return value.
      return finalize(results, results.completed)
        .then(() => {
          unsavedRef.current = null
          if (runLocation === 'hero') setFullscreenOpen(false)
          return performPending()
        })
        .catch((err) => {
          finalizedRef.current = false
          // The execution is already halted — it cannot report again. Park
          // the outputs; the next host action or the overlay Retry re-saves.
          runStartedRef.current = false
          unsavedRef.current = results
          externalStopRef.current = false
          setExternalStop(false)
          pendingActionRef.current = null
          toast({
            title: 'Session not saved',
            description: 'The run could not be recorded. Nothing was lost — your next action retries the save.',
            variant: 'destructive',
          })
          throw err
        })
    },
    [finalize, performPending, runLocation],
  )

  // The pane's ✕ returns to the intro stage; a live run is saved by the
  // scroll-out rule when the run section's viewport releases.
  const handleTimerClose = useCallback(() => {
    runApiRef.current?.scrollToStage('timer-intro')
  }, [])

  const handleFullscreenClose = useCallback(() => {
    setFullscreenOpen(false)
  }, [])

  // Reset saves the live partial and creates a fresh, unstarted snapshot.
  const handleTimerReset = useCallback(() => {
    setRunLocation('tour')
    hasResetRef.current = true
    requestStop({ kind: 'reset' })
  }, [requestStop])

  // Inline runtime — stored for the TV card. Every tour run auto-starts, so
  // the WaitingToStart gate is popped as soon as the runtime exists (deferred
  // one microtask so the panel's auto-start effect has begun execution).
  const handleRuntimeReady = useCallback((runtime: IScriptRuntime) => {
    setTourRuntime(runtime)
    if (autoStart) {
      queueMicrotask(() => runtime.handle(new NextEvent(undefined, runtime.nowProvider)))
    }
  }, [autoStart])

  // First idle→running transition of the current pane's execution. The
  // one-shot autoStart is consumed here so a later remount of the pane can
  // never spawn a second execution of the same identity.
  const handleRunStarted = useCallback(() => {
    runStartedRef.current = true
    setRunLive(true)
    setAutoStart(false)
  }, [])

  // Caption command buttons: Try-it.
  const handleCaptionCommand = useCallback(
    (_captionId: string, key: string) => {
      if (key === 'try') handleRun()
    },
    [handleRun],
  )

  // Actual results stay note-scoped; pre-run examples never enter the journal.
  const sessionWiring = useMemo(
    () => ({
      noteId: run?.noteId ?? null,
      queryKey: DEFAULT_TABLE_QUERY_KEY,
      boardSlug: DEFAULT_BOARD_SLUG,
    }),
    [run?.noteId],
  )

  // Inline timer pane wiring — one shape for the section runway and the
  // reduced-motion stack. Fresh mount per run identity (sessionKey),
  // auto-start on mount, host-driven finalize stop.
  const timerWiring = {
    sessionKey: timerSessionKey,
    block: runLocation === 'tour' && !finalizedRef.current ? run?.block ?? null : null,
    autoStart,
    externalStop,
    onClose: handleTimerClose,
    onComplete: handleTimerComplete,
    onRuntimeReady: handleRuntimeReady,
    onRunStarted: handleRunStarted,
    onStart: handleRun,
    onReset: handleTimerReset,
  }
  // Hero viewport state machine: editor in view while idle/running,
  // session results in view upon completion. Timer runs in fullscreen.
  const heroState: 'editor' | 'result' = heroRunActive && session ? 'result' : 'editor'

  const fullscreenBlock = run?.block ?? activeBlock
  const fullscreen = fullscreenOpen && fullscreenBlock && (
    <FullscreenTimer
      key={timerSessionKey}
      block={fullscreenBlock}
      autoStart={autoStart}
      externalStop={externalStop}
      onRunStarted={handleRunStarted}
      onRuntimeReady={handleRuntimeReady}
      onClose={handleFullscreenClose}
      onCompleteWorkout={handleTimerComplete}
    />
  )
  // the reduced-motion flat stack).
  const offeringsBlock = (
    <>
      <OfferingTiers />
      <p className="-mt-8 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 xl:text-[11px]">
        — or learn the language with examples{' '}
        <Link to="/syntax" className="text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline">
          on the syntax page →
        </Link>
      </p>
    </>
  )

  // ── Reduced-motion stack (flat cards — sticky scroll is opted out) ──
  if (prefersReducedMotion) {
    return (
      <div data-testid="home-tour">
        <TourFlatStack
          theme={theme}
          doc={doc}
          onDocChange={handleDocChange}
          onBlocksChange={handleBlocksChange}
          onRun={handleRun}
          onHeroRun={handleHeroRun}
          exampleDoc={exampleDoc}
          onExampleDocChange={handleExampleDocChange}
          onExampleBlocksChange={handleExampleBlocksChange}
          heroContent={heroState === 'result' && session ? <TourSessionResult result={session} onDismiss={clearSession} dismissLabel="Edit again" /> : undefined}
          onCommand={handleCaptionCommand}
          sharedBy={sharedBy}
          onResetShared={handleClearShared}
          timer={timerWiring}
          session={{ ...sessionWiring, result: session }}
          offeringsSlot={offeringsBlock}
        />
        <GuideIndexFooter />
        <TourFooter />
        {fullscreen}
      </div>
    )
  }

  // ── One runway for every width: a normal-flow hero view (heading + THE
  // editor at first paint), then the run and explore sections in the
  // standard tagline-header + sticky-runway pattern, then feeds →
  // offerings → footer. ──
  return (
    <div data-testid="home-tour">
      {/* Arrival sentinel (#882): a 1px mark at the very top of the page —
          re-entering it from below resets the shared document. */}
      <div ref={heroRef} aria-hidden className="h-px" />

      {/* ponytail: clamped responsive spacing ceiling at 2xl/1720px; upgrade to fluid container queries if ultrawide canvas grows */}
      <section
        ref={heroSectionRef}
        id="tour-hero"
        data-testid="tour-hero"
        className="relative grid h-[calc(100dvh-65px)] grid-rows-[2fr_3fr] justify-items-center gap-4 px-5 py-4 text-center lg:h-[calc(100dvh-104px)] lg:px-10 xl:gap-8 xl:py-8 2xl:gap-10 2xl:py-10 2xl:px-16"
      >
        <div className="flex min-h-0 w-full items-center justify-center overflow-y-auto">
          <TourHeroHeading />
        </div>
        {/* The hero viewport hosts the workflow states in place — editor →
            run → result — so the demo never scrolls away from the editor
            context. The chrome title names the loaded doc (shared
            attribution or the default welcome note). */}
        {/* The hero editor is a scroll gate: while traveling, gestures
            scroll the track; editing inside captures the gate. */}
        <ScrollGate
          gateId="hero-pane"
          segmentId="hero"
          className="h-full min-h-0 w-full max-w-[720px] xl:max-w-[820px] 2xl:max-w-[920px]"
        >
          <MacOSChrome
            title={
              heroState === 'result'
                ? SCREEN_TITLES.metrics
                : sharedBy
                  ? (sharedBy.toLowerCase().startsWith('shared by') ? sharedBy : `shared by: ${sharedBy}`)
                  : 'welcome-1.md'
            }
            headerActions={
              sharedBy && (
                <button
                  type="button"
                  onClick={handleClearShared}
                  title="Reset"
                  className="rounded-md border border-border px-2 py-1 text-[10px] transition-colors hover:bg-accent"
                  data-testid="tour-hero-reset-shared"
                >
                  Reset
                </button>
              )
            }
            className="h-full"
          >
            {heroState === 'editor' && (
              <TourEditorScreen
                doc={doc}
                theme={theme}
                onDocChange={handleDocChange}
                onBlocksChange={handleBlocksChange}
                onRun={handleHeroRun}
              />
            )}
            {heroState === 'result' && session && (
              <TourSessionResult
                result={session}
                onDismiss={clearSession}
                dismissLabel="Edit again"
              />
            )}
          </MacOSChrome>
        </ScrollGate>
      </section>


      <TourSectionRunway
        ref={runApiRef}
        id="run"
        heightVh="420vh"
        header={
          <TaglineHeader
            index="01"
            before="Run it as a "
            accentText="Timer"
            after=""
            accent={TOUR_ACCENTS.timer}
            blurb="The workout reads like plain text — press Run and the script becomes the clock. Step through rounds, cast to the big screen, then see what you logged."
          />
        }
        stages={runStages}
        captions={runCaptions}
        onCommand={handleCaptionCommand}
        onActiveStageChange={handleRunStageChange}
        onViewportChange={handleRunViewport}
        onReachedChange={handleRunReached}
        editor={{
          doc: exampleDoc,
          theme,
          onDocChange: handleExampleDocChange,
          onBlocksChange: handleExampleBlocksChange,
          onRun: handleRun,
        }}
        timer={timerWiring}
        session={{ ...sessionWiring, fixedStage: 'wql-dashboard', result: session }}
        tvRuntime={tourRuntime}
        tvStageId="timer-cast"
        toastLabel={
          session
            ? `Stopped at ${fmtClock(session.duration)}. ${pendingResults ? 'Results not saved' : recorded ? 'Results saved' : 'Saving results…'}`
            : null
        }
      />

      {/* Analytics shares the canonical editor/timer sticky runway. */}
      <CelebrationBridge chapters={chapters} />

      {/* Library & Community Feeds — collections/packages land above the
          data-ownership sections. */}
      <TourJumpSection />

      {offeringsBlock}

      <GuideIndexFooter />
      <TourFooter />
      {fullscreen}
    </div>
  )
}

// ── Public component ───────────────────────────────────────────────────────

export function HomeTour(props: HomeTourProps) {
  return (
    <RingTargetsProvider>
      {/* One continuous scroll track for the whole page: the runway
          sections resolve their stages from the shared track position,
          and the panes inside the pinned windows gate their inner
          scrollers to it (see app/scroll). */}
      <ScrollTrackProvider>
        <HomeTourInner {...props} />
      </ScrollTrackProvider>
    </RingTargetsProvider>
  )
}
