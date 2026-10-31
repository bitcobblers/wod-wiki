/**
 * toEntry mapper tests (#813 slice 7) — converts the engine's Note[] into
 * the Library's Entry[]. The mapper is the single place that touches
 * `sourceId` discrimination; the rest of the Library never inspects it.
 */
import { describe, it, expect } from 'bun:test'
import type { BlockIndexRow, Note } from '@/types/storage'
import type { IEffort, RowsRun } from '@bitcobblers/wod-wiki-wql'
import type { EventRecord } from '@bitcobblers/wod-wiki-core'
import {
  toEntry,
  blockToEntry,
  blockPreview,
  effortToEntry,
  rowsRunToEntry,
  unifiedEventToEntry,
  rowsQueryResultToEntries,
  type EntryKind,
} from './entryMapper'
import { entryOpenHref } from './entryActions'
import { groupEntriesByDimension } from './entryGrouping'

function makeNote(overrides: Partial<Note> & { slug?: string; pageId?: string } = {}): Note {
  return {
    id: 'n',
    title: 't',
    rawContent: '', sourceRevision: 1, blocks: {},
    createdAt: 0,
    type: 'note',
    ...overrides,
  } as Note
}

describe('toEntry — playground entries', () => {
  it('classifies an intake entry (sourceId playground, UUID id) as a playground Note', () => {
    const entry = toEntry(makeNote({
      id: 'uuid-1',
      sourceId: 'playground',
      type: 'playground',
      createdAt: 123,
    }))
    expect(entry.kind).toBe<EntryKind>('note')
    expect(entry.sourceNotebook).toBe('playground')
    // The /playground/:id route segment — the note id itself (V22: no slug).
    expect(entry.sourceNote).toBe('uuid-1')
    expect(entry.date).toBeNull()
    expect(entry.createdAt).toBe(123)
  })

  it('does not map sentinel targetDate: 0 to epoch 1970-01-01', () => {
    const entry = toEntry(makeNote({
      id: 'uuid-2',
      sourceId: 'playground',
      type: 'playground',
      targetDate: 0,
      createdAt: 0,
    } as any))
    expect(entry.date).toBeNull()
  })

  it('classifies a legacy composite-id playground page (type playground, no sourceId) as playground', () => {
    const entry = toEntry(makeNote({
      id: 'playground/2026-09-04-abc',
      type: 'playground',
      sourceId: undefined,
    }))
    expect(entry.sourceNotebook).toBe('playground')
    expect(entry.sourceNote).toBe('2026-09-04-abc')
  })

  it('classifies a legacy playground page by id prefix alone', () => {
    const entry = toEntry(makeNote({
      id: 'playground/legacy-page',
      type: 'note',
      sourceId: undefined,
    }))
    expect(entry.sourceNotebook).toBe('playground')
    expect(entry.sourceNote).toBe('legacy-page')
  })
})

describe('toEntry — tag preservation', () => {
  it('preserves tags from Note onto Entry', () => {
    const entry = toEntry(makeNote({
      id: 'note-with-tags',
      tags: ['pr', 'benchmark'],
    }))
    expect(entry.tags).toEqual(['pr', 'benchmark'])
  })
})

describe('toEntry — guide entries', () => {
  it('classifies a canvas-corpus note (guides: sourceId) as a guide Note carrying the route path', () => {
    const entry = toEntry(makeNote({
      id: 'guide/syntax/basics',
      sourceId: 'guides:guide/syntax/basics',
    }))
    expect(entry.kind).toBe<EntryKind>('note')
    expect(entry.sourceNotebook).toBe('guides')
    expect(entry.sourceNote).toBe('guide/syntax/basics')
    expect(entry.date).toBeNull()
  })

  it('derives the page slug — the /page route — from the declared sourceId route, never the note id', () => {
    const entry = toEntry(makeNote({
      id: 'guide/syntax/basics',
      sourceId: 'guides:page/guide-syntax/basics',
    }))
    expect(entry.sourceNote).toBe('page/guide-syntax/basics')
    expect(entry.pageSlug).toBe('guide-syntax/basics')

    // UUID-keyed guide notes route from sourceId too
    const uuidEntry = toEntry(makeNote({ id: 'uuid-guide', sourceId: 'guides:page/guide-clock' }))
    expect(uuidEntry.sourceNote).toBe('page/guide-clock')
    expect(uuidEntry.pageSlug).toBe('guide-clock')

    // Non-guide notes have no page render target
    expect(toEntry(makeNote({ id: 'uuid-1' })).pageSlug).toBeUndefined()
  })
})

describe('toEntry — journal post dates', () => {
  it('reads a journal post\'s row date as the day it belongs to', () => {
    // The create path stamps the local midnight of the chosen day; the row
    // date IS the journal day. A note written for Oct 22 must not be listed
    // on the day it was typed.
    const entry = toEntry(makeNote({
      id: 'journal-1',
      type: 'journal',
      date: new Date(2026, 9, 22).getTime(),
      createdAt: new Date(2026, 9, 31).getTime(),
    }))
    expect(entry.date).toBe('2026-10-22')
  })

  it('leaves a collection member on its creation day — its row date is the workout\'s own', () => {
    const entry = toEntry(makeNote({
      id: 'collection-1',
      type: 'note',
      date: new Date(2010, 2, 20).getTime(),
      createdAt: new Date(2026, 9, 9).getTime(),
    }))
    expect(entry.date).toBe('2026-10-09')
  })
})

describe('toEntry — kind discrimination', () => {
  it('classifies a journal note (no sourceId) as Note', () => {
    const entry = toEntry(makeNote())
    expect(entry.kind).toBe<EntryKind>('note')
  })

  it('classifies a notebook note as note (the notebook member kind)', () => {
    const entry = toEntry(makeNote({ id: 'crossfit-girls/fran', sourceId: 'notebook:crossfit-girls/fran' }))
    expect(entry.kind).toBe('note')
  })

  it('classifies a dated notebook post as note (the notebook member kind)', () => {
    const entry = toEntry(makeNote({ id: 'crossfit-programming/2026-01-12/monday', sourceId: 'notebook:crossfit-programming/2026-01-12/monday' }))
    expect(entry.kind).toBe('note')
  })
})

describe('toEntry — notebook date projection (by {month, year} grouping)', () => {
  // FeedImporter parses frontmatter `date: YYYY-MM-DD` to noon-UTC epoch ms.
  const NOON = Date.parse('2009-12-01T12:00:00Z')

  it('projects a seeded notebook Note.date onto the entry for date grouping', () => {
    const entry = toEntry(makeNote({ id: 'zombiefit/2009-12-01-beginner', sourceId: 'notebook:zombiefit/2009-12-01-beginner', date: NOON }))
    expect(entry.date).toBe('2009-12-01')
  })

  it('keeps a notebook entry undated when the note carries no date', () => {
    const entry = toEntry(makeNote({ id: 'zombiefit/README', sourceId: 'notebook:zombiefit' }))
    expect(entry.date).toBeNull()
  })

  it('groups dated notebook entries under their month', () => {
    const entry = toEntry(makeNote({ id: 'zombiefit/2009-12-01-beginner', sourceId: 'notebook:zombiefit/2009-12-01-beginner', date: NOON }))
    const groups = groupEntriesByDimension([entry], 'month')
    expect(groups.map(g => g.key)).toEqual(['2009-12'])
  })
})

describe('toEntry — seeded kinds stay out of journal (All-view inclusion)', () => {
  it('classifies a typed dashboard note (sourceId dashboards) as Dashboard, opening at /d/<slug>', () => {
    const entry = toEntry(makeNote({ id: 'uuid-dash', type: 'dashboard', sourceId: 'dashboards', sourcePath: 'markdown/dashboards/hero.md' }))
    expect(entry.kind).toBe<EntryKind>('dashboard')
    expect(entry.sourceNotebook).toBe('dashboards')
    expect(entryOpenHref(entry)).toBe('/dashboard/hero')
  })

  it('classifies a legacy sourceless dashboard seed by corpus path', () => {
    const entry = toEntry(makeNote({ id: 'uuid-legacy', sourcePath: 'markdown/dashboards/strength-trends.md' }))
    expect(entry.kind).toBe<EntryKind>('dashboard')
    expect(entryOpenHref(entry)).toBe('/dashboard/strength-trends')
  })

  it('classifies an effort note (sourceId efforts) as Effort, opening at /e/<slug>', () => {
    const entry = toEntry(makeNote({ id: 'uuid-effort', sourceId: 'efforts', sourcePath: 'markdown/efforts/strength/back-squat.md' }))
    expect(entry.kind).toBe<EntryKind>('effort')
    expect(entry.effort?.slug).toBe('back-squat')
    expect(entryOpenHref(entry)).toBe('/effort/back-squat')
  })

  it('classifies an equipment note as Equipment, opening in the canonical note editor', () => {
    const entry = toEntry(makeNote({ id: 'uuid-gear', sourceId: 'equipment' }))
    expect(entry.kind).toBe<EntryKind>('equipment')
    expect(entry.sourceNotebook).toBe('equipment')
    expect(entryOpenHref(entry)).toBe('/note/uuid-gear')
  })

  it('maps a synthetic tag-plane row to a Tag entry exposing its contributions', () => {
    // The tag plane's synthetic row — a Note carrying the tag's type (the
    // executor's row shape, wider than the storage Note).
    const tagRow: Note & { tagType?: string } = {
      ...makeNote({
        id: 'tag/domain/running',
        title: 'running',
        type: 'tag',
        rawContent: 'contributes metric discipline, function tis',
        createdAt: 42,
      }),
      tagType: 'domain',
    }
    const entry = toEntry(tagRow)
    expect(entry.kind).toBe<EntryKind>('tag')
    expect(entry.sourceNotebook).toBe('tags')
    expect(entry.sourceNote).toBe('running')
    expect(entry.subtitle).toBe('domain')
    // The row shows what the tag carries.
    expect(entry.detail).toBe('contributes metric discipline, function tis')
    expect(entryOpenHref(entry)).toBe('/t/domain/running')
  })

  it('a tag row without a type opens under the general type', () => {
    const entry = toEntry(makeNote({
      id: 'tag/general/heavy',
      title: 'heavy',
      type: 'tag',
      rawContent: '',
    }))
    expect(entryOpenHref(entry)).toBe('/t/general/heavy')
  })

  it('none of the seeded kinds masquerade as journal entries', () => {
    for (const note of [
      makeNote({ type: 'dashboard', sourceId: 'dashboards' }),
      makeNote({ sourceId: 'efforts', sourcePath: 'markdown/efforts/strength/back-squat.md' }),
      makeNote({ sourceId: 'equipment' }),
    ]) {
      const entry = toEntry(note)
      expect(entry.sourceNotebook).not.toBe('journal')
      expect(entry.kind).not.toBe<EntryKind>('note')
    }
  })
})

describe('toEntry — source fields', () => {
  it('sets sourceNotebook to "journal" for Note', () => {
    const entry = toEntry(makeNote({ id: 'journal-2026-07-15' }))
    expect(entry.sourceNotebook).toBe('journal')
    expect(entry.sourceNote).toBe('journal-2026-07-15')
  })

  it('sets sourceNotebook to the notebook slug for a notebook item', () => {
    const entry = toEntry(makeNote({ id: 'crossfit-girls/fran', sourceId: 'notebook:crossfit-girls/fran' }))
    expect(entry.sourceNotebook).toBe('crossfit-girls')
    expect(entry.sourceNote).toBe('fran')
  })

  it('keeps the dated identity on sourceNote for a dated notebook post', () => {
    const entry = toEntry(makeNote({ id: 'crossfit-programming/2026-01-12/monday', sourceId: 'notebook:crossfit-programming/2026-01-12/monday' }))
    expect(entry.sourceNotebook).toBe('crossfit-programming')
    expect(entry.sourceNote).toBe('2026-01-12/monday')
  })
})

describe('toEntry — date resolution', () => {
  it('returns null for undated notebook items (no journal date)', () => {
    const entry = toEntry(makeNote({ id: 'crossfit-girls/fran', sourceId: 'notebook:crossfit-girls/fran' }))
    expect(entry.date).toBeNull()
  })

  it('extracts YYYY-MM-DD from the dated item identity', () => {
    const entry = toEntry(makeNote({ id: 'crossfit-programming/2026-01-12/monday', sourceId: 'notebook:crossfit-programming/2026-01-12/monday' }))
    expect(entry.date).toBe('2026-01-12')
  })

  it('returns null for Note (the Library page resolves Note.date from Page.date, not the Note itself)', () => {
    // Per the spec: the Library page reads `Page.date` (V10) for Notes. The
    // mapper's contract is "no date means the page has to look it up" — it
    // does NOT pretend to know the journal-date of a note.
    const entry = toEntry(makeNote())
    expect(entry.date).toBeNull()
  })
})

describe('toEntry — notebook route derivation (sourceId/sourcePath, never UUID)', () => {
  const UUID = '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e'

  it('derives slug/item from a notebook: sourceId on a UUID-keyed note', () => {
    const entry = toEntry(makeNote({ id: UUID, sourceId: 'notebook:crossfit-girls/fran' }))
    expect(entry.kind).toBe<EntryKind>('note')
    expect(entry.sourceNotebook).toBe('crossfit-girls')
    expect(entry.sourceNote).toBe('fran')
    expect(entry.id).toBe(UUID)
  })

  it('maps a notebook: UUID landing to the notebook landing', () => {
    const entry = toEntry(makeNote({ id: UUID, sourceId: 'notebook:crossfit-girls' }))
    expect(entry.sourceNotebook).toBe('crossfit-girls')
    expect(entry.sourceNote).toBe('')
    expect(entry.id).toBe(UUID)
  })

  it('derives the route from sourcePath for imported notes lacking sourceId', () => {
    const entry = toEntry(makeNote({
      id: UUID,
      sourceId: undefined,
      sourcePath: 'markdown/notebooks/girls/fran.md',
    }))
    expect(entry.kind).toBe<EntryKind>('note')
    expect(entry.sourceNotebook).toBe('girls')
    expect(entry.sourceNote).toBe('fran')
    expect(entry.subtitle).toBe('girls')
  })

  it('treats a README corpus path as the notebook landing, not a workout', () => {
    const entry = toEntry(makeNote({
      id: UUID,
      sourceId: undefined,
      sourcePath: 'markdown/notebooks/dan-john/README.md',
    }))
    expect(entry.sourceNotebook).toBe('dan-john')
    expect(entry.sourceNote).toBe('')
  })

  it('derives slug/date/item from a dated notebook: sourceId on a UUID-keyed note', () => {
    const entry = toEntry(makeNote({ id: UUID, sourceId: 'notebook:crossfit-programming/2026-01-12/monday' }))
    expect(entry.kind).toBe<EntryKind>('note')
    expect(entry.sourceNotebook).toBe('crossfit-programming')
    expect(entry.date).toBe('2026-01-12')
    expect(entry.sourceNote).toBe('2026-01-12/monday')
    expect(entry.id).toBe(UUID)
  })

  it('derives the dated route from sourcePath for imported notes lacking sourceId', () => {
    const entry = toEntry(makeNote({
      id: UUID,
      sourceId: undefined,
      sourcePath: 'markdown/notebooks/crossfit-programming/2026-01-12/monday.md',
    }))
    expect(entry.kind).toBe<EntryKind>('note')
    expect(entry.sourceNotebook).toBe('crossfit-programming')
    expect(entry.date).toBe('2026-01-12')
    expect(entry.sourceNote).toBe('2026-01-12/monday')
  })

  it('propagates the projected named slug to pageSlug, ignoring UUID pageIds', () => {
    const PAGE_UUID = '1d2e3f4a-5b6c-4d8e-9f0a-1b2c3d4e5f6b'
    const withSlug = toEntry(makeNote({ id: UUID, slug: 'my-page', pageId: PAGE_UUID }))
    expect(withSlug.pageSlug).toBe('my-page')
    expect(withSlug.pageId).toBe(PAGE_UUID)
    const slugLess = toEntry(makeNote({ id: UUID, pageId: PAGE_UUID }))
    expect(slugLess.pageSlug).toBeUndefined()
    expect(slugLess.pageId).toBe(PAGE_UUID)
  })
})

describe('toEntry — passthrough fields', () => {
  it('passes through title verbatim', () => {
    const entry = toEntry(makeNote({ title: 'Heavy day' }))
    expect(entry.title).toBe('Heavy day')
  })

  it('sets the notebook slug as subtitle for notebook members', () => {
    const entry = toEntry(makeNote({ id: 'crossfit-girls/fran', sourceId: 'notebook:crossfit-girls/fran' }))
    expect(entry.subtitle).toBe('crossfit-girls')
  })
})

// ── blockToEntry (#855) ──────────────────────────────────────────────────────


function makeBlock(overrides: Partial<BlockIndexRow> = {}): BlockIndexRow {
  return {
    id: 'static:note:seg:1',
    noteId: 'crossfit-programming/2026-01-12/wednesday-hero',
    blockId: 'sec-7',
    blockVersion: 1,
    sourceRevision: 1,
    from: 0,
    to: 16,
    position: 2,
    dataType: 'wod',
    rawContent: 'Murph\n\n1 mile run',
    noteTitle: 'Wednesday Hero',
    createdAt: Date.parse('2026-01-12T00:00:00Z'),
    isStatic: true,
    sourceId: 'notebook:crossfit-programming/2026-01-12/wednesday-hero',
    blockContentId: 'bc-murph',
    ...overrides,
  } as BlockIndexRow
}

describe('blockToEntry (#855)', () => {
  it('keeps the parent note identity and carries the block payload', () => {
    const entry = blockToEntry(makeBlock())
    expect(entry.id).toBe('crossfit-programming/2026-01-12/wednesday-hero')
    expect(entry.kind).toBe<EntryKind>('note')
    expect(entry.date).toBe('2026-01-12')
    expect(entry.title).toBe('Wednesday Hero')
    expect(entry.block).toEqual({
      blockId: 'sec-7',
      dataType: 'wod',
      preview: ['Murph', '1 mile run'],
    })
    expect(entry.blockContentId).toBe('bc-murph')
  })

  it('classifies notebook blocks as notebook-member notes', () => {
    const entry = blockToEntry(makeBlock({
      noteId: 'crossfit-girls/fran',
      sourceId: 'notebook:crossfit-girls/fran',
    }))
    expect(entry.kind).toBe<EntryKind>('note')
    expect(entry.date).toBeNull()
  })

  it('classifies journal blocks (no sourceId) as Note', () => {
    const entry = blockToEntry(makeBlock({ noteId: 'n-1', sourceId: undefined }))
    expect(entry.kind).toBe<EntryKind>('note')
  })

  it('routes imported blocks through sourcePath when sourceId is absent', () => {
    const entry = blockToEntry(makeBlock({
      noteId: '0b9b7e57-0e1a-4b9e-9b1e-3f2a4d5c6b7e',
      sourceId: undefined,
      sourcePath: 'markdown/notebooks/girls/fran.md',
    }))
    expect(entry.kind).toBe<EntryKind>('note')
    expect(entry.sourceNotebook).toBe('girls')
    expect(entry.sourceNote).toBe('fran')
  })
})

describe('blockPreview', () => {
  it('caps at 3 non-empty lines', () => {
    expect(blockPreview('a\n\nb\nc\nd\ne')).toEqual(['a', 'b', 'c'])
  })

  it('truncates long lines with an ellipsis', () => {
    const long = 'x'.repeat(200)
    const [line] = blockPreview(long)
    expect(line!.length).toBe(120)
    expect(line!.endsWith('…')).toBe(true)
  })

  it('returns [] for blank content', () => {
    expect(blockPreview('\n  \n')).toEqual([])
  })
})


describe('effortToEntry', () => {
  const effort: IEffort = {
    id: 'eff-1',
    slug: 'back-squat',
    label: 'Back Squat',
    aliases: ['BS', 'Back Squats'],
    baseAttributes: {
      discipline: 'strength',
      met: 6.0,
      intensityTier: 'high',
    },
    registrySource: 'bundled',
  }

  it('maps an IEffort into an Entry with kind "effort" and effort metadata', () => {
    const entry = effortToEntry(effort)
    expect(entry.kind).toBe('effort')
    expect(entry.id).toBe('back-squat')
    expect(entry.title).toBe('Back Squat')
    expect(entry.sourceNotebook).toBe('bundled')
    expect(entry.sourceNote).toBe('back-squat')
    expect(entry.date).toBeNull()
    expect(entry.subtitle).toBe('strength • MET 6.0 • high')
    expect(entry.detail).toBe('Aliases: BS, Back Squats')
    expect(entry.effort).toEqual({
      slug: 'back-squat',
      label: 'Back Squat',
      discipline: 'strength',
      met: 6.0,
      intensityTier: 'high',
      aliases: ['BS', 'Back Squats'],
      registrySource: 'bundled',
    })
  })
})

describe('rowsRunToEntry — session level (Mode A)', () => {
  const timestamp = new Date('2026-08-15T10:00:00Z').getTime()
  const run: RowsRun = {
    resultId: 'res-123',
    noteId: 'crossfit-girls/fran',
    timestamp,
    events: [
      {
        id: 'res-123:0',
        resultId: 'res-123',
        noteId: 'crossfit-girls/fran',
        blockContentId: 'bc-fran',
        timestamp,
        outputType: 'segment',
        effortSlug: 'thruster',
        timeSpan: { started: timestamp, ended: timestamp + 120_000 },
        metrics: [
          { type: 'rep', value: 21 },
          { type: 'weight', value: 95, unit: 'lbs' },
        ],
      } as EventRecord,
      {
        id: 'res-123:1',
        resultId: 'res-123',
        noteId: 'crossfit-girls/fran',
        timestamp: timestamp + 120_000,
        grain: 'event',
        outputType: 'segment',
        effortSlug: 'pull-up',
        timeSpan: { started: timestamp + 120_000, ended: timestamp + 200_000 },
        metrics: [
          { type: 'rep', value: 21 },
          { type: 'tis', value: 12.5 },
        ],
      } as EventRecord,
    ],
  }

  it('maps a RowsRun to an Entry with kind "result" and execution metrics', () => {
    const entry = rowsRunToEntry(run)
    expect(entry.kind).toBe('result')
    expect(entry.id).toBe('res-123')
    expect(entry.sourceNotebook).toBe('results')
    expect(entry.sourceNote).toBe('res-123')
    expect(entry.date).toBe('2026-08-15')
    expect(entry.title).toBe('Fran')
    expect(entry.subtitle).toContain('03:20')
    expect(entry.subtitle).toContain('2 splits')
    expect(entry.detail).toContain('Thruster, Pull Up')
    expect(entry.blockContentId).toBe('bc-fran')
    expect(entry.execution).toMatchObject({
      resultId: 'res-123',
      noteId: 'crossfit-girls/fran',
      outputType: 'all',
      segmentCount: 2,
      reps: 42,
    })
  })
})

describe('unifiedEventToEntry — segment level (Mode B)', () => {
  const timestamp = new Date('2026-08-15T10:00:00Z').getTime()
  const event: EventRecord = {
    id: 'res-123:0',
    resultId: 'res-123',
    noteId: 'crossfit-girls/fran',
    timestamp,
    blockContentId: 'bc-thruster',
    outputType: 'segment',
    effortSlug: 'thruster',
    timeSpan: { started: timestamp, ended: timestamp + 105_000 },
    metrics: [
      { type: 'rep', value: 21 },
      { type: 'weight', value: 95, unit: 'lbs' },
    ],
  }

  it('maps a segment EventRecord to kind "segment"', () => {
    const entry = unifiedEventToEntry(event, { index: 0 })
    expect(entry.kind).toBe('segment')
    expect(entry.id).toBe('res-123:0')
    expect(entry.title).toBe('Thruster')
    expect(entry.date).toBe('2026-08-15')
    expect(entry.subtitle).toContain('01:45')
    expect(entry.subtitle).toContain('21 reps')
    expect(entry.subtitle).toContain('95 lbs')
    expect(entry.blockContentId).toBe('bc-thruster')
    expect(entry.execution).toMatchObject({
      resultId: 'res-123',
      noteId: 'crossfit-girls/fran',
      outputType: 'segment',
      effortSlug: 'thruster',
      reps: 21,
      loadLbs: 95,
    })
  })
})

describe('rowsQueryResultToEntries', () => {
  const timestamp = new Date('2026-08-15T10:00:00Z').getTime()
  const run: RowsRun = {
    resultId: 'res-1',
    noteId: 'crossfit-girls/fran',
    timestamp,
    events: [
      {
        id: 'res-1:0',
        resultId: 'res-1',
        noteId: 'crossfit-girls/fran',
        timestamp,
        grain: 'event',
        outputType: 'segment',
        effortSlug: 'thruster',
        metrics: [{ type: 'rep', value: 21 }],
      } as EventRecord,
    ],
  }

  it('dispatches find:session to session-level entries', () => {
    const qr: any = {
      parsed: { family: 'find', raw: 'find:session{result:res-1}', target: 'session', filters: [] },
      runs: [run],
    }
    const entries = rowsQueryResultToEntries(qr)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe('result')
  })

  it('dispatches find:session with plane:segment to segment-level entries', () => {
    const qr: any = {
      parsed: {
        family: 'find',
        raw: 'find:session{result:res-1, plane:segment}',
        target: 'session',
        filters: [{ key: 'plane', negate: false, values: [{ value: 'segment', wildcard: false }] }],
      },
      runs: [run],
    }
    const entries = rowsQueryResultToEntries(qr)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe('segment')
    expect(entries[0]!.id).toBe('res-1:0')
  })
})

describe('toEntry — notebook/{slug} identity and application-level editability', () => {
  it('populates canonical notebookId (notebook/{slug}) and editable (only user-created notes are editable)', () => {
    const journal = toEntry({
      id: '01950000-0000-7000-8000-000000000001',
      title: 'Today Log',
      rawContent: '# Log',
      sourceRevision: 1,
      blocks: {},
      createdAt: 1000,
      seedOrigin: 'user',
    })
    expect(journal.notebookId).toBe('notebook/journal')
    expect(journal.editable).toBe(true)

    const playground = toEntry({
      id: 'pg-1',
      title: 'Scratch',
      rawContent: '# Scratch',
      sourceRevision: 1,
      blocks: {},
      createdAt: 1000,
      sourceId: 'playground',
      type: 'playground',
    })
    expect(playground.notebookId).toBe('notebook/playground')
    expect(playground.editable).toBe(true)

    const guide = toEntry({
      id: 'g-1',
      title: 'Start Guide',
      rawContent: '# Start',
      sourceRevision: 1,
      blocks: {},
      createdAt: 1000,
      sourceId: 'guides:guide/start',
      seedOrigin: 'seed',
    })
    expect(guide.notebookId).toBe('notebook/guides')
    expect(guide.editable).toBe(false)

    const seedWorkout = toEntry({
      id: 'fran-1',
      title: 'Fran',
      rawContent: '# Fran',
      sourceRevision: 1,
      blocks: {},
      createdAt: 1000,
      sourceId: 'notebook:crossfit-girls/fran',
      sourcePath: 'markdown/notebooks/crossfit-girls/fran.md',
      seedOrigin: 'seed',
    })
    expect(seedWorkout.notebookId).toBe('notebook/crossfit-girls')
    expect(seedWorkout.editable).toBe(false)
  })

  it('carries the resolver notebook for every corpus family — stamped and path-only rows alike', () => {
    const CASES: Array<{ note: Partial<Note> & { id: string }; kind: EntryKind; notebookId: string }> = [
      {
        note: { id: 'effort-1', sourceId: 'efforts', sourcePath: 'markdown/efforts/bodyweight/air-squat.md', seedOrigin: 'seed' },
        kind: 'effort',
        notebookId: 'notebook/efforts',
      },
      {
        // Legacy sourceless row addressed by its corpus path only.
        note: { id: 'effort-2', sourcePath: 'markdown/efforts/running/5k.md', seedOrigin: 'seed' },
        kind: 'effort',
        notebookId: 'notebook/efforts',
      },
      {
        note: { id: 'equip-1', sourceId: 'equipment', sourcePath: 'markdown/equipment/air-bike.md', seedOrigin: 'seed' },
        kind: 'equipment',
        notebookId: 'notebook/equipment',
      },
      {
        note: { id: 'dash-1', type: 'dashboard', sourceId: 'dashboards', sourcePath: 'markdown/dashboards/benchmark-pr-board.md', seedOrigin: 'seed' },
        kind: 'dashboard',
        notebookId: 'notebook/dashboards',
      },
      {
        note: { id: 'dash-2', type: 'dashboard', seedOrigin: 'user' },
        kind: 'dashboard',
        notebookId: 'notebook/dashboards',
      },
      {
        note: { id: 'post-1', sourceId: 'notebook:community/2026-01-02/post', sourcePath: 'markdown/notebooks/community/2026-01-02/post.md', seedOrigin: 'seed' },
        kind: 'note',
        notebookId: 'notebook/community',
      },
      {
        note: { id: 'guide-1', sourceId: 'guides:guide/clock', sourcePath: 'markdown/canvas/guide/clock.md', seedOrigin: 'seed' },
        kind: 'note',
        notebookId: 'notebook/guides',
      },
    ]
    for (const c of CASES) {
      const entry = toEntry(makeNote(c.note))
      expect(entry.kind, c.note.id).toBe(c.kind)
      expect(entry.notebookId, c.note.id).toBe(c.notebookId)
    }
  })
})
