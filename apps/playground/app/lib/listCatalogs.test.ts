/**
 * listCatalogs tests (#813 slice 12) — the catalog list for the
 * WQL Composer Panel's `+ Filter → Catalog` menu. Derived from the
 * static-block-index: one entry per distinct first path segment of
 * `noteId`, with the `feeds/` wrapper stripped. Plus the synthetic
 * `'journal'` for the journal-side filter.
 */
import { describe, it, expect } from 'bun:test'
import { listCatalogs } from './listCatalogs'
import type { BlockIndexRow } from '@/types/storage'

const TS = 1_700_000_000_000
function makeBlock(noteId: string, sourceId?: string): BlockIndexRow {
  return {
    id: `${noteId}:s`,
    noteId,
    blockId: 's',
    blockVersion: 1,
    sourceRevision: 1,
    from: 0,
    to: 1,
    dataType: 'wod',
    rawContent: '',
    noteTitle: noteId,
    createdAt: TS,
    isStatic: true,
    sourceId,
  }
}

describe('listCatalogs', () => {
  it('returns one entry per distinct first path segment for collections', () => {
    const blocks = [
      makeBlock('crossfit-girls/fran', 'collection:crossfit-girls/fran'),
      makeBlock('crossfit-girls/cindy', 'collection:crossfit-girls/cindy'),
      makeBlock('zombiefit/2009-12-01', 'collection:zombiefit/2009-12-01'),
    ]
    expect(listCatalogs(blocks)).toEqual([
      { id: 'crossfit-girls', name: 'crossfit-girls' },
      { id: 'zombiefit', name: 'zombiefit' },
    ])
  })

  it('strips the feeds/ wrapper to extract the catalog dir for feed rows', () => {
    const blocks = [
      makeBlock('feeds/crossfit-programming/2026-01-12/monday', 'feed:feeds/crossfit-programming/2026-01-12/monday'),
      makeBlock('feeds/dan-john-40-day/2026-01-12/day-2', 'feed:feeds/dan-john-40-day/2026-01-12/day-2'),
    ]
    expect(listCatalogs(blocks)).toEqual([
      { id: 'crossfit-programming', name: 'crossfit-programming' },
      { id: 'dan-john-40-day', name: 'dan-john-40-day' },
    ])
  })

  it('returns an empty list for a corpus with no static blocks', () => {
    expect(listCatalogs([])).toEqual([])
  })

  it('sorts catalogs alphabetically', () => {
    const blocks = [
      makeBlock('zebra/session', 'collection:zebra/session'),
      makeBlock('alpha/session', 'collection:alpha/session'),
      makeBlock('mike/session', 'collection:mike/session'),
    ]
    expect(listCatalogs(blocks).map(c => c.id)).toEqual(['alpha', 'mike', 'zebra'])
  })

  it('does not include the synthetic journal entry (the panel adds it separately)', () => {
    // Note: a real journal note is not in block_index; this test asserts the
    // helper does not fabricate a 'journal' catalog.
    const blocks = [makeBlock('crossfit-girls/fran', 'collection:crossfit-girls/fran')]
    expect(listCatalogs(blocks).find(c => c.id === 'journal')).toBeUndefined()
  })
})
