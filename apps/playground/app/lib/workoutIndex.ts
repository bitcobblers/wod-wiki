/**
 * workoutIndex — front-matter-shaped index over the seeded corpus
 * (docs/prototypes/seed-data-unification.md § Module 3).
 *
 * Owns the pure shaping pass from the seeded-content file map to the typed
 * `WorkoutItem` list leaf components consume, plus the React bindings. The
 * file map is the seed-content snapshot (`markdown/…` keys → raw markdown);
 * the old build-time glob is gone — content loads from IndexedDB.
 */
import { useMemo } from 'react'
import { getScalar, parseFrontmatter } from '@/lib/frontmatter'
import { fileToDisplayName } from '@/repositories/groupings'
import { useSeedContent, type SeedContentFiles } from '@/services/content/seedContent'

export interface WorkoutItem {
  id: string
  /** Routing identity — the raw filename stem; never humanize this. */
  name: string
  /** Human-readable list title; falls back to the humanized filename. Frontmatter `title:` wins. */
  displayName?: string
  category: string
  content: string
  /** Frontmatter `date` (YYYY-MM-DD) as epoch ms (noon UTC); undefined when absent. */
  date?: number
  /** When true, this item is excluded from all search results (front matter: `search: hidden`) */
  searchHidden?: boolean
}

/** Path format: `markdown/{collections|canvas}/{category}/{file}.md` or `markdown/{collections|canvas}/{file}.md` */
function deriveCategory(parts: string[]): string {
  const markdownIdx = parts.indexOf('markdown')
  if (markdownIdx !== -1 && parts.length > markdownIdx + 2) {
    return parts[markdownIdx + 2]!
  }
  return 'General'
}

function deriveSearchHidden(raw: string): boolean {
  return String(getScalar(parseFrontmatter(raw).meta, 'search') ?? '').toLowerCase() === 'hidden'
}

/** `YYYY-MM-DD` frontmatter → epoch ms at noon UTC (matches FeedImporter's Note.date).
 *  Impossible calendar days (e.g. 2026-02-30) yield undefined, never NaN. */
export function deriveDate(raw: string): number | undefined {
  const value = getScalar(parseFrontmatter(raw).meta, 'date')
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() : undefined
}

/**
 * Pure front-matter shaping pass. Given the seeded-content entries, returns
 * the typed list leaf components consume.
 */
export function buildWorkoutItems(
  files: Record<string, string | unknown>,
): WorkoutItem[] {
  return Object.entries(files).map(([path, fileContent]) => {
    const parts = path.split('/')
    const fileName = parts[parts.length - 1]!.replace('.md', '')
    const raw = fileContent as string
    const titleOverride = getScalar(parseFrontmatter(raw).meta, 'title')
    return {
      id: path,
      name: fileName,
      displayName: typeof titleOverride === 'string' && titleOverride.trim()
        ? titleOverride.trim()
        : fileToDisplayName(fileName),
      category: deriveCategory(parts),
      content: raw,
      date: deriveDate(raw),
      searchHidden: deriveSearchHidden(raw),
    }
  })
}

/**
 * Memoised index of all seeded workout markdown files. Used by `AppContent`
 * and `PlaygroundLandingPage.tsx`; leaf components still receive the result
 * as a prop (see `MarkdownCanvasPage`).
 */
export function useWorkoutItems(): WorkoutItem[] {
  const files = useSeedContent()
  return useMemo(() => (files ? buildWorkoutItems(files) : []), [files])
}

/** Empty file map — the pre-seed snapshot for `wodFiles` consumers. */
export const EMPTY_WOD_FILES: SeedContentFiles = {}
