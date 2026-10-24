/**
 * queryConfigSurfaces — the registry of surfaces whose query configuration
 * the user owns, and where that configuration lives.
 *
 * One surface = one storage key in `routeWqlConfig` (plus the route's saved
 * shortcuts). The registry is the single source of truth for:
 *   - which pages offer a query-settings dialog,
 *   - the label the dialog carries,
 *   - the system defaults shown read-only beside the user's overrides,
 *   - whether the surface also owns saved navigation shortcuts.
 *
 * The library surfaces carry a StreamProfile (the system default query and
 * the Where-stored scope vocabulary); the two non-library surfaces — the
 * Metric Explorer and the ⌘/ palette — carry an explicit system default
 * instead, because they have no stream profile of their own.
 *
 * Detail surfaces are deliberately absent: `/c/:slug`, `/session/:date` and
 * `/results/:id` resolve a profile per item, so a config key per item would
 * scatter the keyspace with one-off overrides. They keep their in-code
 * defaults; their families are configured here instead.
 */
import {
  CATALOGS_STREAM_PROFILE,
  EFFORTS_STREAM_PROFILE,
  EQUIPMENT_STREAM_PROFILE,
  FEEDS_STREAM_PROFILE,
  JOURNAL_STREAM_PROFILE,
  PLAYGROUNDS_STREAM_PROFILE,
  SESSIONS_STREAM_PROFILE,
  type StreamProfile,
} from '../views/stream/streamProfile'
import { PALETTE_ROUTE_ID } from './routeWqlConfig'
import { PALETTE_SEED_QUERY } from '../services/wqlSearchSource'
import { SOURCE_OPTIONS } from '@bitcobblers/wod-wiki-ui'

export interface QueryConfigSurface {
  /** Canonical route id — the `routeWqlConfig` storage key. */
  id: string
  /** Human label for the dialog title. */
  label: string
  /** The surface's stream profile, when it has one (the library surfaces). */
  profile?: StreamProfile
  /** Read-only system default query for surfaces without a profile. */
  systemDefaultWql?: string
  /** Where-stored scope choices the surface offers; empty = no scope editor. */
  scopeChoices?: readonly { value: string; label: string }[]
  /** The surface owns saved navigation shortcuts (the library nav groups). */
  shortcuts?: boolean
}

const LIBRARY_SURFACES: QueryConfigSurface[] = [
  {
    id: JOURNAL_STREAM_PROFILE.route,
    label: 'Journal',
    profile: JOURNAL_STREAM_PROFILE,
    scopeChoices: SOURCE_OPTIONS,
    shortcuts: true,
  },
  {
    id: FEEDS_STREAM_PROFILE.route,
    label: 'Notes',
    profile: FEEDS_STREAM_PROFILE,
    scopeChoices: SOURCE_OPTIONS,
    shortcuts: true,
  },
  {
    id: CATALOGS_STREAM_PROFILE.route,
    label: 'Notebooks',
    profile: CATALOGS_STREAM_PROFILE,
    scopeChoices: SOURCE_OPTIONS,
    shortcuts: true,
  },
  {
    id: EFFORTS_STREAM_PROFILE.route,
    label: 'Efforts',
    profile: EFFORTS_STREAM_PROFILE,
    scopeChoices: SOURCE_OPTIONS,
    shortcuts: true,
  },
  {
    id: EQUIPMENT_STREAM_PROFILE.route,
    label: 'Equipment',
    profile: EQUIPMENT_STREAM_PROFILE,
    scopeChoices: SOURCE_OPTIONS,
    shortcuts: true,
  },
  {
    id: SESSIONS_STREAM_PROFILE.route,
    label: 'Sessions',
    profile: SESSIONS_STREAM_PROFILE,
    scopeChoices: SOURCE_OPTIONS,
    shortcuts: true,
  },
  {
    id: PLAYGROUNDS_STREAM_PROFILE.route,
    label: 'Playgrounds',
    profile: PLAYGROUNDS_STREAM_PROFILE,
    scopeChoices: SOURCE_OPTIONS,
    shortcuts: true,
  },
]

/** The Metric Explorer (/dashboards) — an analytics surface, no stream profile. */
export const DASHBOARDS_SURFACE: QueryConfigSurface = {
  id: '/dashboards',
  label: 'Dashboards',
  systemDefaultWql: ':dashboard{}',
}

/** The ⌘/ command palette — a global overlay, no stream profile. */
export const PALETTE_SURFACE: QueryConfigSurface = {
  id: PALETTE_ROUTE_ID,
  label: 'Command palette',
  systemDefaultWql: PALETTE_SEED_QUERY,
  // The palette composes find queries, so its picker prioritizes storage
  // scopes — the same vocabulary the library surfaces offer.
  scopeChoices: SOURCE_OPTIONS,
}

/** Every surface the user can configure, in registry order. */
export const QUERY_CONFIG_SURFACES: readonly QueryConfigSurface[] = [
  ...LIBRARY_SURFACES,
  DASHBOARDS_SURFACE,
  PALETTE_SURFACE,
]

/**
 * The surface for a route id, or undefined when the route has no
 * configurable surface (a detail route, or a page that owns no query).
 */
export function queryConfigSurface(routeId: string): QueryConfigSurface | undefined {
  return QUERY_CONFIG_SURFACES.find(s => s.id === routeId)
}
