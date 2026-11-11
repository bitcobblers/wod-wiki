import { describe, expect, it } from 'vitest';
import type { EventRecord, Note } from '@bitcobblers/wod-wiki-core';
import {
  QueryService,
  projectEventToFacts,
  resolveQueryExecutionScope,
  substituteTokens,
  type EventStore,
  type NoteQueryStore,
  type IEffort,
  type NoteRelationBundle,
} from '../src';
import { parseQuery } from '../src/wql';

const T0 = Date.UTC(2026, 8, 7, 12);

function makeEventRow(opts: {
  id: string;
  resultId: string;
  noteId: string;
  effortSlug?: string;
  metrics: Array<{ type: string; value: number | string; unit?: string; metadata?: Record<string, unknown> }>;
  metricTemporal?: Array<{ temporalKind: 'civil-date' | 'instant'; civilDate?: string; instant?: number }>;
}): EventRecord {
  return {
    id: opts.id,
    resultId: opts.resultId,
    noteId: opts.noteId,
    timestamp: T0,
    grain: 'event',
    outputType: 'segment',
    blockId: 'b1',
    blockVersion: 1,
    effortSlug: opts.effortSlug,
    metrics: opts.metrics.map((m) => ({
      ...m,
      metadata: typeof m.value === 'number' ? { canonicalKey: m.type, ...(m.metadata ?? {}) } : m.metadata,
    })),
    ...(opts.metricTemporal ? { metricTemporal: opts.metricTemporal } : {}),
  } as unknown as EventRecord;
}

function makeEventStore(rows: EventRecord[]): EventStore {
  return {
    scanAll: async () => rows,
    getEventsByTimeRange: async (start, end) => rows.filter((r) => r.timestamp >= start && r.timestamp <= end),
    getEventsByResult: async (resultId) => rows.filter((r) => r.resultId === resultId),
    getEventsForNote: async (noteId) => rows.filter((r) => r.noteId === noteId),
    getEventsByContent: async () => [],
    appendEvents: async () => {},
    finalizeSummaries: async () => {},
    deleteEvents: async () => {},
  };
}

describe('WQL-2 single-pass projectEventToFacts metric filtering', () => {
  it('filters to the requested metricKey while preserving metricOrdinal temporal alignment', () => {
    const row = makeEventRow({
      id: 'r1:0',
      resultId: 'r1',
      noteId: 'n1',
      effortSlug: 'thruster',
      metrics: [
        { type: 'reps', value: 21 },
        { type: 'resistance', value: 43, unit: 'kg' },
      ],
      metricTemporal: [
        { temporalKind: 'civil-date', civilDate: '2026-09-01' },
        { temporalKind: 'civil-date', civilDate: '2026-09-07' },
      ],
    });

    const unfiltered = projectEventToFacts(row);
    expect(unfiltered).toHaveLength(2);
    expect(unfiltered[1]!.id).toBe('r1:0:1');
    expect(unfiltered[1]!.metricDate).toBe('2026-09-07');

    const filtered = projectEventToFacts(row, { metricKey: 'resistance' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.metricKey).toBe('resistance');
    expect(filtered[0]!.value).toBe(43);
    // Ordinal 1 is preserved even though ordinal 0 ('reps') was skipped.
    expect(filtered[0]!.id).toBe('r1:0:1');
    expect(filtered[0]!.metricDate).toBe('2026-09-07');
  });

  it('matches rep/reps synonyms during single-pass filtering', () => {
    const row = makeEventRow({
      id: 'r1:1',
      resultId: 'r1',
      noteId: 'n1',
      metrics: [{ type: 'reps', value: 15 }],
    });
    expect(projectEventToFacts(row, { metricKey: 'rep' })).toHaveLength(1);
    expect(projectEventToFacts(row, { metricKey: 'distance' })).toHaveLength(0);
  });
});

describe('WQL-2 3-tier FactDimensionResolver & by {equipment}', () => {
  const notes: Note[] = [
    { id: 'note-fran', title: 'Fran', createdAt: T0, type: 'note', rawContent: '', sourceRevision: 1, blocks: {} },
    { id: 'note-kb', title: 'Helen', createdAt: T0, type: 'note', rawContent: '', sourceRevision: 1, blocks: {} },
  ];

  const efforts: IEffort[] = [
    {
      id: 'eff-thruster',
      slug: 'thruster',
      label: 'Thruster',
      aliases: [],
      baseAttributes: { discipline: 'weightlifting', intensityTier: 'high' } as unknown as IEffort['baseAttributes'],
      registrySource: 'seed' as IEffort['registrySource'],
      equipment: ['barbell'],
    },
    {
      id: 'eff-pullup',
      slug: 'pull-up',
      label: 'Pull-up',
      aliases: [],
      baseAttributes: { discipline: 'gymnastics', intensityTier: 'moderate' } as unknown as IEffort['baseAttributes'],
      registrySource: 'seed' as IEffort['registrySource'],
      equipment: ['pullup-bar'],
    },
    {
      id: 'eff-mystery',
      slug: 'mystery-move',
      label: 'Mystery Move',
      aliases: [],
      baseAttributes: { discipline: 'conditioning', intensityTier: 'low' } as unknown as IEffort['baseAttributes'],
      registrySource: 'user' as IEffort['registrySource'],
      // No effort-level equipment — falls through to Tier 3 (Note typed tag)
    },
  ];

  it('resolves :note{note:$thisnote} | :sum{metric:reps} by {equipment} via Effort equipment and Note typed tags with 1 batched relationStore read', async () => {
    const events: EventRecord[] = [
      makeEventRow({ id: 'e1', resultId: 'res1', noteId: 'note-fran', effortSlug: 'thruster', metrics: [{ type: 'reps', value: 45 }] }),
      makeEventRow({ id: 'e2', resultId: 'res1', noteId: 'note-fran', effortSlug: 'pull-up', metrics: [{ type: 'reps', value: 45 }] }),
      makeEventRow({ id: 'e3', resultId: 'res2', noteId: 'note-kb', effortSlug: 'mystery-move', metrics: [{ type: 'reps', value: 63 }] }),
    ];

    let batchCalls = 0;
    const relationBundles = new Map<string, NoteRelationBundle>([
      ['note-fran', { tags: [{ label: 'crossfit', type: 'domain' }, { label: 'for-time', type: 'format' }], links: [], pages: [] }],
      ['note-kb', { tags: [{ label: 'kettlebell', type: 'equipment' }, { label: 'crossfit', type: 'domain' }], links: [], pages: [] }],
    ]);

    const noteStore: NoteQueryStore = {
      getAllNotes: async () => notes,
      getNoteIdsForTag: async () => new Set(),
      getNoteTagLabels: async () => [],
    };

    const service = new QueryService({
      eventStore: makeEventStore(events),
      noteStore,
      effortStore: { getAllEfforts: async () => efforts },
      relationStore: {
        getBatches: async (ids) => {
          batchCalls += 1;
          const out = new Map<string, NoteRelationBundle>();
          for (const id of ids) {
            const b = relationBundles.get(id);
            if (b) out.set(id, b);
          }
          return out;
        },
      },
    });

    const scope = resolveQueryExecutionScope({ noteId: 'note-fran' });
    const rawWql = substituteTokens(':note{note:$thisnote} | :sum{metric:reps} by {equipment}', scope.tokens).query;
    const res = await service.runPipeline(rawWql);

    expect(res.error).toBeUndefined();
    const byEquipment = Object.fromEntries((res.series ?? []).map((s) => [s.label, s.points[0]?.value]));
    expect(byEquipment).toEqual({
      barbell: 45,
      'pullup-bar': 45,
    });
    expect(batchCalls).toBe(1);

    // Tier 3 fallback: mystery-move has no effort equipment, so it inherits 'kettlebell' from note-kb's typed tag.
    const allNotesRes = await service.runPipeline(':note{} | :sum{metric:reps} by {equipment}');
    const allByEquip = Object.fromEntries((allNotesRes.series ?? []).map((s) => [s.label, s.points[0]?.value]));
    expect(allByEquip).toEqual({
      barbell: 45,
      'pullup-bar': 45,
      kettlebell: 63,
    });
  });

  it('filters :segment{equipment:kettlebell} | :sum{metric:reps} and enforces Tier 1 > Tier 2 > Tier 3 precedence', async () => {
    const events: EventRecord[] = [
      // Tier 2 effort says 'barbell', Tier 3 note says 'sandbag', but Tier 1 statement metric says 'dumbbell' -> 'dumbbell' wins!
      makeEventRow({
        id: 'e1',
        resultId: 'res1',
        noteId: 'note-1',
        effortSlug: 'thruster',
        metrics: [
          { type: 'reps', value: 30 },
          { type: 'equipment', value: 'dumbbell' },
        ],
      }),
      // Tier 2 effort says 'barbell', no statement override -> 'barbell' wins over Tier 3 note 'sandbag'.
      makeEventRow({
        id: 'e2',
        resultId: 'res1',
        noteId: 'note-1',
        effortSlug: 'thruster',
        metrics: [{ type: 'reps', value: 15 }],
      }),
      // No Tier 1 or Tier 2 equipment -> Tier 3 note 'sandbag' wins.
      makeEventRow({
        id: 'e3',
        resultId: 'res1',
        noteId: 'note-1',
        effortSlug: 'mystery-move',
        metrics: [{ type: 'reps', value: 20 }],
      }),
    ];

    const service = new QueryService({
      eventStore: makeEventStore(events),
      effortStore: { getAllEfforts: async () => efforts },
      relationStore: {
        getBatches: async () =>
          new Map([['note-1', { tags: [{ label: 'sandbag', type: 'equipment' }], links: [], pages: [] }]]),
      },
    });

    const grouped = await service.run(parseQuery('sum:reps{} by {equipment}'));
    const byEquip = Object.fromEntries(grouped.series.map((s) => [s.label, s.points[0]?.value]));
    expect(byEquip).toEqual({
      dumbbell: 30,
      barbell: 15,
      sandbag: 20,
    });

    const segmentPipe = await service.runPipeline(':segment{equipment:dumbbell} | :sum{metric:reps}');
    expect(segmentPipe.error).toBeUndefined();
    expect(segmentPipe.series?.[0]?.points[0]?.value).toBe(30);
  });
});
