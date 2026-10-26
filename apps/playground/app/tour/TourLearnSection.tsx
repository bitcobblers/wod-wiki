/**
 * TourLearnSection.tsx / LearnProgressOverview — compact chapter-progress
 * overview that follows the six syntax chapter heroes on the home page.
 *
 * Deliberately NOT a per-quest list: each chapter hero already renders its own
 * quest cards, so this section shows only high-level per-chapter completion
 * (badge + count + progress bar) with a link into each guide. Keeps the page
 * from listing every quest twice.
 */

import { Link } from 'react-router-dom'
import { telemetry, HOME_EVENTS } from '@/services/telemetry'
import type { Chapter, Quest } from '../canvas/parseCanvasMarkdown'
import { useChapterProgress } from '../hooks/useChapterProgress'
import { chapterIcon } from '../components/ChallengeBadges'
import { CHAPTER_GUIDE_ROUTES, CHAPTER_GUIDE_DEFAULT_ROUTE } from './tourConstants'
import { cn } from '@/lib/utils'

export interface TourLearnSectionProps {
  quests: Quest[]
  chapters: Chapter[]
  questLabels?: Record<string, string>
  onHomeQuestClick?: (questId: string) => void
}

export function LearnProgressOverview({
  chapters,
}: TourLearnSectionProps) {
  const handleLesson = () => telemetry.record(HOME_EVENTS.lessonStarted)
  const handleCheatsheet = () => telemetry.record(HOME_EVENTS.cheatsheetOpened)
  const { chapters: progress } = useChapterProgress(chapters)

  // Only the language chapters (home-tour is honored by the celebration bridge).
  const languageChapters = progress.filter((c) => c.chapter.id !== 'home-tour')

  return (
    <section
      data-testid="tour-learn"
      className="mx-auto max-w-5xl px-6 py-16 border-b border-border/60"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Learn the Language</h2>
          <p className="mt-2 text-muted-foreground leading-relaxed max-w-xl">
            Six chapters, each with a runnable example and quests to earn — progress shows on the chapter cards above.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/page/guide-start"
            onClick={handleLesson}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Start Lesson 1
          </Link>
          <Link
            to="/page/guide-start?h=reference"
            onClick={handleCheatsheet}
            className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
          >
            Cheat sheet →
          </Link>
        </div>
      </div>

      {/* Slim progress strip (#dogfood: the previous per-chapter card grid
          duplicated the chapter heroes' quest cards — one challenge surface
          per chapter now lives on the hero card; this is the footer readout). */}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {languageChapters.map(({ chapter, completedCount, totalCount, isComplete }) => {
          const route = CHAPTER_GUIDE_ROUTES[chapter.id] ?? CHAPTER_GUIDE_DEFAULT_ROUTE
          const Icon = chapterIcon(chapter.badge)
          return (
            <Link
              key={chapter.id}
              to={route}
              data-testid={`learn-progress-chip-${chapter.id}`}
              className={cn(
                'group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors hover:border-primary/40',
                isComplete ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-card',
              )}
            >
              {Icon && <Icon className="size-3.5 text-muted-foreground" />}
              <span className="text-[12px] font-semibold text-foreground">{chapter.title}</span>
              <span
                className={cn(
                  'font-mono text-[10px] font-bold tabular-nums',
                  isComplete ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                )}
              >
                {isComplete ? 'done ✓' : `${completedCount}/${totalCount}`}
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

/** Back-compat alias; the old full quest list is retired (issues #926/#927). */
export const TourLearnSection = LearnProgressOverview
