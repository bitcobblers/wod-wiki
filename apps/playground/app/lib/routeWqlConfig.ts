/**
 * routeWqlConfig — the user's per-surface WQL configuration, edited in the
 * surface's own query settings.
 *
 * Persists the user's override of a surface's landing default WQL, Where-stored
 * scope options, and Group-By favorites, one key per route id — browser
 * localStorage locally, namespaced meta rows on the server in api mode. Absent fields fall back individually
 * to the in-code system defaults (the route's StreamProfile, the palette seed);
 * an empty array is a deliberate
 * "no predefined options" state and is preserved. An explicit URL `?q=` always
 * wins over any default — that precedence lives in useComposerQueryState, so
 * defaults apply only when `?q` is absent and Back/Forward restores explicit
 * query choices.
 *
 * Favorites are priority lists, never grammar: stored option ids migrate
 * narrowly to canonical target/scope choices on read (work item 3); ids that
 * are neither canonical nor migratable are reported (`invalidTypeOptions`,
 * `invalidGroupByOptions`) instead of silently turning into query clauses.
 *
 * The store is live: a write notifies its subscribers, so a surface's own
 * settings change the open page without a reload.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { WQL_FIND_TARGETS, WQL_SOURCE_VALUES } from '@bitcobblers/wod-wiki-engine'
import type { StreamProfile } from '../views/stream/streamProfile'
import { migrateLegacyCatalogFilter } from './legacyWql'
import { LocalStore } from '@/services/storage/LocalStore'
import { remotePrefsMode, metaDeletePrefs, metaPrefBackend, metaSetPref } from '@/services/storage/metaStore'
import {
  GROUP_BY_DIMENSION_IDS,
  normalizeGroupByFavorites,
} from './groupByOptions'

export interface RouteWqlConfig {
  /** Landing default WQL when the URL carries no `?q=`. */
  defaultWql?: string
  /** Replaces the profile's scopeOptions when present (empty = no predefined options). */
  typeOptions?: string[]
  /** The surface's Group-By favorites, in priority order — the order the
   *  dimensions are offered in and the dimension a bare landing falls back
   *  to. Never a filter: dimensions the target cannot group by stay stored
   *  but are not offered. */
  groupByOptions?: string[]
  /** Stored type-option ids that are neither canonical nor migratable — surfaced
   *  in the surface's query settings, never turned into query clauses. */
  invalidTypeOptions?: string[]
  /** Stored group-by ids outside the canonical dimension vocabulary. */
  invalidGroupByOptions?: string[]
}

/** The ⌘/ palette is a global surface, not a route; it gets a synthetic route id. */
export const PALETTE_ROUTE_ID = '/palette'

export const ROUTE_WQL_STORAGE_PREFIX = 'wodwiki.routeWql.v1'

// api mode: reads come from the hydrated server rows; writes bypass the
// error-swallowing LocalStore and flush through metaSetPref instead.
export const routeWqlStore = new LocalStore(ROUTE_WQL_STORAGE_PREFIX, remotePrefsMode ? metaPrefBackend : undefined)

/** Canonical Where-stored choices — the storage scopes a note surface offers. */
export const SCOPE_OPTION_VALUES: readonly string[] = WQL_SOURCE_VALUES

/** Every canonical type-option value: singular targets plus storage scopes. */
export const CANONICAL_TYPE_OPTIONS: readonly string[] = [...WQL_FIND_TARGETS, ...WQL_SOURCE_VALUES]

/**
 * Fallback card-arrangement dimensions — the shared vocabulary the per-page
 * query settings editor offers, the stored-favorites validation below, and
 * the stream grouping consumer (`groupEntriesByDimension`) implements. The
 * vocabulary and its sort rules live in `groupByOptions` — one list, three
 * consumers. Query grouping (WQL `by {…}`) wins over the fallback while
 * present.
 */
export { GROUP_BY_DIMENSIONS, GROUP_BY_DIMENSION_IDS } from './groupByOptions'

/**
 * Narrow one-time id migration for persisted favorites (work item 3): the old
 * plural-noun type vocabulary maps onto canonical singular targets, and the
 * retired `collections`/`feeds` storage scopes map onto `notebooks`
 * (collections→feeds→notebooks rename chain).
 */
const LEGACY_TYPE_OPTION_IDS: Record<string, string> = {
  notes: 'note',
  blocks: 'block',
  efforts: 'effort',
  collections: 'notebooks',
  feeds: 'notebooks',
}

function getRouteWqlStorageId(routeId: string): string {
  const id = routeId.startsWith('/') ? routeId : `/${routeId}`
  return STORAGE_ID_OVERRIDES[id] ?? id
}

export function getRouteWqlStorageKey(routeId: string): string {
  return routeWqlStore.qualify(getRouteWqlStorageId(routeId))
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim())
}

/**
 * Migrate one stored favorites list id-by-id: legacy plural ids map to their
 * canonical choice, unknown ids are reported (not dropped silently), empty
 * lists stay empty, first-occurrence order (priority) is preserved.
 */
function migrateFavoriteIds(
  values: string[],
  canonical: readonly string[],
  legacy: Record<string, string>,
): { options: string[]; invalid: string[] } {
  const options: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const v of values) {
    const id = legacy[v] ?? v
    if (!canonical.includes(id)) {
      if (!invalid.includes(v)) invalid.push(v)
      continue
    }
    if (!seen.has(id)) {
      seen.add(id)
      options.push(id)
    }
  }
  return { options, invalid }
}

/**
 * Storage keys that moved during the ticket-09 route scheme: overrides saved
 * under the retired surface id still resolve under the canonical one, so a
 * route rename never loses the user's query settings. The new key always
 * wins when both exist.
 *
 *   /notebooks ← /catalogs   (the notebooks list was /catalogs)
 *   /notes     ← /feeds      (the notes list was the old /feeds surface; the
 *                            new /feeds surface is the feed sources, a new
 *                            key with no legacy of its own)
 *   /sessions  ← /results    (earlier rebrand — kept so those settings survive)
 *   /dashboards ← /dashboard (earlier rebrand — kept so those settings survive)
 */
const LEGACY_STORAGE_ALIASES: Record<string, string> = {
  '/notebooks': '/catalogs',
  '/notes': '/feeds',
  '/sessions': '/results',
  '/dashboards': '/dashboard',
}

/** Two-rename chains: `/notes` inherited the old `/feeds` surface, which
 *  itself inherited `/collections` — a key that old resolves after both
 *  hops (mirrors routeWqlConfig's second hop). */
const LEGACY_STORAGE_SECOND_HOP: Record<string, string> = {
  '/notes': '/collections',
}

/** Internal storage-id overrides. The feed-source list keeps the public
 *  `/feeds` URL but stores under a versioned key: settings saved under the
 *  retired notes-list `/feeds` surface migrate to `/notes` and must never
 *  leak into the new feed defaults. */
const STORAGE_ID_OVERRIDES: Record<string, string> = {
  '/feeds': '/feeds@2',
}

/**
 * One-time hard-break migration for the collections→feeds→notebooks rename
 * chain: stored default WQL written in the retired grammar rewrites to the
 * notebook forms. The `:collection`/`:collections`/`:feed`/`:feeds` heads
 * become `:notebook`/`:notebooks`, `source:collections`/`source:feeds`
 * become `source:notebooks`, the retired note kinds `type:feed`/
 * `type:collection` fold into `type:note` (a note in a notebook is one
 * kind). The `catalog:` filter becomes `notebook:` (ticket 08 — the catalog
 * plane is the notebook plane). Storage-identity spellings pass through
 * untouched — a `collection:`-prefixed source id keeps its prefix
 * (`:collection:` is never followed by a head boundary).
 */
function migrateLegacyStoredWql(wql: string): string {
  return migrateLegacyCatalogFilter(wql)
    .replace(/^:(collections?|feeds?)(?![\w:])/, (head) =>
      (head === ':collections' || head === ':feeds' ? ':notebooks' : ':notebook'))
    .replace(/(^|[{,\s])source:(collections|feeds)(?![\w:])/g, '$1source:notebooks')
    .replace(/(^|[{,\s])source:collection:/g, '$1source:notebook:')
    .replace(/(^|[{,\s])type:(feed|collection)(?![\w:])/g, '$1type:note')
}
export { migrateLegacyStoredWql }

export function readRouteWqlConfig(routeId: string, store: LocalStore = routeWqlStore): RouteWqlConfig {
  const id = getRouteWqlStorageId(routeId)
  const legacyId = LEGACY_STORAGE_ALIASES[id]
  let parsed = store.get<Partial<RouteWqlConfig>>(id, { alias: legacyId })
  if (parsed == null && legacyId) {
    parsed = store.get<Partial<RouteWqlConfig>>(legacyId, { alias: LEGACY_STORAGE_SECOND_HOP[id] })
  }
  if (!parsed) return {}
  const typeOptions = sanitizeStringArray(parsed.typeOptions)
  const groupByOptions = sanitizeStringArray(parsed.groupByOptions)
  const migratedType = typeOptions && migrateFavoriteIds(typeOptions, CANONICAL_TYPE_OPTIONS, LEGACY_TYPE_OPTION_IDS)
  const migratedGroup = groupByOptions
    ? normalizeGroupByFavorites(groupByOptions)
    : undefined
  return {
    defaultWql:
      typeof parsed.defaultWql === 'string' && parsed.defaultWql.trim().length > 0
        ? migrateLegacyStoredWql(parsed.defaultWql.trim())
        : undefined,
    typeOptions: migratedType?.options,
    groupByOptions: migratedGroup?.options,
    ...(migratedType?.invalid.length ? { invalidTypeOptions: migratedType.invalid } : {}),
    ...(migratedGroup?.invalid.length ? { invalidGroupByOptions: migratedGroup.invalid } : {}),
  }
}

/**
 * Persist one route's config. Resolves false only when persistence failed
 * (api mode: the server row was not stored); local mode keeps the existing
 * browser-backend semantics and always resolves true.
 */
export async function writeRouteWqlConfig(routeId: string, config: RouteWqlConfig, store: LocalStore = routeWqlStore): Promise<boolean> {
  const id = getRouteWqlStorageId(routeId)
  const payload = {
    defaultWql: config.defaultWql?.trim() || undefined,
    typeOptions: sanitizeStringArray(config.typeOptions),
    groupByOptions: sanitizeStringArray(config.groupByOptions),
  }
  if (remotePrefsMode) {
    try {
      await metaSetPref(store.qualify(id), JSON.stringify(payload))
    } catch (err) {
      console.error('[routeWqlConfig] server write failed:', err)
      return false
    }
    notifyRouteWqlConfig()
    return true
  }
  store.set(id, payload)
  notifyRouteWqlConfig()
  return true
}

/** Discard the stored config — canonical key and its legacy rebrand alias
 *  together, so a reset cannot resurrect the old override. Resolves false
 *  when the server delete failed (api mode) — the stored override then
 *  still stands. */
export async function clearRouteWqlConfig(routeId: string, store: LocalStore = routeWqlStore): Promise<boolean> {
  const id = getRouteWqlStorageId(routeId)
  const legacyId = LEGACY_STORAGE_ALIASES[id]
  if (remotePrefsMode) {
    try {
      await metaDeletePrefs(legacyId ? [store.qualify(id), store.qualify(legacyId)] : [store.qualify(id)])
    } catch (err) {
      console.error('[routeWqlConfig] server delete failed:', err)
      return false
    }
    notifyRouteWqlConfig()
    return true
  }
  store.remove(id, legacyId)
  notifyRouteWqlConfig()
  return true
}

// ── Reactivity — version-counter store for useSyncExternalStore ─────────────

/**
 * The config store is read on every render of every consumer (the stream
 * view's profile overlay, the nav panel's fallback, the page's own settings
 * dialog), so a save has to reach the open page without a reload. A version
 * counter is the cheapest channel that fits the existing `routeWqlShortcuts`
 * pattern: writes bump it, subscribers re-read.
 */
let configVersion = 0
const listeners = new Set<() => void>()

/** Subscribe to config changes (write / clear). Returns an unsubscribe fn. */
export function subscribeRouteWqlConfig(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The current config version — changes on every write/clear. */
export function routeWqlConfigVersion(): number {
  return configVersion
}

function notifyRouteWqlConfig(): void {
  configVersion += 1
  for (const listener of listeners) listener()
}

/**
 * The live config for a route — re-reads whenever any surface's config is
 * written, so the page reflects its own edits immediately.
 */
export function useRouteWqlConfig(routeId: string): RouteWqlConfig {
  const version = useSyncExternalStore(subscribeRouteWqlConfig, routeWqlConfigVersion, routeWqlConfigVersion)
  return useMemo(() => readRouteWqlConfig(routeId), [routeId, version])
}

/**
 * The current config version — a dependency for callers that read the
 * config outside a hook (the stream profile overlay, the nav panel's
 * fallback), so they re-derive when a surface saves.
 */
export function useRouteWqlConfigVersion(): number {
  return useSyncExternalStore(subscribeRouteWqlConfig, routeWqlConfigVersion, routeWqlConfigVersion)
}

/**
 * Overlay the stored config onto a resolved StreamProfile. Returns the same
 * object when nothing is configured, so profile identity is preserved.
 *
 * Stored favorites overlay the scope list only: canonical target favorites
 * (e.g. a migrated `notes` → `note`) are inert here — the route's target is
 * fixed by the page — but stay visible and removable in the surface's own
 * query settings. A stored list without scope entries (including a deliberate
 * empty list) leaves the route with no predefined scope options — the nudge
 * state, never a blocker.
 *
 * The Group-By favorites ride along as a priority list: the page offers those
 * dimensions first and falls back to the first one on a bare landing. They
 * never filter — a dimension the target cannot group by stays stored but is
 * not offered.
 */
export function applyRouteWqlConfig(profile: StreamProfile, config?: RouteWqlConfig): StreamProfile {
  const resolved = config ?? readRouteWqlConfig(profile.route)
  if (!resolved.defaultWql && !resolved.typeOptions && !resolved.groupByOptions) return profile
  return {
    ...profile,
    defaultWql: resolved.defaultWql ?? profile.defaultWql,
    scopeOptions: resolved.typeOptions
      ? resolved.typeOptions.filter(v => (WQL_SOURCE_VALUES as readonly string[]).includes(v))
      : profile.scopeOptions,
    groupByOptions: resolved.groupByOptions,
  }
}

/**
 * The profile with the user's config applied, kept live: a save on the page
 * updates the open page without a reload. An absent profile stays absent.
 */
export function useAppliedRouteWqlConfig(profile: StreamProfile | undefined): StreamProfile | undefined {
  const config = useRouteWqlConfig(profile?.route ?? '')
  return useMemo(
    () => (profile ? applyRouteWqlConfig(profile, config) : undefined),
    [profile, config],
  )
}
