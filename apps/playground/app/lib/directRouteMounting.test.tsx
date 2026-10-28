/**
 * directRouteMounting.test.tsx — Route cutover verification (Ticket 004).
 *
 * Verifies that:
 * 1. /journal, /notes, /notebooks, /feeds, and /efforts mount directly
 *    under the unified queriable stream (routeView classifies them as 'library').
 * 2. Each route resolves to its route-aware StreamProfile with canonical WQL defaults.
 * 3. Legacy query parameters and bookmarks seamlessly migrate into canonical WQL queries.
 */
import { describe, it, expect } from 'bun:test'
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine'
import { resolveRouteView, type RouteViewDeps } from './routeView'
import {
  JOURNAL_STREAM_PROFILE,
  NOTEBOOKS_STREAM_PROFILE,
  NOTES_STREAM_PROFILE,
  EFFORTS_STREAM_PROFILE,
  resolveStreamProfile,
} from '../views/stream/streamProfile'

const NO_PARAMS = {}
function makeDeps(): RouteViewDeps {
  return {
    workoutItems: [],
    canvasPage: null,
    recentResults: [],
    selectWorkout: () => {},
  }
}

describe('Direct route mounting classification (routeView)', () => {
  it('classifies /journal and /journal/ directly to library with Journal title', () => {
    const v1 = resolveRouteView('/journal', NO_PARAMS, makeDeps())
    expect(v1.page).toBe('library')
    expect(v1.workout.name).toBe('Journal')
    expect(v1.shell).toEqual({ wrap: 'bare' })

    const v2 = resolveRouteView('/journal/', NO_PARAMS, makeDeps())
    expect(v2.page).toBe('library')
    expect(v2.workout.name).toBe('Journal')
    expect(v2.shell).toEqual({ wrap: 'bare' })
  })

  it('classifies /notes directly to library with Notes title', () => {
    const v = resolveRouteView('/notes', NO_PARAMS, makeDeps())
    expect(v.page).toBe('library')
    expect(v.workout.name).toBe('Notes')
    expect(v.shell).toEqual({ wrap: 'bare' })
  })

  it('classifies /feeds directly to library with Feeds title', () => {
    const v = resolveRouteView('/feeds', NO_PARAMS, makeDeps())
    expect(v.page).toBe('library')
    expect(v.workout.name).toBe('Feeds')
    expect(v.shell).toEqual({ wrap: 'bare' })
  })

  it('classifies /notebooks directly to library with Notebooks title', () => {
    const v = resolveRouteView('/notebooks', NO_PARAMS, makeDeps())
    expect(v.page).toBe('library')
    expect(v.workout.name).toBe('Notebooks')
    expect(v.shell).toEqual({ wrap: 'bare' })
  })

  it('classifies /efforts directly to library with Efforts title', () => {
    const v = resolveRouteView('/efforts', NO_PARAMS, makeDeps())
    expect(v.page).toBe('library')
    expect(v.workout.name).toBe('Efforts')
    expect(v.shell).toEqual({ wrap: 'bare' })
  })
})

describe('Route-aware stream profile resolution', () => {
  it('resolves canonical StreamProfile configurations per route', () => {
    expect(resolveStreamProfile('/journal')).toBe(JOURNAL_STREAM_PROFILE)
    // Semantic, not spelling: the journal default scopes to the journal
    // notebook over a 4-week window, grouped by date in the query itself —
    // a copyable note-plane query regardless of head spelling.
    const journalDefault = parseQuery(resolveStreamProfile('/journal').defaultWql)
    expect(isFindQuery(journalDefault)).toBe(true)
    if (isFindQuery(journalDefault)) {
      expect(journalDefault.target).toBe('note')
      expect(journalDefault.filters.some((f) => f.key === 'notebook' && f.values.some((v) => v.value === 'journal'))).toBe(true)
      expect(journalDefault.groupBy).toEqual(['date'])
      expect(journalDefault.window).toEqual({ kind: 'relative', size: 4, unit: 'w' })
    }

    expect(resolveStreamProfile('/notebooks')).toBe(NOTEBOOKS_STREAM_PROFILE)
    expect(resolveStreamProfile('/notebooks').defaultWql).toBe(':notebook{subscribed:true} by {feed}')

    expect(resolveStreamProfile('/notes')).toBe(NOTES_STREAM_PROFILE)
    expect(resolveStreamProfile('/notes').defaultWql).toBe(':note{notebook:*}')

    expect(resolveStreamProfile('/efforts')).toBe(EFFORTS_STREAM_PROFILE)
    expect(resolveStreamProfile('/efforts').defaultWql).toBe(':effort')
  })
})

describe('Legacy parameter migration across unified stream routes', () => {
  it('migrates legacy bookmarks on /journal into canonical WQL queries', () => {
    const legacy = JOURNAL_STREAM_PROFILE.legacy!
    expect(legacy.toQuery(new URLSearchParams('mode=plan'))).toBe(':journal last 2w')
    expect(legacy.toQuery(new URLSearchParams('mode=plan&s=2026-07-15&tags=pr'))).toBe(':journal{tags:pr} last 2w')
    expect(legacy.toQuery(new URLSearchParams('text=snatch'))).toBe(':journal{text:snatch} last 2w')
  })

  it('migrates legacy bookmarks on /notes into canonical WQL queries', () => {
    // The notebooks scope keeps its source-scoped legacy mapping (scope
    // notebooks → the `:notebooks` head).
    const legacy = NOTES_STREAM_PROFILE.legacy!
    expect(legacy.toQuery(new URLSearchParams('text=fran'))).toBe(':notebooks{text:fran} last 2w')
    expect(legacy.toQuery(new URLSearchParams('timePreset=all'))).toBe(':notebooks')
  })

  it('migrates legacy unscoped bookmarks on /notes without source narrowing', () => {
    const legacy = NOTES_STREAM_PROFILE.legacy!
    // No tri-state params: the default scope applies. Semantic check on the
    // scoped form — one positive source filter, notebooks scope, 2-week window.
    const migrated = parseQuery(legacy.toQuery(new URLSearchParams('s=2026-07-12')) ?? '')
    expect(isFindQuery(migrated)).toBe(true)
    if (isFindQuery(migrated)) {
      expect(migrated.filters.filter((f) => f.key === 'source' && f.values.some((v) => v.value === 'notebooks'))).toHaveLength(1)
      expect(migrated.window).toEqual({ kind: 'relative', size: 2, unit: 'w' })
    }
  })

  it('migrates legacy tri-state parameters on /notes', () => {
    const legacy = NOTES_STREAM_PROFILE.legacy!
    expect(legacy.toQuery(new URLSearchParams('note=on&session=hide&post=hide'))).toBe(':journal last 2w')
    expect(legacy.toQuery(new URLSearchParams('note=hide&session=on&post=hide'))).toBe(':notebooks last 2w')
    // post=on mapped to the now-excised notebooks scope: unscoped, same window.
    const postOnly = parseQuery(legacy.toQuery(new URLSearchParams('note=hide&session=hide&post=on')) ?? '')
    expect(isFindQuery(postOnly)).toBe(true)
    if (isFindQuery(postOnly)) {
      expect(postOnly.filters.filter((f) => f.key === 'source')).toHaveLength(0)
      expect(postOnly.window).toEqual({ kind: 'relative', size: 2, unit: 'w' })
    }
  })

  it('migrates legacy parameters and plain-text query on /efforts', () => {
    const legacy = EFFORTS_STREAM_PROFILE.legacy!
    expect(legacy.toQuery(new URLSearchParams('origin=bundled&discipline=strength'))).toBe(':effort{origin:bundled,discipline:strength}')
    expect(legacy.salvageQ?.('fran', new URLSearchParams())).toBe(':effort{text:fran}')
    expect(legacy.salvageQ?.('snatch balance', new URLSearchParams('discipline=weightlifting'))).toBe(':effort{text:"snatch balance",discipline:weightlifting}')
  })
})
