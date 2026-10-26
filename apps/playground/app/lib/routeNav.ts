/**
 * routeNav — per-route nav-rail derivation, split out of routeView.ts.
 *
 * Pure: a pathname plus injected data yields the nav links a page publishes
 * (canvas section indexes, guide TOCs, the journal date list). No React, no
 * fetching. `routeView.resolveRouteView` calls into this for `view.nav`.
 */
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'
import type { Session } from '@/types/storage'
import type { WorkoutItem } from './workoutIndex'
import type { ParsedCanvasPage } from '../canvas/parseCanvasMarkdown'
import type { SelectWorkoutItem } from './routeView'
import { getSectionProse } from '../canvas/parseCanvasMarkdown'
import { formatDateMedium } from '@/lib/dateFormat'
import { formatDateKey } from '../services/dateUtils'

export interface RouteNavDeps {
  workoutItems: WorkoutItem[]
  canvasPage: ParsedCanvasPage | null
  recentResults: Session[]
  selectWorkout: (item: SelectWorkoutItem) => void
}

interface JournalItemPayload {
  targetDate?: string | number
  updatedAt?: string | number
}

function readItemDate(item: WorkoutItem): string | number | undefined {
  if (!('payload' in item)) return undefined
  const payload = item.payload
  if (!payload || typeof payload !== 'object') return undefined
  const p = payload as JournalItemPayload
  return p.targetDate ?? p.updatedAt
}

export function deriveNav(pathname: string, deps: RouteNavDeps): PageNavLink[] {
  const { canvasPage, workoutItems, recentResults, selectWorkout } = deps

  // The bundle-owned home tour publishes its own L3 outline. Return before
  // the corpus branch so `/` has the same nav with or without a canvas page.
  if (pathname === '/') return []

  // 1. Canvas pages
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

  // 2. Journal list page — top-10 distinct session dates
  if (pathname === '/journal') {
    const dates = new Set<string>()
    recentResults.forEach(r => {
      // Tolerate rows from partially-migrated dev databases — a bad date must
      // not take down the whole nav derivation.
      const time = new Date(r.createdAt).getTime()
      if (Number.isFinite(time)) dates.add(formatDateKey(new Date(time)))
    })
    workoutItems.forEach(item => {
      const d = readItemDate(item)
      if (d && Number.isFinite(new Date(d).getTime())) dates.add(formatDateKey(new Date(d)))
    })
    return Array.from(dates).sort().reverse().slice(0, 10).map(d => ({
      id: d,
      label: formatDateMedium(new Date(d + 'T00:00:00')),
      type: 'heading' as const,
    }))
  }
  return []
}

