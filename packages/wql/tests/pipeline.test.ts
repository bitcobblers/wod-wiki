import { describe, expect, it } from 'vitest';
import type { EventRecord, Note } from '@bitcobblers/wod-wiki-core';
import { parseQuery, type ParsedAggregateQuery, type ParsedPipelineQuery } from '../src/wql';
import { QueryService, type EventStore } from '../src/QueryService';

const T0 = Date.UTC(2026, 8, 7, 12); // civil 2026-09-07 (UTC)
const DAY = 86_400_000;

function eventRow(id: string, resultId: string, outputType: string, metrics: Array<{ type: string; value?: number; unit?: string }>, ts = T0): EventRecord {
  return {
    id, resultId, noteId: 'n1', timestamp: ts, grain: 'event', outputType, blockId: 'seg', blockVersion: 1,
    metrics: metrics.map((m) => ({ ...m, metadata: { canonicalKey: m.type } })),
  } as unknown as EventRecord;
}

/** Every read throws — proves carried/dataset stages never touch the store. */
function explodingStore(): EventStore {
  const boom = () => { throw new Error('event store must never be read on this path'); };
  return {
    getEventsByTimeRange: boom, getEventsByResult: boom, getEventsForNote: boom, getEventsByContent: boom, scanAll: boom,
    appendEvents: async () => {}, finalizeSummaries: async () => {}, deleteEvents: async () => {},
  };
}

function storeWith(rows: EventRecord[]): EventStore {
  const inRangeRows = (start: number, end: number) => rows.filter((r) => r.timestamp >= start && r.timestamp <= end);
  return {
    ...explodingStore(),
    scanAll: async () => rows,
    getEventsByTimeRange: async (start, end) => inRangeRows(start, end),
    getEventsByResult: async (resultId) => rows.filter((r) => r.resultId === resultId),
    getEventsForNote: async (noteId) => rows.filter((r) => r.noteId === noteId),
    getEventsByContent: async (blockContentId) => rows.filter((r) => 'blockContentId' in r && r.blockContentId === blockContentId),
    getEventsByMetricDates: async (dates) =>
      rows.filter((r) => (r.metricTemporal ?? []).some((t) => t.temporalKind === 'civil-date' && dates.includes(t.civilDate ?? ''))),
  };
}

function agg(aggOp: ParsedAggregateQuery['agg'], metric: string, groupBy: string[] = []): ParsedAggregateQuery {
  return { family: 'aggregate', raw: `${aggOp}:${metric}{}`, agg: aggOp, metric, filters: [], groupBy };
}

function pipeline(overrides: Partial<ParsedPipelineQuery> & { source: ParsedPipelineQuery['source']; transforms: ParsedAggregateQuery[] }): ParsedPipelineQuery {
  return { family: 'pipeline', raw: 'test-pipeline', ...overrides };
}

// r1 rows today; r2 rows two civil days earlier.
const SESSION_EVENTS: EventRecord[] = [
  eventRow('s1:0', 'r1', 'segment', [{ type: 'tis', value: 100 }]),
  eventRow('s1:1', 'r1', 'system', [{ type: 'tis', value: 20 }]),
  eventRow('s2:0', 'r2', 'segment', [{ type: 'tis', value: 300 }], T0 - 2 * DAY),
  eventRow('s2:1', 'r2', 'segment', [], T0 - 2 * DAY), // zero-metric debug statement
];
const SESSION_DATASET = { events: SESSION_EVENTS, notes: [{ id: 'n1', title: 'Today', createdAt: T0, type: 'note', rawContent: '', sourceRevision: 1, blocks: {} } satisfies Note] };
// Weighted loads in two sessions, w2 one hour after w1 (last-ordering).
const KG_ROWS: EventRecord[] = [
  eventRow('w1:0', 'w1', 'segment', [{ type: 'weight', value: 60, unit: 'kg' }]),
  eventRow('w2:0', 'w2', 'segment', [{ type: 'weight', value: 100, unit: 'kg' }], T0 + 3_600_000),
];

describe(':segment vs :event — one EventStore, two predicates', () => {
  const ROWS: EventRecord[] = [
    eventRow('a:0', 'rA', 'segment', [{ type: 'tis', value: 10 }]),
    eventRow('a:1', 'rA', 'system', []), // zero-metric emitted statement
    eventRow('a:2', 'rA', 'compiler', [{ type: 'tis', value: 7 }]),
    eventRow('a:3', 'rB', 'segment', [{ type: 'tis', value: 100 }], T0 - 2 * DAY),
    { ...eventRow('a:s', 'rA', 'analytics', [{ type: 'tis', value: 999 }]), grain: 'summary' } as EventRecord,
  ];
  const findTable = async (text: string) => {
    const parsed = parseQuery(text);
    if (parsed.family !== 'find') throw new Error(`expected find query: ${JSON.stringify(parsed)}`);
    return new QueryService({ eventStore: storeWith(ROWS) }).runFind(parsed);
  };

  it(':event is the full debug stream — empty-metric statements kept, summaries excluded', async () => {
    const result = await findTable(':event{}');
    expect(result.table!.totalCount).toBe(4);
    const ids = result.table!.rows.map((r) => r.__id);
    expect(ids).toContain('a:1');
    expect(ids).not.toContain('a:s');
  });

  it(':segment is the domain-point subset of the same scan, windows filter by own anchor', async () => {
    const result = await findTable(':segment{}');
    expect(result.table!.rows.map((r) => r.__id).sort()).toEqual(['a:0', 'a:3']);
    // A window on the row's own anchor selects only today's segment.
    const today = await findTable(':segment{} from 2026-09-07 to 2026-09-07');
    expect(today.table!.rows.map((r) => r.__id)).toEqual(['a:0']);
  });

  it('a windowed table fetches by-metric-date candidates run() would fetch — civil-date rows outside the timestamp window survive', async () => {
    // Fetch timestamp 31 days before the window; the recorded civil metric
    // date is inside it — the by-metric-date union must recover the row.
    const backdated = {
      ...eventRow('b:0', 'rC', 'segment', [{ type: 'tis', value: 55 }]),
      timestamp: T0 - 31 * DAY,
      metricTemporal: [{ temporalKind: 'civil-date', civilDate: '2026-09-07' }],
    } as unknown as EventRecord;
    const parsed = parseQuery(':segment{} from 2026-09-07 to 2026-09-07');
    if (parsed.family !== 'find') throw new Error('expected find query');
    const result = await new QueryService({ eventStore: storeWith([backdated, ...ROWS]) }).runFind(parsed);
    expect(result.table!.rows.map((r) => r.__id)).toEqual(['a:0', 'b:0']);
  });
});

describe('runPipeline — datasets resolve in memory, no store reads', () => {
  it('@session via pageSources aggregates without a database roundtrip', async () => {
    const result = await new QueryService({ eventStore: explodingStore() }).runPipeline('@session | :sum{metric:tis}', {
      pageSources: new Map([['@session', SESSION_DATASET]]),
    });
    expect(result.error).toBeUndefined();
    expect(result.series![0]!.points[0]!.value).toBe(420);
  });

  it('@session via an injected datasetStore sync lookup — no fetch', async () => {
    const service = new QueryService({
      eventStore: explodingStore(),
      datasetStore: { getDataset: (name) => (name === '@session' ? SESSION_DATASET : undefined) },
    });
    expect((await service.runPipeline('@session | :sum{metric:tis}')).series![0]!.points[0]!.value).toBe(420);
  });

  it('unknown dataset reports a diagnostic instead of touching the store', async () => {
    const result = await new QueryService({ eventStore: explodingStore() }).runPipeline('@nope | :sum{metric:tis}');
    expect(result.error).toContain('@nope');
  });

  it('runAggregateEvents aggregates carried events with no store reads', async () => {
    const result = await new QueryService({ eventStore: explodingStore() }).runAggregateEvents(agg('sum', 'tis'), SESSION_EVENTS);
    expect(result.scalar).toBe(420);
  });

  it('runAggregateEvents honors a window against the provided context', async () => {
    const result = await new QueryService({ eventStore: explodingStore() }).runAggregateEvents(
      { ...agg('sum', 'tis'), window: { kind: 'range', start: '2026-09-07', end: '2026-09-07' } },
      SESSION_EVENTS,
      { context: { instant: T0, timeZone: 'UTC' } },
    );
    expect(result.scalar).toBe(120); // r2's rows anchor two civil days earlier
  });

  it('a content join on a carried dataset errors instead of re-reading the store', async () => {
    const result = await new QueryService({ eventStore: explodingStore() }).runAggregateEvents(
      { ...agg('sum', 'tis'), join: { target: 'note', filters: [] } },
      SESSION_EVENTS,
    );
    expect(result.error).toContain('join');
    expect(result.series).toEqual([]);
  });
});

describe('runPipeline — functions reduce the preceding stage left to right', () => {
  it('sum by {session} then max picks the largest carried bucket — no re-query', async () => {
    const service = new QueryService({ eventStore: explodingStore() });
    const result = await service.runPipeline('@session | :sum{metric:tis} by {session} | :max{}', {
      pageSources: new Map([['@session', SESSION_DATASET]]),
    });
    expect(result.error).toBeUndefined();
    expect(result.series![0]!.points[0]!.value).toBe(300);
  });

  it('three chained functions: sum → max → count counts the carried points', async () => {
    const service = new QueryService({ eventStore: explodingStore() });
    const result = await service.runPipeline('@session | :sum{metric:tis} by {session} | :max{} | :count{}', {
      pageSources: new Map([['@session', SESSION_DATASET]]),
    });
    expect(result.series![0]!.points[0]!.value).toBe(1);
    expect(result.series![0]!.unit).toBe('count');
  });

  it('a carried stage honors a window over the carried points', async () => {
    const service = new QueryService({ eventStore: explodingStore() });
    const result = await service.runPipelineParsed(pipeline({
      source: { kind: 'dataset', name: '@session' },
      transforms: [
        agg('sum', 'tis', ['session']),
        { ...agg('max', 'tis'), window: { kind: 'range', start: '2026-09-07', end: '2026-09-07' } },
      ],
    }), { pageSources: new Map([['@session', SESSION_DATASET]]), context: { instant: T0, timeZone: 'UTC' } });
    expect(result.error).toBeUndefined();
    expect(result.series![0]!.points[0]!.value).toBe(120); // only r1's carried bucket is in window
  });

  it('a carried stage honors in <unit> — converted before reduction', async () => {
    const service = new QueryService({ eventStore: explodingStore() });
    const result = await service.runPipelineParsed(pipeline({
      source: { kind: 'dataset', name: '@session' },
      transforms: [
        agg('sum', 'weight', ['session']),
        { ...agg('avg', 'weight'), displayUnit: 'lb' },
      ],
    }), { pageSources: new Map([['@session', { events: KG_ROWS, notes: [] }]]) });
    expect(result.series![0]!.unit).toBe('lb');
    expect(result.series![0]!.points[0]!.value).toBeCloseTo(80 / 0.45359237, 1); // 80 kg in lb
  });

  it('a carried :last{} in lb reports the CONVERTED observation, never kg relabeled', async () => {
    const service = new QueryService({ eventStore: explodingStore() });
    const result = await service.runPipelineParsed(pipeline({
      source: { kind: 'dataset', name: '@session' },
      transforms: [
        agg('sum', 'weight', ['session']),
        { ...agg('last', 'weight'), displayUnit: 'lb' },
      ],
    }), { pageSources: new Map([['@session', { events: KG_ROWS, notes: [] }]]) });
    expect(result.series![0]!.unit).toBe('lb');
    expect(result.series![0]!.points[0]!.value).toBeCloseTo(100 / 0.45359237, 1); // latest observation (w2) in lb
  });

  it('a carried stage rejects a mismatched metric: instead of mislabeling the result', async () => {
    const service = new QueryService({ eventStore: explodingStore() });
    const result = await service.runPipelineParsed(pipeline({
      source: { kind: 'dataset', name: '@session' },
      transforms: [agg('sum', 'tis', ['session']), agg('max', 'resistance')],
    }), { pageSources: new Map([['@session', SESSION_DATASET]]) });
    expect(result.error).toContain('metric:resistance');
    expect(result.error).toContain('tis');
  });

  it('carried stages reject fact-dimension modifiers with an explicit diagnostic', async () => {
    const service = new QueryService({ eventStore: explodingStore() });
    const result = await service.runPipelineParsed(pipeline({
      source: { kind: 'dataset', name: '@session' },
      transforms: [agg('sum', 'tis', ['session']), { ...agg('max', 'tis'), filters: [{ key: 'effort', negate: false, values: [{ value: 'run', wildcard: false }] }] }],
    }), { pageSources: new Map([['@session', SESSION_DATASET]]) });
    expect(result.error).toContain('cannot apply');
  });

  it(':count{} with no metric counts observations in scope', async () => {
    const result = await new QueryService({ eventStore: explodingStore() }).runPipeline('@session | :count{}', {
      pageSources: new Map([['@session', SESSION_DATASET]]),
    });
    expect(result.series![0]!.points[0]!.value).toBe(3); // three metric-bearing rows project 3 facts
  });

  it('a non-count function without metric: reports a clean diagnostic and stops the chain', async () => {
    const service = new QueryService({ eventStore: explodingStore() });
    const result = await service.runPipelineParsed(pipeline({
      source: { kind: 'dataset', name: '@session' },
      transforms: [{ family: 'aggregate', raw: ':sum{}', agg: 'sum', metric: '', filters: [], groupBy: [] }, agg('max', 'tis')],
    }), { pageSources: new Map([['@session', SESSION_DATASET]]) });
    expect(result.error).toContain('requires a metric');
    expect(result.series).toEqual([]);
  });

  it('function-first source uses the aggregate query as the source stage', async () => {
    const service = new QueryService({ eventStore: storeWith([
      eventRow('z:0', 'rz', 'segment', [{ type: 'tis', value: 5 }]),
      eventRow('z:1', 'rz', 'segment', [{ type: 'tis', value: 9 }]),
    ]) });
    const result = await service.runPipeline('sum:tis{} by {session} | :max{}');
    expect(result.error).toBeUndefined();
    expect(result.series![0]!.points[0]!.value).toBe(14);
  });

  it('run() refuses pipeline ASTs with a clean diagnostic — never an unsafe cast', async () => {
    const service = new QueryService({ eventStore: explodingStore() });
    await expect(service.run(pipeline({ source: { kind: 'dataset', name: '@session' }, transforms: [] })))
      .rejects.toThrow(/runPipeline/);
  });

  it('non-pipeline text through runPipelineParsed reports a diagnostic at top level', async () => {
    const result = await new QueryService({ eventStore: explodingStore() }).runPipelineParsed(parseQuery('sum:tis{}'));
    expect(result.error).toBeTruthy();
  });
});

describe('runPipeline — source-scoped content resolution', () => {
  const NOTES: Note[] = [
    { id: 'n1', title: 'Alpha', createdAt: T0, type: 'note', rawContent: '', sourceRevision: 1, blocks: {} },
    { id: 'n2', title: 'Beta', createdAt: T0, type: 'note', rawContent: '', sourceRevision: 1, blocks: {} },
  ];
  const NOTE_EVENTS: Record<string, EventRecord[]> = {
    n1: [eventRow('n1:0', 'r1', 'segment', [{ type: 'tis', value: 42 }])],
    n2: [eventRow('n2:0', 'r2', 'segment', [{ type: 'tis', value: 8 }])],
  };
  function noteService(notes: Note[], store: EventStore): QueryService {
    return new QueryService({
      eventStore: store,
      noteStore: { getAllNotes: async () => notes, getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [] },
    });
  }

  it(':journal | :table surfaces notes through the sink and never resolves events', async () => {
    const store: EventStore = { ...explodingStore(), getEventsForNote: () => { throw new Error('events resolved without transforms'); } };
    const result = await noteService(NOTES, store).runPipeline(':journal{} | :table');
    expect(result.notes!.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
    expect(result.chart).toEqual({ head: 'table', filters: [] });
    expect(result.series).toBeUndefined();
  });

  it(':journal with a transform resolves ONLY the matched notes\' events', async () => {
    const fetched: string[] = [];
    const store: EventStore = {
      ...explodingStore(),
      getEventsForNote: async (noteId) => { fetched.push(noteId); return NOTE_EVENTS[noteId] ?? []; },
    };
    const result = await noteService(NOTES, store).runPipeline(':journal{text:Alpha} | :sum{metric:tis}');
    expect(fetched).toEqual(['n1']);
    expect(result.series![0]!.points[0]!.value).toBe(42);
  });

  it(':note default scope restricts to journal|feeds|playground', async () => {
    const feedNote: Note = { id: 'feed-1', title: 'Feed', createdAt: T0, type: 'note', sourceId: 'feed:x', rawContent: '', sourceRevision: 1, blocks: {} };
    const store: EventStore = { ...explodingStore(), getEventsForNote: async (noteId) => NOTE_EVENTS[noteId] ?? [] };
    const result = await noteService([...NOTES, feedNote], store).runPipeline(':note{} | :sum{metric:tis}');
    expect(result.series![0]!.points[0]!.value).toBe(50); // feed note excluded by default scope
  });
});

describe('containers — junction-based, parent Page wins', () => {
  const NOTES: Note[] = [
    { id: 'n-page', title: 'Bound', createdAt: T0, type: 'note', rawContent: '', sourceRevision: 1, blocks: {} },
    { id: 'n-loose', title: 'Standalone', createdAt: T0, type: 'note', rawContent: '', sourceRevision: 1, blocks: {} },
  ];

  it('find results map page-bound notes to their parent Page and loose notes to Note', async () => {
    const parsed = parseQuery(':journal{}');
    if (parsed.family !== 'find') throw new Error('expected find query');
    const result = await new QueryService({
      noteStore: { getAllNotes: async () => NOTES, getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [] },
      pageStore: {
        getNotePages: async (noteId) => noteId === 'n-page' ? [{ id: 'pn1', pageId: 'p1', noteId, position: 1, createdAt: T0 }] : [],
        getPage: async (pageId) => pageId === 'p1' ? { id: 'p1', slug: 'snatches', createdAt: T0 } : undefined,
      },
    }).runFind(parsed);
    expect(result.containers).toEqual({
      'n-page': { kind: 'page', id: 'p1', slug: 'snatches' },
      'n-loose': { kind: 'note', id: 'n-loose' },
    });
  });

  it('no pageStore → no containers map', async () => {
    const parsed = parseQuery(':journal{}');
    if (parsed.family !== 'find') throw new Error('expected find query');
    const result = await new QueryService({
      noteStore: { getAllNotes: async () => NOTES, getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [] },
    }).runFind(parsed);
    expect(result.containers).toBeUndefined();
  });

  it('relationStore batches containers in one read: first-by-position page wins, dangling links stay standalone, tags inline on untagged notes', async () => {
    const parsed = parseQuery(':journal{}');
    if (parsed.family !== 'find') throw new Error('expected find query');
    const notes: Note[] = [
      { id: 'n-page', title: 'Bound', createdAt: T0, type: 'note', rawContent: '', sourceRevision: 1, blocks: {} },
      { id: 'n-loose', title: 'Standalone', createdAt: T0, type: 'note', rawContent: '', sourceRevision: 1, blocks: {} },
      { id: 'n-tagged', title: 'Inline', createdAt: T0, type: 'note', tags: ['authored'], rawContent: '', sourceRevision: 1, blocks: {} },
      { id: 'n-dangling', title: 'Dangling', createdAt: T0, type: 'note', rawContent: '', sourceRevision: 1, blocks: {} },
    ];
    const batchIds: string[][] = [];
    const result = await new QueryService({
      noteStore: { getAllNotes: async () => notes, getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [] },
      relationStore: {
        getBatches: async (ids) => {
          batchIds.push([...ids]);
          return new Map([
            ['n-page', {
              tags: [{ label: 'crossfit' }, { label: 'girl-wods' }],
              links: [
                { id: 'pn1', pageId: 'p-named', noteId: 'n-page', position: 2, createdAt: T0 },
                { id: 'pn2', pageId: 'p1', noteId: 'n-page', position: 1, createdAt: T0 },
              ],
              pages: [{ id: 'p1', slug: 'snatches', createdAt: T0 }], // p-named missing: dangling
            }],
            ['n-dangling', { tags: [], links: [{ id: 'pn3', pageId: 'gone', noteId: 'n-dangling', position: 1, createdAt: T0 }], pages: [] }],
            ['n-tagged', { tags: [{ label: 'ignored' }], links: [], pages: [] }],
          ]);
        },
      },
    }).runFind(parsed);
    // One deduped bundle read for the whole run — no per-note page reads.
    expect(batchIds).toHaveLength(1);
    expect(batchIds[0]!.sort()).toEqual(['n-dangling', 'n-loose', 'n-page', 'n-tagged']);
    expect(result.containers).toEqual({
      // First link by position resolves p1 even though a later-position
      // link exists; the unresolved p-named page never resurrects.
      'n-page': { kind: 'page', id: 'p1', slug: 'snatches' },
      'n-loose': { kind: 'note', id: 'n-loose' },
      'n-dangling': { kind: 'note', id: 'n-dangling' },
      'n-tagged': { kind: 'note', id: 'n-tagged' },
    });
    // Bundle junction tags inline only on notes without authored tags.
    expect(notes.find(n => n.id === 'n-page')!.tags).toEqual(['crossfit', 'girl-wods']);
    expect(notes.find(n => n.id === 'n-tagged')!.tags).toEqual(['authored']);
    expect(notes.find(n => n.id === 'n-loose')!.tags).toBeUndefined();
  });
});
