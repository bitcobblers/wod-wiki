/**
 * viewSettingsStorage — client storage persistence for per-route view settings (Ticket 002).
 *
 * Persists the user's field visibility, layout (Cards / Rows / Feed / Agenda
 * / Planner), and grouping per view route in localStorage. Legacy
 * stream/table layouts migrate to cards/rows on read. Drops obsolete or
 * unknown field IDs on read to keep stored state resilient.
 */
import { useState, useCallback, useEffect } from 'react'
import { LocalStore } from '@/services/storage/LocalStore'
import {
  type EntityLevel,
  getFieldsForLevel,
  getDefaultVisibleFieldIds,
} from './fieldProjection'

/**
 * The layouts a stream surface can render.
 *
 * `cards` / `rows` / `feed` are the flat projections of the query result set.
 * `agenda` / `planner` are the CALENDAR projections — the same set laid out
 * on a time axis (a month of days, or a board of weeks). They are offered
 * only on routes whose entries carry dates (see `StreamProfile.calendarCapable`).
 */
export type LayoutMode = 'cards' | 'rows' | 'feed' | 'agenda' | 'planner'

/** Every layout the picker can offer, in picker order. */
export const LAYOUT_MODES: readonly LayoutMode[] = ['cards', 'rows', 'feed', 'agenda', 'planner']

/** Persisted layouts from before the Cards / Rows / Feed split (Ticket 002). */
const LEGACY_LAYOUTS: Record<string, LayoutMode> = {
  stream: 'cards',
  table: 'rows',
}

export interface ViewSettings {
  level: EntityLevel
  layout: LayoutMode
  visibleFields: string[]
  groupBy?: string
}

export const VIEW_SETTINGS_STORAGE_PREFIX = 'wodwiki.viewSettings.v1'

/** Storage keys that moved during the ticket-09 route scheme: view settings
 *  saved under the retired surface id still resolve under the canonical one.
 *  The current key always wins when both exist. */
const LEGACY_ROUTE_ALIASES: Record<string, string> = {
  '/notebooks': '/catalogs',
  '/notes': '/feeds',
  '/sessions': '/results',
  '/dashboards': '/dashboard',
}

/** Two-rename chains: `/notes` inherited the old `/feeds` surface, which
 *  itself inherited `/collections` — a key that old resolves after both
 *  hops (mirrors routeWqlConfig's second hop). */
const LEGACY_ROUTE_SECOND_HOP: Record<string, string> = {
  '/notes': '/collections',
}

/** Internal storage-id overrides. The feed-source list keeps the public
 *  `/feeds` URL but stores under a versioned key: settings saved under the
 *  retired notes-list `/feeds` surface migrate to `/notes` and must never
 *  leak into the new feed defaults. */
const STORAGE_ID_OVERRIDES: Record<string, string> = {
  '/feeds': '/feeds@2',
}

/** Map a public route to its storage key id (versioned overrides applied). */
function storageRouteId(route: string): string {
  const cleanRoute = route.startsWith('/') ? route : `/${route}`
  return STORAGE_ID_OVERRIDES[cleanRoute] ?? cleanRoute
}

export const viewSettingsStore = new LocalStore(VIEW_SETTINGS_STORAGE_PREFIX)

export function getRouteStorageKey(route: string): string {
  return viewSettingsStore.qualify(storageRouteId(route))
}

export function getDefaultViewSettings(level: EntityLevel, defaultLayout?: LayoutMode): ViewSettings {
  return {
    level,
    layout: defaultLayout ?? 'cards',
    visibleFields: getDefaultVisibleFieldIds(level),
    groupBy: undefined,
  }
}

export function readViewSettings(route: string, level: EntityLevel, store: LocalStore = viewSettingsStore, defaultLayout?: LayoutMode): ViewSettings {
  const defaults = getDefaultViewSettings(level, defaultLayout)
  const cleanRoute = storageRouteId(route)
  const legacyRoute = LEGACY_ROUTE_ALIASES[cleanRoute]
  let parsed = store.get<Partial<ViewSettings>>(cleanRoute, { alias: legacyRoute })
  if (parsed == null && legacyRoute) {
    parsed = store.get<Partial<ViewSettings>>(legacyRoute, { alias: LEGACY_ROUTE_SECOND_HOP[cleanRoute] })
  }
  if (!parsed) return defaults
  const rawLayout = typeof parsed.layout === 'string' ? parsed.layout : ''
  const layout: LayoutMode = LAYOUT_MODES.includes(rawLayout as LayoutMode)
    ? (rawLayout as LayoutMode)
    : (LEGACY_LAYOUTS[rawLayout] ?? 'cards')

    // Sanitize visible fields against valid fields for this level
    const availableFieldIds = new Set(getFieldsForLevel(level).map(f => f.id))
    const visibleFields = Array.isArray(parsed.visibleFields)
      ? parsed.visibleFields.filter(id => typeof id === 'string' && availableFieldIds.has(id))
      : defaults.visibleFields

    const groupBy = typeof parsed.groupBy === 'string' ? parsed.groupBy : undefined
    return {
      level,
      layout,
      visibleFields: visibleFields.length > 0 ? visibleFields : defaults.visibleFields,
      groupBy,
    }
}

export function writeViewSettings(route: string, settings: ViewSettings, store: LocalStore = viewSettingsStore): void {
  const cleanRoute = storageRouteId(route)
  store.set(cleanRoute, {
    level: settings.level,
    layout: settings.layout,
    visibleFields: settings.visibleFields,
    groupBy: settings.groupBy,
  })
}

export function resetViewSettings(route: string, level: EntityLevel, store: LocalStore = viewSettingsStore): ViewSettings {
  const cleanRoute = storageRouteId(route)
  const legacyRoute = LEGACY_ROUTE_ALIASES[cleanRoute]
  const secondHop = LEGACY_ROUTE_SECOND_HOP[cleanRoute]
  store.remove(cleanRoute, legacyRoute)
  if (secondHop) store.remove(secondHop)
  return getDefaultViewSettings(level)
}

/**
 * React hook for consuming and updating per-route view settings with client storage persistence.
 */
export function useViewSettings(route: string, level: EntityLevel, defaultLayout?: LayoutMode) {
  const [settings, setSettings] = useState<ViewSettings>(() => readViewSettings(route, level, viewSettingsStore, defaultLayout))

  // Synchronize when route or level changes
  useEffect(() => {
    setSettings(readViewSettings(route, level, viewSettingsStore, defaultLayout))
  }, [route, level, defaultLayout])

  const update = useCallback(
    (updater: (prev: ViewSettings) => ViewSettings) => {
      setSettings(prev => {
        const next = updater(prev)
        writeViewSettings(route, next)
        return next
      })
    },
    [route],
  )

  const setLayout = useCallback(
    (layout: LayoutMode) => {
      update(prev => ({ ...prev, layout }))
    },
    [update],
  )

  const toggleField = useCallback(
    (fieldId: string) => {
      update(prev => {
        const currentSet = new Set(prev.visibleFields)
        if (currentSet.has(fieldId)) {
          currentSet.delete(fieldId)
        } else {
          currentSet.add(fieldId)
        }
        return {
          ...prev,
          visibleFields: Array.from(currentSet),
        }
      })
    },
    [update],
  )

  const setVisibleFields = useCallback(
    (visibleFields: string[]) => {
      update(prev => ({ ...prev, visibleFields }))
    },
    [update],
  )

  const setGroupBy = useCallback(
    (groupBy?: string) => {
      update(prev => ({ ...prev, groupBy }))
    },
    [update],
  )
  const resetSettings = useCallback(() => {
    const defaults = resetViewSettings(route, level)
    setSettings(defaults)
  }, [route, level])

  return {
    settings,
    setLayout,
    toggleField,
    setVisibleFields,
    setGroupBy,
    resetSettings,
  }
}
