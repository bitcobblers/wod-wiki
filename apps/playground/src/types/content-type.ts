/**
 * content-type.ts
 *
 * Canonical PageMode type and derivePageMode() function.
 *
 * All page components, action bars, and WOD block command hooks derive their
 * behaviour from this single discriminant rather than from category-name sets
 * or route-based conditionals.
 *
 * See docs/design/content-types-architecture.md §5.1 for the original spec.
 */

export type ContentSource = 'playground' | 'journal' | 'notebook'

export type PageMode =
  | 'playground'
  | 'notebook-readonly'
  | 'journal-history'
  | 'journal-active'
  | 'journal-plan'
  | 'effort'

/**
 * Derive the page mode from the content source and, for journal entries, the
 * target date.
 *
 * @param source    - Where the content originates.
 * @param targetDate - ISO date string (YYYY-MM-DD) or Date object. Only used
 *                    when source === 'journal'. Omit or pass undefined for
 *                    today (returns 'journal-active').
 */
export function derivePageMode(
  source: ContentSource,
  targetDate?: Date | string,
): PageMode {
  if (source === 'playground') return 'playground'
  if (source === 'notebook') return 'notebook-readonly'

  // Journal — compare target date to today (midnight-normalised)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (!targetDate) return 'journal-active'

  const t =
    typeof targetDate === 'string'
      ? new Date(`${targetDate}T00:00:00`)
      : new Date(targetDate)
  t.setHours(0, 0, 0, 0)

  if (t < today) return 'journal-history'
  if (t > today) return 'journal-plan'
  return 'journal-active'
}
