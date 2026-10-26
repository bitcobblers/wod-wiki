/**
 * ScrollCanvasPage.tsx — markdown-driven ```scroll guide page.
 *
 * A guide authors one fenced ```scroll block plus trailing content sections;
 * this page renders the runway through the unified **Runway Adapter** (#936),
 * which picks the desktop slide runway / mobile pinned window / reduced flat
 * stack by Form Factor — all fed by the one `resolveScrollStage` seam. The
 * page itself keeps only the page-level chrome the adapter deliberately does
 * NOT own (#933/#935): the fullscreen runtime (timer/review), quest
 * validation, and the trailing content sections with their nav deps.
 *
 * The runway's document is CONTROLLED: the page owns `doc`/`setDoc` so a
 * trailing-section button (`swapSource`) or example picker can load a source
 * into the hero editor, and the page reads the compiled block for Run/runtime.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryState } from 'nuqs'
import { RuntimeTimerPanel } from '@/components/organisms/editor/RuntimeTimerPanel'
import type { ScriptBlock } from '@/components/Editor/types'
import { useScrollTelemetry } from '@/services/telemetry'
import { useCanvasRuntime } from '../hooks/useCanvasRuntime'
import { useCompletionChallenge } from '../hooks/useCompletionChallenge'
import { useSyntaxChallenge } from '../hooks/useSyntaxChallenge'
import { CanvasSection as CanvasSectionCard } from '../components/molecules/CanvasSection'
import type { NavActionDeps } from '../nav/navTypes'
import type { WorkoutItem } from '../App'
import {
  type ParsedCanvasPage,
  type CanvasSection,
} from './parseCanvasMarkdown'
import { resolveSource, STICKY_NAV_HEIGHT } from './canvasUtils'
import { useStickyBoundaryOffset } from '@/panels/page-shells'
import { useScrollQuests } from './useScrollQuests'
import { RunwayAdapter } from './RunwayAdapter'

export interface ScrollCanvasPageProps {
  page: ParsedCanvasPage
  wodFiles: Record<string, string>
  theme: string
  workoutItems: WorkoutItem[]
  onSelect?: (item: WorkoutItem) => void
  onScrollToSection?: (sectionId: string) => void
}

export function ScrollCanvasPage({
  page,
  wodFiles,
  theme,
  onScrollToSection,
}: ScrollCanvasPageProps) {
  const scroll = page.scroll!
  const stages = scroll.stages
  const navigate = useNavigate()
  const isGuide = page.type === 'guide' || page.route.startsWith('/page/guide-')
  useScrollTelemetry(isGuide ? page.route : undefined)

  // ── Editor document (controlled into the runway) + per-stage sources ──
  const sourcesByStageId = useMemo(
    () =>
      Object.fromEntries(
        stages.map((s) => [s.id, s.source ? resolveSource(s.source, wodFiles) : '']),
      ),
    [stages, wodFiles],
  )
  const [doc, setDoc] = useState(() => sourcesByStageId[stages[0]?.id] ?? '')
  const blocksRef = useRef<ScriptBlock[]>([])
  const [liveBlock, setLiveBlock] = useState<ScriptBlock | null>(null)

  // ── Quests: scroll milestones + validation challenges share the ledger ──
  const markStageViewed = useScrollQuests(page.route, page.quests, stages)

  const getBlock = useCallback(() => blocksRef.current[0] ?? null, [])
  const getContent = useCallback(() => doc, [doc])
  const runtime = useCanvasRuntime({ getBlock, getContent, title: page.frontmatter.title })
  const { startRun } = runtime
  const stickyViewportOffset = useStickyBoundaryOffset(STICKY_NAV_HEIGHT)

  const challenge = useSyntaxChallenge({
    pageRoute: page.route,
    quests: page.quests,
    block: liveBlock,
  })

  useCompletionChallenge({
    pageRoute: page.route,
    quests: page.quests,
    completedResults: runtime.completedResults,
  })

  // ── Nav deps for trailing sections (buttons, pipelines) ──
  const [, setHeadingParam] = useQueryState('h', { history: 'replace', shallow: true })
  const deps = useMemo<NavActionDeps>(
    () => ({
      navigate: (to: string, opts?: { replace?: boolean }) => navigate(to, { replace: opts?.replace }),
      setQueryParam: (params: Record<string, string | null>, replace?: boolean) => {
        const h = params['h']
        if (h !== undefined) setHeadingParam(h, { history: replace ? 'replace' : 'push' })
      },
      swapSource: (source: string) => setDoc(resolveSource(source, wodFiles)),
      setPanelState: (state: 'note' | 'track' | 'review') => {
        if (state === 'track') {
          const block = getBlock()
          if (block) startRun(block)
        }
      },
    }),
    [navigate, setHeadingParam, wodFiles, getBlock, startRun],
  )

  const handleExampleSelect = useCallback(
    (section: CanvasSection, index: number) => {
      const example = section.examples?.[index]
      if (example?.source) setDoc(resolveSource(example.source, wodFiles))
    },
    [wodFiles],
  )

  const handleBlocksChange = useCallback((blocks: ScriptBlock[]) => {
    const next = blocks[0] ?? null
    blocksRef.current = blocks
    setLiveBlock((prev) =>
      prev?.content === next?.content && prev?.id === next?.id ? prev : next,
    )
  }, [])

  // Run from the runway's Run button — the adapter hands back the current
  // doc + compiled block; launch the fullscreen timer with it.
  const handleRun = useCallback(
    (content: string, block: ScriptBlock | null) => {
      if (block) void startRun(block, content)
    },
    [startRun],
  )

  const noteTitle = `${page.route.split('/').pop() ?? 'note'}.md`

  // Trailing sections (hero skipped — its view IS the runway's editor).
  const trailingSections = page.sections.slice(1)
  const trailing = trailingSections.map((section, idx) => (
    <CanvasSectionCard
      key={section.id}
      section={section}
      idx={idx}
      blockId={section.id}
      keySuffix="scroll"
      isActive={false}
      hasViewDef={false}
      deps={deps}
      onExampleSelect={handleExampleSelect}
      selectedExampleIndex={0}
      challengeQuests={challenge.quests}
      onScrollToSection={onScrollToSection}
    />
  ))

  return (
    <div className="flex flex-col min-h-screen bg-background" data-testid="scroll-canvas-page">
      {runtime.fullscreen?.kind === 'timer' && (
        <div className="sticky z-30 border-b border-border bg-background" style={{ top: stickyViewportOffset }}>
          <div className="mx-auto h-[max(320px,min(75vh,640px))] max-w-5xl px-4 py-2">
            <RuntimeTimerPanel
              block={runtime.fullscreen.block}
              onClose={runtime.closeRun}
              autoStart
              externalStop={runtime.resetRequested}
              onComplete={(_blockId, results) => { void runtime.handleWorkoutComplete(results) }}
            />
          </div>
        </div>
      )}

      <RunwayAdapter
        spec={scroll}
        wodFiles={wodFiles}
        theme={theme}
        noteTitle={noteTitle}
        showFrontmatter={page.frontmatter.showFrontmatter === true}
        doc={doc}
        onDocChange={setDoc}
        onBlocksChange={handleBlocksChange}
        onStageEnter={markStageViewed}
        onRun={handleRun}
      />

      {trailing}
    </div>
  )
}
