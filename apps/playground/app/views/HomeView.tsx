/**
 * HomeView — the homepage: a scroll-driven product walkthrough.
 *
 * The redesigned home page renders the heading hero, the "Why Wod Wiki?"
 * video placeholder, the live editor preview, the session-analytics
 * sections, the Library & Community Feeds strip, and the data-ownership
 * sections. See playground/src/tour/HomeTour.tsx for the section-level
 * implementation.
 *
 * The bundle-owned home slice supplies the quests and arrival document before
 * the seed corpus is available. Quest identity stays compatible with the old
 * markdown-driven home (markdown/canvas/home/README.md).
 */
import { useEffect, useMemo } from 'react'
import { markBootMilestone } from '@/services/bootDiagnostics'
import { HOME_PAGE, withHomeDocs } from '../canvas/homeSlice'
import { HomeTour } from '../tour/HomeTour'
import type { WorkoutItem } from '../App'

export interface HomeViewProps {
  wodFiles: Record<string, string>
  theme: string
  workoutItems?: WorkoutItem[]
  onSelect?: (item: WorkoutItem) => void
}

export function HomeView({ wodFiles, theme }: HomeViewProps) {
  const homeWodFiles = useMemo(() => withHomeDocs(wodFiles), [wodFiles])
  useEffect(() => {
    markBootMilestone('homeFirstPaint')
  }, [])

  return (
    <HomeTour
      wodFiles={homeWodFiles}
      theme={theme}
      quests={HOME_PAGE.quests}
    />
  )
}
