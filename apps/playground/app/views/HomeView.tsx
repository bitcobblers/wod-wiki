/**
 * HomeView — the homepage: a scroll-driven product walkthrough.
 *
 * The redesigned home page renders the heading hero, the "Why Wod Wiki?"
 * video placeholder, the live editor preview, the session-analytics
 * sections, the Library & Community Feeds strip, and the data-ownership
 * sections. See playground/src/tour/HomeTour.tsx for the section-level
 * implementation.
 *
 * Preserved from the markdown-driven home (markdown/canvas/home/README.md):
 *  - quick-start quests (qs-arrive / qs-edit / qs-run) plus scroll quests
 *    (qs-tour-*) fired as each tour stage scrolls into view
 *  - ChallengeHeaderBadge on '/' (mounted by App.tsx) — home quests only
 */

import { useFindCanvasPage } from '../canvas/canvasRoutes'
import { HomeTour } from '../tour/HomeTour'
import type { WorkoutItem } from '../App'

export interface HomeViewProps {
  wodFiles: Record<string, string>
  theme: string
  workoutItems?: WorkoutItem[]
  onSelect?: (item: WorkoutItem) => void
}

export function HomeView({ wodFiles, theme }: HomeViewProps) {
  const page = useFindCanvasPage('/')

  if (!page) {
    return (
      <div className="flex items-center justify-center p-20 text-muted-foreground">
        Home canvas content not found (markdown/canvas/routes/home.md)
      </div>
    )
  }

  return (
    <HomeTour
      wodFiles={wodFiles}
      theme={theme}
      quests={page.quests ?? []}
    />
  )
}
