import { describe, it, expect } from 'bun:test'
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine'
import {
  JOURNAL_STREAM_PROFILE,
  NOTEBOOKS_STREAM_PROFILE,
  NOTES_STREAM_PROFILE,
  FEEDS_STREAM_PROFILE,
  PAGES_STREAM_PROFILE,
  EFFORTS_STREAM_PROFILE,
  EQUIPMENT_STREAM_PROFILE,
  TAGS_STREAM_PROFILE,
  SESSIONS_STREAM_PROFILE,
  PLAYGROUNDS_STREAM_PROFILE,
  getStreamProfile,
  resolveStreamProfile,
  isStreamRoute,
  streamRouteTitle,
} from './streamProfile'

describe('streamProfile', () => {
  it('every stream default WQL parses — requested defaults are executable', () => {
    for (const profile of [
      JOURNAL_STREAM_PROFILE,
      NOTEBOOKS_STREAM_PROFILE,
      NOTES_STREAM_PROFILE,
      FEEDS_STREAM_PROFILE,
      PAGES_STREAM_PROFILE,
      EFFORTS_STREAM_PROFILE,
      EQUIPMENT_STREAM_PROFILE,
      TAGS_STREAM_PROFILE,
      SESSIONS_STREAM_PROFILE,
      PLAYGROUNDS_STREAM_PROFILE,
    ]) {
      const parsed = parseQuery(profile.defaultWql)
      expect(parsed.error).toBeUndefined()
    }
  })

  it('carries a display title per stream surface — deriveWorkout reads these', () => {
    expect(JOURNAL_STREAM_PROFILE.title).toBe('Journal')
    expect(NOTES_STREAM_PROFILE.title).toBe('Notes')
    expect(NOTEBOOKS_STREAM_PROFILE.title).toBe('Notebooks')
    expect(FEEDS_STREAM_PROFILE.title).toBe('Feeds')
    expect(PAGES_STREAM_PROFILE.title).toBe('Pages')
    expect(EFFORTS_STREAM_PROFILE.title).toBe('Efforts')
    expect(EQUIPMENT_STREAM_PROFILE.title).toBe('Equipment')
    expect(TAGS_STREAM_PROFILE.title).toBe('Tags')
    expect(SESSIONS_STREAM_PROFILE.title).toBe('Sessions')
    expect(PLAYGROUNDS_STREAM_PROFILE.title).toBe('Playgrounds')
  })

  it('the journal default is a copyable note-plane query grouped by date', () => {
    // The landing query is plain `:note{…} by {date}` — anyone can copy the
    // URL's `?q=` and reproduce the same list, grouping included.
    const parsed = parseQuery(JOURNAL_STREAM_PROFILE.defaultWql)
    if (!isFindQuery(parsed)) throw new Error('journal default must be a find query')
    expect(parsed.target).toBe('note')
    expect(parsed.groupBy).toEqual(['date'])
    expect(JOURNAL_STREAM_PROFILE.defaultWql).toContain('notebook:journal')
  })

  it('the tags surface binds the tag plane — one row per tag, no storage scope', () => {
    expect(TAGS_STREAM_PROFILE.route).toBe('/tags')
    expect(TAGS_STREAM_PROFILE.target).toBe('tag')
    expect(TAGS_STREAM_PROFILE.defaultWql).toBe(':tag{}')
    expect(TAGS_STREAM_PROFILE.scopeOptions).toEqual([])
    expect(isStreamRoute('/tags')).toBe(true)
    expect(getStreamProfile('/tags')).toBe(TAGS_STREAM_PROFILE)
    expect(streamRouteTitle('/tags')).toBe('Tags')
  })

  it('owns stream-surface membership — isStreamRoute is the single registry', () => {
    // every profile route is a stream surface
    expect(isStreamRoute('/journal')).toBe(true)
    expect(isStreamRoute('/notes')).toBe(true)
    expect(isStreamRoute('/notebooks')).toBe(true)
    expect(isStreamRoute('/feeds')).toBe(true)
    expect(isStreamRoute('/pages')).toBe(true)
    expect(isStreamRoute('/efforts')).toBe(true)
    expect(isStreamRoute('/sessions')).toBe(true)
    expect(isStreamRoute('/playgrounds')).toBe(true)
    // trailing slashes normalize
    expect(isStreamRoute('/journal/')).toBe(true)
    // dynamic stream routes
    expect(isStreamRoute('/results/res-42')).toBe(true)
    expect(isStreamRoute('/session/2026-09-17')).toBe(true)
    expect(isStreamRoute('/notebook/dan-john')).toBe(true)
    expect(isStreamRoute('/notebook/dan-john/fran')).toBe(false)
    // retired bare results paths are not streams — the router 404s them
    expect(isStreamRoute('/results')).toBe(false)
    // /sessions/:id is retired — only the bare list remains
    expect(isStreamRoute('/sessions/res-42')).toBe(false)
    // non-stream routes stay out
    expect(isStreamRoute('/settings/appearance')).toBe(false)
    expect(isStreamRoute('/playground/abc')).toBe(false)
    expect(isStreamRoute('/note/some-id')).toBe(false)
    expect(isStreamRoute('/dashboard')).toBe(false)
  })

  it('resolves stream profile by route using getStreamProfile and resolveStreamProfile', () => {
    expect(getStreamProfile('/journal')?.route).toBe('/journal')
    expect(getStreamProfile('/journal/')?.route).toBe('/journal')
    expect(getStreamProfile('/notebooks')?.route).toBe('/notebooks')
    expect(getStreamProfile('/notes')?.route).toBe('/notes')
    expect(getStreamProfile('/feeds')?.route).toBe('/feeds')
    expect(getStreamProfile('/pages')?.route).toBe('/pages')
    expect(getStreamProfile('/efforts')?.route).toBe('/efforts')
    expect(getStreamProfile('/sessions')?.route).toBe('/sessions')
    expect(getStreamProfile('/playgrounds')?.route).toBe('/playgrounds')

    // getStreamProfile returns undefined for unknown routes
    expect(getStreamProfile('/unknown')).toBeUndefined()

    // the generic fallback is the conservative journal surface
    expect(resolveStreamProfile('/unknown')).toBe(JOURNAL_STREAM_PROFILE)
  })
  it('dynamically resolves the notebook stream profile for /notebook/:slug', () => {
    const profile = getStreamProfile('/notebook/dan-john')
    expect(profile).toBeDefined()
    expect(profile?.route).toBe('/notebook/dan-john')
    expect(profile?.title).toBe('Dan John')
    expect(profile?.defaultWql).toBe(':note{notebook:dan-john} by {date}')
    expect(profile?.notebookSlug).toBe('dan-john')
    expect(profile?.defaultLayout).toBe('cards')
    expect(profile?.level).toBe('session')
  })


  it('dynamically resolves the result detail stream profile for /results/:sessionId', () => {
    const detail = getStreamProfile('/results/res-42')
    expect(detail).toBeDefined()
    expect(detail?.route).toBe('/results/res-42')
    expect(detail?.defaultWql).toBe(':session{result:res-42, plane:segment}')
    expect(detail?.level).toBe('segment')
    expect(detail?.target).toBe('session')

    // Trailing slash normalizes
    const trailing = getStreamProfile('/results/res-42/')
    expect(trailing?.route).toBe('/results/res-42')

    // resolveStreamProfile returns the dynamic profile
    expect(resolveStreamProfile('/results/res-99').defaultWql).toBe(':session{result:res-99, plane:segment}')
  })

  it('dynamically resolves a date-scoped sessions profile for /session/:date', () => {
    const byDate = getStreamProfile('/session/2026-09-17')
    expect(byDate).toBeDefined()
    expect(byDate?.route).toBe('/session/2026-09-17')
    expect(byDate?.defaultWql).toBe(':session{} from 2026-09-17 to 2026-09-17')
    expect(byDate?.level).toBe('result')
    expect(byDate?.target).toBe('session')
  })

  it('migrates legacy content parameters with default source', () => {
    const journalLegacy = JOURNAL_STREAM_PROFILE.legacy!
    expect(journalLegacy).toBeDefined()
    expect(journalLegacy.toQuery(new URLSearchParams('text=snatch'))).toBe(':journal{text:snatch} last 2w')
    expect(journalLegacy.toQuery(new URLSearchParams('text=snatch+clean&timePreset=4w'))).toBe(':journal{text:"snatch clean"} last 4w')
    expect(journalLegacy.toQuery(new URLSearchParams('timePreset=all'))).toBe(':journal')
  })

  it('migrates legacy tri-state parameters', () => {
    const feedsLegacy = FEEDS_STREAM_PROFILE.legacy!
    expect(feedsLegacy).toBeDefined()
    expect(feedsLegacy.toQuery(new URLSearchParams('note=on&session=hide&post=hide'))).toBe(':journal last 2w')
    expect(feedsLegacy.toQuery(new URLSearchParams('note=hide&session=on&post=hide'))).toBe(':notebooks last 2w')
    // `post` mapped to the feeds WQL scope — excised, so it no longer narrows.
    const postOnly = parseQuery(feedsLegacy.toQuery(new URLSearchParams('note=hide&session=hide&post=on')) ?? '')
    expect(isFindQuery(postOnly)).toBe(true)
    if (isFindQuery(postOnly)) {
      expect(postOnly.filters.filter((f) => f.key === 'source')).toHaveLength(0)
      expect(postOnly.window).toEqual({ kind: 'relative', size: 2, unit: 'w' })
    }
  })

  it('migrates legacy efforts parameters and salvages plain text query', () => {
    const effortsLegacy = EFFORTS_STREAM_PROFILE.legacy!
    expect(effortsLegacy).toBeDefined()
    expect(effortsLegacy.toQuery(new URLSearchParams('origin=bundled&discipline=strength'))).toBe(':effort{origin:bundled,discipline:strength}')
    expect(effortsLegacy.salvageQ?.('pull-up', new URLSearchParams())).toBe(':effort{text:pull-up}')
    expect(effortsLegacy.salvageQ?.('handstand push-up', new URLSearchParams('origin=user'))).toBe(':effort{text:"handstand push-up",origin:user}')
    expect(effortsLegacy.salvageQ?.(':effort', new URLSearchParams())).toBeNull()
  })
})

describe('NOTEBOOKS_STREAM_PROFILE default query (ticket 08)', () => {
  it('defaults to subscribed notebooks grouped by feed', () => {
    expect(NOTEBOOKS_STREAM_PROFILE.defaultWql).toBe(':notebook{subscribed:true} by {feed}')
    expect(NOTEBOOKS_STREAM_PROFILE.target).toBe('note')
    const parsed = parseQuery(NOTEBOOKS_STREAM_PROFILE.defaultWql)
    expect(parsed.error).toBeUndefined()
    // The grouping dimension the stream view consumes.
    expect(isFindQuery(parsed) && parsed.groupBy).toEqual(['feed'])
  })

  it('the default query runs against the notebook plane and returns notes', async () => {
    const { QueryService } = await import('@bitcobblers/wod-wiki-engine')
    const notes = [
      { id: 'journal/2026-10-26', title: 'Morning', seedOrigin: 'user', sourceId: 'journal', tags: ['benchmark'], createdAt: 1, rawContent: '', sourceRevision: 1, blocks: {} },
      { id: 'crossfit-girls/fran', title: 'Fran', seedOrigin: 'seed', sourceId: 'notebook:crossfit-girls/fran', tags: ['benchmark'], createdAt: 2, rawContent: '', sourceRevision: 1, blocks: {} },
      { id: 'pg-1', title: 'Draft', seedOrigin: 'user', sourceId: 'playground', tags: ['emom'], createdAt: 3, rawContent: '', sourceRevision: 1, blocks: {} },
    ]
    const service = new QueryService({
      eventStore: { getEventsByTimeRange: async () => [], getEventsByResult: async () => [] },
      noteStore: { getAllNotes: async () => notes, getNoteIdsForTag: async () => new Set() },
      blockStore: { getAllBlocks: async () => [] },
    } as never)
    const result = await service.runFind(parseQuery(NOTEBOOKS_STREAM_PROFILE.defaultWql) as never)
    // Notes from every notebook, tagged so the stream view can group them —
    // never synthetic notebook/container rows.
    expect(result.notes.map((n) => n.id).sort()).toEqual(['crossfit-girls/fran', 'journal/2026-10-26', 'pg-1'])
    expect(result.notes.every((n) => !n.id.startsWith('notebook/'))).toBe(true)
  })
})
