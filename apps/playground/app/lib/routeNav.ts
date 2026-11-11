/**
 * routeNav — per-route nav-rail derivation, split out of routeView.ts.
 *
 * Pure: a pathname plus injected data yields the structural nav links a canvas
 * or guide page publishes into L3 ("On this page"). Stream/library routes
 * (such as `/journal`) do not inject static session dates into L3 — their L3
 * slot is reserved for live stream modifiers (`StreamControlsNav` +
 * `FacetProperties`) and stream actions.
 */
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'
import type { Session } from '@/types/storage'
import type { WorkoutItem } from './workoutIndex'
import type { ParsedCanvasPage } from '../canvas/parseCanvasMarkdown'
import type { SelectWorkoutItem } from './routeView'
import { getSectionProse } from '../canvas/parseCanvasMarkdown'

export interface RouteNavDeps {
  workoutItems: WorkoutItem[]
  canvasPage: ParsedCanvasPage | null
  recentResults?: Session[]
  selectWorkout: (item: SelectWorkoutItem) => void
}

export function deriveNav(pathname: string, deps: RouteNavDeps): PageNavLink[] {
  const { canvasPage, workoutItems, selectWorkout } = deps

  // The bundle-owned home tour publishes its own L3 outline. Return before
  // the corpus branch so `/` has the same nav with or without a canvas page.
  if (pathname === '/') return []

  // Canvas pages (guide chapters + notebook landing pages)
  if (canvasPage) {
    const isNotebook = /^\/notebook\//.test(pathname)
    const notebookSlug = isNotebook ? pathname.split('/').pop() ?? null : null

    const links: PageNavLink[] = []
    const isGuidePage = pathname.startsWith('/page/guide-')
    canvasPage.sections
      .filter(s => s.level > 1)
      .forEach(s => {
        links.push({ id: s.id, label: s.heading, type: 'heading' as const })

        // Extract standard time/log workout blocks from prose. On guide pages these are
        // inline examples under section headings, so listing them as generic
        // 'Workout N' entries duplicates nothing useful; skip them.
        if (!isGuidePage) {
          const lines = getSectionProse(s).split('\n')
          let workoutCount = 0
          lines.forEach((line, i) => {
            const fenceMatch = line.trim().match(/^```(time|log)(:\w+)?\s*$/)
            if (fenceMatch) {
              const tag = fenceMatch[1] as 'time' | 'log'
              workoutCount++
              // Canvas workout blocks have no onRun here — MarkdownCanvasPage manages its own runtime.
              links.push({
                id: `${s.id}-${tag}-${i + 1}`,
                label: `Workout ${workoutCount}`,
                type: tag,
              })
            }
          })
        }
      })

    if (isNotebook && notebookSlug) {
      links.push({ id: 'notebook-workouts', label: 'Explore', type: 'heading' as const })
      const notebookItems = workoutItems.filter(
        item => item.category === notebookSlug && item.name.toLowerCase() !== 'readme',
      )
      notebookItems.forEach(item => {
        links.push({
          id: `workout-${item.id}`,
          label: item.name,
          type: 'time',
          onRun: () => selectWorkout(item),
          runIcon: 'link' as const,
        })
      })
    }
    return links
  }

  return []
}
