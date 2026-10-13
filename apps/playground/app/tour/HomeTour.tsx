/**
 * HomeTour.tsx — the home page: hero + jump section + four tagged
 * walkthrough sections (Write it in Markdown / Run it as a Timer / Own the
 * Metrics / Explore your analytics) + the Learn-the-Language chapter picker.
 *
 * Each tagged section owns a sticky mini-runway (TourSectionRunway) driven by
 * its own scroll progress over a partition of the canonical ```scroll spec;
 * the metrics explainer section is code-declared (it has no markdown source).
 *
 * One shared editor document: the desktop hero view and the write-section
 * sticky pane are two displays of the same doc + block list (edits in either
 * place are edits to the run document; neither resets at the boundary).
 * Hero runs stay in place at every width; chapter example runs use fullscreen.
 * The middle tour starts on timer arrival and saves on results arrival.
 * Analytics examples are isolated; recorded results stay scoped to their note.
 *
 * Preserved contracts:
 *  - Arrival (#882): /load?z= shared script replaces welcome-1.md in the hero.
 *  - quick-start quests (qs-arrive / qs-edit / qs-run) plus scroll quests
 *    fired as each tour stage scrolls into view
 *  - ChallengeHeaderBadge on '/' (mounted by App.tsx) — home quests only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  buildAdventureScript,
  TOUR_CAPTIONS,
  type TourCaption,
} from './TourCaptions'
import {
  TourSectionRunway,
  type TourSectionRunwayApi,
} from './TourSectionRunway'
import { CelebrationBridge } from './CelebrationBridge'
import { TourChapterPicker } from './TourChapterPicker'
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
  BOARD_SLUGS,
  DEFAULT_BOARD_SLUG,
  DEFAULT_TABLE_QUERY_KEY,
  TABLE_QUERIES,
} from './screens/TourSessionAnalytics'

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const HOME_DEMO_SOURCE = 'wods/examples/home/welcome-1.md'

/** Home quest id → the tour stage that demonstrates it. */
const HOME_QUEST_STAGE: Record<string, string> = {
  'qs-tour-timer': 'timer-wallclock',
  'qs-edit': 'timer-wallclock',
  'qs-run': 'timer-wallclock',
  'qs-tour-analytics': 'wql-idea',
}

/** Stage groups of the canonical runway, in tagline order. */
const SECTION_ORDER = ['write', 'run', 'own', 'explore'] as const
type SectionId = (typeof SECTION_ORDER)[number]

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
    id: 'editor-metrics',
    range: [0.12, 0.24],
    screen: 'editor',
    accent: TOUR_ACCENTS.editor,
    label: 'Every Line Collects Metrics',
    source: HOME_DEMO_SOURCE,
    caption: 'Every Line Collects Metrics. Reps, distance & load.',
    ring: { key: 'editor.wodBlock', tag: 'Line Metrics' },
  },
  {
    id: 'editor-run',
    range: [0.24, 0.36],
    screen: 'editor',
    accent: TOUR_ACCENTS.editor,
    label: 'Press Run to Start',
    source: HOME_DEMO_SOURCE,
    caption: 'Press Run to Execute. Launch the working clock.',
    ring: { key: 'editor.runButton', tag: 'Run Button' },
  },
  {
    id: 'timer-wallclock',
    range: [0.36, 0.47],
    screen: 'timer',
    accent: TOUR_ACCENTS.timer,
    label: 'What Happens When It Runs',
    source: HOME_DEMO_SOURCE,
    caption: 'What Happens When It Runs. The script becomes the clock.',
    ring: { key: 'timer.floor', tag: 'Clock' },
  },
  {
    id: 'timer-next',
    range: [0.47, 0.57],
    screen: 'timer',
    accent: TOUR_ACCENTS.timer,
    label: 'Advance Rounds with Next',
    source: HOME_DEMO_SOURCE,
    caption: 'Next Advances the Workout. Every click locks a time.',
    ring: { key: 'timer.nextButton', tag: 'Next Button' },
  },
  {
    id: 'timer-cast',
    range: [0.57, 0.65],
    screen: 'timer',
    accent: TOUR_ACCENTS.timer,
    label: 'Cast to the Big Screen',
    source: HOME_DEMO_SOURCE,
    caption: 'Cast to the Big Screen. Real-time mirror for the gym floor.',
    ring: { key: 'timer.castButton', tag: 'Cast' },
  },
  {
    id: 'wql-idea',
    range: [0.65, 0.72],
    screen: 'analytics',
    accent: TOUR_ACCENTS.analytics,
    label: 'Query what you just did',
    caption: 'Query what you just did. Every result is one query away.',
    ring: { key: 'analytics.vocab', tag: 'WQL elements' },
  },
  {
    id: 'wql-table',
    range: [0.72, 0.79],
    screen: 'analytics',
    accent: TOUR_ACCENTS.analytics,
    label: 'Read it as a list',
    caption: 'Read it as a list. One aggregator, one metric, one dimension.',
    ring: { key: 'analytics.table', tag: 'Table list' },
  },
  {
    id: 'wql-graphs',
    range: [0.79, 0.86],
    screen: 'analytics',
    accent: TOUR_ACCENTS.analytics,
    label: 'See it as trends',
    caption: 'See it as trends. A graph is a rollup away.',
    ring: { key: 'analytics.graphs', tag: 'Graphs' },
  },
  {
    id: 'wql-dashboard',
    range: [0.86, 0.93],
    screen: 'analytics',
    accent: TOUR_ACCENTS.analytics,
    label: 'Compose a dashboard',
    caption: 'Compose a dashboard. N queries on one screen.',
    ring: { key: 'analytics.dashboard', tag: 'Dashboard' },
  },
  {
    id: 'wql-live',
    range: [0.93, 1.0],
    screen: 'analytics',
    accent: TOUR_ACCENTS.analytics,
    label: "It's your data",
    caption: "It's your data. Open the Dashboards tab to query anything, your way.",
  },
]

/** Code-declared stages for the Own-the-Metrics explainer (no md source). */
const OWN_METRICS_STAGES: ScrollStage[] = [
  {
    id: 'metrics-e',
    range: [0.0, 0.34],
    screen: 'analytics',
    accent: TOUR_ACCENTS.timer,
    label: 'Everything is an effort',
    caption: 'Every line tracks an effort from the movement registry.',
    ring: { key: 'metrics.efforts', tag: 'Efforts' },
  },
  {
    id: 'metrics-d',
    range: [0.34, 0.67],
    screen: 'analytics',
    accent: TOUR_ACCENTS.editor,
    label: 'Measures ride along',
    caption: 'Reps, load, distance, timed rest — typed micro data points.',
    ring: { key: 'metrics.data', tag: 'Measures' },
  },
  {
    id: 'metrics-c',
    range: [0.67, 1.0],
    screen: 'analytics',
    accent: TOUR_ACCENTS.analytics,
    label: 'They compound',
    caption: 'Efforts × measures compound into queryable analytics facts.',
    ring: { key: 'metrics.compound', tag: 'Your data' },
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
  /** Cross-page quest id → label, collected from every canvas route. */
  questLabels?: Record<string, string>
  /** Main tour ```scroll runway spec (partitioned across the four sections). */
  scroll?: ScrollSpec | null
}

// ── Inner (needs RingTargetsContext) ──────────────────────────────────────────

function HomeTourInner({ wodFiles, theme, quests, chapters, questLabels, scroll }: HomeTourProps) {
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

  // Runway runtime — set by the run section's inline timer pane; feeds the TV
  // card and lets the host pop the auto-start gate.
  const [tourRuntime, setTourRuntime] = useState<IScriptRuntime | null>(null)

  // ── Canonical runway partitioned across the four tagged sections ──
  const canonicalStages = useMemo(() =>
    (scroll?.stages ?? DEFAULT_HOME_STAGES).map((stage) => ({ ...stage, accent: 'hsl(var(--primary))' })),
    [scroll],
  )
  const sectionStages = useMemo<Record<SectionId, ScrollStage[]>>(() => ({
    write: renormalize(canonicalStages.filter((s) => s.screen === 'editor')),
    run: renormalize(canonicalStages.filter((s) => s.screen === 'timer')),
    // Own is code-declared only; markdown never contributes metrics-* stages,
    // but stay defensive about the partition boundary.
    own: OWN_METRICS_STAGES,
    // Explore is dashboard-primary: a brief vocabulary beat, then the real
    // seeded boards (the session table lives in Own-the-Metrics).
    explore: [
      { id: 'wql-idea', range: [0.0, 0.3] as [number, number], screen: 'analytics', accent: TOUR_ACCENTS.analytics, label: 'The WQL vocabulary', caption: 'The whole language fits on one strip.', ring: { key: 'analytics.vocab', tag: 'WQL elements' } },
      { id: 'wql-dashboard', range: [0.3, 1.0] as [number, number], screen: 'analytics', accent: TOUR_ACCENTS.analytics, label: 'Seeded dashboards', caption: 'Real boards, range, units, inspect.', ring: { key: 'analytics.dashboard', tag: 'Dashboard' } },
    ],
  }), [canonicalStages])
  const sectionCaptions = useMemo<Record<SectionId, TourCaption[]>>(() => ({
    write: captionsForStages(sectionStages.write),
    run: captionsForStages(sectionStages.run),
    own: captionsForStages(sectionStages.own),
    explore: captionsForStages(sectionStages.explore).map((caption, index) => ({ ...caption, num: `04${String.fromCharCode(97 + index)}` })),
  }), [sectionStages])

  const writeApiRef = useRef<TourSectionRunwayApi | null>(null)
  const runApiRef = useRef<TourSectionRunwayApi | null>(null)
  const ownApiRef = useRef<TourSectionRunwayApi | null>(null)
  const exploreApiRef = useRef<TourSectionRunwayApi | null>(null)
  const sectionApis: Record<SectionId, React.MutableRefObject<TourSectionRunwayApi | null>> = useMemo(
    () => ({
      write: writeApiRef,
      run: runApiRef,
      own: ownApiRef,
      explore: exploreApiRef,
    }),
    [],
  )

  const [runInView, setRunInView] = useState(false)
  const handleRunViewport = useCallback((inView: boolean) => setRunInView(inView), [])
  const [runReached, setRunReached] = useState(false)
  const handleRunReached = useCallback((reached: boolean) => setRunReached(reached), [])
  const [ownInView, setOwnInView] = useState(false)
  const handleOwnViewport = useCallback((inView: boolean) => setOwnInView(inView), [])
  const [activeStages, setActiveStages] = useState<Partial<Record<SectionId, string>>>({})
  const activeStagesRef = useRef(activeStages)
  activeStagesRef.current = activeStages
  const handleActiveStage = useCallback(
    (section: SectionId) => (stageId: string) => {
      setActiveStages((prev) => (prev[section] === stageId ? prev : { ...prev, [section]: stageId }))
      markStageViewedRef.current?.(stageId as TourStageId)
    },
    [],
  )

  // Stable per-section callbacks: the section runways notify on stage change
  // and must not observe a fresh closure every render.
  const stageHandlers = useMemo(
    () => ({
      write: handleActiveStage('write'),
      run: handleActiveStage('run'),
      own: handleActiveStage('own'),
      explore: handleActiveStage('explore'),
    }),
    [handleActiveStage],
  )

  // ── Session results (inline playground run) ──
  const [session, setSession] = useState<Sessions | null>(null)
  // True while the current identity's execution is actually running — drives
  // the L3 outline's stop-the-timer transition button on the metrics row.
  const [runLive, setRunLive] = useState(false)
  // True while a visitor-initiated in-place run owns the hero viewport
  // (editor → timer → result). The tour's run section yields its timer pane
  // for the duration so two runtimes never execute the same identity.
  const [runLocation, setRunLocation] = useState<'tour' | 'hero' | 'fullscreen'>('tour')
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
    | { kind: 'restart'; doc: string; block: ScriptBlock; sectionTitle: string; location: 'tour' | 'hero' | 'fullscreen' }
    | { kind: 'restart-unstarted'; doc: string; block: ScriptBlock; sectionTitle: string; location: 'tour' | 'hero' | 'fullscreen' }
    | { kind: 'reset' }
    | null
  >(null)

  // ── Explore stage state: caption-driven WQL query + dashboard board ──
  const [tableQueryKey, setTableQueryKey] = useState(DEFAULT_TABLE_QUERY_KEY)
  const [boardSlug, setBoardSlug] = useState<string>(DEFAULT_BOARD_SLUG)

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

  const doStart = useCallback(async (docText: string, block: ScriptBlock | null, sectionTitle: string, location: 'tour' | 'hero' | 'fullscreen'): Promise<boolean> => {
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
    setFullscreenOpen(location === 'fullscreen' || location === 'hero')

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
  const [stackOwnInView, setStackOwnInView] = useState(false)
  useEffect(() => {
    if (!prefersReducedMotion || typeof IntersectionObserver === 'undefined') return
    const timer = document.getElementById('tour-stack-timer')
    const own = document.getElementById('tour-section-own')
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === timer) setStackTimerInView(entry.isIntersecting)
        if (entry.target === own) setStackOwnInView(entry.isIntersecting)
      }
    })
    if (timer) observer.observe(timer)
    if (own) observer.observe(own)
    return () => observer.disconnect()
  }, [prefersReducedMotion])
  // ── Timer-stage presence: the run section's sticky window with a timer-*
  // stage active (reduced motion: the flat stack's timer card in view). ──
  const runStageId = activeStages.run
  const stageInTimer = prefersReducedMotion
    ? stackTimerInView
    : (runReached || runLive) && runInView && runStageId != null && runStageId.startsWith('timer-')

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

  // Metrics-arrival stop: scrolling into Own-the-Metrics while a run is live
  // halts it (the section's pane shows the recorded $session segments). The
  // run-section timer stage owns the stop while it is active — this catches
  // the blow-past path where the run stages were never dwelled in.
  const ownStageActive = prefersReducedMotion ? stackOwnInView : ownInView && activeStages.own != null
  useEffect(() => {
    if (runLocation === 'fullscreen' || !ownStageActive || stageInTimer) return
    if (!runRef.current || finalizedRef.current || !runStartedRef.current) return
    if (externalStopRef.current) return
    requestStop(null)
  }, [ownStageActive, stageInTimer, requestStop, runLocation, runLive])

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

  // ── Editor interactions (one shared document: hero + write pane) ──
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

  // A workout choice replaces the shared script after saving any live run.
  const handleWorkoutChoice = useCallback(
    (wod: string) => {
      track?.(HOME_EVENTS.demoEdited)
      requestStop({ kind: 'apply-doc', doc: buildAdventureScript(wod) })
    },
    [requestStop, track],
  )

  const beginRun = useCallback(
    (
      sectionTitle: string,
      doc: string,
      block: ScriptBlock | null,
      demo: boolean,
      location: 'tour' | 'hero' | 'fullscreen' = 'tour',
    ) => {
      if (!block) return
      track?.(HOME_EVENTS.demoRun)
      if (demo) setDemoRunning(true)
      hasResetRef.current = false

      // Immediate UI response: open dialog or slide to timer on the click frame
      if (location === 'tour') {
        scrollTimerStage()
      } else if (location === 'fullscreen' || location === 'hero') {
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

  const handleRun = useCallback(() => {
    beginRun('Run', docRef.current, blocksRef.current[0], true)
  }, [beginRun])

  // Explicit hero/editor Run: start in place — the hero viewport switches
  // editor → timer → result without scrolling away from the editor context,
  // at every width (never forced fullscreen by the device).
  const handleHeroRun = useCallback(() => {
    beginRun('Run', docRef.current, blocksRef.current[0], true, 'hero')
  }, [beginRun])

  useEffect(() => {
    if (hasResetRef.current) return
    if (!stageInTimer || fullscreenOpen || startingRef.current || pendingActionRef.current) return
    if (run && runLocation === 'tour') return
    if (run && !finalizedRef.current) return
    setDemoRunning(true)
    void doStart(docRef.current, blocksRef.current[0] ?? null, 'Run', 'tour')
  }, [stageInTimer, fullscreenOpen, run, runLocation, doStart])

  // ── L3 outline (right rail + ⋯ menu): links to the tour sections. The run
  // row's secondary ▶ button IS the idle→running state transition — clicking
  // it mints a fresh run identity and glides to the timer stage. The metrics
  // row's secondary ■ button is the running→stopped transition — while a run
  // is live it halts the execution, records the partial, and glides to the
  // metrics section (the same bridge a natural finish takes). ──
  const { setL3Items, scrollToSection } = useNav()
  const handleStopToMetrics = useCallback(() => {
    requestStop(null)
    scrollToSection('tour-section-own')
  }, [requestStop, scrollToSection])
  useEffect(() => {
    const outline: NavItemL3[] = [
      { id: 'tour-hero', label: 'Welcome', level: 3, action: { type: 'scroll', sectionId: 'tour-hero' } },
      { id: 'community-feeds', label: 'Library & Community Feeds', level: 3, action: { type: 'scroll', sectionId: 'tour-section-community-feeds' } },
      { id: 'write', label: 'Write it in Markdown', level: 3, action: { type: 'scroll', sectionId: 'tour-section-write' } },
      {
        id: 'run',
        label: 'Run it as a Timer',
        level: 3,
        action: { type: 'scroll', sectionId: 'tour-section-run' },
        secondaryAction: { id: 'run-start', label: 'Start the run', action: { type: 'call', handler: handleRun } },
      },
      {
        id: 'own',
        label: 'Own the Metrics',
        level: 3,
        action: { type: 'scroll', sectionId: 'tour-section-own' },
        // Gated on a live execution — idle has no stop transition to offer.
        ...(runLive
          ? {
              secondaryAction: { id: 'run-stop', label: 'Stop the timer', action: { type: 'call' as const, handler: handleStopToMetrics } },
              secondaryRunIcon: 'stop' as const,
            }
          : {}),
      },
      { id: 'explore', label: 'Explore your analytics', level: 3, action: { type: 'scroll', sectionId: 'tour-section-explore' } },
      { id: 'offerings', label: 'You Own the Data', level: 3, action: { type: 'scroll', sectionId: 'tour-section-offerings' } },
      { id: 'hosted', label: 'Wod-Wiki Hosted', level: 3, action: { type: 'scroll', sectionId: 'tour-section-hosted' } },
      { id: 'learn', label: 'Learn the Language', level: 3, action: { type: 'scroll', sectionId: 'tour-chapter-picker' } },
    ]
    setL3Items(outline)
    return () => setL3Items([])
  }, [setL3Items, handleRun, handleStopToMetrics, runLive])

  // Chapter example run — scoped per chapter (#919): runs inline WITHOUT
  // firing the global run-started quest; the chapter's own lead quest is
  // completed by the picker. Each run mints a fresh note named for it.
  const handleChapterRun = useCallback(
    (chapterId: string, block: ScriptBlock | null, chapterDoc: string) => {
      track?.(HOME_EVENTS.chapterExampleRun, { chapter: chapterId })
      beginRun(`Chapter ${chapterId}`, chapterDoc, block, false, 'fullscreen')
    },
    [beginRun, track],
  )

  // Stop click / metrics arrival / scroll-out: the panel reports partial or
  // completed results; finalize records them against the run's note exactly
  // once, then any parked action (reset/restart/doc swap) executes.
  // The completion never scrolls — the result state shows in place (hero
  // viewport for in-place runs, the finished pane for dwell runs); the
  // Own-the-Metrics section shows the recorded segments when scrolled to.
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

  // The pane's ✕ returns to the write stage; a live run is saved by the
  // scroll-out rule when the run section's viewport releases.
  const handleTimerClose = useCallback(() => {
    writeApiRef.current?.scrollToStage('editor-metrics')
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

  // Caption command buttons: query presets, board picks, Try-it.
  const handleCaptionCommand = useCallback(
    (_captionId: string, key: string) => {
      if (TABLE_QUERIES[key]) {
        setTableQueryKey(key)
        return
      }
      const selectedBoard = key.startsWith('board-') ? key.slice(6) : key
      if ((BOARD_SLUGS as readonly string[]).includes(selectedBoard)) {
        setBoardSlug(selectedBoard)
        return
      }
      if (key === 'try') handleRun()
    },
    [handleRun],
  )

  // Actual results stay note-scoped; pre-run examples never enter the journal.
  const sessionWiring = useMemo(
    () => ({
      noteId: run?.noteId ?? null,
      queryKey: tableQueryKey,
      boardSlug,
    }),
    [run?.noteId, tableQueryKey, boardSlug],
  )

  // Quest navigation: route the stage id to whichever section owns it.
  const handleHomeQuestClick = useCallback(
    (questId: string) => {
      const stageId = HOME_QUEST_STAGE[questId]
      if (!stageId) return
      for (const section of SECTION_ORDER) {
        if (sectionStages[section].some((s) => s.id === stageId)) {
          sectionApis[section].current?.scrollToStage(stageId)
          return
        }
      }
    },
    [sectionStages, sectionApis],
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
        — or keep scrolling for more wod wiki examples ↓
      </p>
    </>
  )

  // ── Reduced-motion stack (flat cards — sticky scroll is opted out) ──
  if (prefersReducedMotion) {
    return (
      <div data-testid="home-tour">
        <TourFlatStack
          theme={theme}
          wodFiles={wodFiles}
          quests={quests}
          chapters={chapters}
          questLabels={questLabels}
          onHomeQuestClick={handleHomeQuestClick}
          doc={doc}
          onDocChange={handleDocChange}
          onBlocksChange={handleBlocksChange}
          onRun={handleRun}
          onHeroRun={handleHeroRun}
          onChapterRun={handleChapterRun}
          heroContent={heroState === 'result' && session ? <TourSessionResult result={session} onDismiss={clearSession} dismissLabel="Edit again" /> : undefined}
          onChoice={handleWorkoutChoice}
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
  // editor at first paint — it scrolls out completely before the write track
  // pins), then the write section in the standard tagline-header +
  // sticky-runway pattern, then run / own / explore sections → chapters ──
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
            context. The write section's sticky pane below is a second
            display of the same shared document. The chrome title names the
            loaded doc (shared attribution or the default welcome note). */}
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


      <TourJumpSection />

      <TourSectionRunway
        ref={writeApiRef}
        id="write"
        heightVh="300vh"
        header={
          <TaglineHeader
            index="01"
            before="Write it in "
            accentText="Markdown"
            after=""
            accent={TOUR_ACCENTS.editor}
            blurb="Freeform Markdown notes, fenced ```time blocks, property and tag suggestions. Everything starts as plain text you can edit."
          />
        }
        stages={sectionStages.write}
        captions={sectionCaptions.write}
        onChoice={handleWorkoutChoice}
        onCommand={handleCaptionCommand}
        onActiveStageChange={stageHandlers.write}
        editor={{
          doc,
          theme,
          onDocChange: handleDocChange,
          onBlocksChange: handleBlocksChange,
          onRun: handleRun,
        }}
      />

      <TourSectionRunway
        ref={runApiRef}
        id="run"
        heightVh="300vh"
        header={
          <TaglineHeader
            index="02"
            before="Run it as a "
            accentText="Timer"
            after=""
            accent={TOUR_ACCENTS.timer}
            blurb="The script becomes the clock. Step through rounds, cast to the big screen, and pace the room together."
          />
        }
        stages={sectionStages.run}
        captions={sectionCaptions.run}
        onCommand={handleCaptionCommand}
        onActiveStageChange={stageHandlers.run}
        onViewportChange={handleRunViewport}
        onReachedChange={handleRunReached}
        timer={timerWiring}
        tvRuntime={tourRuntime}
        tvStageId="timer-cast"
      />

      <TourSectionRunway
        ref={ownApiRef}
        id="own"
        heightVh="260vh"
        header={
          <TaglineHeader
            index="03"
            before="Own the "
            accentText="Metrics"
            after=""
            accent={TOUR_ACCENTS.analytics}
            blurb="Everything you log is an effort carrying measured data points — and together they compound into rich, queryable analytics."
          />
        }
        stages={sectionStages.own}
        captions={sectionCaptions.own}
        onCommand={handleCaptionCommand}
        onActiveStageChange={stageHandlers.own}
        onViewportChange={handleOwnViewport}
        // Once a run has been recorded, the pane answers with the recorded
        // $session segments; before that it shows the session-scoped table.
        session={{ ...sessionWiring, fixedStage: 'wql-table', result: session }}
      />

      <TourSectionRunway
        ref={exploreApiRef}
        id="explore"
        heightVh="320vh"
        header={
          <TaglineHeader
            index="04"
            before=""
            accentText="Explore"
            after=" your analytics"
            accent={TOUR_ACCENTS.analytics}
            blurb="WQL turns your journal into queryable facts: lists, trends, dashboards — every widget one query away from anything you've logged."
          />
        }
        stages={sectionStages.explore}
        captions={sectionCaptions.explore}
        onCommand={handleCaptionCommand}
        onActiveStageChange={stageHandlers.explore}
        session={sessionWiring}
        toastLabel={
          session
            ? `Stopped at ${fmtClock(session.duration)}. ${pendingResults ? 'Results not saved' : recorded ? 'Results saved' : 'Saving results…'}`
            : null
        }
      />

      {/* Analytics shares the canonical editor/timer sticky runway. */}
      <CelebrationBridge chapters={chapters} />

      {offeringsBlock}

      {/* Learn the Language — single-slide chapter picker with a shared editor */}
      <TourChapterPicker
        wodFiles={wodFiles}
        chapters={chapters}
        allQuests={quests}
        theme={theme}
        onRun={handleChapterRun}
      />
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
      {/* One continuous scroll track for the whole page: the four runway
          sections resolve their stages from the shared track position,
          and the panes inside the pinned windows gate their inner
          scrollers to it (see app/scroll). */}
      <ScrollTrackProvider>
        <HomeTourInner {...props} />
      </ScrollTrackProvider>
    </RingTargetsProvider>
  )
}
