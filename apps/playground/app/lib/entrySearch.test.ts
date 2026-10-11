/**
 * searchEntries — :block emits one Entry per block (parent identity +
 * block payload, #855) in executor order: pipes (order/limit) are applied
 * upstream and the stream must not re-sort presentation. :note behavior
 * is unchanged (whole-note entries, blocks only expand text hits) — but its
 * stage counts describe the actual mapped union.
 */
import { describe, expect, it, mock } from 'bun:test'

import type { FindQueryResult, ParsedRowsQuery, RowsQueryResult } from '@bitcobblers/wod-wiki-engine'
import type { BlockIndexRow, Note } from '@/types/storage'
import { parseQuery, type ParsedFindQuery } from '@bitcobblers/wod-wiki-engine'
import type { IEffort, RowsRun } from '@bitcobblers/wod-wiki-wql'
import type { EventRecord } from '@bitcobblers/wod-wiki-core'
import { InMemoryStorage, setStorageForTesting, resetStorageForTesting, storageService } from '@/services/storage'
import { entryOpenHref } from './entryActions'
function makeBlock(i: number, createdAt = i): BlockIndexRow {
  return {
    id: `static:note-${i % 5}:seg-${i}:1`,
    noteId: `feeds/feed-a/2026-01-1${i % 5}/note-${i % 5}`,
    segmentId: `seg-${i}`,
    segmentVersion: 1,
    position: 0,
    dataType: 'wod',
    rawContent: `block ${i} content`,
    noteTitle: `Note ${i % 5}`,
    createdAt,
    isStatic: true,
    sourceId: `feed:feeds/feed-a/2026-01-1${i % 5}/note-${i % 5}`,
  } as BlockIndexRow
}

let runFindImpl: (parsed: ParsedFindQuery) => Promise<FindQueryResult>
let runFindEffortImpl: ((parsed: ParsedFindQuery) => Promise<FindQueryResult>) | undefined

mock.module('@/services/queryService', () => ({
  queryService: {
    runFind: mock((parsed: ParsedFindQuery) => runFindImpl(parsed)),
    runFindEffort: mock((parsed: ParsedFindQuery) => runFindEffortImpl ? runFindEffortImpl(parsed) : runFindImpl(parsed)),
    runRows: mock((parsed: ParsedRowsQuery): Promise<RowsQueryResult> => Promise.resolve({ parsed, runs: [] })),
  },
  indexedDbBlockStore: { getAllBlocks: async () => [] },
  indexedDbNoteStore: { getAllNotes: async () => [] },
  ensurePageSources: async () => {},
  refreshPageSources: async () => {},
}))

const { searchEntries, StreamQueryEngine } = await import('./entrySearch')

function blockResult(raw: string, blocks: BlockIndexRow[]): FindQueryResult {
  return {
    parsed: parseQuery(raw) as ParsedFindQuery,
    notes: [],
    blocks,
    stages: { selected: blocks.length, matched: blocks.length },
  }
}

describe('searchEntries — :block (#855, #861)', () => {
  it('emits one Entry per block with parent identity and block payload, in executor order', async () => {
    const blocks = [makeBlock(0, 100), makeBlock(1, 200)]
    runFindImpl = async parsed => blockResult(parsed.raw, blocks)

    const entries = await searchEntries(':block in all')
    expect(entries).toHaveLength(2)
    // Executor order is presentation order — no local re-sort.
    expect(entries[0]!.block?.segmentId).toBe('seg-0')
    for (const entry of entries) {
      expect(entry.kind).toBe('post')
      expect(entry.block?.dataType).toBe('wod')
      // Parent identity preserved for Open / Add-to-today.
      expect(entry.id).toMatch(/^feeds\/feed-a\//)
    }
  })

  it('returns the full set — rendering batches at the page, not the pipeline (#861)', async () => {
    const blocks = Array.from({ length: 500 }, (_, i) => makeBlock(i, i))
    runFindImpl = async parsed => blockResult(parsed.raw, blocks)

    const entries = await searchEntries(':block in all')
    expect(entries).toHaveLength(500)
    expect(entries[0]!.block?.segmentId).toBe('seg-0')
  })
})

describe('searchEntries — :note unchanged', () => {
  it('still returns whole-note entries for note queries', async () => {
    runFindImpl = async parsed => ({
      parsed,
      notes: [{ id: 'n-1', title: 'Note 1', createdAt: 1, type: 'note' } as never],
      blocks: [],
      stages: { selected: 1, matched: 1 },
    })

    const entries = await searchEntries(':note in all')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe('note')
    expect(entries[0]!.block).toBeUndefined()
  })
})

describe('StreamQueryEngine — secondary text search for :note', () => {
  it('searches block bodies when text: filter is present and combines with notes', async () => {
    const calls: ParsedFindQuery[] = []
    runFindImpl = async parsed => {
      calls.push(parsed)
      if (parsed.target === 'block') {
        return {
          parsed,
          notes: [],
          blocks: [makeBlock(1, 200)],
          stages: { selected: 1, matched: 1 },
        }
      }
      return {
        parsed,
        notes: [{ id: 'note-0', title: 'Note 0', createdAt: 100, type: 'note' } as never],
        blocks: [],
        stages: { selected: 1, matched: 1 },
      }
    }

    const engine = new StreamQueryEngine()
    const entries = await engine.query(':note{text:squat} in all')
    expect(calls).toHaveLength(2)
    expect(calls[0]!.target).toBe('note')
    expect(calls[1]!.target).toBe('block')
    expect(entries).toHaveLength(2)
  })

  it('handles AST input directly for :note with text: filter', async () => {
    const calls: ParsedFindQuery[] = []
    runFindImpl = async parsed => {
      calls.push(parsed)
      return {
        parsed,
        notes: [{ id: 'n-ast', title: 'AST Note', createdAt: 100, type: 'note' } as never],
        blocks: [],
        stages: { selected: 1, matched: 1 },
      }
    }

    const ast = parseQuery(':note{text:thruster} in all')
    const entries = await searchEntries(ast)
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.title).toBe('AST Note')
  })
})

describe('StreamQueryEngine — note block info (feed previews)', () => {
  it('attaches excerpt lines and the first wod blockContentId per note, same scope', async () => {
    const calls: ParsedFindQuery[] = []
    runFindImpl = async parsed => {
      calls.push(parsed)
      if (parsed.target === 'block') {
        return {
          parsed,
          notes: [],
          blocks: [
            { ...makeBlock(1, 200), noteId: 'note-0', rawContent: '21-15-9\nThrusters', position: 0, blockContentId: 'wod-1' },
            { ...makeBlock(2, 200), noteId: 'note-0', rawContent: 'Pull-ups', position: 1, blockContentId: undefined },
          ],
          stages: { selected: 2, matched: 2 },
        }
      }
      return {
        parsed,
        notes: [{ id: 'note-0', title: 'Note 0', createdAt: 100, type: 'playground', sourceId: 'playground' } as never],
        blocks: [],
        stages: { selected: 1, matched: 1 },
      }
    }

    const engine = new StreamQueryEngine({ noteBlockInfo: true })
    const entries = await engine.query(':note{source:playground}')

    // One companion query, identical scope (only the target pivots).
    expect(calls).toHaveLength(2)
    expect(calls[0]!.target).toBe('note')
    expect(calls[1]!.target).toBe('block')
    expect(calls[1]!.filters).toEqual(calls[0]!.filters)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.excerpt).toEqual(['21-15-9', 'Thrusters', 'Pull-ups'])
    expect(entries[0]!.blockContentId).toBe('wod-1')
    expect(entries[0]!.wodBlock).toEqual({ blockContentId: 'wod-1', content: '21-15-9\nThrusters' })
  })

  it('does not run the companion query by default', async () => {
    const calls: ParsedFindQuery[] = []
    runFindImpl = async parsed => {
      calls.push(parsed)
      return {
        parsed,
        notes: [{ id: 'note-0', title: 'Note 0', createdAt: 100, type: 'note' } as never],
        blocks: [],
        stages: { selected: 1, matched: 1 },
      }
    }

    const engine = new StreamQueryEngine()
    const entries = await engine.query(':note in all')
    expect(calls).toHaveLength(1)
    expect(entries[0]!.excerpt).toBeUndefined()
  })

  it('withNoteBlockInfo forks the same engine with the flag on', async () => {
    runFindImpl = async parsed => {
      if (parsed.target === 'block') {
        return {
          parsed,
          notes: [],
          blocks: [{ ...makeBlock(1, 200), noteId: 'note-0', rawContent: 'Grace' }],
          stages: { selected: 1, matched: 1 },
        }
      }
      return {
        parsed,
        notes: [{ id: 'note-0', title: 'Note 0', createdAt: 100, type: 'note' } as never],
        blocks: [],
        stages: { selected: 1, matched: 1 },
      }
    }

    const base = new StreamQueryEngine()
    const forked = base.withNoteBlockInfo()
    const entries = await forked.query(':note in all')
    expect(entries[0]!.excerpt).toEqual(['Grace'])
  })
})

describe('StreamQueryEngine — effort plane (:effort)', () => {
  const effortSample: IEffort = {
    id: 'eff-1',
    slug: 'back-squat',
    label: 'Back Squat',
    aliases: ['BS'],
    baseAttributes: {
      discipline: 'strength',
      met: 6.0,
      intensityTier: 'high',
    },
    registrySource: 'bundled',
  }

  it('dispatches :effort to runFindEffort and maps to effort entries', async () => {
    let effortCalled = false
    runFindEffortImpl = async parsed => {
      effortCalled = true
      return {
        parsed,
        notes: [],
        blocks: [],
        efforts: [effortSample],
        stages: { selected: 1, matched: 1 },
      }
    }

    const engine = new StreamQueryEngine()
    const entries = await engine.query(':effort in all')
    expect(effortCalled).toBe(true)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe('effort')
    expect(entries[0]!.title).toBe('Back Squat')
    expect(entries[0]!.subtitle).toBe('strength • MET 6.0 • high')
    expect(entries[0]!.effort?.slug).toBe('back-squat')
  })

  it('accepts AST for :effort', async () => {
    runFindEffortImpl = async parsed => ({
      parsed,
      notes: [],
      blocks: [],
      efforts: [effortSample],
      stages: { selected: 1, matched: 1 },
    })

    const ast = parseQuery(':effort{discipline:strength} in all')
    const entries = await searchEntries(ast)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe('effort')
  })
})

describe('StreamQueryEngine — telemetry plane (rows:)', () => {
  const timestamp = new Date('2026-08-15T10:00:00Z').getTime()
  const sampleRun: RowsRun = {
    resultId: 'res-42',
    noteId: 'crossfit-girls/fran',
    timestamp,
    events: [
      {
        id: 'res-42:0',
        resultId: 'res-42',
        noteId: 'crossfit-girls/fran',
        timestamp,
        grain: 'event',
        outputType: 'segment',
        effortSlug: 'thruster',
        timeSpan: { started: timestamp, ended: timestamp + 100_000 },
        metrics: [{ type: 'rep', value: 21 }, { type: 'weight', value: 95 }],
      } as EventRecord,
      {
        id: 'res-42:1',
        resultId: 'res-42',
        noteId: 'crossfit-girls/fran',
        timestamp: timestamp + 100_000,
        grain: 'event',
        outputType: 'segment',
        effortSlug: 'pull-up',
        timeSpan: { started: timestamp + 100_000, ended: timestamp + 180_000 },
        metrics: [{ type: 'rep', value: 21 }, { type: 'tis', value: 8.5 }],
      } as EventRecord,
    ],
  }

  it('dispatches :session to runFind and maps to session-level result entries', async () => {
    runFindImpl = async parsed => ({
      parsed,
      runs: [sampleRun],
      notes: [],
      blocks: [],
      stages: { selected: 1, matched: 1 },
    })

    const entries = await searchEntries(':session{result:res-42}')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe('result')
    expect(entries[0]!.id).toBe('res-42')
    expect(entries[0]!.date).toBe('2026-08-15')
    expect(entries[0]!.title).toBe('Fran')
    expect(entries[0]!.execution?.segmentCount).toBe(2)
    expect(entries[0]!.execution?.reps).toBe(42)
  })

  it('dispatches :session with plane:segment to segment-level entries', async () => {
    runFindImpl = async parsed => ({
      parsed,
      runs: [sampleRun],
      notes: [],
      blocks: [],
      stages: { selected: 1, matched: 1 },
    })

    const entries = await searchEntries(':session{result:res-42, plane:segment}')
    expect(entries).toHaveLength(2)
    expect(entries[0]!.kind).toBe('segment')
    expect(entries[0]!.id).toBe('res-42:0')
    expect(entries[0]!.title).toBe('Thruster')
    expect(entries[1]!.kind).toBe('segment')
    expect(entries[1]!.id).toBe('res-42:1')
    expect(entries[1]!.title).toBe('Pull Up')
  })

  it('resolves note titles via noteTitleResolver in StreamQueryEngine options', async () => {
    runFindImpl = async parsed => ({
      parsed,
      runs: [sampleRun],
      notes: [],
      blocks: [],
      stages: { selected: 1, matched: 1 },
    })

    const engine = new StreamQueryEngine({
      noteTitleResolver: async noteId => (noteId === 'crossfit-girls/fran' ? 'Custom Fran Title' : undefined),
    })

    const entries = await engine.query(':session{result:res-42}')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.title).toBe('Custom Fran Title')
  })
})

describe('StreamQueryEngine — tag hydration (:note)', () => {
  it('hydrates tags via noteTagsResolver in StreamQueryEngine options', async () => {
    runFindImpl = async () => ({
      parsed: {} as never,
      notes: [{ id: 'note-1', title: 'Fran', createdAt: 1000, type: 'note' } as Note],
      blocks: [],
      stages: { selected: 1, matched: 1 },
    })

    const engine = new StreamQueryEngine({
      noteTagsResolver: async (noteId) => (noteId === 'note-1' ? ['benchmark', 'crossfit'] : []),
    })

    const entries = await engine.query(':note in all')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.tags).toEqual(['benchmark', 'crossfit'])
  })
})

describe('StreamQueryEngine — error and unsupported query handling', () => {
  it('returns empty array on parse error', async () => {
    const entries = await searchEntries(':invalid query syntax {}}')
    expect(entries).toEqual([])
  })

  it('returns empty array on aggregate query (not supported by stream intake)', async () => {
    const entries = await searchEntries('sum:totalVolume{discipline:strength}')
    expect(entries).toEqual([])
  })

  it('returns empty array on empty query string', async () => {
    const entries = await searchEntries('')
    expect(entries).toEqual([])
  })
})

describe('StreamQueryEngine — tabular rows plane (:segment / :event, #1042)', () => {
  function tableResult(parsed: ParsedFindQuery): FindQueryResult {
    return {
      parsed,
      notes: [],
      blocks: [],
      table: {
        columns: [],
        rows: [
          { date: '2026-08-15', effort: 'thruster', __id: 'row-1', __resultId: 'res-42' },
          { date: '2026-08-16', __id: 'row-2', __resultId: 'res-42' },
        ],
        totalCount: 2,
      },
      stages: { selected: 9, matched: 2 },
    }
  }

  it('maps result.table rows to entries — executor order, ids preserved, no noteMap fallback', async () => {
    runFindImpl = async parsed => tableResult(parsed)

    const entries = await searchEntries(':segment{result:res-42}')
    expect(entries).toHaveLength(2)
    expect(entries[0]!.kind).toBe('segment')
    expect(entries[0]!.id).toBe('row-1')
    expect(entries[0]!.date).toBe('2026-08-15')
    expect(entries[0]!.title).toBe('Thruster')
    expect(entries[0]!.sourceItem).toBe('res-42')
    expect(entries[1]!.id).toBe('row-2')
    expect(entries[1]!.title).toBe('Segment 2')
  })

  it('reports union-honest stage counts: matched = mapped rows, selected never below it', async () => {
    runFindImpl = async parsed => tableResult(parsed)

    let stages: { selected: number; matched: number } | undefined
    await searchEntries(':segment{result:res-42}', undefined, next => { stages = next })
    expect(stages).toEqual({ selected: 9, matched: 2 })
  })
})

describe('StreamQueryEngine — stage counts reconcile the companion union', () => {
  it('matched counts the actual note union when body companions widen the result', async () => {
    runFindImpl = async parsed => {
      if (parsed.target === 'block') {
        return {
          parsed,
          notes: [],
          blocks: [
            { ...makeBlock(1, 200), noteId: 'note-0' },
            { ...makeBlock(2, 200), noteId: 'note-extra' },
          ],
          stages: { selected: 2, matched: 2 },
        }
      }
      return {
        parsed,
        notes: [{ id: 'note-0', title: 'Note 0', createdAt: 100, type: 'note' } as never],
        blocks: [],
        stages: { selected: 1, matched: 1 },
      }
    }

    let stages: { selected: number; matched: number } | undefined
    const engine = new StreamQueryEngine()
    const entries = await engine.query(':note{text:squat}', next => { stages = next })
    // Two notes render (primary + companion-only), so matched is 2 — and
    // selected (scope population) never drops below the union.
    expect(entries).toHaveLength(2)
    expect(stages).toEqual({ selected: 2, matched: 2 })
  })
})

describe('StreamQueryEngine — blank block noteTitle', () => {
  it('fills a body-hit entry label from the real note record', async () => {
    const memory = new InMemoryStorage()
    setStorageForTesting(memory)
    try {
      const note: Note = { id: 'note-uuid', title: 'Dogfod smoke original', type: 'note', createdAt: 1 }
      await storageService.saveNote(note)
      // First-save indexing runs before the note row exists, so block rows
      // can carry an empty noteTitle.
      const block = { ...makeBlock(0), noteId: note.id, noteTitle: '', sourceId: undefined }
      const engine = new StreamQueryEngine({
        service: { runFind: async parsed => ({ parsed, notes: [], blocks: parsed.target === 'block' ? [block] : [], stages: { selected: 1, matched: 1 } }) },
      })
      const entries = await engine.query(':note{text:pushup} in all')
      expect(entries.map(e => e.id)).toEqual([note.id])
      expect(entries[0]!.title).toBe('Dogfod smoke original')
    } finally {
      resetStorageForTesting()
      await memory.close()
    }
  })
})

describe('StreamQueryEngine — named page navigation', () => {
  it('opens note and block hits by the first named page slug, not a calendar page UUID', async () => {
    const memory = new InMemoryStorage()
    setStorageForTesting(memory)
    try {
      const note: Note = { id: 'note-uuid', title: 'Workout plan', type: 'note', createdAt: 1 }
      const block = { ...makeBlock(0), noteId: note.id, noteTitle: note.title, sourceId: undefined }
      await storageService.savePage({ id: 'calendar-uuid', date: '2026-10-08', createdAt: 1 })
      await storageService.savePage({ id: 'named-uuid', slug: 'workout-plan', createdAt: 2 })
      await storageService.savePage({ id: 'other-uuid', slug: 'other-plan', createdAt: 3 })
      await storageService.addNoteToPage(note.id, 'calendar-uuid', 0)
      await storageService.addNoteToPage(note.id, 'other-uuid', 2)
      await storageService.addNoteToPage(note.id, 'named-uuid', 1)
      const engine = new StreamQueryEngine({
        service: { runFind: async parsed => ({ parsed, notes: parsed.target === 'note' ? [note] : [], blocks: parsed.target === 'block' ? [block] : [], stages: { selected: 1, matched: 1 } }) },
      })
      for (const query of [':note in all', ':block in all']) {
        const entries = await engine.query(query)
        expect(entries[0]?.pageId).toBe('calendar-uuid')
        expect(entryOpenHref(entries[0]!)).toBe(query.startsWith(':block') ? '/p/workout-plan#seg-0' : '/p/workout-plan')
        expect(entries[0]?.noteId).toBe(note.id)
      }
    } finally {
      resetStorageForTesting()
      await memory.close()
    }
  })
})
