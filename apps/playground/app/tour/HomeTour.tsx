/**
 * HomeTour.tsx — the home page: hero + the data sections, then the Library
 * & Community Feeds jump section, the offerings, and the footer.
 *
 * The FIRST interaction is the hero: the editor at first paint, Run opens
 * the fullscreen timer, and the recorded run lands back in the hero pane.
 * There is deliberately no second editor below — the repetition it caused
 * is gone.
 *
 * Scrolling continues with two data sections (HomeInsightsSections):
 *  01 · Your Session, Analyzed — analytics of the run just recorded
 *       (timeline + Rest/Test Ratio + Reaction Time), or a run-to-view CTA
 *       whose button triggers the same fullscreen run when nothing has been
 *       recorded yet.
 *  02 · One Run Becomes Many — two example boards over the preloaded
 *       sample data, each a different aggregation of workout data.
 * Then the pre-existing sections: CelebrationBridge → jump section →
 * offerings → footer.
 *
 * Preserved contracts:
 *  - Arrival (#882): /load?z= shared script replaces welcome-1.md in the
 *    hero; re-entering the hero viewport resets it to the arrival document
 *    (the recorded session survives — it feeds the insights section).
 *  - Hero pane (min-h flex, 2:3 heading/pane at first paint) grows to its
 *    content — a recorded session renders fully instead of clipping into an
 *    inner scrollbar — and every editor↔result transition parks the pane
 *    top right under the sticky header. Dismiss ("Edit again") slides
 *    there first and only then swaps back to the editor.
 *  - quick-start quests (qs-arrive / qs-edit / qs-run) plus the insights
 *    scroll quest (qs-tour-analytics) and the run-started quest
 *    (qs-tour-timer, marked by any real run).
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
import type { Chapter } from '../canvas/parseCanvasMarkdown'
import { useQuickStartAutoComplete } from '../hooks/useQuickStartAutoComplete'
import { useCompletionChallenge } from '../hooks/useCompletionChallenge'
import { useRunStartedChallenge } from '../hooks/useRunStartedChallenge'
import { useTourScrollQuests } from '../hooks/useTourScrollQuests'
import { usePlaygroundRun } from '../hooks/usePlaygroundRun'
import { useNav } from '../nav/NavContext'
import type { NavItemL3 } from '../nav/navTypes'
import { cn } from '@/lib/utils'
import { RingTargetsProvider } from './TourRing'
import { SCREEN_TITLES } from './tourConstants'
import { TourHeroHeading } from './TourHero'
import { TourFooter } from './TourFooter'
import { OfferingTiers } from '../components/molecules/OfferingTiers'
import { MacOSChrome } from '../components/atoms/MacOSChrome'
import { TourEditorScreen } from './screens/TourEditorScreen'
import { FullscreenTimer } from '@/components/organisms/review/FullscreenTimer'
import { TourSessionResult } from './screens/TourSessionResult'
import { SessionInsightsSection, SampleDashboardsSection } from './HomeInsightsSections'
import { CelebrationBridge } from './CelebrationBridge'
import { TourJumpSection } from './TourJumpSection'
import { ScrollGate, ScrollTrackProvider, useTrackAnchor } from '../scroll/ScrollTrackProvider'
import { HOME_EVENTS, useTelemetry, useScrollTelemetry } from '@/services/telemetry'
import { toast } from '@/hooks/use-toast'
import { useMediaQuery } from '../hooks/useMediaQuery'

// ── Helpers ─────────────────────────────────────────────────────────────────

const HOME_DEMO_SOURCE = 'wods/examples/home/welcome-1.md'

/** Where the current (or most recent) run was launched from. 'hero' shows
 *  its results in the hero pane; 'cta' ran from the insights section and
 *  leaves the hero editor untouched. */
type RunLocation = 'hero' | 'cta'

// ── Props ───────────────────────────────────────────────────────────────────

export interface HomeTourProps {
  wodFiles: Record<string, string>
  theme: string
  /** Quick-start quests from the home canvas markdown. */
  quests: Quest[]
  /** Page-level chapters from the home canvas markdown (home-tour first). */
  chapters: Chapter[]
}

// ── Inner (needs RingTargetsContext) ──────────────────────────────────────────

function HomeTourInner({ wodFiles, theme, quests, chapters }: HomeTourProps) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const telemetry = useTelemetry()
  const track = telemetry?.track
  useScrollTelemetry('/')

  // ── Editor document ──
  // Arrival contract (#882): the initial load content is the shared script
  // stored by /load?z= when present, else welcome-1.md (home intro page).
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

  // ── Playground run identity (usePlaygroundRun — fresh note per run) ──
  const { run, start, finalize, end } = usePlaygroundRun()
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
  type PendingAction = { kind: 'apply-doc'; doc: string } | { kind: 'restart'; doc: string; block: ScriptBlock; sectionTitle: string; location: RunLocation }
  const pendingActionRef = useRef<PendingAction | null>(null)

  // ── Session results ──
  // `session` is the current run identity's report (drives the hero result
  // view). `recordedSession` is the last run with committed results — it
  // SURVIVES the hero's reset-to-arrival so the insights section keeps its
  // data after the editor above resets.
  const [session, setSession] = useState<Sessions | null>(null)
  const [recordedSession, setRecordedSession] = useState<Sessions | null>(null)
  // null = idle (no run identity owns a viewport).
  const [runLocation, setRunLocation] = useState<RunLocation | null>(null)
  const heroRunActive = runLocation === 'hero'
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const startingRef = useRef(false)
  const markStageViewedRef = useRef<(id: string) => void>(() => {})

  // ── Session key for remounting the fullscreen timer between runs ──
  const [timerSessionKey, setTimerSessionKey] = useState(0)
  // Auto-start is consumed by the fresh timer mount of a new run identity.
  const [autoStart, setAutoStart] = useState(false)

  const clearSession = useCallback(() => {
    setSession(null)
    setRunLocation(null)
    setFullscreenOpen(false)
    setActiveBlock(null)
  }, [])

  const [demoRunning, setDemoRunning] = useState(false)
  const [activeBlock, setActiveBlock] = useState<ScriptBlock | null>(null)

  const doStart = useCallback(async (docText: string, block: ScriptBlock | null, sectionTitle: string, location: RunLocation): Promise<boolean> => {
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
    setRecordedSession(null)
    setRunLocation(location)
    setFullscreenOpen(true)

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
        // Hero re-arrival and clear-shared restore a clean editor over a
        // settled run. The recorded session survives (insights keep it).
        editedRecordedRef.current = false
        setDoc(action.doc)
        clearSession()
        setTimerSessionKey((k) => k + 1)
        setAutoStart(false)
        break
      case 'restart': {
        await doStart(action.doc, action.block, action.sectionTitle, action.location)
        break
      }
    }
  }, [doStart, clearSession, finalize])

  // Finalize entry point for host-driven stops. When the run was never
  // started, is already recorded, or has an unsaved pending write (the
  // execution can no longer report), the pending action runs immediately —
  // performPending retries the save first.
  const requestStop = useCallback((pending: PendingAction | null) => {
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
  // the hero hand off to the sections below as the reading line moves on.
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

  // Insights scroll quest: first time the session-analytics section enters
  // the viewport, qs-tour-analytics completes (no validation → scroll-only).
  useEffect(() => {
    const el = document.getElementById('tour-section-insights')
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) markStageViewedRef.current?.('session-insights')
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ── Editor interactions: the hero hosts the shared welcome document. ──
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
      location: RunLocation,
    ) => {
      if (!block) return
      track?.(HOME_EVENTS.demoRun)
      if (demo) setDemoRunning(true)

      // Immediate UI response: open the fullscreen timer on the click frame.
      setActiveBlock(block)
      setRunLocation(location)
      setFullscreenOpen(true)
      setAutoStart(true)
      setTimerSessionKey((k) => k + 1)
      setSession(null)

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
        // Never-started snapshot: discard it (end() — no note churn), then
        // mint the running note.
        void end().then(() => doStart(doc, block, sectionTitle, location))
        return
      }
      void doStart(doc, block, sectionTitle, location)
    },
    [doStart, end, track],
  )

  // Explicit hero/editor Run: start in place — the hero viewport switches
  // editor → fullscreen timer → result without scrolling away, at every
  // width (never forced fullscreen by the device).
  const handleHeroRun = useCallback(() => {
    beginRun('Run', docRef.current, blocksRef.current[0], true, 'hero')
  }, [beginRun])

  // The insights section's CTA: same fullscreen run; results feed the
  // insights pane (the hero editor stays put).
  const handleInsightsRun = useCallback(() => {
    beginRun('Run', docRef.current, blocksRef.current[0], true, 'cta')
  }, [beginRun])

  // ── L3 outline (right rail + ⋯ menu): links to the home sections. The
  // insights row's secondary ▶ IS the idle→running transition — clicking it
  // mints a fresh run identity and opens the fullscreen timer. ──
  const { setL3Items } = useNav()
  useEffect(() => {
    const outline: NavItemL3[] = [
      { id: 'tour-hero', label: 'Welcome', level: 3, action: { type: 'scroll', sectionId: 'tour-hero' } },
      {
        id: 'insights',
        label: 'Your Session, Analyzed',
        level: 3,
        action: { type: 'scroll', sectionId: 'tour-section-insights' },
        secondaryAction: { id: 'run-start', label: 'Run the workout', action: { type: 'call', handler: handleInsightsRun } },
      },
      { id: 'boards', label: 'One Run Becomes Many', level: 3, action: { type: 'scroll', sectionId: 'tour-section-boards' } },
      { id: 'community-feeds', label: 'Library & Community Feeds', level: 3, action: { type: 'scroll', sectionId: 'tour-section-community-feeds' } },
      { id: 'offerings', label: 'You Own the Data', level: 3, action: { type: 'scroll', sectionId: 'tour-section-offerings' } },
      { id: 'hosted', label: 'Wod-Wiki Hosted', level: 3, action: { type: 'scroll', sectionId: 'tour-section-hosted' } },
    ]
    setL3Items(outline)
    return () => setL3Items([])
  }, [setL3Items, handleInsightsRun])

  // Stop click / natural completion: the fullscreen panel reports partial or
  // completed results; finalize records them against the run's note exactly
  // once. The completion never scrolls — the hero shows the result state for
  // hero runs; the insights pane picks the session up where the visitor is.
  const handleTimerComplete = useCallback(
    (_blockId: string, results: Sessions) => {
      // Record-once: a duplicate report (Stop after natural complete) is
      // absorbed unless a save is still pending.
      if (finalizedRef.current && !unsavedRef.current) return
      setSession(results)
      if ((results.logs ?? []).length === 0) {
        finalizedRef.current = true
        setRecordedSession(results)
        setFullscreenOpen(false)
        return performPending()
      }
      finalizedRef.current = true
      // The promise is returned so awaiting hosts (the fullscreen overlay)
      // hold dismissal and offer the same-report Retry on failure; the toast
      // stays for hosts that ignore the return value.
      return finalize(results, results.completed)
        .then(() => {
          unsavedRef.current = null
          setRecordedSession(results)
          setFullscreenOpen(false)
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
    [finalize, performPending],
  )

  const handleFullscreenClose = useCallback(() => {
    setFullscreenOpen(false)
  }, [])

  // The panel's runtime callback feeds the auto-start gate (a fresh pane
  // mount must pop the waiting-to-start block its first time).
  const tourRuntimeRef = useRef<IScriptRuntime | null>(null)
  const handleRuntimeReady = useCallback((runtime: IScriptRuntime) => {
    tourRuntimeRef.current = runtime
  }, [])

  // Consume auto-start only after execution starts; skipping the gate earlier leaves its clock at zero.
  const handleRunStarted = useCallback(() => {
    runStartedRef.current = true
    const runtime = tourRuntimeRef.current
    if (autoStart && runtime) runtime.handle(new NextEvent(undefined, runtime.nowProvider))
    setAutoStart(false)
  }, [autoStart])

  // Hero dismiss (Edit again): slide the viewport back to the parked
  // position FIRST — the expanded result layout stays frozen during the
  // animation, so nothing reflows or re-runs breakpoint work under a
  // moving viewport — and swap back to the editor once the slide
  // settles. Falls back to an immediate swap when there is no hero pane
  // (reduced-motion flat hero) or a slide is already in flight.
  const heroSlideRef = useRef(false)
  const handleHeroDismiss = useCallback(() => {
    if (heroSlideRef.current) { clearSession(); return }
    const sentinel = heroRef.current
    const gate = document.querySelector('[data-gate-id="hero-pane"]')
    if (!sentinel || !gate) { clearSession(); return }
    const headerBottom = sentinel.getBoundingClientRect().top + window.scrollY
    const paneTop = gate.getBoundingClientRect().top + window.scrollY
    const target = Math.max(0, paneTop - headerBottom)
    // No animation frames (jsdom, exotic embeds) — nothing can slide, so
    // reset synchronously.
    if (typeof requestAnimationFrame !== 'function') { clearSession(); return }
    heroSlideRef.current = true
    window.scrollTo({ top: target, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
    const started = performance.now()
    const settle = () => {
      // Swap when the slide lands; the cap bounds the wait if the visitor
      // interrupts the glide with their own scrolling.
      if (Math.abs(window.scrollY - target) <= 2 || performance.now() - started > 1200) {
        heroSlideRef.current = false
        clearSession()
        return
      }
      requestAnimationFrame(settle)
    }
    requestAnimationFrame(settle)
  }, [clearSession, prefersReducedMotion])

  // Hero viewport state machine: editor in view while idle/running,
  // session results in view upon completion. Timer runs in fullscreen.
  const heroState: 'editor' | 'result' = heroRunActive && session ? 'result' : 'editor'

  // Result reveal + edit-again return: the pane's height follows its
  // content (a recorded session expands it), so every transition parks
  // the pane top right under the sticky header — past the "Write it.
  // Time it." heading when the result loads, and back to the editor at
  // the top when it is dismissed. The return direction slides BEFORE the
  // swap (handleHeroDismiss), so on arrival here the viewport is already
  // at the parked position — just correct any CodeMirror-settle drift
  // instantly. The sentinel's document top IS the header's bottom edge
  // (it is the first element in flow under it).
  const prevHeroStateRef = useRef<'editor' | 'result'>('editor')
  useEffect(() => {
    const prev = prevHeroStateRef.current
    prevHeroStateRef.current = heroState
    if (heroState === prev) return
    const measureParked = () => {
      const sentinel = heroRef.current
      const gate = document.querySelector('[data-gate-id="hero-pane"]')
      if (!sentinel || !gate) return null
      const headerBottom = sentinel.getBoundingClientRect().top + window.scrollY
      const paneTop = gate.getBoundingClientRect().top + window.scrollY
      return Math.max(0, paneTop - headerBottom)
    }
    if (heroState === 'result') {
      const target = measureParked()
      if (target == null) return
      window.scrollTo({ top: target, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
    }
    // The editor remount settles CodeMirror heights for ~300ms and its
    // anchor compensation can scroll the window after us — re-assert the
    // parked position once it settles (drift-guarded so live scrolling
    // always wins).
    const timers = [150, 450].map((ms) => setTimeout(() => {
      const target = measureParked()
      if (target != null && Math.abs(window.scrollY - target) > 2) window.scrollTo({ top: target, behavior: 'auto' })
    }, ms))
    return () => timers.forEach(clearTimeout)
  }, [heroState, prefersReducedMotion])

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
  // the offerings block (shared by both form factors).
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

  // Reduced-motion: the same sections, flat hero — no sticky choreography.
  if (prefersReducedMotion) {
    return (
      <div data-testid="home-tour">
        <section id="tour-hero" data-testid="tour-hero" className="grid h-[calc(100dvh-65px)] grid-rows-[2fr_3fr] gap-4 px-6 py-4 lg:h-[calc(100dvh-104px)]">
          <div className="flex min-h-0 items-center justify-center overflow-y-auto"><TourHeroHeading /></div>
          <div className="relative min-h-0 overflow-hidden rounded-xl border border-border">
            {sharedBy && (
              <button
                type="button"
                onClick={handleClearShared}
                data-testid="tour-hero-reset-shared"
                className="absolute right-3 top-3 z-10 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-accent"
              >
                Reset
              </button>
            )}
            {heroState === 'result' && session
              ? <TourSessionResult result={session} onDismiss={handleHeroDismiss} dismissLabel="Edit again" />
              : (
                <TourEditorScreen
                  doc={doc}
                  theme={theme}
                  onDocChange={handleDocChange}
                  onBlocksChange={handleBlocksChange}
                  onRun={handleHeroRun}
                />
              )}
          </div>
        </section>
        <SessionInsightsSection session={recordedSession} onRun={handleInsightsRun} />
        <SampleDashboardsSection />
        <CelebrationBridge chapters={chapters} />
        <TourJumpSection />
        {offeringsBlock}
        <GuideIndexFooter />
        <TourFooter />
        {fullscreen}
      </div>
    )
  }

  // ── Normal flow: a normal-flow hero view (heading + THE editor at first
  // paint), then the two data sections, then feeds → offerings → footer. ──
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
        className="relative flex min-h-[calc(100dvh-65px)] flex-col items-center gap-4 px-5 py-4 text-center lg:min-h-[calc(100dvh-104px)] lg:px-10 xl:gap-8 xl:py-8 2xl:gap-10 2xl:py-10 2xl:px-16"
      >
        {/* grow 2/3 mirrors the old 2fr_3fr grid rows at first paint; with
            content taller than the share (a recorded session), the pane
            grows instead of clipping into an inner scrollbar. */}
        <div className="flex w-full shrink grow-[2] basis-0 items-center justify-center">
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
          className={cn(
            'w-full max-w-[720px] grow-[3] basis-0 xl:max-w-[820px] 2xl:max-w-[920px]',
            // Result state: let the gate's inner pane size to its content so
            // the recorded session expands the window (editor state keeps the
            // default min-h-0 clip — the gate freeze owns tall editor docs).
            heroState === 'result' && '[&>div:first-child]:min-h-fit',
          )}
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
            className={heroState === 'result'
              ? 'h-full min-h-fit [&>div:last-child]:min-h-fit'
              : 'h-full'}
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
                onDismiss={handleHeroDismiss}
                dismissLabel="Edit again"
              />
            )}
          </MacOSChrome>
        </ScrollGate>
      </section>

      <SessionInsightsSection session={recordedSession} onRun={handleInsightsRun} />
      <SampleDashboardsSection />

      {/* "You've seen how it works. Now master the syntax." — tour progress
          badge + chapter overview bridge. */}
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
      {/* One continuous scroll track: the hero is a stageless anchor segment
          and the panes inside it gate their inner scrollers to the track
          (see app/scroll). */}
      <ScrollTrackProvider>
        <HomeTourInner {...props} />
      </ScrollTrackProvider>
    </RingTargetsProvider>
  )
}
