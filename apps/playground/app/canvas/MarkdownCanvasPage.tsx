/**
 * MarkdownCanvasPage — thin page wrapper for the interactive canvas.
 *
 * Composes:
 *   SplitCanvasTemplate (layout)
 *   CanvasProsePanel    (scrolling prose column)
 *   CanvasEditorPanel   (sticky editor/runtime/review panel)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Play } from 'lucide-react'
import { useQueryState } from 'nuqs'
import type { ScriptCommand } from '@/components/Editor/overlays/ScriptCommand'
import { RuntimeTimerPanel } from '@/components/organisms/editor/RuntimeTimerPanel'
import { useActiveScrollSection } from '@/hooks/useActiveScrollSection'
import { useScrollTelemetry } from '@/services/telemetry'
import { useCanvasRuntime } from '../hooks/useCanvasRuntime'
import { useCanvasEditorSource } from '../hooks/useCanvasEditorSource'
import { useCompletionChallenge } from '../hooks/useCompletionChallenge'
import { useQuickStartAutoComplete } from '../hooks/useQuickStartAutoComplete'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { CanvasPanelContent } from './CanvasPanelContent'
import { GuideRunwayGroups } from './GuideRunwayGroups'
import { GuideIndexFooter } from './GuideIndexFooter'
import { groupGuideSections } from './guideGroups'
import { getEditorPreferredHeight } from './canvasLayout'
import { CanvasSection as CanvasSectionCard } from '../components/molecules/CanvasSection'
import { CanvasProsePanel } from '../components/organisms/canvas/CanvasProsePanel'
import { CanvasEditorPanel } from '../components/organisms/canvas/CanvasEditorPanel'
import { SplitCanvasTemplate } from '../templates/SplitCanvasTemplate'
import { useSyntaxChallenge } from '../hooks/useSyntaxChallenge'
import {
  getCanvasNoteId,
  resolveSource,
  resolveContentOwners,
  STICKY_NAV_HEIGHT,
  INITIAL_SOURCE_KEY,
} from './canvasUtils'
import { type ParsedCanvasPage, type CanvasSection, type ButtonBlock, SECTION_THEME_STYLES, type SectionTheme } from './parseCanvasMarkdown'
import type { ScriptBlock } from '@/components/Editor/types'
import type { WorkoutItem } from '../App'
import { executeNavAction, pipelineStepToNavAction, type NavActionDeps } from '../nav/navTypes'
import { useStickyBoundaryOffset } from '@/panels/page-shells'
import { notebookItemPath } from '../lib/routes'
export interface MarkdownCanvasPageProps {
  page: ParsedCanvasPage
  wodFiles: Record<string, string>
  theme: string
  workoutItems?: WorkoutItem[]
  onSelect?: (item: WorkoutItem) => void
  contentOverride?: string
  panelHeaderActions?: React.ReactNode
  onPanelActionsReady?: (actions: PanelActions) => void
  heroSlot?: React.ReactNode
  /** Called when an inline challenge asks to scroll to its owning section. */
  onScrollToSection?: (sectionId: string) => void
}

export interface PanelActions {
  run: () => void
  reset: () => void
  results: () => void
  fullscreen: () => void
  getSource: () => string
}

export function MarkdownCanvasPage({
  page,
  wodFiles,
  theme,
  workoutItems,
  onSelect,
  contentOverride,
  panelHeaderActions,
  onPanelActionsReady,
  heroSlot: heroSlotProp,
  onScrollToSection,
}: MarkdownCanvasPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { sections, route, chapters } = page
  const isPageSlug = location.pathname.startsWith('/page/') || route.startsWith('/page/')
  const canvasNoteId = useMemo(() => getCanvasNoteId(route), [route])
  const isGuide = page.type === 'guide' || route.startsWith('/page/guide-')
  useScrollTelemetry(isGuide ? route : undefined)

  const isCollection = route.startsWith('/notebook/')
  // Live syntax guides render their content sections as grouped parallax
  // runways (GuideRunwayGroups over the shared RunwayShell). Collections and
  // every other canvas page keep the original flowing layout.
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const isGuideRunway = isGuide && !isCollection && !reducedMotion
  const notebookSlug = isCollection ? (route.split('/').pop() ?? null) : null

  const handleSelectWorkout = useCallback(
    (item: WorkoutItem) => {
      if (onSelect) {
        onSelect(item)
        return
      }
      navigate(notebookItemPath(item.category, item.name))
    },
    [navigate, onSelect],
  )

  const hasWorkoutsTag = sections.some((s) => s.proseChunks.some(c => c.kind === 'widget' && c.widget === 'workouts-list'))
  const contentSections = sections.slice(1)

  const heroSection = sections[0] ?? null
  const heroHasContent = !!heroSection && (heroSection.proseChunks.some(c => c.kind === 'prose' && c.text.trim() !== '') || heroSection.buttons.length > 0)

  const viewDef = sections.find((s) => s.view)?.view ?? null
  const stickyAlign = viewDef?.align ?? 'right'
  const editorWidth = viewDef?.width ?? '50%'
  const initialActiveSection = contentSections[0] ?? sections[0] ?? null

  // On the home page the editor panel is hidden during the hero and Jump-In
  // hub, then becomes sticky from the "Learn the Syntax" section onward.
  // On all other pages the panel is present from the first content section.
  const editorAppearsAtSectionId = route === '/' ? 'learn' : undefined

  const initialSource = viewDef?.source ? resolveSource(viewDef.source, wodFiles) : ''
  const initialSourceKey = viewDef?.source || INITIAL_SOURCE_KEY
  const [activeSectionId, setActiveSectionId] = useState<string | null>(initialActiveSection?.id ?? null)
  const [activeSectionTitle, setActiveSectionTitle] = useState(initialActiveSection?.heading ?? 'Whiteboard Script')
  // Tracks the heading of whichever section *owns* the panel's current
  // content (see `contentOwnerBySection` below). Sections that only narrate
  // the same code sample (e.g. "Plan"/"Run"/"Analytics" beats) show this
  // alongside their own title — "still looking at X" — instead of appearing
  // to desync from the content.
  const [contentOwnerTitle, setContentOwnerTitle] = useState(initialActiveSection?.heading ?? 'Whiteboard Script')

  // See `resolveContentOwners` in canvasUtils.ts for why ownership is
  // resolved from document position rather than from scroll-triggered side
  // effects (it's what makes scrolling back UP correctly restore content).
  const contentOwnerBySection = useMemo(() => resolveContentOwners(contentSections), [contentSections])

  // Guide stages carry their example in the Try-it button pipeline
  // (`set-source: …`) instead of ```example fences — derive the same owner
  // map from those so runway activation swaps/restores the panel source
  // exactly like the example-driven pages do (null on non-guide pages).
  const guideGroupKey = isGuideRunway ? route.split('/').pop() || undefined : undefined
  const guideGrouping = useMemo(
    () => (isGuideRunway ? groupGuideSections(contentSections, guideGroupKey) : null),
    [isGuideRunway, guideGroupKey, contentSections],
  )
  const { guideOwnerBySection, guideOwnerSource } = useMemo(() => {
    if (!isGuideRunway) return { guideOwnerBySection: null, guideOwnerSource: null }
    const owners = new Map<string, CanvasSection | null>()
    const sources = new Map<string, string>()
    let owner: CanvasSection | null = null
    for (const section of contentSections) {
      const chunkButton = section.proseChunks.find(
        (c): c is { kind: 'button'; button: ButtonBlock } =>
          c.kind === 'button' && c.button.pipeline.some((step) => step.action === 'set-source'),
      )
      const source =
        chunkButton?.button.pipeline.find((step) => step.action === 'set-source')?.value
        ?? section.buttons.find((b) => b.pipeline.some((step) => step.action === 'set-source'))
          ?.pipeline.find((step) => step.action === 'set-source')?.value
        ?? null
      if (source) {
        owner = section
        sources.set(section.id, source)
      }
      owners.set(section.id, owner)
    }
    return { guideOwnerBySection: owners, guideOwnerSource: sources }
  }, [isGuideRunway, contentSections])
  const [activeSectionTheme, setActiveSectionTheme] = useState<SectionTheme>(() =>
    (initialActiveSection ?? sections[0])?.theme ?? 'slate'
  )
  const [selectedExamples, setSelectedExamples] = useState<Record<string, number>>({})
  const {
    editorSource, editorOpacity, isEditorLoading, activeOriginalSource,
    swapSource, handleEditorChange, resetActiveSource,
    setEditorView, getSource,
  } = useCanvasEditorSource({ initialSource, initialSourceKey, contentOverride })
  const wodFilesRef = useRef(wodFiles)
  wodFilesRef.current = wodFiles

  // Runtime hook
  const getBlock = useCallback(() => scriptBlocksRef.current[0] ?? null, [])
  const runtime = useCanvasRuntime({ getBlock, getContent: getSource, title: page.frontmatter.title })
  const { startRun, closeRun, handleWorkoutComplete, resetRun, resetRequested, fullscreen, runState, completedResults } = runtime

  // Reset-to-example: archive first (partial + fresh reset snapshot of the
  // example source); the draft only changes once the reset persisted.
  const handlePanelReset = useCallback(async () => {
    const ok = await resetRun(initialSource)
    if (!ok) return false
    resetActiveSource()
    return true
  }, [resetRun, initialSource, resetActiveSource])


  // Reactive state mirror of the first script block so quest validation
  // re-runs on every editor compile. Kept in sync via `onBlocksChange`.
  const [liveBlock, setLiveBlock] = useState<ScriptBlock | null>(null)

  // Page-level quests are extracted from ```quest fenced blocks by the
  // canvas parser and shipped on `page.quests`. They drive the challenge
  // banner and the syntax-validation hook.
  const pageQuests = page.quests ?? []

  const challenge = useSyntaxChallenge({
    pageRoute: page.route,
    quests: pageQuests,
    block: liveBlock,
  })

  useCompletionChallenge({
    pageRoute: page.route,
    quests: pageQuests,
    completedResults,
  })

  useQuickStartAutoComplete({
    pageRoute: page.route,
    quests: pageQuests,
    initialSource,
    currentSource: editorSource,
  })

  // ScriptBlocks ref
  const scriptBlocksRef = useRef<ScriptBlock[]>([])

  // Id of whichever owner section's content is currently applied to the
  // panel (`null` means the original `view` source, before any owner).
  // Comparing against this — rather than reacting to "did this section have
  // steps" — is what lets re-entering a section (from either scroll
  // direction) skip a no-op re-apply while still correctly resetting when
  // the resolved owner actually changes.
  const appliedContentOwnerIdRef = useRef<string | null>(
    contentOwnerBySection.get(initialActiveSection?.id ?? '')?.id ?? null,
  )

  // Activate section
  const activateSection = useCallback((section: CanvasSection) => {
    setActiveSectionId(section.id)
    setActiveSectionTitle(section.heading)
    setActiveSectionTheme(section.theme ?? 'slate')

    const ownerMap = guideOwnerBySection ?? contentOwnerBySection
    const owner = ownerMap.get(section.id) ?? null
    setContentOwnerTitle(owner?.heading ?? initialActiveSection?.heading ?? 'Whiteboard Script')

    const ownerKey = owner?.id ?? null
    if (ownerKey === appliedContentOwnerIdRef.current) return
    appliedContentOwnerIdRef.current = ownerKey

    if (!owner) {
      // Scrolled back above the first content-owning section — restore the
      // panel's original source instead of leaving a later section's example
      // showing.
      swapSource(initialSource, initialSourceKey)
      return
    }

    const ownerExamples = owner.examples ?? []
    if (ownerExamples.length > 0) {
      const selectedIndex = selectedExamples[owner.id] ?? 0
      const example = ownerExamples[selectedIndex] ?? ownerExamples[0]
      if (example?.source) {
        swapSource(resolveSource(example.source, wodFilesRef.current), example.source)
      }
    }

    for (const cmd of owner.commands) {
      const steps = cmd.pipeline
        .filter((step) => !(ownerExamples.length > 0 && step.action === 'set-source'))
        .map((step) => pipelineStepToNavAction(step, cmd.open ?? 'view'))
      if (steps.length === 0) continue
      executeNavAction(
        steps.length === 1 ? steps[0] : { type: 'pipeline', steps },
        depsRef.current,
      )
    }

    // Guide stages: the derived Try-it source IS the owner's example — the
    // panel loads it when the stage becomes active (and the owner map
    // restores the previous stage's source when scrolling back up).
    const guideSource = guideOwnerBySection ? guideOwnerSource?.get(owner.id) : undefined
    if (guideSource) {
      swapSource(resolveSource(guideSource, wodFilesRef.current), guideSource)
    }
  }, [selectedExamples, swapSource, contentOwnerBySection, guideOwnerBySection, guideOwnerSource, initialActiveSection, initialSource, initialSourceKey])

  const handleExampleSelect = useCallback((section: CanvasSection, index: number) => {
    setSelectedExamples((prev) => ({ ...prev, [section.id]: index }))
    setActiveSectionId(section.id)
    setActiveSectionTitle(section.heading)
    setActiveSectionTheme(section.theme ?? 'slate')
    setContentOwnerTitle(section.heading)
    appliedContentOwnerIdRef.current = section.id

    const example = section.examples?.[index]
    if (example?.source) {
      swapSource(resolveSource(example.source, wodFilesRef.current), example.source)
    }
  }, [swapSource])

  // NavActionDeps
  const [headingParam, setHeadingParam] = useQueryState('h', { history: 'replace', shallow: true })
  const [notebookQuery] = useQueryState('q', { defaultValue: '', shallow: true })

  const deps = useMemo<NavActionDeps>(() => ({
    navigate: (to: string, opts?: { replace?: boolean }) => navigate(to, { replace: opts?.replace }),
    setQueryParam: (params: Record<string, string | null>, replace?: boolean) => {
      const h = params['h']
      if (h !== undefined) setHeadingParam(h, { history: replace ? 'replace' : 'push' })
    },
    swapSource: (source: string) => swapSource(resolveSource(source, wodFilesRef.current), source),
    setPanelState: (state: 'note' | 'track' | 'review') => {
      if (state === 'track') {
        const block = getBlock()
        if (block) startRun(block)
      }
    },
  }), [navigate, swapSource, setHeadingParam, getBlock, startRun])

  const depsRef = useRef(deps)
  depsRef.current = deps

  // Guide runways: a group reports the section its scroll progress just
  // activated — same contract as the old per-section IO tracking, so source
  // ownership, titles, and the ?h= deep link stay in the host.
  const activateGuideSection = useCallback((section: CanvasSection) => {
    setHeadingParam(section.id, { history: 'replace' })
    activateSection(section)
  }, [activateSection, setHeadingParam])

  // The sticky boundary measures the actual visible panel/header stack. This
  // keeps section tracking correct when the editor frame becomes content-sized.
  const stickyViewportOffset = useStickyBoundaryOffset(STICKY_NAV_HEIGHT)
  const activeScrollRootMargin = useMemo(
    () => `-${stickyViewportOffset}px 0px -30% 0px`,
    [stickyViewportOffset],
  )

  // Scroll tracking. Guide runways activate their stages through runway
  // progress (owner-gated), so the element observer only tracks the static
  // tail there — hidden caption cards must never compete for activation.
  const trackedSectionIds = guideGrouping
    ? guideGrouping.tail.map((s) => s.id)
    : contentSections.map((s) => s.id)
  const hasUserScrolledRef = useRef(false)
  useActiveScrollSection({
    ids: trackedSectionIds,
    enabled: trackedSectionIds.length > 0,
    rootMargin: activeScrollRootMargin,
    threshold: [0, 0.1, 0.25, 0.5, 0.75],
    dataAttribute: 'data-section-id',
    scrollDirection: 'topmost-when-up',
    debounceMs: 50,
    shouldAcceptChange: () => {
      if (!hasUserScrolledRef.current) {
        hasUserScrolledRef.current = window.scrollY > 0
        return hasUserScrolledRef.current
      }
      return true
    },
    onChange: (id) => {
      const section = contentSections.find((s) => s.id === id)
      if (!section) return
      setHeadingParam(id, { history: 'replace' })
      activateSection(section)
    },
  })

  // Initial scroll-to from ?h=
  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (didInitialScroll.current || !headingParam || contentSections.length === 0) return
    didInitialScroll.current = true
    requestAnimationFrame(() => {
      // Guide runways render zero-size stage markers at each stage's runway
      // start, so this element scroll lands at real group progress; static
      // tail sections resolve to their normal-flow cards.
      const el = document.querySelector(`[data-section-id="${headingParam}"]`)
      if (!el) return
      
      const offset = stickyViewportOffset + 8
      const top = (el as HTMLElement).getBoundingClientRect().top + window.scrollY - offset
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    })
  }, [contentSections, headingParam, stickyViewportOffset])

  // Collection query scroll
  // Collection query scroll
  const previousCollectionQueryRef = useRef(notebookQuery)
  useEffect(() => {
    if (!isCollection) {
      previousCollectionQueryRef.current = notebookQuery
      return
    }
    const nextQuery = notebookQuery.trim()
    const previousQuery = previousCollectionQueryRef.current.trim()
    if (nextQuery && nextQuery !== previousQuery) {
      const listElement = document.getElementById('notebook-workouts')
      if (listElement) {
        const top = listElement.getBoundingClientRect().top + window.scrollY - stickyViewportOffset - 8
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      }
    }
    previousCollectionQueryRef.current = notebookQuery
  }, [notebookQuery, isCollection, stickyViewportOffset])

  // Panel actions ready
  const onPanelActionsReadyRef = useRef(onPanelActionsReady)
  onPanelActionsReadyRef.current = onPanelActionsReady
  useEffect(() => {
    onPanelActionsReadyRef.current?.({
      run: () => {
        const block = scriptBlocksRef.current[0] ?? null
        if (block) startRun(block)
      },
      reset: () => { void resetRun() },
      results: () => {},
      fullscreen: () => {
        const block = scriptBlocksRef.current[0] ?? null
        if (block) startRun(block)
      },
      getSource,
    })
  }, [startRun, resetRun, getSource])

  // Commands for InlineCommandBar on wod blocks
  const canvasCommands = useMemo<ScriptCommand[]>(() => [
    {
      id: 'run',
      label: 'Run',
      icon: <Play className="h-3 w-3 fill-current" />,
      primary: true,
      onClick: (block) => {
        startRun(block)
      },
    },
  ], [startRun])

  const activePanelTheme = SECTION_THEME_STYLES[activeSectionTheme] ?? SECTION_THEME_STYLES.slate

  const panelTitle =
    isEditorLoading ? `${activeSectionTitle} · loading` : activeSectionTitle

  // Only shown when the active section is narrating the same source the
  // panel already loaded (see `contentOwnerTitle` above) — makes it explicit
  // that the panel hasn't gone stale, it's just still on the same example.
  const panelSubtitle =
    !isEditorLoading && activeSectionTitle !== contentOwnerTitle
      ? contentOwnerTitle
      : undefined


  // Stable `onBlocksChange` so the editor's internal effect (which depends on
  // the prop reference) doesn't refire every parent render. Guards on
  // content identity so a no-op re-emission from the editor doesn't
  // re-render the whole canvas page.
  const handleBlocksChange = useCallback(
    (blocks: ScriptBlock[]) => {
      const next = blocks[0] ?? null;
      scriptBlocksRef.current = blocks;
      setLiveBlock((prev) => {
        if (prev?.content === next?.content && prev?.id === next?.id) {
          return prev;
        }
        return next;
      });
    },
    [],
  )


  // Goal Gradient (ADR-0010): the home page gets an onboarding credit/progress
  // strip above the markdown hero. Other canvas routes are unaffected.
  const heroContent = heroSlotProp ?? (heroHasContent && heroSection ? (
    <CanvasSectionCard
      section={heroSection}
      idx={-1}
      prose={undefined}
      blockId={heroSection.id}
      keySuffix="hero"
      showEyebrow={false}
      isActive={false}
      hasViewDef={!!viewDef}
      deps={deps}
      onExampleSelect={handleExampleSelect}
      selectedExampleIndex={0}
      onScrollToSection={onScrollToSection}
      challengeQuests={challenge.quests}
    />
  ) : null)
  const heroSlot = heroContent

  const activeHeaderActions = panelHeaderActions

  const panelContent = (
    <CanvasPanelContent
      editorSource={editorSource}
      editorOpacity={editorOpacity}
      activeOriginalSource={activeOriginalSource}
      handleEditorChange={handleEditorChange}
      onResetToSource={handlePanelReset}
      canvasNoteId={canvasNoteId}
      readonly={isPageSlug}
      showFrontmatter={typeof page.frontmatter.showFrontmatter === 'boolean'
        ? page.frontmatter.showFrontmatter
        : !isGuide && route !== '/' && !route.startsWith('/syntax')}
      theme={theme}
      commands={canvasCommands}
      onBlocksChange={handleBlocksChange}
      onViewCreated={setEditorView}
      panelTitle={panelTitle}
      panelSubtitle={panelSubtitle}
      panelThemeClass={activePanelTheme.panel}
      headerActions={activeHeaderActions}
      onRun={(doc, block) => {
        if (block) void startRun(block, doc)
      }}
    />
  )

  const desktopPanel = viewDef && (
    <CanvasEditorPanel
      variant="desktop"
      panelContent={panelContent}
      panelTitle={panelTitle}
      panelSubtitle={panelSubtitle}
      viewDefButtons={viewDef.buttons}
      runState={runState}
      deps={deps}
      width={editorWidth}
      source={editorSource}
    />
  )

  const mobilePanel = viewDef && (
    <CanvasEditorPanel
      variant="mobile"
      panelContent={panelContent}
      panelTitle={panelTitle}
      panelSubtitle={panelSubtitle}
      viewDefButtons={viewDef.buttons}
      runState={runState}
      deps={deps}
      width={editorWidth}
      source={editorSource}
    />
  )

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {fullscreen?.kind === 'timer' && (
        <div className="sticky z-30 border-b border-border bg-background" style={{ top: stickyViewportOffset }}>
          <div className="mx-auto h-[max(320px,min(75vh,640px))] max-w-5xl px-4 py-2">
            <RuntimeTimerPanel
              block={fullscreen.block}
              onClose={closeRun}
              autoStart
              externalStop={resetRequested}
              onComplete={(_blockId, results) => { void handleWorkoutComplete(results) }}
            />
          </div>
        </div>
      )}

      <SplitCanvasTemplate
        heroSlot={heroSlot}
      >
        {isGuideRunway ? (
          <GuideRunwayGroups
            sections={contentSections}
            groupKey={guideGroupKey}
            title={String(page.frontmatter.title ?? '')}
            pane={
              <div
                className="absolute inset-0"
                style={{
                  '--canvas-editor-preferred-height': getEditorPreferredHeight(editorSource),
                } as React.CSSProperties}
              >
                {panelContent}
              </div>
            }
            cardArgs={{
              activeSectionId,
              selectedExamples,
              onExampleSelect: handleExampleSelect,
              runState,
              deps,
              hasViewDef: !!viewDef,
              chapters,
              challengeQuests: challenge.quests,
              onScrollToSection,
            }}
            onActivateSection={activateGuideSection}
          />
        ) : (
          <CanvasProsePanel
            contentSections={contentSections}
            isCollection={isCollection}
            notebookSlug={notebookSlug}
            workoutItems={workoutItems}
            handleSelectWorkout={handleSelectWorkout}
            activeSectionId={activeSectionId}
            selectedExamples={selectedExamples}
            runState={runState}
            deps={deps}
            handleExampleSelect={handleExampleSelect}
            hasWorkoutsTag={hasWorkoutsTag}
            hasViewDef={!!viewDef}
            chapters={chapters}
            challengeQuests={challenge.quests}
            onScrollToSection={onScrollToSection}
            mobilePanel={mobilePanel}
            desktopPanel={desktopPanel}
            stickyAlign={stickyAlign as 'left' | 'right'}
            editorWidth={editorWidth}
            editorAppearsAtSectionId={editorAppearsAtSectionId}
          />
        )}
      </SplitCanvasTemplate>
      {isGuide && <GuideIndexFooter />}
    </div>
  )
}
