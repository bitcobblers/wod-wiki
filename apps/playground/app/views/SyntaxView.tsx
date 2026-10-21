/**
 * SyntaxView — the /syntax page hosting the "Learning with Examples"
 * chapter picker (moved off the home page). Standalone chapter-run
 * plumbing: each run captures a fresh playground snapshot note via
 * usePlaygroundRun and drives the fullscreen timer.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ScriptBlock, Sessions } from '@/components/Editor/types'
import { useSeedContent } from '@/services/content/seedContent'
import { HOME_EVENTS, useTelemetry } from '@/services/telemetry'
import { useTheme } from '@/contexts/ThemeProvider'
import { toast } from '@/hooks/use-toast'
import { EMPTY_WOD_FILES } from '../lib/workoutIndex'
import { useCanvasRoutes, useFindCanvasPage } from '../canvas/canvasRoutes'
import { RingTargetsProvider } from '../tour/TourRing'
import { TourChapterPicker } from '../tour/TourChapterPicker'
import { TourLearnSection } from '../tour/TourLearnSection'
import { TaglineHeader } from '../tour/TaglineHeader'
import { GuideIndexFooter } from '../canvas/GuideIndexFooter'
import { TourFooter } from '../tour/TourFooter'
import { FullscreenTimer } from '@/components/organisms/review/FullscreenTimer'
import { usePlaygroundRun } from '../hooks/usePlaygroundRun'

export function SyntaxView() {
  const seedFiles = useSeedContent()
  const wodFiles = seedFiles ?? EMPTY_WOD_FILES

  // Resolved editor theme — same memo as AppContent.
  const { theme } = useTheme()
  const [isSystemDark, setIsSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    if (theme !== 'system') return
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (e: MediaQueryListEvent) => setIsSystemDark(e.matches)
    mediaQuery.addEventListener('change', listener)
    return () => mediaQuery.removeEventListener('change', listener)
  }, [theme])
  const actualTheme = useMemo(() => {
    if (theme === 'system') {
      return isSystemDark ? 'vs-dark' : 'vs'
    }
    return theme === 'dark' ? 'vs-dark' : 'vs'
  }, [theme, isSystemDark])

  // Chapters + quests from the home canvas page; cross-page quest labels.
  const page = useFindCanvasPage('/')
  const canvasRoutes = useCanvasRoutes()
  const chapters = page?.chapters ?? []
  const quests = page?.quests ?? []
  const questLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const { page: p } of canvasRoutes) {
      for (const q of p.quests) labels[q.id] = q.label
    }
    return labels
  }, [canvasRoutes])

  // Chapter run plumbing.
  const telemetry = useTelemetry()
  const track = telemetry?.track
  const { run, start, finalize, end } = usePlaygroundRun()
  const [activeBlock, setActiveBlock] = useState<ScriptBlock | null>(null)
  const [sessionKey, setSessionKey] = useState(0)
  const [autoStart, setAutoStart] = useState(false)

  const closeOverlay = useCallback(() => {
    setActiveBlock(null)
    setAutoStart(false)
  }, [])

  const handleChapterRun = useCallback(
    async (chapterId: string, block: ScriptBlock | null, doc: string) => {
      if (!block) return
      track?.(HOME_EVENTS.chapterExampleRun, { chapter: chapterId })
      try {
        const captured = await start(doc, block, { pageTitle: 'Syntax', sectionTitle: `Chapter ${chapterId}` })
        setActiveBlock(captured.block)
        setSessionKey((k) => k + 1)
        setAutoStart(true)
      } catch (err) {
        console.error('[SyntaxView] failed to persist playground run note:', err)
        closeOverlay()
        toast({ title: 'Could not start workout', variant: 'destructive' })
      }
    },
    [closeOverlay, start, track],
  )

  const handleComplete = useCallback(
    async (_blockId: string, results: Sessions) => {
      try {
        if ((results.logs ?? []).length === 0) {
          await end()
          closeOverlay()
        } else {
          await finalize(results, results.completed)
        }
      } catch (err) {
        console.error('[SyntaxView] failed to save session:', err)
        toast({ title: 'Session not saved', variant: 'destructive' })
        throw err
      }
    },
    [closeOverlay, end, finalize],
  )

  return (
    <RingTargetsProvider>
      <div data-testid="syntax-view">
        <TaglineHeader
          index="S"
          before="Syntax "
          accentText="Learning with Examples"
          after=""
          accent="hsl(var(--primary))"
          blurb="Six chapters on the syntax, each with a runnable example. Press run to start a timed workout from any chapter."
        />
        <TourChapterPicker
          wodFiles={wodFiles}
          chapters={chapters}
          allQuests={quests}
          theme={actualTheme}
          onRun={handleChapterRun}
        />
        <TourLearnSection quests={quests} chapters={chapters} questLabels={questLabels} />
        <GuideIndexFooter />
        <TourFooter />
        {activeBlock && autoStart && run && (
          <FullscreenTimer
            key={sessionKey}
            block={run.block}
            resultId={run.resultId}
            autoStart
            onClose={closeOverlay}
            onCompleteWorkout={handleComplete}
          />
        )}
      </div>
    </RingTargetsProvider>
  )
}
