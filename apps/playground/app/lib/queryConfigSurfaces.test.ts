/**
 * queryConfigSurfaces — the registry of surfaces whose query configuration
 * the user owns.
 *
 * Asserts:
 *   1. Every library listing page has a surface — including /equipment,
 *      which the retired global settings page never listed.
 *   2. A detail route (/notebook/:slug, /session/:date, /results/:id) has NO
 *      surface — its defaults stay in code, so the keyspace does not grow
 *      one entry per item.
 *   3. The two non-library surfaces — the Metric Explorer and the ⌘/ palette
 *      — carry an explicit system default and no stream profile.
 */
import { describe, expect, it } from 'bun:test'
import {
  DASHBOARDS_SURFACE,
  PALETTE_SURFACE,
  QUERY_CONFIG_SURFACES,
  queryConfigSurface,
} from './queryConfigSurfaces'
import { PALETTE_ROUTE_ID } from './routeWqlConfig'

describe('queryConfigSurfaces — registry', () => {
  it('covers every library listing page', () => {
    for (const id of [
      '/journal',
      '/notes',
      '/notebooks',
      '/feeds',
      '/pages',
      '/efforts',
      '/equipment',
      '/sessions',
      '/playgrounds',
    ]) {
      expect(queryConfigSurface(id)).toBeDefined()
    }
  })

  it('gives every library surface a stream profile and the scope vocabulary', () => {
    for (const surface of QUERY_CONFIG_SURFACES) {
      if (surface.id === '/dashboards' || surface.id === PALETTE_ROUTE_ID) continue
      expect(surface.profile).toBeDefined()
      expect(surface.scopeChoices?.length).toBeGreaterThan(0)
      expect(surface.shortcuts).toBe(true)
    }
  })

  it('has no surface for a detail route — one config per item would scatter the keyspace', () => {
    expect(queryConfigSurface('/notebook/girls')).toBeUndefined()
    expect(queryConfigSurface('/session/2026-01-01')).toBeUndefined()
    expect(queryConfigSurface('/results/res-1')).toBeUndefined()
  })

  it('has no surface for a page that owns no query', () => {
    expect(queryConfigSurface('/settings/appearance')).toBeUndefined()
    expect(queryConfigSurface('/page/guide-start')).toBeUndefined()
  })

  it('gives the Metric Explorer an explicit system default and no profile', () => {
    expect(DASHBOARDS_SURFACE.id).toBe('/dashboards')
    expect(DASHBOARDS_SURFACE.systemDefaultWql).toBe(':dashboard{}')
    expect(DASHBOARDS_SURFACE.profile).toBeUndefined()
  })

  it('gives the palette a synthetic route id and no profile', () => {
    expect(PALETTE_SURFACE.id).toBe(PALETTE_ROUTE_ID)
    expect(PALETTE_SURFACE.systemDefaultWql).toBeTruthy()
    expect(PALETTE_SURFACE.profile).toBeUndefined()
  })
})
