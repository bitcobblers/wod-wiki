/**
 * HomeTour.tsx — the home page: a heading hero that stages the "Why Wod
 * Wiki?" video pitch and the live editor preview — watching the pitch
 * collapses it into a Watch again tab and hands the hero
 * viewport to the editor — then the data sections, the Library & Community
 * Feeds jump section, the offerings, and the footer.
 *
 * The FIRST interaction is the editor in the hero: Run opens the
 * fullscreen timer, whose review panel shows the recorded results.
 * Closing it glides the visitor to the dashboards section — "Session
 * Insights" turns the run into data, and the boards carousel below
 * aggregates runs into dashboards.
 *
 * Preserved contracts:
 *  - arrival contract (#882): the initial load content is the shared script
 *    stored by /load?z= when present, else welcome-1.md (home intro page);
 *    re-entering the editor section resets it to that arrival document.
 *  - quick-start quests (qs-arrive / qs-edit / qs-run) plus the insights
 *    scroll quest (qs-tour-analytics) and the run-started quest
 *    (qs-tour-timer, marked by any real run). The Syntax Challenges
 *    header badge is guides-only; home quests surface here and in the
 *    tour outro instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { clearHomeShared, loadHomeShared, type HomeSharedScript } from '../services/homeSharedScript'
import { resolveSource } from '../canvas/canvasUtils'
import { GuideIndexFooter } from '../canvas/GuideIndexFooter'
import { NextEvent } from '@bitcobblers/wod-wiki-engine'
import type { IScriptRuntime } from '@bitcobblers/wod-wiki-engine'
import type { ScriptBlock, Sessions } from '@/components/Editor/types'
import type { Quest } from '../hooks/usePageQuests'
import { useQuickStartAutoComplete } from '../hooks/useQuickStartAutoComplete'
import { useCompletionChallenge } from '../hooks/useCompletionChallenge'
import { useRunStartedChallenge } from '../hooks/useRunStartedChallenge'
import { useTourScrollQuests } from '../hooks/useTourScrollQuests'
import { usePlaygroundRun } from '../hooks/usePlaygroundRun'
import { useNav } from '../nav/NavContext'
import type { NavItemL3 } from '../nav/navTypes'
import { useSectionScrollSpy } from '../hooks/useSectionScrollSpy'
import { RingTargetsProvider } from './TourRing'
import { TourHeroHeading } from './TourHero'
import { TourWhyVideo } from './TourWhyVideo'
import { TourFooter } from './TourFooter'
import { OfferingTiers } from '../components/molecules/OfferingTiers'
import { MacOSChrome } from '../components/atoms/MacOSChrome'
import { TourEditorScreen } from './screens/TourEditorScreen'
import { FullscreenTimer } from '@/components/organisms/review/FullscreenTimer'
import { InsightsDashboardsSection } from './HomeInsightsSections'
import { TourJumpSection } from './TourJumpSection'
import { ScrollGate, ScrollTrackProvider, useTrackAnchor } from '../scroll/ScrollTrackProvider'
import { HOME_EVENTS, useTelemetry, useScrollTelemetry } from '@/services/telemetry'
import { toast } from '@/hooks/use-toast'
import { useMediaQuery } from '../hooks/useMediaQuery'

// ── Helpers ─────────────────────────────────────────────────────────────────

const HOME_DEMO_SOURCE = 'wods/examples/home/welcome-1.md'

// ── Props ───────────────────────────────────────────────────────────────────

export interface HomeTourProps {
  wodFiles: Record<string, string>
  theme: string
  /** Quick-start quests from the home canvas markdown. */
  quests: Quest[]
}

// ── Inner (needs RingTargetsContext) ──────────────────────────────────────────

function HomeTourInner({ wodFiles, theme, quests }: HomeTourProps) {
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
  type PendingAction = { kind: 'apply-doc'; doc: string } | { kind: 'restart'; doc: string; block: ScriptBlock; sectionTitle: string }
  const pendingActionRef = useRef<PendingAction | null>(null)

  // ── Session results ──
  // `recordedSession` is the last run with committed results — it feeds the
  // Session Insights pane, and it SURVIVES the editor's reset-to-arrival so
  // the data stays after the editor above resets.
  const [recordedSession, setRecordedSession] = useState<Sessions | null>(null)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const fullscreenOpenRef = useRef(fullscreenOpen)
  fullscreenOpenRef.current = fullscreenOpen
  const startingRef = useRef(false)
  const markStageViewedRef = useRef<(id: string) => void>(() => {})

  // ── Session key for remounting the fullscreen timer between runs ──
  const [timerSessionKey, setTimerSessionKey] = useState(0)
  // Auto-start is consumed by the fresh timer mount of a new run identity.
  const [autoStart, setAutoStart] = useState(false)

  const [demoRunning, setDemoRunning] = useState(false)
  const [activeBlock, setActiveBlock] = useState<ScriptBlock | null>(null)

  const doStart = useCallback(async (docText: string, block: ScriptBlock | null, sectionTitle: string): Promise<boolean> => {
    if (!block || startingRef.current) return false
    startingRef.current = true

    // Optimistic presentation: launch timer dialog immediately on click
    finalizedRef.current = false
    runStartedRef.current = false
    unsavedRef.current = null
    setActiveBlock(block)
    setTimerSessionKey((k) => k + 1)
    setAutoStart(true)
    setRecordedSession(null)
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
        // Editor re-arrival and clear-shared restore a clean editor over a
        // settled run. The recorded session survives (insights keep it).
        editedRecordedRef.current = false
        setDoc(action.doc)
        setFullscreenOpen(false)
        setActiveBlock(null)
        setTimerSessionKey((k) => k + 1)
        setAutoStart(false)
        break
      case 'restart': {
        await doStart(action.doc, action.block, action.sectionTitle)
        break
      }
    }
  }, [doStart, finalize])

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

  // ── Editor-reset contract (#882): re-entering the editor viewport resets
  // the document to the initial load content, discarding edits and session
  // state. The first entry (arrival) is not a re-entry, and a run owning
  // the fullscreen timer blocks the reset. ──
  const heroRef = useRef<HTMLDivElement | null>(null)
  const editorSectionRef = useRef<HTMLDivElement | null>(null)
  const heroSectionRef = useRef<HTMLElement | null>(null)
  useTrackAnchor('hero', heroSectionRef)

  // ── Hero stage: the pitch video owns the hero until it is watched (the
  // lightbox closes); then it collapses into the Watch again tab above the
  // editor. Scrolling past without watching never collapses it. ──
  const [whyShrunk, setWhyShrunk] = useState(false)
  const whyShrunkRef = useRef(whyShrunk)
  whyShrunkRef.current = whyShrunk

  // Park the editor section right under the sticky header (same math as
  // scrollInsightsIntoView).
  const scrollEditorIntoView = useCallback(() => {
    const el = document.getElementById('tour-section-editor')
    const sentinel = heroRef.current
    if (!el || !sentinel || typeof window.scrollTo !== 'function') return
    const headerBottom = sentinel.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - headerBottom), behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  }, [prefersReducedMotion])

  // Watched: collapse, then hand the hero viewport to the editor once the
  // collapse transition (~300ms) has settled the layout beneath it.
  const handleWhyWatched = useCallback(() => {
    setWhyShrunk(true)
    window.setTimeout(scrollEditorIntoView, 350)
  }, [scrollEditorIntoView])

  // Watch again: re-expand the pitch and return to the top of the page.
  const handleWatchAgain = useCallback(() => {
    setWhyShrunk(false)
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  }, [prefersReducedMotion])

  const editorLeftRef = useRef(false)
  const resetEditorToArrival = useCallback(() => {
    requestStop({ kind: 'apply-doc', doc: initialContent })
  }, [initialContent, requestStop])

  useEffect(() => {
    const el = editorSectionRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (editorLeftRef.current && !fullscreenOpenRef.current) {
          editorLeftRef.current = false
          resetEditorToArrival()
        }
      } else {
        editorLeftRef.current = true
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [resetEditorToArrival])

  // Header Reset button: clear the stored shared script, back to welcome-1.md
  // (re-following the original /load?z= link would store it again).
  const handleClearShared = useCallback(() => {
    clearHomeShared()
    setSharedScript(null)
    requestStop({ kind: 'apply-doc', doc: welcomeScript })
  }, [welcomeScript, requestStop])

  // Dashboards pane header: slide back up to the editor viewport and reset
  // the runtime (the same stop path as the re-entry contract), ready for
  // another run.
  const handleBackToEditor = useCallback(() => {
    resetEditorToArrival()
    const el = document.getElementById('tour-section-editor')
    const sentinel = heroRef.current
    if (!el || !sentinel || typeof window.scrollTo !== 'function') return
    const headerBottom = sentinel.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - headerBottom), behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  }, [prefersReducedMotion, resetEditorToArrival])

  // ── Quest + challenge hooks ──
  useQuickStartAutoComplete({
    pageRoute: '/',
    quests,
    initialSource: initialContent,
    currentSource: doc,
  })
  useCompletionChallenge({ pageRoute: '/', quests, completedResults: recordedSession })

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

  // ── Editor interactions: the editor section hosts the shared welcome document. ──
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
    ) => {
      if (!block) return
      track?.(HOME_EVENTS.demoRun)
      if (demo) setDemoRunning(true)

      // Immediate UI response: open the fullscreen timer on the click frame.
      setActiveBlock(block)
      setFullscreenOpen(true)
      setAutoStart(true)
      setTimerSessionKey((k) => k + 1)
      setRecordedSession(null)

      if (startingRef.current || pendingActionRef.current) {
        pendingActionRef.current = { kind: 'restart', doc, block, sectionTitle }
        return
      }
      if (runRef.current && runStartedRef.current && !finalizedRef.current) {
        pendingActionRef.current = { kind: 'restart', doc, block, sectionTitle }
        externalStopRef.current = true
        setExternalStop(true)
        return
      }
      if (runRef.current && !finalizedRef.current) {
        // Never-started snapshot: discard it (end() — no note churn), then
        // mint the running note.
        void end().then(() => doStart(doc, block, sectionTitle))
        return
      }
      void doStart(doc, block, sectionTitle)
    },
    [doStart, end, track],
  )

  // Explicit editor Run: start in place — the editor viewport stays an
  // editor; closing the fullscreen review glides to the dashboards section.
  const handleRun = useCallback(() => {
    beginRun('Run', docRef.current, blocksRef.current[0], true)
  }, [beginRun])

  // Completion glide: park the dashboards section header right under the
  // sticky header so the run's Session Insights are what the visitor sees
  // after closing the fullscreen review panel. The sentinel's document top
  // IS the header's bottom edge (it is the first element in flow under it).
  // The glide leaves the hero, so an unwatched pitch collapses first —
  // gliding before the collapse settled would shift the target under us.
  const scrollInsightsIntoView = useCallback(() => {
    const glide = () => {
      const el = document.getElementById('tour-section-insights')
      const sentinel = heroRef.current
      if (!el || !sentinel || typeof window.scrollTo !== 'function') return
      const headerBottom = sentinel.getBoundingClientRect().top + window.scrollY
      const target = Math.max(0, el.getBoundingClientRect().top + window.scrollY - headerBottom)
      window.scrollTo({ top: target, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
    }
    if (whyShrunkRef.current) {
      glide()
      return
    }
    setWhyShrunk(true)
    window.setTimeout(glide, 350)
  }, [prefersReducedMotion])

  // Stop click / natural completion: the fullscreen panel reports partial or
  // completed results; finalize records them against the run's note exactly
  // once, then the insights section picks the session up and glides into
  // view where the visitor is.
  const handleTimerComplete = useCallback(
    (_blockId: string, results: Sessions) => {
      // Record-once: a duplicate report (Stop after natural complete) is
      // absorbed unless a save is still pending.
      if (finalizedRef.current && !unsavedRef.current) return
      if ((results.logs ?? []).length === 0) {
        finalizedRef.current = true
        setRecordedSession(results)
        setFullscreenOpen(false)
        scrollInsightsIntoView()
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
          if (externalStopRef.current || pendingActionRef.current) {
            setFullscreenOpen(false)
            return performPending()
          }
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
    [finalize, performPending, scrollInsightsIntoView],
  )

  const handleFullscreenClose = useCallback(() => {
    setFullscreenOpen(false)
    scrollInsightsIntoView()
  }, [scrollInsightsIntoView])

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

  // ── L3 outline (right rail + ⋯ menu): links to the home sections. The
  // insights row's secondary ▶ IS the idle→running transition — clicking it
  // mints a fresh run identity and opens the fullscreen timer. ──
  const { setL3Items } = useNav()
  const outline = useMemo<NavItemL3[]>(() => [
    { id: 'tour-hero', label: 'Welcome', level: 3, action: { type: 'scroll', sectionId: 'tour-hero' } },
    { id: 'editor', label: 'Live Preview', level: 3, action: { type: 'scroll', sectionId: 'tour-section-editor' } },
    {
      id: 'insights',
      label: 'Session Insights',
      level: 3,
      action: { type: 'scroll', sectionId: 'tour-section-insights' },
      secondaryAction: { id: 'run-start', label: 'Run the workout', action: { type: 'call', handler: handleRun } },
    },
    { id: 'boards', label: 'One Run Becomes Many', level: 3, action: { type: 'scroll', sectionId: 'tour-section-boards' } },
    { id: 'community-feeds', label: 'Library & Community Feeds', level: 3, action: { type: 'scroll', sectionId: 'tour-section-community-feeds' } },
    { id: 'offerings', label: 'Who owns the Data?', level: 3, action: { type: 'scroll', sectionId: 'tour-section-offerings' } },
    { id: 'university', label: 'Wod Wiki University', level: 3, action: { type: 'scroll', sectionId: 'tour-section-university' } },
  ], [handleRun])
  useEffect(() => {
    setL3Items(outline)
    return () => setL3Items([])
  }, [setL3Items, outline])
  // deriveNav is empty on `/`, so usePageScrollSync has nothing to observe —
  // the tour owns its outline AND its scroll-spy, keeping the rail's
  // highlight on the section under the reading line while scrolling.
  const spyIds = useMemo(
    () => outline.map(item => (item.action.type === 'scroll' ? item.action.sectionId : item.id)),
    [outline],
  )
  useSectionScrollSpy(spyIds)

  const fullscreenBlock = run?.block ?? activeBlock
  const fullscreen = fullscreenOpen && fullscreenBlock && (
    <FullscreenTimer
      key={timerSessionKey}
      block={fullscreenBlock}
      resultId={run?.resultId}
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

  const editorPane = (
    <ScrollGate
      gateId="editor-pane"
      segmentId="hero"
      className="w-full max-w-[720px] xl:max-w-[820px] 2xl:max-w-[920px]"
    >
      <MacOSChrome
        title={sharedBy ? (sharedBy.toLowerCase().startsWith('shared by') ? sharedBy : `shared by: ${sharedBy}`) : 'welcome-1.md'}
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
        className="h-[540px] lg:h-[600px] 2xl:h-[640px]"
      >
        <TourEditorScreen
          doc={doc}
          theme={theme}
          onDocChange={handleDocChange}
          onBlocksChange={handleBlocksChange}
          onRun={handleRun}
        />
      </MacOSChrome>
    </ScrollGate>
  )

  // The pitch video hands the hero to the editor once watched —
  // the same stage contract in both form factors.
  const whyVideoBlock = (
    <div
      id="tour-why-video-wrap"
      aria-hidden={whyShrunk}
      className={cn(
        'grid w-full transition-all duration-300 motion-reduce:transition-none',
        whyShrunk ? 'grid-rows-[0fr] opacity-0 invisible' : 'grid-rows-[1fr] opacity-100',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <TourWhyVideo onWatched={handleWhyWatched} />
      </div>
    </div>
  )

  const editorBlock = (
    <div
      ref={editorSectionRef}
      id="tour-section-editor"
      data-testid="tour-section-editor"
      className="flex w-full flex-col items-center px-5 py-8 text-center lg:px-10 xl:py-10 2xl:px-16"
    >
      {whyShrunk && (
        <button
          type="button"
          onClick={handleWatchAgain}
          data-testid="tour-why-watch-again"
          className="inline-flex items-center gap-1.5 rounded-t-lg border border-b-0 border-border bg-muted/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Play className="size-3" />
          Watch again
        </button>
      )}
      {editorPane}
    </div>
  )

  // Reduced-motion: the same sections, flat hero — no sticky choreography.
  if (prefersReducedMotion) {
    return (
      <div data-testid="home-tour">
        <section id="tour-hero" data-testid="tour-hero" className="flex flex-col items-center gap-5 px-6 py-6 text-center">
          <TourHeroHeading />
          {whyVideoBlock}
          {editorBlock}
        </section>
        <InsightsDashboardsSection session={recordedSession} onRun={handleRun} onBackToEditor={handleBackToEditor} />
        <TourJumpSection />
        {offeringsBlock}
        <GuideIndexFooter variant="university" />
        <TourFooter />
        {fullscreen}
      </div>
    )
  }

  // ── Normal flow: heading hero (pitch video, then the live editor
  // preview) → the two data sections → feeds → offerings → footer. ──
  return (
    <div data-testid="home-tour">
      {/* Arrival sentinel (#882): a 1px mark at the very top of the page —
          its document top IS the sticky header's bottom edge (parking math). */}
      <div ref={heroRef} aria-hidden className="h-px" />

      <section
        ref={heroSectionRef}
        id="tour-hero"
        data-testid="tour-hero"
        className="relative flex min-h-[calc(100dvh-65px)] flex-col items-center justify-center gap-5 px-5 py-6 text-center lg:min-h-[calc(100dvh-104px)] lg:px-10 xl:gap-7 xl:py-8 2xl:px-16"
      >
        <TourHeroHeading />
        {whyVideoBlock}
        {/* The live preview: welcome-1.md loaded in the editor. Watching the
            pitch collapses it into the Watch again tab and the
            editor becomes the hero viewport. Run opens the fullscreen timer;
            closing its review panel glides to the dashboards section below.
            The editor chrome is a scroll gate: while traveling, gestures
            scroll the track; editing inside captures the gate. */}
        {editorBlock}
      </section>

      <InsightsDashboardsSection session={recordedSession} onRun={handleRun} onBackToEditor={handleBackToEditor} />

      {/* Library & Community Feeds — collections/packages land above the
          data-ownership sections. */}
      <TourJumpSection />

      {offeringsBlock}

      <GuideIndexFooter variant="university" />
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
