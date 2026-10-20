/**
 * TourChapterPicker.tsx — Learning with Examples / Learn the Language.
 *
 * Normal motion: the SAME sticky-parallax runway as the first-four tagged
 * sections — TaglineHeader '05' plus a TourSectionRunway whose six chapter
 * stages span a 600vh track. Crossing a stage boundary (either scroll
 * direction) selects that chapter and types its runnable example into the
 * sticky editor; an edit inside a chapter is never overwritten (the load
 * effect only reruns when the chapter itself changes). The caption rail
 * carries the chapter's summary, bullet breakdown, quest progress and
 * guide link in the standard first-four caption formatting; Run stays on
 * the editor (fullscreen chapter run) — scrolling alone never fakes one.
 *
 * Reduced motion: one editor beside stacked chapter cards with explicit
 * Load example and Read guide actions, no scroll-driven source changes.
 * Same component, same quests.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpenCheck, Play } from 'lucide-react'
import type { Chapter, Quest, ScrollStage } from '../canvas/parseCanvasMarkdown'
import type { ScriptBlock } from '@/components/Editor/types'
import { resolveSource } from '../canvas/canvasUtils'
import { useChapterProgress, type ChapterProgress } from '../hooks/useChapterProgress'
import { usePageQuests } from '../hooks/usePageQuests'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { telemetry, HOME_EVENTS } from '@/services/telemetry'
import { chapterIcon } from '../components/ChallengeBadges'
import { MacOSChrome } from '../components/atoms/MacOSChrome'
import { TourEditorScreen } from './screens/TourEditorScreen'
import { TourSectionRunway } from './TourSectionRunway'
import { CHAPTER_GUIDE_ROUTES, CHAPTER_GUIDE_DEFAULT_ROUTE } from './tourConstants'
import { TaglineHeader } from './TaglineHeader'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import type { HomeEventName } from '@/services/telemetry'

/** Moved from the retired TourCaptions stage captions — the chapter picker
 *  renders captions in the same shape. */
export interface TourCaptionAction {
  label: string
  href: string
  event: HomeEventName
  /** Telemetry payload (e.g. { chapter } attribution). */
  data?: Record<string, unknown>
  /** Stable test hook (e.g. chapter-picker-guide-<chapterId>). */
  testId?: string
}

export interface TourCaption {
  /** Stage id for walkthrough captions; chapter captions use chapter ids. */
  id: string
  num: string
  title: ReactNode
  body: string
  /** Readable explanatory list under the body (chapter captions). */
  bullets?: string[]
  foot: string
  accent: string
  actions?: TourCaptionAction[]
  /** Optional node under the foot line (e.g. chapter quest progress). */
  extra?: ReactNode
}

/** Chapter id → its home-page example asset (the canonical syntax examples). */
const CHAPTER_EXAMPLE_SOURCES: Record<string, string> = {
  basics: 'wods/examples/syntax/single-movement.md',
  protocols: 'wods/examples/syntax/timers-rest.md',
  structure: 'wods/examples/syntax/groups-1.md',
  'custom-metrics': 'wods/syntax/custom-metrics-1.md',
  dialects: 'wods/examples/syntax/dialect-climb-bouldering.md',
  complex: 'wods/examples/syntax/complex-swimming.md',
}

const CHAPTER_DESCRIPTIONS: Record<string, { summary: string; bullets: string[] }> = {
  basics: {
    summary: 'Statements and metrics — how a workout line reads, from movement names to reps, loads, and timed rests.',
    bullets: ['Freeform Markdown + fenced ```time blocks', 'Single movements: 10 Pushups, 15 Air Squats', 'Inline resistance: 225lb, 100kg, 24kg'],
  },
  protocols: {
    summary: 'Time-capped and paced protocols: AMRAP, EMOM, Tabata intervals, and required rest that paces the room.',
    bullets: ['20:00 AMRAP (As Many Rounds As Possible)', '(10) :60 EMOM (Every Minute on the Minute)', '*:30 Rest (required, unskippable recovery)'],
  },
  structure: {
    summary: 'Rounds, rep ladders, and nested grouping — how blocks compose into multi-part workout schemes.',
    bullets: ['(3 Rounds) and (5 Sets) block repetition', 'Ladders & schemes: 21-15-9, 10-8-6-4-2', 'Section labels: (Warmup) and // Strength'],
  },
  'custom-metrics': {
    summary: 'Capture typed data points right inline: effort intensity, heart rate, RPE, and custom JSON metrics.',
    bullets: ['Inline JSON metrics: {"intensity": 80}', 'Capture prompts: :? time, ? reps, ?lb load', 'Session-level RPE & custom dimensions'],
  },
  dialects: {
    summary: 'Dialect fences for specialized domains: workout, log, plan, and climbing session notes.',
    bullets: ['```time for workouts, ```log for recorded efforts', 'Sport dialect suffixes like ```log:climbing', 'Discipline tags and session intent'],
  },
  complex: {
    summary: 'Multi-set training sessions that chain intervals, strength, and conditioning into one complete program.',
    bullets: ['Multi-set swimming and track intervals', 'Strength blocks paired with conditioned finishers', 'Full training session flow'],
  },
}

const DEFAULT_CHAPTERS: Chapter[] = [
  { id: 'basics', title: 'Basics', badge: 'trophy', questIds: [], sectionIds: [] },
  { id: 'protocols', title: 'Protocols', badge: 'timer', questIds: [], sectionIds: [] },
  { id: 'structure', title: 'Structure', badge: 'dumbbell', questIds: [], sectionIds: [] },
  { id: 'custom-metrics', title: 'Custom Metrics', badge: 'trophy', questIds: [], sectionIds: [] },
  { id: 'dialects', title: 'Dialects', badge: 'trophy', questIds: [], sectionIds: [] },
  { id: 'complex', title: 'Complex Workouts', badge: 'dumbbell', questIds: [], sectionIds: [] },
]

export interface TourChapterPickerProps {
  chapters?: Chapter[]
  allQuests?: Quest[]
  theme: string
  wodFiles?: Record<string, string>
  onRun?: (chapterId: string, block: ScriptBlock | null, doc: string) => void
}

export function TourChapterPicker({
  chapters = [],
  allQuests = [],
  theme,
  wodFiles = {},
  onRun,
}: TourChapterPickerProps) {
  const languageChapters = useMemo(() => {
    const list = (chapters ?? []).filter((c) => c.id !== 'home-tour')
    return list.length > 0 ? list : DEFAULT_CHAPTERS
  }, [chapters])

  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const { markComplete } = usePageQuests('/', allQuests)
  const { chapters: chapterProgress } = useChapterProgress(languageChapters)

  const [selectedId, setSelectedId] = useState<string>(
    () => languageChapters[0]?.id ?? 'basics',
  )
  const [doc, setDoc] = useState('')
  const blocksRef = useRef<ScriptBlock[]>([])
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  // Typed source ownership: each chapter's canonical example, resolved once.
  const chapterSources = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        languageChapters.map((chapter) => [
          chapter.id,
          resolveSource(CHAPTER_EXAMPLE_SOURCES[chapter.id] ?? '', wodFiles),
        ]),
      ),
    [languageChapters, wodFiles],
  )

  // Stage boundary — in either scroll direction — swaps the chapter's
  // resolved example in instantly and drops stale compiled blocks. Edits
  // inside a chapter are never touched: the effect reruns only when the
  // chapter itself changes.
  useEffect(() => {
    blocksRef.current = []
    setDoc(chapterSources[selectedId] ?? '')
  }, [selectedId, chapterSources])

  const handleBlocksChange = useCallback((blocks: ScriptBlock[]) => {
    blocksRef.current = blocks
  }, [])

  const handleRun = useCallback(() => {
    const chapterId = selectedIdRef.current
    markComplete(`${chapterId}-run`)
    onRun?.(chapterId, blocksRef.current[0] ?? null, doc)
  }, [doc, markComplete, onRun])

  // Chapter stages over an even 600vh partition — the learn section's slice
  // of the shared runway pattern (default primary accent, editor screen).
  const chapterStages = useMemo<ScrollStage[]>(
    () =>
      languageChapters.map((chapter, i): ScrollStage => {
        const count = Math.max(1, languageChapters.length)
        return {
          id: chapter.id,
          range: [i / count, (i + 1) / count],
          screen: 'editor',
          accent: 'hsl(var(--primary))',
          label: chapter.title,
          source: chapterSources[chapter.id],
        }
      }),
    [languageChapters, chapterSources],
  )

  const progressByChapter = useMemo(
    () => Object.fromEntries(chapterProgress.map((p) => [p.chapter.id, p])) as Record<string, ChapterProgress>,
    [chapterProgress],
  )

  // Chapter captions in the standard first-four TourCaptions formatting:
  // numbered heading, summary body, readable bullet explanation, quest
  // progress, and the preserved guide action with chapter attribution.
  const chapterCaptions = useMemo<TourCaption[]>(
    () =>
      languageChapters.map((chapter, i) => {
        const desc = CHAPTER_DESCRIPTIONS[chapter.id]
        const progress = progressByChapter[chapter.id]
        return {
          id: chapter.id,
          num: `05${String.fromCharCode(97 + i)}`,
          title: chapter.title,
          body: desc?.summary ?? chapter.title,
          bullets: desc?.bullets,
          accent: 'hsl(var(--primary))',
          extra: progress && (
            <span
              data-testid={`chapter-picker-progress-${chapter.id}`}
              className={cn(
                'font-mono text-[11px] font-semibold tabular-nums',
                progress.isComplete
                  ? 'font-bold text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground',
              )}
            >
              {progress.isComplete
                ? 'done ✓'
                : `${progress.completedCount}/${progress.totalCount}`}
            </span>
          ),
          actions: [
            {
              label: 'Read guide →',
              href: CHAPTER_GUIDE_ROUTES[chapter.id] ?? CHAPTER_GUIDE_DEFAULT_ROUTE,
              event: HOME_EVENTS.chapterGuideClicked,
              data: { chapter: chapter.id },
              testId: `chapter-picker-guide-${chapter.id}`,
            },
          ],
        }
      }),
    [languageChapters, progressByChapter],
  )

  return (
    <section id="tour-chapter-picker" data-testid="tour-chapter-picker" className="flex flex-col">
      {/* Tagline header for section 05 */}
      <TaglineHeader
        index="05"
        before="Learning with "
        accentText="Examples"
        after=""
        accent="hsl(var(--primary))"
        blurb="Six chapters on the syntax, each with a runnable example and quests to earn. Scroll into each section to load its example code into the editor."
      />
      {reduced ? (
        <ChapterFlat
          chapters={languageChapters}
          selectedId={selectedId}
          onSelect={setSelectedId}
          doc={doc}
          onDocChange={setDoc}
          theme={theme}
          onBlocksChange={handleBlocksChange}
          onRun={handleRun}
          progressByChapter={progressByChapter}
        />
      ) : (
        <TourSectionRunway
          id="learn"
          heightVh="600vh"
          stages={chapterStages}
          captions={chapterCaptions}
          onActiveStageChange={setSelectedId}
          editor={{
            doc,
            theme,
            onDocChange: setDoc,
            onBlocksChange: handleBlocksChange,
            onRun: handleRun,
          }}
        />
      )}
    </section>
  )
}

/** Reduced motion keeps chapter selection explicit and preserves edits while reading. */
function ChapterFlat({
  chapters,
  selectedId,
  onSelect,
  doc,
  onDocChange,
  theme,
  onBlocksChange,
  onRun,
  progressByChapter,
}: {
  chapters: Chapter[]
  selectedId: string
  onSelect: (id: string) => void
  doc: string
  onDocChange: (next: string) => void
  theme: string
  onBlocksChange: (blocks: ScriptBlock[]) => void
  onRun: () => void
  progressByChapter: Record<string, ChapterProgress>
}) {
  // No scroll observer: selection is explicit (Load example buttons), so
  // scrolling or reading a card never resets the selected chapter's doc.
  return (
    <div className="relative mx-auto w-full max-w-[1500px] 2xl:max-w-[1720px] px-6 py-8 lg:px-12 xl:px-16">
      <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12 xl:gap-16">
        {/* Left Column: Sticky macOS Chrome Editor */}
        <div className="w-full lg:w-[58%] xl:w-[60%] lg:sticky lg:top-[110px] z-10 flex-none">
          <div className="h-[420px] sm:h-[480px] lg:h-[calc(100dvh-150px)] max-h-[700px] w-full rounded-2xl border border-border shadow-2xl overflow-hidden bg-background">
            <MacOSChrome
              title={CHAPTER_GUIDE_ROUTES[selectedId]?.split('/').pop() ?? 'example.md'}
              subtitle={`Lesson: ${chapters.find((c) => c.id === selectedId)?.title ?? selectedId}`}
              className="h-full"
            >
              <TourEditorScreen
                doc={doc}
                onDocChange={onDocChange}
                onBlocksChange={onBlocksChange}
                onRun={onRun}
                theme={theme}
                withRingTargets={false}
              />
            </MacOSChrome>
          </div>
        </div>

        {/* Right Column: Stacked Chapters / Lesson Explanations */}
        <div
          className="w-full lg:w-[42%] xl:w-[40%] flex flex-col gap-16 lg:py-6"
          data-testid="chapter-picker-list"
        >
          {chapters.map((chapter, idx) => {
            const progress = progressByChapter[chapter.id]
            const Icon = chapterIcon(chapter.badge)
            const active = chapter.id === selectedId
            const desc = CHAPTER_DESCRIPTIONS[chapter.id]

            return (
              <div
                key={chapter.id}
                data-testid={`chapter-picker-row-${chapter.id}`}
                className={cn(
                  'rounded-2xl border p-6 sm:p-8 transition-all duration-300 min-h-[340px] flex flex-col justify-between',
                  active
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30 shadow-lg dark:bg-primary/10'
                    : 'border-border/70 bg-card hover:border-primary/40',
                )}
              >
                <div>
                  {/* Step badge & icon */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold uppercase tracking-wider text-primary">
                        Chapter 0{idx + 1}
                      </span>
                      {Icon && <Icon className="size-4 text-primary" />}
                    </div>
                    <span
                      className={cn(
                        'font-mono text-xs font-semibold tabular-nums',
                        progress?.isComplete ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-muted-foreground',
                      )}
                    >
                      {progress?.isComplete
                        ? 'done ✓'
                        : `${progress?.completedCount ?? 0}/${progress?.totalCount ?? chapter.questIds.length}`}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                    {chapter.title}
                  </h3>

                  {/* Body explanation */}
                  <p className="mt-3 text-sm sm:text-base leading-relaxed text-muted-foreground">
                    {desc?.summary ?? chapter.title}
                  </p>

                  {/* Bullet breakdown */}
                  {desc?.bullets && (
                    <ul className="mt-4 space-y-1.5 text-xs sm:text-sm text-foreground/80 font-mono">
                      {desc.bullets.map((b, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-primary font-bold">›</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Action controls */}
                <div className="mt-6 flex flex-wrap items-center gap-3 pt-4 border-t border-border/50">
                  <button
                    type="button"
                    onClick={() => onSelect(chapter.id)}
                    data-testid={`chapter-picker-select-${chapter.id}`}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold transition-colors shadow-xs',
                      active
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'border border-border bg-background text-foreground hover:bg-muted',
                    )}
                  >
                    <Play className="size-3.5 fill-current" />
                    <span>{active ? 'Loaded in editor' : 'Load example'}</span>
                  </button>

                  <Link
                    to={CHAPTER_GUIDE_ROUTES[chapter.id] ?? CHAPTER_GUIDE_DEFAULT_ROUTE}
                    data-testid={`chapter-picker-guide-${chapter.id}`}
                    aria-label={`Read guide for ${chapter.title}`}
                    onClick={() => telemetry.record(HOME_EVENTS.chapterGuideClicked, { chapter: chapter.id })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/80 px-3.5 py-2 text-xs sm:text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-background hover:text-primary"
                  >
                    <BookOpenCheck className="size-3.5" />
                    <span>Read guide →</span>
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
