/**
 * groupByOptions — the grouping-dimension vocabulary every surface shares,
 * the rules that turn a surface's stored Group-By favorites into the
 * checklist the page offers, and the sort order each dimension's groups
 * come out in.
 *
 * One vocabulary, four consumers:
 *   - the stream view's Group-by checklist (`availableGroupDims`),
 *   - the fallback arrangement dimension a bare landing groups by,
 *   - the per-page query settings dialog (the picker it edits),
 *   - the stored-favorites validation in `routeWqlConfig`.
 *
 * The dimension ids are the WQL `by {…}` names the engine accepts
 * (`wqlGroupingDimensions` → CONTENT_GROUPING_DIMENSIONS), so a favorite
 * stored here is a query-grouping dimension — never a filter key.
 *
 * A stored favorites list is a PRIORITY list, never a filter: it decides the
 * ORDER the dimensions are offered in and which dimension a bare landing
 * falls back to, but it never removes a dimension the target supports. An
 * absent list means "no preferences" (the target's own dimensions, in
 * canonical order); an explicitly stored empty list means the same — there
 * is no first favorite to fall back to, so the surface keeps its level
 * default.
 */

/** The canonical dimension vocabulary, in the order surfaces present it. */
export const GROUP_BY_DIMENSIONS: readonly { id: string; label: string }[] = [
  { id: 'date', label: 'Date' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'tag', label: 'Tags' },
  { id: 'type', label: 'Type' },
  { id: 'discipline', label: 'Discipline' },
  { id: 'source', label: 'Source' },
  { id: 'origin', label: 'Origin' },
]

/** Dimension ids in canonical order — the validation vocabulary. */
export const GROUP_BY_DIMENSION_IDS: readonly string[] = GROUP_BY_DIMENSIONS.map(d => d.id)

const LABEL_BY_ID: Record<string, string> = Object.fromEntries(
  GROUP_BY_DIMENSIONS.map(d => [d.id, d.label]),
)

/** Human label for a dimension id; unknown ids fall back to the id itself. */
export function groupByDimensionLabel(id: string): string {
  return LABEL_BY_ID[id] ?? id
}

// ── Sort order ───────────────────────────────────────────────────────────────

/**
 * How a dimension's groups are ordered.
 *
 * `chronological-desc` — newest first (the date family).
 * `priority-then-alpha` — a fixed discipline priority, then alphabetical.
 * `alpha` — alphabetical by key.
 * `alpha-sink-last` — alphabetical, but the "nothing here" bucket (Unassigned,
 * Untagged) sinks to the end instead of sorting among real values.
 */
export type GroupSortRule =
  | 'chronological-desc'
  | 'priority-then-alpha'
  | 'alpha'
  | 'alpha-sink-last'

const SORT_RULES: Record<string, GroupSortRule> = {
  date: 'chronological-desc',
  day: 'chronological-desc',
  week: 'chronological-desc',
  month: 'chronological-desc',
  year: 'chronological-desc',
  discipline: 'priority-then-alpha',
  source: 'alpha',
  notebook: 'alpha',
  origin: 'alpha',
  kind: 'alpha',
  type: 'alpha',
  tag: 'alpha-sink-last',
}

/** The sort rule for a dimension; open property dimensions sort alphabetically. */
export function groupSortRule(dimension: string): GroupSortRule {
  return SORT_RULES[dimension.toLowerCase()] ?? 'alpha-sink-last'
}

/**
 * Order a dimension's buckets. `sink` names the bucket that goes last (the
 * empty-value bucket); `priority` is the fixed order a few dimensions use
 * before falling back to alphabetical.
 *
 * Every dimension passes through here, so no grouping can fall back to the
 * executor's row order — the same entries always produce the same groups in
 * the same sequence.
 */
export function sortGroupBuckets<T>(
  buckets: readonly (readonly [string, T])[],
  rule: GroupSortRule,
  options?: { sink?: string; priority?: readonly string[] },
): (readonly [string, T])[] {
  const sink = options?.sink
  const priority = options?.priority ?? []
  const rank = (key: string) => {
    const i = priority.indexOf(key)
    return i === -1 ? Infinity : i
  }
  return [...buckets].sort((a, b) => {
    if (rule === 'chronological-desc') return b[0].localeCompare(a[0])
    if (rule === 'priority-then-alpha') {
      const ra = rank(a[0])
      const rb = rank(b[0])
      if (ra !== rb) return ra - rb
      return a[0].localeCompare(b[0])
    }
    if (sink) {
      if (a[0] === sink) return 1
      if (b[0] === sink) return -1
    }
    return a[0].localeCompare(b[0])
  })
}

// ── Favorites ────────────────────────────────────────────────────────────────

/**
 * Resolve the Group-by checklist for a surface.
 *
 * `supported` is the target's own dimension set (from
 * `wqlGroupingDimensions`) — the ceiling. `favorites` is the stored priority
 * list (undefined = none stored). The result:
 *   - the favorites first, in the user's order, dropping any the target
 *     cannot group by (they stay stored — they are not this target's
 *     business),
 *   - then the remaining supported dimensions in canonical order, so a
 *     favorites list reorders the checklist without hiding capabilities.
 */
export function resolveGroupByOptions(
  supported: readonly string[],
  favorites?: readonly string[],
): { id: string; label: string }[] {
  const supportedSet = new Set(supported)
  if (!favorites || favorites.length === 0) {
    return GROUP_BY_DIMENSIONS.filter(d => supportedSet.has(d.id))
  }
  const favoriteIds = favorites.filter(id => supportedSet.has(id))
  const chosen = new Set(favoriteIds)
  return [
    ...favoriteIds.map(id => ({ id, label: groupByDimensionLabel(id) })),
    ...GROUP_BY_DIMENSIONS.filter(d => supportedSet.has(d.id) && !chosen.has(d.id)),
  ]
}

/**
 * The dimension a bare landing (no `by {…}` in the query, no view-settings
 * group) falls back to: the surface's FIRST stored favorite that the target
 * supports, else the level default.
 */
export function resolveFallbackGroupDimension(
  favorites: readonly string[] | undefined,
  supported: readonly string[],
  levelDefault: string,
): string {
  if (!favorites) return levelDefault
  const supportedSet = new Set(supported)
  const first = favorites.find(id => supportedSet.has(id))
  return first ?? levelDefault
}

/**
 * Normalize a stored favorites list: canonical ids only, de-duplicated,
 * first-occurrence order (the priority) preserved. Ids outside the
 * vocabulary are reported rather than silently dropped.
 */
export function normalizeGroupByFavorites(favorites: readonly string[] | undefined): {
  options: string[]
  invalid: string[]
} {
  if (!favorites) return { options: [], invalid: [] }
  const options: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const id of favorites) {
    if (!GROUP_BY_DIMENSION_IDS.includes(id)) {
      if (!invalid.includes(id)) invalid.push(id)
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    options.push(id)
  }
  return { options, invalid }
}
