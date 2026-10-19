import { useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Moon, Sun, Sparkles, PanelTop, LayoutGrid } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeProvider'
import { Switch } from '@/components/atoms/primitives/switch'
import { usePaletteStore } from '@/components/organisms/command-palette/palette-store'
import { useCanvasRoutes } from '../canvas/canvasRoutes'
import { canvasRouteSource } from '../services/paletteDataSources'
import {
  wqlSearchSource,
  withWqlText,
  searchPaletteQuery,
  palettePreferredChoices,
  paletteExecute,
  navigatePaletteResult,
} from '../services/wqlSearchSource'
import { createPlaygroundPage } from '../services/createPlaygroundPage'
import { AttentionWidget, type AttentionActionType, type AttentionWidgetConfig } from '../components/molecules/AttentionWidget'
import { CodeExampleWidget, type CodeExampleWidgetConfig } from '../components/molecules/CodeExampleWidget'
import { SyntaxGroupWidget, type SyntaxGroupWidgetConfig } from '../components/molecules/SyntaxGroupWidget'
import { OfferingTiers } from '../components/molecules/OfferingTiers'
import { buildSyntaxGuideReference } from '@/content/syntaxGuideReference'
import { useSeedContent } from '@/services/content/seedContent'
import { playgroundPath } from '../lib/routes'
import { LandingTemplate } from '../templates/LandingTemplate'

const ATTENTION_CONFIG: AttentionWidgetConfig = {
  headline: 'Build and preview widget-driven workout pages.',
  subtitle:
    'Phase 2.2 integrates the attention, code-example, and syntax-group widgets into one interactive playground surface.',
  pillars: [
    {
      icon: <Sparkles className="size-4" aria-hidden="true" />,
      label: 'Attention widget',
      description: 'High-signal hero block with actionable CTAs.',
    },
    {
      icon: <PanelTop className="size-4" aria-hidden="true" />,
      label: 'Code example widget',
      description: 'Editable CodeMirror sample with runnable workout output.',
    },
    {
      icon: <LayoutGrid className="size-4" aria-hidden="true" />,
      label: 'Syntax group widget',
      description: 'Grouped syntax cards linked to docs.',
    },
  ],
  actions: [
    { label: 'Jump to workout', action: 'scroll-to-workout', variant: 'primary' },
    { label: 'Open search', action: 'open-search', variant: 'secondary' },
  ],
}

export function PlaygroundLandingPage() {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const workoutSectionRef = useRef<HTMLElement | null>(null)
  const files = useSeedContent()

  // Guide snippets derive from the seeded corpus; placeholders cover the
  // pre-seed window and malformed pages.
  const guideReference = useMemo(() => (files ? buildSyntaxGuideReference(files) : null), [files])

  const classicAmrapLines = useMemo(
    () => (guideReference?.classicAmrap?.workout ?? '20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  15 Air Squats').split('\n'),
    [guideReference],
  )

  const CODE_EXAMPLE_CONFIG: CodeExampleWidgetConfig = useMemo(
    () => ({
      lines: [
        {
          code: classicAmrapLines[0] ?? '20:00 AMRAP',
          annotation: 'Classic AMRAP from the guide — fixed time window with unbounded rounds.',
        },
        { code: classicAmrapLines[1] ?? '  5 Pullups', annotation: 'Start each round with five pullups.' },
        { code: classicAmrapLines[2] ?? '  10 Pushups', annotation: 'Then move into ten pushups.' },
        {
          code: classicAmrapLines[3] ?? '  15 Air Squats',
          annotation: 'Finish the round with fifteen air squats before looping.',
        },
      ],
      cta: 'Run this example',
    }),
    [classicAmrapLines],
  )

  const SYNTAX_GROUP_CONFIGS: SyntaxGroupWidgetConfig[] = useMemo(() => {
    const simpleRounds = guideReference?.simpleRounds
    const timersAndRest = guideReference?.timersAndRest
    const repSchemes = guideReference?.repSchemes
    return [
      {
        category: 'Structure',
        icon: '🔁',
        title: simpleRounds?.title ?? 'Simple Rounds',
        description: simpleRounds?.subtitle ?? 'Rounds repeated for time or reps.',
        example: simpleRounds?.workout ?? '3 rounds\n  10 Air Squats',
        docsPath: simpleRounds?.docsPath ?? '/guide/structure?h=rounds',
      },
      {
        category: 'Timing',
        icon: '⏱️',
        title: timersAndRest?.title ?? 'Timers And Rest',
        description: timersAndRest?.subtitle ?? 'Timed windows with rest periods.',
        example: timersAndRest?.workout ?? '10:00\n  5 Burpees\n  rest 1:00',
        docsPath: timersAndRest?.docsPath ?? '/guide/protocols?h=required-rest',
      },
      {
        category: 'Structure',
        icon: '🏋️',
        title: 'Rep Schemes',
        description: repSchemes?.subtitle ?? 'Rep counts per movement.',
        example: repSchemes?.workout ?? '21-15-9\n  Thrusters',
        docsPath: repSchemes?.docsPath ?? '/guide/structure?h=rep-schemes',
      },
    ]
  }, [guideReference])

  const isDarkMode = useMemo(() => {
    if (theme === 'dark') return true
    if (theme === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }, [theme])


  // Same global Search Palette as Cmd+/ in App (WQL mode, issue #834).
  const canvasRouteList = useCanvasRoutes()
  const openSearch = useCallback(async () => {
    const result = await usePaletteStore.getState().open({
      wql: {
        initialQuery: searchPaletteQuery(),
        execute: paletteExecute,
        preferredChoices: palettePreferredChoices(),
      },
      sources: [
        wqlSearchSource(),
        withWqlText(canvasRouteSource(canvasRouteList)),
      ],
    })

    if (result.dismissed) return
    navigatePaletteResult(result.item, navigate)
  }, [navigate, canvasRouteList])

  const handleAttentionAction = useCallback(
    (action: AttentionActionType) => {
      if (action === 'scroll-to-workout') {
        workoutSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }

      if (action === 'open-search') {
        void openSearch()
      }
    },
    [openSearch],
  )

  const handleRunExample = useCallback(
    async (script: string) => {
      const template = [
        '# Playground Widget Example',
        '',
        '```time',
        script,
        '```',
        '',
        '[▶ Run Workout]{.button action=start-workout}',
        '',
      ].join('\n')

      const id = await createPlaygroundPage(template)
      navigate(playgroundPath(id))
    },
    [navigate],
  )

  const handleOpenDocs = useCallback(
    (docsPath: string) => {
      if (/^https?:\/\//i.test(docsPath)) {
        window.open(docsPath, '_blank', 'noopener,noreferrer')
        return
      }
      navigate(docsPath)
    },
    [navigate],
  )

  return (
    <LandingTemplate
      actionsSlot={
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/70">
          <Sun className="size-4 text-zinc-500" aria-hidden="true" />
          <Switch
            checked={isDarkMode}
            onChange={(checked) => setTheme(checked ? 'dark' : 'light')}
            aria-label="Toggle dark mode"
          />
          <Moon className="size-4 text-zinc-500" aria-hidden="true" />
        </div>
      }
      heroSlot={<AttentionWidget config={ATTENTION_CONFIG} onAction={handleAttentionAction} />}
    >
      <section ref={workoutSectionRef} id="workout-widget-surface" className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <CodeExampleWidget
            config={CODE_EXAMPLE_CONFIG}
            isDarkMode={isDarkMode}
            onRun={handleRunExample}
          />
        </div>
        <div className="space-y-4">
          {SYNTAX_GROUP_CONFIGS.map((config) => (
            <SyntaxGroupWidget key={config.title} config={config} onOpenDocs={handleOpenDocs} />
          ))}
        </div>
      </section>

      <OfferingTiers />
    </LandingTemplate>
  )
}
