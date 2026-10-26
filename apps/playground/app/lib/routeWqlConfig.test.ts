import { LocalStore, InMemoryBackend } from '@/services/storage/LocalStore'
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  readRouteWqlConfig,
  writeRouteWqlConfig,
  clearRouteWqlConfig,
  applyRouteWqlConfig,
  getRouteWqlStorageKey,
  routeWqlConfigVersion,
  subscribeRouteWqlConfig,
  ROUTE_WQL_STORAGE_PREFIX,
  PALETTE_ROUTE_ID,
  type RouteWqlConfig,
} from './routeWqlConfig'
import { FEEDS_STREAM_PROFILE } from '../views/stream/streamProfile'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('routeWqlConfig — pure read/write/clear', () => {
  it('returns an empty config when nothing is stored', () => {
    expect(readRouteWqlConfig('/journal')).toEqual({})
  })

  it('round-trips a config per route and isolates routes', async () => {
    await writeRouteWqlConfig('/journal', { defaultWql: ':note last 6w' })
    await writeRouteWqlConfig('/feeds', { typeOptions: ['journal'] })

    expect(readRouteWqlConfig('/journal')).toEqual({ defaultWql: ':note last 6w' })
    expect(readRouteWqlConfig('/feeds')).toEqual({ typeOptions: ['journal'] })
    expect(readRouteWqlConfig('/efforts')).toEqual({})
  })

  it('keys storage like viewSettingsStorage: prefix + /<routeId>', () => {
    expect(getRouteWqlStorageKey('/journal')).toBe(`${ROUTE_WQL_STORAGE_PREFIX}/journal`)
    expect(getRouteWqlStorageKey('journal')).toBe(`${ROUTE_WQL_STORAGE_PREFIX}/journal`)
  })

  it('preserves an empty options array — a deliberate "no predefined options" state', async () => {
    await writeRouteWqlConfig('/journal', { typeOptions: [] })
    expect(readRouteWqlConfig('/journal')).toEqual({ typeOptions: [] })
  })

  it('drops blank entries and trims values on write', async () => {
    await writeRouteWqlConfig('/journal', {
      defaultWql: '  :note last 6w  ',
      typeOptions: ['notes', '  ', 'journal'],
      groupByOptions: ['week', ''],
    })

    expect(readRouteWqlConfig('/journal')).toEqual({
      defaultWql: ':note last 6w',
      typeOptions: ['note', 'journal'],
      groupByOptions: ['week'],
    })
  })

  it('drops blank default WQL on read', () => {
    window.localStorage.setItem(getRouteWqlStorageKey('/journal'), JSON.stringify({ defaultWql: '   ' }))
    expect(readRouteWqlConfig('/journal')).toEqual({})
  })

  it('survives malformed JSON with an empty config', () => {
    window.localStorage.setItem(getRouteWqlStorageKey('/journal'), '{not json')

    expect(readRouteWqlConfig('/journal')).toEqual({})
  })

  it('resolves overrides saved under pre-rename surface ids (legacy alias)', () => {
    // Overrides saved before the /results → /sessions and /dashboard →
    // /dashboards rebrands must still resolve.
    window.localStorage.setItem(
      getRouteWqlStorageKey('/results'),
      JSON.stringify({ defaultWql: 'rows:all{} last 8w' }),
    )
    expect(readRouteWqlConfig('/sessions')).toEqual({ defaultWql: 'rows:all{} last 8w' })

    window.localStorage.setItem(
      getRouteWqlStorageKey('/dashboard'),
      JSON.stringify({ defaultWql: 'rows:all{} last 12w' }),
    )
    expect(readRouteWqlConfig('/dashboards')).toEqual({ defaultWql: 'rows:all{} last 12w' })

    // The /collections listing renamed to /feeds, then /notebooks, and the
    // old /feeds surface moved to /notes — overrides saved under either
    // retired surface id still resolve (and their WQL migrates off the
    // retired grammar onto the notebook plane).
    window.localStorage.setItem(
      getRouteWqlStorageKey('/collections'),
      JSON.stringify({ defaultWql: ':collection{} last 2w', typeOptions: ['collections'] }),
    )
    expect(readRouteWqlConfig('/notes')).toEqual({ defaultWql: ':notebook{} last 2w', typeOptions: ['notebooks'] })

    // The new key always wins when both exist
    window.localStorage.setItem(
      getRouteWqlStorageKey('/sessions'),
      JSON.stringify({ defaultWql: 'rows:all{} last 4w' }),
    )
    expect(readRouteWqlConfig('/sessions')).toEqual({ defaultWql: 'rows:all{} last 4w' })
  })

  it('the new /feeds surface stores under /feeds@2 — old notes defaults never leak into it', async () => {
    // Pre-ticket the notes list lived at /feeds: defaults saved under the
    // plain /feeds key migrate to /notes (the old surface's successor)...
    window.localStorage.setItem(
      `${ROUTE_WQL_STORAGE_PREFIX}/feeds`,
      JSON.stringify({ defaultWql: ':feed{} last 2w' }),
    )
    expect(readRouteWqlConfig('/notes')).toEqual({ defaultWql: ':notebook{} last 2w' })

    // ...while the new feed-source list at the same public URL starts fresh —
    // its storage id is versioned so the legacy notes key cannot shape it.
    expect(readRouteWqlConfig('/feeds')).toEqual({})

    // Its own writes persist under the versioned key and read back; the
    // legacy key stays untouched for the /notes migration.
    await writeRouteWqlConfig('/feeds', { defaultWql: ':feed{} last 1w' })
    expect(window.localStorage.getItem(`${ROUTE_WQL_STORAGE_PREFIX}/feeds@2`)).toContain('last 1w')
    expect(readRouteWqlConfig('/feeds')).toEqual({ defaultWql: ':notebook{} last 1w' })
    expect(readRouteWqlConfig('/notes')).toEqual({ defaultWql: ':notebook{} last 2w' })
  })

  it('never aliases the other direction — writes land on the new key only', async () => {
    await writeRouteWqlConfig('/sessions', { defaultWql: 'rows:all{} last 4w' })
    expect(window.localStorage.getItem(getRouteWqlStorageKey('/results'))).toBeNull()
  })

  it('drops non-string garbage from stored arrays', () => {
    window.localStorage.setItem(
      getRouteWqlStorageKey('/journal'),
      JSON.stringify({ typeOptions: ['notes', 42, null, 'journal'] }),
    )
    expect(readRouteWqlConfig('/journal')).toEqual({ typeOptions: ['note', 'journal'] })
  })

  it('clear removes the stored config', async () => {
    await writeRouteWqlConfig('/journal', { defaultWql: ':note last 6w' })
    await clearRouteWqlConfig('/journal')
    expect(readRouteWqlConfig('/journal')).toEqual({})
  })

  it('clear on a renamed surface also clears the legacy key — a reset must not resurrect', async () => {
    window.localStorage.setItem(
      getRouteWqlStorageKey('/results'),
      JSON.stringify({ defaultWql: 'rows:all{} last 8w' }),
    )
    await clearRouteWqlConfig('/sessions')
    expect(readRouteWqlConfig('/sessions')).toEqual({})
  })
})

describe('routeWqlConfig — narrow favorites migration (work item 3)', () => {
  it('migrates persisted plural-noun ids to canonical singular targets', () => {
    window.localStorage.setItem(
      getRouteWqlStorageKey('/feeds'),
      JSON.stringify({ typeOptions: ['notes', 'blocks', 'efforts'] }),
    )
    expect(readRouteWqlConfig('/feeds')).toEqual({ typeOptions: ['note', 'block', 'effort'] })
  })

  it('migrates the retired collections/feeds scopes to notebooks, preserving order and deduping', () => {
    window.localStorage.setItem(
      getRouteWqlStorageKey('/feeds'),
      JSON.stringify({ typeOptions: ['journal', 'notes', 'collections', 'feeds', 'journal'] }),
    )
    expect(readRouteWqlConfig('/feeds')).toEqual({ typeOptions: ['journal', 'note', 'notebooks'] })
  })

  it('migrates stored default WQL from the retired collections grammar', () => {
    // Hard break on the old spellings: heads, scope filters and type values
    // rewrite to the notebook forms; retired source-id prefixes re-address.
    window.localStorage.setItem(
      getRouteWqlStorageKey('/feeds'),
      JSON.stringify({ defaultWql: ':collection{} last 2w' }),
    )
    expect(readRouteWqlConfig('/feeds')).toEqual({ defaultWql: ':notebook{} last 2w' })

    window.localStorage.setItem(
      getRouteWqlStorageKey('/catalogs'),
      JSON.stringify({ defaultWql: ':collections{source:collections} by {tag}' }),
    )
    expect(readRouteWqlConfig('/catalogs')).toEqual({ defaultWql: ':notebooks{source:notebooks} by {tag}' })

    window.localStorage.setItem(
      getRouteWqlStorageKey('/journal'),
      JSON.stringify({ defaultWql: ':note{type:collection}' }),
    )
    expect(readRouteWqlConfig('/journal')).toEqual({ defaultWql: ':note{type:note}' })

    // The retired `catalog:` filter migrates to `notebook:` (ticket 08) and
    // retired `collection:`-prefixed source ids re-address to `notebook:`.
    window.localStorage.setItem(
      getRouteWqlStorageKey('/c/fran'),
      JSON.stringify({ defaultWql: ':feed{catalog:fran, source:collection:fran} last 4w' }),
    )
    expect(readRouteWqlConfig('/c/fran')).toEqual({
      defaultWql: ':notebook{notebook:fran, source:notebook:fran} last 4w',
    })
  })

  it('reports stored ids that are neither canonical nor migratable', () => {
    window.localStorage.setItem(
      getRouteWqlStorageKey('/journal'),
      JSON.stringify({ typeOptions: ['rows', 'journal', 'garbage'] }),
    )
    expect(readRouteWqlConfig('/journal')).toEqual({
      typeOptions: ['journal'],
      invalidTypeOptions: ['rows', 'garbage'],
    })
  })

  it('reports unsupported group-by ids without dropping the supported ones', () => {
    window.localStorage.setItem(
      getRouteWqlStorageKey('/efforts'),
      JSON.stringify({ groupByOptions: ['week', 'nonsense'] }),
    )
    expect(readRouteWqlConfig('/efforts')).toEqual({
      groupByOptions: ['week'],
      invalidGroupByOptions: ['nonsense'],
    })
  })
})

describe('routeWqlConfig — resolution', () => {
  it('overrides profile defaultWql and scopeOptions per field', async () => {
    await writeRouteWqlConfig('/feeds', { defaultWql: ':note{source:journal} last 1w' })
    const applied = applyRouteWqlConfig(FEEDS_STREAM_PROFILE)

    expect(applied.defaultWql).toBe(':note{source:journal} last 1w')
    // Unconfigured fields keep the system value.
    expect(applied.scopeOptions).toEqual(FEEDS_STREAM_PROFILE.scopeOptions)
    expect(applied.route).toBe('/feeds')
  })

  it('replaces scopeOptions wholesale, including the empty nudge state', async () => {
    await writeRouteWqlConfig('/feeds', { typeOptions: [] })
    expect(applyRouteWqlConfig(FEEDS_STREAM_PROFILE).scopeOptions).toEqual([])

    await writeRouteWqlConfig('/feeds', { typeOptions: ['guides'] })
    expect(applyRouteWqlConfig(FEEDS_STREAM_PROFILE).scopeOptions).toEqual(['guides'])
  })

  it('treats migrated target favorites as inert for the scope overlay', async () => {
    // `notes` migrates to the canonical `note` target; the route's target is
    // fixed, so only scope entries overlay. An all-target stored list leaves
    // no scope favorites — the deliberate "no predefined options" nudge.
    await writeRouteWqlConfig('/feeds', { typeOptions: ['notes'] })
    expect(applyRouteWqlConfig(FEEDS_STREAM_PROFILE).scopeOptions).toEqual([])

    await writeRouteWqlConfig('/feeds', { typeOptions: ['notes', 'journal'] })
    expect(applyRouteWqlConfig(FEEDS_STREAM_PROFILE).scopeOptions).toEqual(['journal'])
  })

  it('returns the same profile object when no config exists', () => {
    expect(applyRouteWqlConfig(FEEDS_STREAM_PROFILE)).toBe(FEEDS_STREAM_PROFILE)
  })

  it('carries the Group-By favorites onto the profile', async () => {
    await writeRouteWqlConfig('/feeds', { groupByOptions: ['week', 'discipline'] })
    expect(applyRouteWqlConfig(FEEDS_STREAM_PROFILE).groupByOptions).toEqual(['week', 'discipline'])
  })

  it('exposes the palette as a configurable synthetic route id', async () => {
    expect(PALETTE_ROUTE_ID).toBe('/palette')
    await writeRouteWqlConfig(PALETTE_ROUTE_ID, { defaultWql: ':note{text:fran}' })
    expect(readRouteWqlConfig(PALETTE_ROUTE_ID).defaultWql).toBe(':note{text:fran}')
  })
})

describe('routeWqlConfig — reactivity', () => {
  it('notifies subscribers when a config is written', async () => {
    let notified = 0
    const unsubscribe = subscribeRouteWqlConfig(() => {
      notified += 1
    })

    await writeRouteWqlConfig('/journal', { defaultWql: ':note last 6w' })
    expect(notified).toBe(1)

    unsubscribe()
    await writeRouteWqlConfig('/journal', { defaultWql: ':note last 8w' })
    expect(notified).toBe(1)
  })

  it('notifies subscribers when a config is cleared', async () => {
    await writeRouteWqlConfig('/journal', { defaultWql: ':note last 6w' })
    let notified = 0
    const unsubscribe = subscribeRouteWqlConfig(() => {
      notified += 1
    })

    await clearRouteWqlConfig('/journal')
    expect(notified).toBe(1)
    unsubscribe()
  })

  it('bumps the version on every write, so live consumers re-read', async () => {
    const before = routeWqlConfigVersion()
    await writeRouteWqlConfig('/journal', { defaultWql: ':note last 6w' })
    expect(routeWqlConfigVersion()).toBeGreaterThan(before)
  })
})

describe('routeWqlConfig — type shape', () => {
  it('stores only the three override fields', async () => {
    const config: RouteWqlConfig = { defaultWql: ':note', typeOptions: ['notes'], groupByOptions: ['week'] }
    await writeRouteWqlConfig('/feeds', config)
    expect(Object.keys(readRouteWqlConfig('/feeds')).sort()).toEqual([
      'defaultWql',
      'groupByOptions',
      'typeOptions',
    ])
  })
})

describe('routeWqlConfig — dependency inversion', () => {
  it('operates against an injected InMemoryBackend without window globals', async () => {
    const inMemory = new LocalStore(ROUTE_WQL_STORAGE_PREFIX, new InMemoryBackend())
    await writeRouteWqlConfig('/custom', { defaultWql: ':note{source:journal}' }, inMemory)
    expect(readRouteWqlConfig('/custom', inMemory).defaultWql).toBe(':note{source:journal}')
    await clearRouteWqlConfig('/custom', inMemory)
    expect(readRouteWqlConfig('/custom', inMemory)).toEqual({})
  })
})
