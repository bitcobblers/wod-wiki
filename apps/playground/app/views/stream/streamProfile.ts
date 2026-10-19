/**
 * streamProfile — profile contract and presets for QueriableStreamView (Ticket 003).
 *
 * Encapsulates the routing, default WQL query, entity level, and presentation
 * metadata for each unified stream route (/journal, /feeds, /catalogs,
 * /efforts, /sessions, /results/:sessionId).
 */
import type { EntityLevel } from '../../lib/fieldProjection'
import type { LayoutMode } from '../../lib/viewSettingsStorage'
import { EFFORTS_LEGACY_CONFIG } from '../../hooks/useEffortsComposerState'
import type { ComposerLegacyConfig } from '../../hooks/useComposerQueryState'
import type { WqlFindTarget, WqlSourceValue } from '@bitcobblers/wod-wiki-engine'
import { toDisplayName } from '@/repositories/groupings'

export function cleanRoutePath(route: string): string {
  return route.endsWith('/') && route.length > 1 ? route.slice(0, -1) : route
}

export interface StreamProfile {
  /** Route path matching this stream (e.g. '/journal', '/collections'). */
  route: string
  /** Default canonical WQL query loaded when no query param is present. */
  defaultWql: string
  /** Active entity level for field projection and view settings. */
  level: EntityLevel
  /** Canonical find target (singular WQL_FIND_TARGETS value) this surface
   *  queries — kind is always `find` on stream surfaces. */
  target: WqlFindTarget
  /** Canonical Where-stored scope favorites (WQL_SOURCE_VALUES subset) the
   *  header query bar presets/prioritizes. Favorites reorder choices — they
   *  never define grammar validity: every canonical scope stays reachable
   *  and free text queries are unaffected. Empty = no predefined options —
   *  the route nudges for a pick but never blocks. Replaces the old
   *  plural-noun typeOptions vocabulary (notes/blocks/efforts were targets,
   *  not scopes). */
  scopeOptions: readonly WqlSourceValue[]
  /** When true, renders the undated Sessions shelf alongside the dated stream. */
  shelfVisible?: boolean
  /** Optional message displayed when query yields zero results. */
  emptyMessage?: string
  /** Corpus comes from optional seed libraries — when no manual library has
   *  imported, the view shows a Sync notice (catalogs/feeds dead-end without
   *  one). Efforts/dashboards can opt in later. */
  seedNotice?: boolean
  /** Display name for breadcrumbs/crumbs — `routeView.deriveWorkout` reads
   *  it instead of keeping its own route-name map. */
  title?: string
  /** Specific catalog identifier when scoped to a collection catalog. */
  catalog?: string
  /** Preferred initial layout mode (defaults to level standard if omitted). */
  defaultLayout?: LayoutMode
  /** Legacy parameter and salvage configuration for URL migration. */
  legacy?: StreamProfileLegacyConfig
}

export type StreamProfileLegacyConfig = ComposerLegacyConfig

export function createContentLegacyConfig(defaultSource?: string): StreamProfileLegacyConfig {
  const keys = ['note', 'session', 'post', 'text', 'timePreset', 'rangeStart', 'rangeEnd', 's', 'tags', 'mode'] as const
  return {
    keys,
    toQuery(search: URLSearchParams): string | null {
      const hasAnyLegacy = keys.some(k => search.has(k))
      if (!hasAnyLegacy) return null

      let sourceFilter: string | null = null
      const hasTriState = search.has('note') || search.has('session') || search.has('post')
      if (hasTriState) {
        const visible: string[] = []
        if ((search.get('note') ?? 'include') !== 'hide') visible.push('journal')
        if ((search.get('session') ?? 'include') !== 'hide') visible.push('feeds')
        // `post` mapped to the feeds storage scope — excised from WQL, so it
        // no longer narrows the migrated query.
        if (visible.length === 1) {
          sourceFilter = `source:${visible[0]}`
        }
      } else if (defaultSource) {
        sourceFilter = `source:${defaultSource}`
      }

      const preset = search.get('timePreset') ?? '2w'
      const window = preset === 'all' || preset === 'custom' ? null : `last ${preset}`

      const text = search.get('text')?.trim()
      const tags = search.get('tags')?.trim()
      const textClause = text ? (/\s/.test(text) ? `text:"${text}"` : `text:${text}`) : null
      const tagsClause = tags ? `tags:${tags}` : null

      let head = ':note'
      const otherFilters = [textClause, tagsClause].filter(Boolean)
      if (sourceFilter === 'source:journal') head = ':journal'
      else if (sourceFilter === 'source:feeds') head = ':catalog'
      else if (sourceFilter === 'source:playground') head = ':playground'
      else if (sourceFilter) otherFilters.unshift(sourceFilter)
      const braces = otherFilters.length ? `{${otherFilters.join(',')}}` : ''
      return [`${head}${braces}`, window].filter(Boolean).join(' ')
    },
  }
}

export const JOURNAL_STREAM_PROFILE: StreamProfile = {
  route: '/journal',
  title: 'Journal',
  defaultWql: ':journal{} last 4w',
  level: 'note',
  target: 'note',
  scopeOptions: ['journal'],
  legacy: createContentLegacyConfig('journal'),
}

export const CATALOGS_STREAM_PROFILE: StreamProfile = {
  route: '/catalogs',
  title: 'Notebooks',
  defaultWql: ':catalog{} by {tag}',
  level: 'session',
  target: 'note',
  scopeOptions: ['feeds'],
  shelfVisible: false,
  // Corpus comes from seed libraries — surface the core-only notice.
  seedNotice: true,
  legacy: createContentLegacyConfig('feeds'),
}

export const FEEDS_STREAM_PROFILE: StreamProfile = {
  route: '/feeds',
  title: 'Notes',
  defaultWql: ':feed{}',
  level: 'note',
  target: 'note',
  scopeOptions: ['feeds'],
  emptyMessage: 'No note entries match your search.',
  // Corpus comes from seed libraries — surface the core-only notice.
  seedNotice: true,
  legacy: createContentLegacyConfig('feeds'),
}

export const EFFORTS_STREAM_PROFILE: StreamProfile = {
  route: '/efforts',
  title: 'Efforts',
  defaultWql: ':effort',
  level: 'effort',
  target: 'effort',
  scopeOptions: [],
  emptyMessage: 'No efforts match your search.',
  legacy: EFFORTS_LEGACY_CONFIG,
}

export const EQUIPMENT_STREAM_PROFILE: StreamProfile = {
  route: '/equipment',
  title: 'Equipment',
  defaultWql: ':note{source:equipment}',
  level: 'note',
  target: 'note',
  scopeOptions: ['equipment'],
  emptyMessage: 'No equipment matches your search.',
}

export const SESSIONS_STREAM_PROFILE: StreamProfile = {
  route: '/sessions',
  title: 'Sessions',
  defaultWql: ':session{} last 1d',
  level: 'result',
  target: 'session',
  scopeOptions: [],
  emptyMessage: 'No completed session results recorded in this period.',
}

export const PLAYGROUNDS_STREAM_PROFILE: StreamProfile = {
  route: '/playgrounds',
  title: 'Playgrounds',
  // `by {}` precedes the window — the grammar orders the suffixes that way.
  defaultWql: ':playground{} by {date} last 1w',
  level: 'note',
  target: 'note',
  scopeOptions: ['playground'],
  shelfVisible: true,
  legacy: createContentLegacyConfig('playground'),
}

/** /session/:date — the sessions recorded on one date. */
export function createSessionDateProfile(date: string): StreamProfile {
  return {
    route: `/session/${date}`,
    defaultWql: `:session{} from ${date} to ${date}`,
    level: 'result',
    target: 'session',
    scopeOptions: [],
    emptyMessage: `No session results recorded on ${date}.`,
  }
}

export function createResultDetailProfile(resultId: string): StreamProfile {
  return {
    route: `/results/${resultId}`,
    defaultWql: `:session{result:${resultId}, plane:segment}`,
    level: 'segment',
    target: 'session',
    scopeOptions: [],
    emptyMessage: `No segment records found for result ${resultId}.`,
  }
}
/** /c/:slug — collection stream profile for a catalog */
export function createCollectionCatalogProfile(catalogSlug: string): StreamProfile {
  return {
    route: `/c/${catalogSlug}`,
    title: toDisplayName(catalogSlug),
    defaultWql: `:feed{catalog:${catalogSlug}} by {date}`,
    level: 'session',
    target: 'note',
    scopeOptions: ['feeds'],
    shelfVisible: false,
    defaultLayout: 'cards',
    catalog: catalogSlug,
    legacy: createContentLegacyConfig('feeds'),
  }
}


const PROFILES_BY_ROUTE: Record<string, StreamProfile> = {
  '/journal': JOURNAL_STREAM_PROFILE,
  '/catalogs': CATALOGS_STREAM_PROFILE,
  '/feeds': FEEDS_STREAM_PROFILE,
  '/feed': FEEDS_STREAM_PROFILE,
  '/efforts': EFFORTS_STREAM_PROFILE,
  '/equipment': EQUIPMENT_STREAM_PROFILE,
  '/sessions': SESSIONS_STREAM_PROFILE,
  '/playgrounds': PLAYGROUNDS_STREAM_PROFILE,
}

export function getStreamProfile(route: string): StreamProfile | undefined {
  const clean = cleanRoutePath(route)
  const exact = PROFILES_BY_ROUTE[clean]
  if (exact) return exact

  if (clean.startsWith('/results/')) {
    const sessionId = clean.slice('/results/'.length)
    if (sessionId) {
      return createResultDetailProfile(sessionId)
    }
  }

  if (clean.startsWith('/session/')) {
    const date = clean.slice('/session/'.length)
    if (date) {
      return createSessionDateProfile(date)
    }
  }
  if (clean.startsWith('/c/')) {
    const slug = clean.slice('/c/'.length)
    if (slug && !slug.includes('/')) {
      return createCollectionCatalogProfile(slug)
    }
  }

  return undefined
}

export function resolveStreamProfile(route: string): StreamProfile {
  // Generic fallback: an unclassified stream-classified path lands on the
  // conservative journal surface (`?q=` still overrides the default).
  return getStreamProfile(route) ?? JOURNAL_STREAM_PROFILE
}

/**
 * Display title for an exact stream route — `routeView.deriveWorkout` reads
 * this instead of a parallel route-name map.
 */
export function streamRouteTitle(pathname: string): string | undefined {
  const exact = PROFILES_BY_ROUTE[cleanRoutePath(pathname)]?.title
  if (exact) return exact
  if (cleanRoutePath(pathname).startsWith('/c/')) {
    const slug = cleanRoutePath(pathname).slice('/c/'.length)
    if (slug && !slug.includes('/')) {
      return toDisplayName(slug)
    }
  }
  return undefined
}

/**
 * Stream-surface membership — the single registry `routeView` consults when
 * classifying a pathname as a list surface. Covers every profile route plus
 * the dynamic detail/date routes; legacy bare `/results*` paths classify too
 * (the router redirects them, but this function stays pure on the pathname).
 */
export function isStreamRoute(pathname: string): boolean {
  const clean = cleanRoutePath(pathname)
  if (PROFILES_BY_ROUTE[clean]) return true

  if (clean.startsWith('/results/')) return clean.slice('/results/'.length) !== ''
  if (clean.startsWith('/session/')) return clean.slice('/session/'.length) !== ''
  if (clean === '/results' || clean === '/results/segments') return true
  if (clean.startsWith('/c/')) {
    const slug = clean.slice('/c/'.length)
    return Boolean(slug && !slug.includes('/'))
  }

  return false
}
