/**
 * entryGrouping — group stream entries by date or by dynamic WQL grouping dimensions
 * (day, week, month, year, discipline, origin, kind, tag).
 *
 * Shared by QueriableStreamView and Explorer views to produce structured, navigable
 * stream sections with matching DOM IDs and TOC section links.
 */
import type { Entry } from './entryMapper'
import { todayKey, formatDateHeader } from './dateFormat'
import { parseQuery, type AnyParsedQuery } from '@bitcobblers/wod-wiki-engine'
import { CONTENT_GROUPING_DIMENSIONS } from '@bitcobblers/wod-wiki-ui'

export const UNDATED_KEY = '(undated)'

export interface StreamGroup {
  /** DOM id and scroll target, e.g. "date-group-2026-09-04" or "group-discipline-strength" */
  id: string
  /** Raw grouping key */
  key: string
  /** Localized human-readable label */
  label: string
  /** Whether this group represents today's date (for badge highlighting) */
  isToday?: boolean
  /** Entries in this group */
  entries: Entry[]
}

/** Legacy signature kept for existing callers and tests */
export function groupEntriesByDate(entries: Entry[]): [string, Entry[]][] {
  const map = new Map<string, Entry[]>()
  for (const e of entries) {
    const k = e.date ?? UNDATED_KEY
    const arr = map.get(k)
    if (arr) arr.push(e)
    else map.set(k, [e])
  }
  return Array.from(map.entries())
}

/** Parse the ordered grouping dimensions from a WQL query string or a
 *  already-parsed AST (`by {a, b}` is ordered). Null when the query is
 *  invalid or carries no grouping — the view-settings fallback applies. */
export function parseGroupingDimensions(query: string, parsed?: AnyParsedQuery): string[] | null {
  const ast = parsed ?? parseQuery(query)
  if (ast.error) return null
  return ast.groupBy?.length ? ast.groupBy.map(d => String(d).toLowerCase()) : null
}

function safeSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'default'
}

/**
 * Group stream entries by one or more ordered dimensions. Multi-dimension
 * queries (`by {discipline, week}`) produce composite groups: the second and
 * further dimensions sub-divide each parent group ("Strength / Week of …").
 * The undated shelf is never sub-grouped.
 */
export function groupEntriesByDimension(
  entries: Entry[],
  dimension: string | readonly string[] = 'date',
  options?: { shelfVisible?: boolean },
): StreamGroup[] {
  const dims = (Array.isArray(dimension) ? dimension : [dimension])
    .map(d => String(d).toLowerCase())
    .filter(Boolean)
  if (dims.length === 0) dims.push('date')

  const build = (es: Entry[], rest: string[]): StreamGroup[] => {
    const groups = groupByDimension(es, rest[0]!, options)
    if (rest.length === 1) return groups
    return groups.flatMap(group =>
      group.key === 'shelf'
        ? [group]
        : build(group.entries, rest.slice(1)).map(sub => ({
            ...sub,
            key: `${group.key}/${sub.key}`,
            id: `${group.id}--${sub.id}`,
            label: `${group.label} / ${sub.label}`,
            isToday: group.isToday || sub.isToday,
          })),
    )
  }
  return build(entries, dims)
}

/**
 * Group entries by one dimension. The CONTENT_GROUPING_DIMENSIONS vocabulary
 * keeps its special buckets below; any other dimension names a note property
 * (a configured tag type) and resolves from the entry's typed tags —
 * entries without that property land in an Unassigned group, matching the
 * aggregate plane's open-dimension policy.
 */
function groupByDimension(
  entries: Entry[],
  dimension: string,
  options?: { shelfVisible?: boolean },
): StreamGroup[] {
  const dim = dimension.toLowerCase()
  const today = todayKey()
  const locale = 'en'

  if (dim === 'date' || dim === 'day') {
    const map = new Map<string, Entry[]>()
    const undatedShelf: Entry[] = []
    const undatedPlain: Entry[] = []

    for (const e of entries) {
      // Playground notes carry no journal date — createdAt IS their stream
      // date, so `by {date}` groups stay meaningful. ponytail: playground-only
      // fallback; widen to other sources when one needs dated undated grouping.
      const key = e.date ?? (e.sourceCatalog === 'playground' && e.createdAt && e.createdAt > 946684800000 ? new Date(e.createdAt).toISOString().slice(0, 10) : null)
      if (options?.shelfVisible && (e.kind === 'session' || key == null)) {
        undatedShelf.push(e)
      } else if (key) {
        const arr = map.get(key)
        if (arr) arr.push(e)
        else map.set(key, [e])
      } else {
        undatedPlain.push(e)
      }
    }

    const sortedDates = Array.from(map.keys()).sort((a, b) => b.localeCompare(a))
    const groups: StreamGroup[] = []

    if (options?.shelfVisible && undatedShelf.length > 0) {
      groups.push({
        id: 'group-shelf',
        key: 'shelf',
        label: 'Catalog Sessions',
        entries: undatedShelf,
      })
    }

    for (const dateKey of sortedDates) {
      groups.push({
        id: `date-group-${dateKey}`,
        key: dateKey,
        label: dateKey === today ? 'Today' : formatDateHeader(dateKey),
        isToday: dateKey === today,
        entries: map.get(dateKey) ?? [],
      })
    }

    if (undatedPlain.length > 0) {
      groups.push({
        id: 'group-date-undated',
        key: 'undated',
        label: 'Undated',
        entries: undatedPlain,
      })
    }

    return groups
  }

  if (dim === 'week') {
    const map = new Map<string, { label: string; entries: Entry[] }>()
    const undated: Entry[] = []

    for (const e of entries) {
      if (!e.date) {
        undated.push(e)
        continue
      }
      const [y, m, d] = e.date.split('-').map(Number)
      const dt = new Date(Date.UTC(y!, m! - 1, d!))
      const day = dt.getUTCDay()
      const diff = dt.getUTCDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(Date.UTC(y!, m! - 1, diff))
      const mondayKey = monday.toISOString().slice(0, 10)
      const label = `Week of ${monday.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })}`

      const group = map.get(mondayKey)
      if (group) group.entries.push(e)
      else map.set(mondayKey, { label, entries: [e] })
    }

    const sortedWeeks = Array.from(map.keys()).sort((a, b) => b.localeCompare(a))
    const groups: StreamGroup[] = sortedWeeks.map(key => ({
      id: `group-week-${key}`,
      key,
      label: map.get(key)!.label,
      entries: map.get(key)!.entries,
    }))

    if (undated.length > 0) {
      groups.push({
        id: 'group-week-undated',
        key: 'undated',
        label: 'Undated',
        entries: undated,
      })
    }
    return groups
  }

  if (dim === 'month') {
    const map = new Map<string, { label: string; entries: Entry[] }>()
    const undated: Entry[] = []

    for (const e of entries) {
      if (!e.date) {
        undated.push(e)
        continue
      }
      const ym = e.date.slice(0, 7)
      const [y, m] = ym.split('-').map(Number)
      const label = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })

      const group = map.get(ym)
      if (group) group.entries.push(e)
      else map.set(ym, { label, entries: [e] })
    }

    const sortedMonths = Array.from(map.keys()).sort((a, b) => b.localeCompare(a))
    const groups: StreamGroup[] = sortedMonths.map(key => ({
      id: `group-month-${key}`,
      key,
      label: map.get(key)!.label,
      entries: map.get(key)!.entries,
    }))

    if (undated.length > 0) {
      groups.push({
        id: 'group-month-undated',
        key: 'undated',
        label: 'Undated',
        entries: undated,
      })
    }
    return groups
  }

  if (dim === 'year') {
    const map = new Map<string, Entry[]>()
    const undated: Entry[] = []

    for (const e of entries) {
      if (!e.date) {
        undated.push(e)
        continue
      }
      const y = e.date.slice(0, 4)
      const arr = map.get(y)
      if (arr) arr.push(e)
      else map.set(y, [e])
    }

    const sortedYears = Array.from(map.keys()).sort((a, b) => b.localeCompare(a))
    const groups: StreamGroup[] = sortedYears.map(key => ({
      id: `group-year-${key}`,
      key,
      label: key,
      entries: map.get(key) ?? [],
    }))

    if (undated.length > 0) {
      groups.push({
        id: 'group-year-undated',
        key: 'undated',
        label: 'Undated',
        entries: undated,
      })
    }
    return groups
  }

  if (dim === 'discipline') {
    const map = new Map<string, Entry[]>()

    for (const e of entries) {
      const disc =
        e.effort?.discipline ||
        e.tags?.find(t =>
          ['strength', 'gymnastics', 'cardio', 'running', 'rowing', 'weightlifting', 'olympic-weightlifting'].includes(
            t.toLowerCase(),
          ),
        ) ||
        'General'
      const norm = disc.charAt(0).toUpperCase() + disc.slice(1).toLowerCase()
      const arr = map.get(norm)
      if (arr) arr.push(e)
      else map.set(norm, [e])
    }

    const priority = ['Strength', 'Gymnastics', 'Cardio', 'Running', 'Rowing', 'Weightlifting']
    const sorted = Array.from(map.keys()).sort((a, b) => {
      const ia = priority.indexOf(a)
      const ib = priority.indexOf(b)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return a.localeCompare(b)
    })

    return sorted.map(key => ({
      id: `group-discipline-${safeSlug(key)}`,
      key,
      label: key,
      entries: map.get(key) ?? [],
    }))
  }

  if (dim === 'origin') {
    const map = new Map<string, Entry[]>()
    for (const e of entries) {
      const origin = e.effort?.registrySource === 'bundled' ? 'Bundled Standards' : 'Custom Movements'
      const arr = map.get(origin)
      if (arr) arr.push(e)
      else map.set(origin, [e])
    }
    return Array.from(map.entries()).map(([key, groupEntries]) => ({
      id: `group-origin-${safeSlug(key)}`,
      key,
      label: key,
      entries: groupEntries,
    }))
  }

  if (dim === 'source') {
    const map = new Map<string, Entry[]>()
    for (const e of entries) {
      const source = e.sourceCatalog || 'Other'
      const label = source.charAt(0).toUpperCase() + source.slice(1)
      const arr = map.get(label)
      if (arr) arr.push(e)
      else map.set(label, [e])
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, groupEntries]) => ({
        id: `group-source-${safeSlug(key)}`,
        key,
        label: key,
        entries: groupEntries,
      }))
  }

  if (dim === 'kind' || dim === 'type') {
    const map = new Map<string, Entry[]>()
    for (const e of entries) {
      const kind = e.kind.charAt(0).toUpperCase() + e.kind.slice(1) + 's'
      const arr = map.get(kind)
      if (arr) arr.push(e)
      else map.set(kind, [e])
    }
    return Array.from(map.entries()).map(([key, groupEntries]) => ({
      id: `group-kind-${safeSlug(key)}`,
      key,
      label: key,
      entries: groupEntries,
    }))
  }

  // Property dimension — any configured tag type (domain, equipment, custom
  // types from tag settings). First matching value wins, same as the tag
  // bucket; entries without the property group under Unassigned.
  if (!(CONTENT_GROUPING_DIMENSIONS as readonly string[]).includes(dim)) {
    const map = new Map<string, Entry[]>()
    for (const e of entries) {
      const value = e.typedTags?.find((t) => t.type?.toLowerCase() === dim)?.label ?? 'Unassigned'
      const arr = map.get(value)
      if (arr) arr.push(e)
      else map.set(value, [e])
    }
    return Array.from(map.entries()).map(([key, groupEntries]) => ({
      id: `group-property-${safeSlug(dim)}-${safeSlug(key)}`,
      key,
      label: key,
      entries: groupEntries,
    }))
  }

  // Fallback: group by tag
  const map = new Map<string, Entry[]>()
  for (const e of entries) {
    const tag = e.tags?.[0] ? `#${e.tags[0]}` : 'Untagged'
    const arr = map.get(tag)
    if (arr) arr.push(e)
    else map.set(tag, [e])
  }
  return Array.from(map.entries()).map(([key, groupEntries]) => ({
    id: `group-tag-${safeSlug(key)}`,
    key,
    label: key,
    entries: groupEntries,
  }))
}
