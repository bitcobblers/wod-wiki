import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import { QueryService, type NoteQueryStore, type EventStore } from '../src/QueryService';
import { parseQuery } from '../src/wql';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const day0 = Math.floor(1_700_000_000_000 / DAY) * DAY;
const HOUR = 3_600_000;

let seq = 0;
interface SummaryExtra {
  noteId?: string;
  unit?: string;
  effortSlug?: string;
  discipline?: string;
  intensityTier?: string;
  grade?: string;
  groupTags?: Record<string, string>;
  blockContentId?: string;
}

/** A finalize-written summary row — the stored shape the SELECT leg reads. */
function fact(
  metricKey: string,
  value: number,
  timestamp: number,
  extra: SummaryExtra = {},
): EventRecord {
  seq += 1;
  const { unit, effortSlug, discipline, intensityTier, grade, groupTags, ...identity } = extra;
  return {
    id: `r${seq}:summary:${metricKey}`,
    resultId: `r${seq}`,
    noteId: 'note-fran',
    grain: 'summary',
    outputType: 'analytics',
    blockId: 's1',
    blockVersion: 1,
    timestamp,
    ...identity,
    // Post-V14 engine output: summaries carry substitution-proof stats.
    representationKind: 'calculated',
    reducerStats: { observedCount: 1 },
    metrics: [{
      type: metricKey,
      value,
      ...(unit ? { unit } : {}),
      metadata: {
        canonicalKey: metricKey,
        ...(effortSlug ? { effortSlug } : {}),
        ...(discipline ? { effortDiscipline: discipline } : {}),
        ...(intensityTier ? { effortIntensityTier: intensityTier } : {}),
        ...(grade ? { grade } : {}),
        ...(groupTags ? { groupTags } : {}),
      },
    }],
  };
}

const V1 = fact('totalVolume', 1000, day0 + HOUR, { discipline: 'strength', effortSlug: 'back-squat', intensityTier: 'high' });
const V2 = fact('totalVolume', 2000, day0 + 1 * DAY, { discipline: 'strength', effortSlug: 'back-squat', intensityTier: 'high' });
const V3 = fact('totalVolume', 3000, day0 + 8 * DAY, { discipline: 'strength', effortSlug: 'back-squat', intensityTier: 'high' });
const T1 = fact('tis', 72, day0 + HOUR, { discipline: 'strength', effortSlug: 'back-squat' });
const V4 = fact('totalVolume', 500, day0 + 3 * DAY, { discipline: 'rowing', effortSlug: 'rowing', noteId: 'note-row' });
const FACTS = [V1, V2, V3, T1, V4];

const NOTE_TAGS: Record<string, string[]> = {
  'note-fran': ['crossfit', 'girl-wods'],
  'note-row': ['rowing'],
};

interface StoreSpy {
  store: EventStore;
  noteStore: NoteQueryStore;
  calls: string[];
}

function makeStore(rows: EventRecord[] = FACTS): StoreSpy {
  const calls: string[] = [];
  return {
    calls,
    store: {
      getEventsByTimeRange: async (start, end) => {
        calls.push(`by-timestamp:${start}-${end}`);
        return rows.filter(row => row.timestamp >= start && row.timestamp <= end);
      },
      getEventsByResult: async (resultId) => rows.filter(row => row.resultId === resultId),
      getEventsForNote: async (noteId) => rows.filter(row => row.noteId === noteId),
      getEventsByContent: async (blockContentId) => rows.filter(row => row.blockContentId === blockContentId),
      scanAll: async () => {
        calls.push('scan-all');
        return rows;
      },
      appendEvents: async () => {},
      finalizeSummaries: async () => {},
      deleteEvents: async () => {},
    },
    noteStore: {
      getAllNotes: async () => [],
      getNoteIdsForTag: async () => new Set<string>(),
      getNoteTagLabels: async (noteId) => {
        calls.push(`tags:${noteId}`);
        return NOTE_TAGS[noteId] ?? [];
      },
    },
  };
}

describe('QueryService', () => {
  it('SELECTs window-first: scans all-time, fetches by-timestamp only with a range', async () => {
    const { store, noteStore, calls } = makeStore();
    const service = new QueryService({ eventStore: store, noteStore });

    await service.runQuery('sum:totalVolume{}');
    expect(calls).toEqual(['scan-all']);

    calls.length = 0;
    await service.runQuery('sum:totalVolume{}', { rangeStart: day0, rangeEnd: day0 + 4 * DAY });
    expect(calls).toEqual([`by-timestamp:${day0}-${day0 + 4 * DAY}`]);
  });

  it('windows the SELECT through the by-timestamp leg alone', async () => {
    const { store, noteStore } = makeStore();
    const service = new QueryService({ eventStore: store, noteStore });
    const result = await service.runQuery('sum:totalVolume{}', {
      rangeStart: day0 + 1 * DAY,
      rangeEnd: day0 + 4 * DAY,
    });
    expect(result.stages.selected).toBe(2);
    expect(result.scalar).toBe(2500);
  });

  it('leaves unresolved custom dimensions unassigned rather than erroring', async () => {
    const service = new QueryService(makeStore().store);

    expect((await service.runQuery('sum:totalVolume{coach:greg}')).stages.selected).toBe(0);
    expect((await service.runQuery('sum:totalVolume{!coach:greg}')).stages.selected).toBe(4);
  });

  it('filters multi-value tags with OR within a key and AND across keys', async () => {
    const service = new QueryService(makeStore().store);

    expect((await service.runQuery('sum:totalVolume{note:note-fran|note-row}')).scalar).toBe(6500);
    expect((await service.runQuery('sum:totalVolume{effort:back-squat|rowing}')).scalar).toBe(6500);

    const andAcross = await service.runQuery('sum:totalVolume{note:note-row,discipline:strength}');
    expect(andAcross.stages.selected).toBe(0);

    const mixed = await service.runQuery('sum:totalVolume{note:note-fran|note-row,discipline:strength}');
    expect(mixed.scalar).toBe(6000);
  });

  it('negates multi-value filters across the whole value list', async () => {
    const service = new QueryService(makeStore().store);

    expect((await service.runQuery('sum:totalVolume{!note:note-fran|note-row}')).stages.selected).toBe(0);
    expect((await service.runQuery('sum:totalVolume{!effort:rowing}')).scalar).toBe(6000);
  });

  it('supports per-value wildcards in multi-value filters', async () => {
    const service = new QueryService(makeStore().store);

    expect((await service.runQuery('sum:totalVolume{effort:back*|rowing}')).scalar).toBe(6500);
  });

  it('treats repeated keys as OR within the key (same as a|b)', async () => {
    const service = new QueryService(makeStore().store);

    const multiValue = await service.runQuery('sum:totalVolume{note:note-fran|note-row}');
    const repeatedKey = await service.runQuery('sum:totalVolume{note:note-fran,note:note-row}');
    expect(repeatedKey.scalar).toBe(multiValue.scalar);

    expect(repeatedKey.stages.selected).toBe(multiValue.stages.selected);
  });
  it('groups and filters by the grade dimension', async () => {
    const sends = [
      fact('calc.sends', 1, day0 + HOUR, { grade: 'V5' }),
      fact('calc.sends', 1, day0 + 2 * HOUR, { grade: 'V8' }),
      fact('calc.sends', 1, day0 + 3 * HOUR, { grade: 'V8' }),
    ];
    const service = new QueryService(makeStore(sends).store);

    const grouped = await service.runQuery('count:calc.sends{} by {grade}');
    expect(grouped.series.map((s) => s.label).sort()).toEqual(['V5', 'V8']);
    expect(grouped.series.find((s) => s.label === 'V8')!.points[0]!.value).toBe(2);

    const filtered = await service.runQuery('count:calc.sends{grade:V5}');
    expect(filtered.scalar).toBe(1);
  });

  it('groups and filters by custom dimensions from summary groupTags', async () => {
    const rows = [
      fact('totalVolume', 1000, day0 + HOUR, { groupTags: { coach: 'greg' } }),
      fact('totalVolume', 2000, day0 + 2 * HOUR, { groupTags: { coach: 'anita' } }),
    ];
    const service = new QueryService(makeStore(rows).store);

    const grouped = await service.runQuery('sum:totalVolume{} by {coach}');
    expect(grouped.series.map((s) => s.label).sort()).toEqual(['anita', 'greg']);

    const filtered = await service.runQuery('sum:totalVolume{coach:greg}');
    expect(filtered.scalar).toBe(1000);
  });

  it('normalizes free-form dim keys against stored normalized keys', async () => {
    const rows = [fact('totalVolume', 1000, day0 + HOUR, { groupTags: { sleepQuality: 'good' } })];
    const service = new QueryService(makeStore(rows).store);
    expect((await service.runQuery('sum:totalVolume{sleepQuality:good}')).scalar).toBe(1000);
  });

  it('resolves multi-value tags against the note_tags set', async () => {
    const { store, noteStore } = makeStore();
    const service = new QueryService({ eventStore: store, noteStore });

    const result = await service.runQuery('sum:totalVolume{tags:crossfit|rowing}');
    expect(result.scalar).toBe(6500);
    expect(result.stages.selected).toBe(4);
  });

  it("resolves the 'tags' dimension through note_tags, loaded once per note", async () => {
    const { store, noteStore, calls } = makeStore();
    const service = new QueryService({ eventStore: store, noteStore });

    const result = await service.runQuery('sum:totalVolume{tags:crossfit}');
    expect(result.scalar).toBe(6000);
    expect(calls.filter(c => c.startsWith('tags:')).sort()).toEqual(['tags:note-fran', 'tags:note-row']);

    calls.length = 0;
    await service.runQuery('sum:totalVolume{}');
    expect(calls.some(c => c.startsWith('tags:'))).toBe(false);
  });

  it('aggregates all seven aggregators, hand-computed', async () => {
    const service = new QueryService(makeStore().store);
    const cases: [string, number][] = [
      ['sum:totalVolume{}', 6500],
      ['avg:totalVolume{}', 1625],
      ['min:totalVolume{}', 500],
      ['max:totalVolume{}', 3000],
      ['count:totalVolume{}', 4],
      ['last:totalVolume{}', 3000],
      // Ticket 13: delta is chronological (metric-date order), not fetch order.
      ['delta:totalVolume{}', 3000 - 1000],
    ];
    for (const [query, expected] of cases) {
      expect((await service.runQuery(query)).scalar).toBe(expected);
    }
  });

  it('BUCKETs by week and aggregates per bucket', async () => {
    const service = new QueryService(makeStore().store);
    const result = await service.runQuery('sum:totalVolume{discipline:strength} by {week}');

    expect(result.series).toHaveLength(1);
    expect(result.series[0].points.map(p => p.value)).toEqual([3000, 3000]);
    expect(result.stages.buckets).toBe(2);
  });

  it('GROUPs by tag dimensions and virtual dims', async () => {
    const service = new QueryService(makeStore().store);

    const byEffort = await service.runQuery('sum:totalVolume{} by {effort}');
    // Ticket 16: group identity is the ordered tuple; the label is display.
    expect(byEffort.series.map(s => s.label).sort()).toEqual(['back-squat', 'rowing']);
    expect(byEffort.series.find(s => s.label === 'back-squat')!.points[0].value).toBe(6000);
    expect(byEffort.stages.groups).toBe(2);

    const bySession = await service.runQuery('sum:totalVolume{} by {session}');
    expect(bySession.stages.groups).toBe(4);

    const byDay = await service.runQuery('sum:totalVolume{discipline:strength} by {day}');
    // Ticket 12: the day domain spans the observed extent including empty
    // interior days (day0, day0+1d, day0+8d → 9 civil days, 6 missing).
    expect(byDay.series[0].points).toHaveLength(9);
    expect(byDay.series[0].points.filter((p) => p.missing)).toHaveLength(6);
    expect(byDay.stages.buckets).toBe(9);

    const byRound = await service.runQuery('sum:totalVolume{} by {round}');
    // Ticket 16: the missing group resolves to the structural UNASSIGNED
    // sentinel (label 'unassigned'), never a literal '(none)'.
    expect(byRound.series[0].label).toBe('unassigned');
  });

  it('GROUPs and FILTERs calc.sends by the climb grade tag', async () => {
    // The dashboard grade pyramid contract: climb-sends summaries persist a
    // grade tag (calc engine + seeds) and WQL resolves it as a dimension.
    const sends = [
      fact('calc.sends', 1, day0 + HOUR, { grade: 'V1' }),
      fact('calc.sends', 1, day0 + 2 * HOUR, { grade: 'V2' }),
      fact('calc.sends', 1, day0 + 3 * HOUR, { grade: 'V2' }),
      fact('calc.sends', 1, day0 + 4 * HOUR, { grade: 'V5' }),
    ];
    const service = new QueryService(makeStore(sends).store);

    const byGrade = await service.runQuery('count:calc.sends{} by {grade}');
    expect(byGrade.series.map(s => s.label).sort()).toEqual(['V1', 'V2', 'V5']);
    expect(byGrade.series.find(s => s.label === 'V2')!.points[0].value).toBe(2);
    expect(byGrade.stages.groups).toBe(3);

    const v2 = await service.runQuery('count:calc.sends{grade:V2}');
    expect(v2.scalar).toBe(2);
  });

  it('exposes stage telemetry and scalar for single-point results', async () => {
    const service = new QueryService(makeStore().store);
    const result = await service.runQuery('sum:totalVolume{discipline:strength} by {week}');
    expect(result.stages).toEqual({ selected: 3, buckets: 2, aggregated: 2, groups: 1 });
    expect(result.scalar).toBeUndefined();

    const scalar = await service.runQuery('max:tis{}');
    expect(scalar.scalar).toBe(72);
  });

  it('returns an empty telemetry-zero result for parse errors', async () => {
    const service = new QueryService(makeStore().store);
    const result = await service.runQuery('median:tis');
    expect(result.series).toEqual([]);
    expect(result.stages).toEqual({ selected: 0, buckets: 0, aggregated: 0, groups: 0 });
    expect(result.matched).toEqual([]);
  });
});

describe('QueryService unit conversion', () => {
  const lbFacts = [
    fact('totalVolume', 1000, day0 + HOUR, { unit: 'lb', effortSlug: 'back-squat' }),
    fact('totalVolume', 2000, day0 + DAY, { unit: 'lb', effortSlug: 'back-squat' }),
    fact('totalVolume', 3000, day0 + 8 * DAY, { unit: 'lb', effortSlug: 'back-squat' }),
  ];

  it('converts to a directive display unit', async () => {
    const service = new QueryService(makeStore(lbFacts).store);
    const result = await service.runQuery('sum:totalVolume{} in kg');

    expect(result.unit).toBe('kg');
    expect(result.series[0]?.unit).toBe('kg');
    // Unrounded — renderers format (ticket 13).
    expect(result.scalar).toBeCloseTo(2721.55422, 4);
  });

  it('applies the system kg default when no directive (preference tier retired, ticket 13)', async () => {
    const service = new QueryService(makeStore(lbFacts).store);
    const result = await service.runQuery('sum:totalVolume{}', { preferredUnit: 'kg' });

    expect(result.unit).toBe('kg');
    expect(result.scalar).toBeCloseTo(2721.55422, 4);
  });

  it('outputs the system kg default for mass when no directive is given (ticket 13)', async () => {
    const service = new QueryService(makeStore(lbFacts).store);
    const result = await service.runQuery('sum:totalVolume{}');

    expect(result.unit).toBe('kg');
    expect(result.scalar).toBeCloseTo(2721.55422, 4);
  });

  it('ignores a preferred unit for non-mass metrics', async () => {
    const repsFacts = [
      fact('totalReps', 50, day0 + HOUR, { unit: 'reps' }),
      fact('totalReps', 30, day0 + DAY, { unit: 'reps' }),
    ];
    const service = new QueryService(makeStore(repsFacts).store);
    const result = await service.runQuery('sum:totalReps{}', { preferredUnit: 'kg' });

    expect(result.unit).toBe('count');
    expect(result.scalar).toBe(80);
  });

  it('declares a converted unit on each series and keeps raw points original', async () => {
    const service = new QueryService(makeStore(lbFacts).store);
    const result = await service.runQuery('sum:totalVolume{} by {effort} in kg');

    expect(result.series).toHaveLength(1);
    expect(result.series[0]?.unit).toBe('kg');
    expect(result.series[0]?.points[0]?.value).toBeCloseTo(2721.55422, 4); // unrounded (ticket 13)
    expect(result.matched[0]?.unit).toBe('lb');
    expect(result.matched[0]?.value).toBe(1000);
    expect(result.series[0]?.points[0]?.value).toBeCloseTo(2721.55422, 4); // unrounded (ticket 13)
  });
});

describe('window module (C1) execution', () => {
  it('a parsed relative window drives the by-timestamp SELECT', async () => {
    const { store, calls } = makeStore();
    const service = new QueryService({ eventStore: store });
    await service.runQuery('sum:totalVolume{} last 1w');
    // No explicit options and a parsed window: the store is read through
    // getEventsByTimeRange, never scanAll.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^by-timestamp:/);
  });

  it('a civil-date range window selects local-midnight-to-end-of-day', async () => {
    const { store } = makeStore();
    const service = new QueryService({ eventStore: store });
    // Build the civil window from the fixtures' own local components, so the
    // assertion holds under any ambient timezone.
    const iso = (ts: number) => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const result = await service.runQuery(
      `count:totalVolume{} from ${iso(V1.timestamp)} to ${iso(V2.timestamp)}`,
    );
    // V1 and V2 are the first two distinct civil days of totalVolume facts;
    // V3/V4 land later. T1 is a tis fact — never selected.
    expect(result.matched.map((r) => r.timestamp)).toEqual(
      [V1, V2].map((f) => f.timestamp),
    );
  });

  it('no window scans; the query window wins over host range options (ticket 12)', async () => {
    const { store, calls } = makeStore();
    const service = new QueryService({ eventStore: store });
    await service.runQuery('sum:totalVolume{}');
    expect(calls).toContain('scan-all');
    // Explicit query window beats the host range — the host range is only
    // the default when the query has none.
    calls.length = 0;
    await service.runQuery('sum:totalVolume{} last 1w', { rangeStart: 0, rangeEnd: 10 });
    expect(calls).not.toEqual(['by-timestamp:0-10']);
    // Host range applies when the query has none: the window is a membership
    // bound on the result — an empty window selects nothing, whatever fetch
    // (by-timestamp or complete scan) served it.
    const ranged = await service.runQuery('sum:totalVolume{}', { rangeStart: 0, rangeEnd: 10 });
    expect(ranged.matched).toEqual([]);
  });

  it('by {day} buckets points on LOCAL civil days with gap domain (ticket 12)', async () => {
    // Fixtures built from local components — deterministic in every zone.
    const monday = new Date(2026, 5, 8, 10).getTime();   // Mon Jun 8
    const tuesday = new Date(2026, 5, 9, 10).getTime();  // Tue Jun 9
    const nextMon = new Date(2026, 5, 15, 10).getTime(); // Mon Jun 15
    const rows = [
      fact('totalVolume', 100, monday),
      fact('totalVolume', 200, monday + 3 * HOUR), // same civil day
      fact('totalVolume', 50, tuesday),
      fact('totalVolume', 500, nextMon),
    ];
    const { store } = makeStore(rows);
    const service = new QueryService({ eventStore: store });
    const result = await service.runQuery('sum:totalVolume{} by {day}');
    const points = result.series[0]!.points;
    // Ticket 12: the unbounded query uses the observed extent — Jun 8 …
    // Jun 15 with every interior civil day present (8 buckets, 5 missing).
    expect(points).toHaveLength(8);
    expect(points.filter((p) => p.missing)).toHaveLength(5);
    // Point ts is local noon of its civil day.
    expect(points.map((p) => new Date(p.ts).getDate())).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(points[0]!.value).toBe(300); // both Jun-8 facts folded
    expect(points[0]!.missing).toBeUndefined();
    expect(points[7]!.value).toBe(500);
  });

  it('by {week} buckets points on civil-Monday weeks', async () => {
    const monday = new Date(2026, 5, 8, 10).getTime();
    const friday = new Date(2026, 5, 12, 10).getTime();  // same civil week
    const nextMonday = new Date(2026, 5, 15, 10).getTime();
    const rows = [
      fact('totalVolume', 100, monday),
      fact('totalVolume', 100, friday),
      fact('totalVolume', 700, nextMonday),
    ];
    const { store } = makeStore(rows);
    const service = new QueryService({ eventStore: store });
    const result = await service.runQuery('sum:totalVolume{} by {week}');
    const points = result.series[0]!.points;
    expect(points).toHaveLength(2); // two civil-Monday weeks
    expect(points.map((p) => new Date(p.ts).getDate())).toEqual([8, 15]); // Mondays
    expect(points[0]!.value).toBe(200);
    expect(points[1]!.value).toBe(700);
  });

  it('week keys stay civil Mondays across the London DST transition (child probe)', () => {
    // Europe/London springs forward 2026-03-29 (Sunday): old instant math
    // (ts − N×DAY + UTC slice) mislabeled that week's Monday. The civil
    // component math cannot. Child process so TZ is set at process start.
    const probe = `
      const ts = Date.UTC(2026, 2, 29, 12); // DST-transition Sunday Mar 29
      const d = new Date(ts);
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7);
      const iso = (x) => \`\${x.getFullYear()}-\${String(x.getMonth()+1).padStart(2,'0')}-\${String(x.getDate()).padStart(2,'0')}\`;
      console.log(iso(monday));
    `;
    const result = spawnSync(process.execPath, ['-e', probe], {
      encoding: 'utf8',
      env: { ...process.env, TZ: 'Europe/London' },
    });
    if (result.status !== 0) throw new Error(result.stderr);
    expect(result.stdout.trim()).toBe('2026-03-23');
  });
});

describe('the notebook plane (ticket 08)', () => {
  const notes = [
    {
      id: 'crossfit-girls/fran',
      title: 'Fran',
      seedOrigin: 'seed',
      sourceId: 'notebook:crossfit-girls/fran',
      tags: ['for-time'],
      createdAt: 1000,
    },
    {
      id: 'crossfit-girls/helen',
      title: 'Helen',
      seedOrigin: 'seed',
      sourceId: 'notebook:crossfit-girls/helen',
      tags: ['benchmark'],
      createdAt: 1100,
    },
    {
      id: 'dan-john/armor-building',
      title: 'Armor Building Complex',
      seedOrigin: 'seed',
      sourceId: 'notebook:dan-john/armor-building',
      tags: ['kettlebell'],
      createdAt: 2000,
    },
    {
      id: 'journal/2026-03-23',
      title: 'Morning Log',
      seedOrigin: 'user',
      sourceId: 'journal',
      createdAt: 3000,
    },
  ].map(note => ({ ...note, rawContent: '', sourceRevision: 1, blocks: {} }));

  const service = new QueryService({
    eventStore: {
      getEventsByTimeRange: async () => [],
      getEventsByResult: async () => [],
    },
    noteStore: {
      getAllNotes: async () => notes as never,
      getNoteIdsForTag: async (tag) => new Set(notes.filter(n => n.tags?.includes(tag)).map(n => n.id)),
    },
    blockStore: { getAllBlocks: async () => [] },
    blockEffortsStore: {
      getAllFromIndex: async (_index: string, key: string) =>
        key === 'pull-up' ? [{ noteId: 'crossfit-girls/fran', blockId: 'b1' }] : [],
    },
    tagsStore: {
      getAllFromIndex: async (_index: string, label: string) =>
        label === 'kettlebell' ? [{ id: 'tag-eq-kettlebell', type: 'equipment', label: 'kettlebell' }] : [],
    },
    noteTagsStore: {
      getAllFromIndex: async (_index: string, tagId: string) =>
        tagId === 'tag-eq-kettlebell' ? [{ noteId: 'dan-john/armor-building' }] : [],
    },
  });

  it('the retired :catalog head no longer resolves (ticket 12 — no alias)', () => {
    const parsed = parseQuery(':catalog');
    expect(parsed.target).not.toBe('notebook');
  });

  it(':notebook{} returns the notes of every notebook — no synthetic container rows', async () => {
    const result = await service.runFind(parseQuery(':notebook{}') as never);
    expect(result.notes.map(n => n.id)).toEqual([
      'crossfit-girls/fran',
      'crossfit-girls/helen',
      'dan-john/armor-building',
      'journal/2026-03-23',
    ]);
    expect(result.notes.every(n => !n.id.startsWith('notebook/'))).toBe(true);
  });

  it(':notebook{notebook:crossfit-girls} narrows to that notebook’s notes', async () => {
    const result = await service.runFind(parseQuery(':notebook{notebook:crossfit-girls}') as never);
    expect(result.notes.map(n => n.id)).toEqual(['crossfit-girls/fran', 'crossfit-girls/helen']);
  });

  it(':notebook{!notebook:crossfit-girls} narrows the same note shape by negation', async () => {
    const result = await service.runFind(parseQuery(':notebook{!notebook:crossfit-girls}') as never);
    expect(result.notes.map(n => n.id).sort()).toEqual(['dan-john/armor-building', 'journal/2026-03-23']);
    expect(result.notes.every(n => !n.id.startsWith('notebook/'))).toBe(true);
  });

  it(':notebook{source:notebooks} keeps notebook-delivered notes only', async () => {
    const result = await service.runFind(parseQuery(':notebook{source:notebooks}') as never);
    expect(result.notes.map(n => n.id).sort()).toEqual([
      'crossfit-girls/fran',
      'crossfit-girls/helen',
      'dan-john/armor-building',
    ]);
  });

  it('member criteria narrow notebook results: tags:, effort:, typed tags, text', async () => {
    expect((await service.runFind(parseQuery(':notebook{tags:for-time}') as never)).notes.map(n => n.id))
      .toEqual(['crossfit-girls/fran']);
    // The singular `tag:` spelling is accepted by the capabilities and must
    // narrow too — never silently ignored.
    expect((await service.runFind(parseQuery(':notebook{tag:for-time}') as never)).notes.map(n => n.id))
      .toEqual(['crossfit-girls/fran']);
    expect((await service.runFind(parseQuery(':notebook{effort:pull-up}') as never)).notes.map(n => n.id))
      .toEqual(['crossfit-girls/fran']);
    expect((await service.runFind(parseQuery(':notebook{equipment:kettlebell}') as never)).notes.map(n => n.id))
      .toEqual(['dan-john/armor-building']);
    expect((await service.runFind(parseQuery(':notebook{text:armor}') as never)).notes.map(n => n.id))
      .toEqual(['dan-john/armor-building']);
    // Combined with a container narrow, criteria restrict its members.
    expect((await service.runFind(parseQuery(':notebook{notebook:crossfit-girls, tags:benchmark}') as never)).notes.map(n => n.id))
      .toEqual(['crossfit-girls/helen']);
  });

  it('filters by feed:<id> and feed:local', async () => {
    const feedNotes = [
      { id: 'n1', title: 'N1', rawContent: '', sourceRevision: 1, blocks: {}, createdAt: 1, feedSourceId: 'seed-crossfit', sourceId: 'notebook:crossfit-girls/fran' },
      { id: 'n2', title: 'N2', rawContent: '', sourceRevision: 1, blocks: {}, createdAt: 2, feedSourceId: 'custom-feed', sourceId: 'notebook:custom/a' },
      { id: 'n3', title: 'N3', rawContent: '', sourceRevision: 1, blocks: {}, createdAt: 3, notebookId: 'my-notebook' },
    ];
    const s = new QueryService({
      eventStore: { getEventsByTimeRange: async () => [], getEventsByResult: async () => [] },
      noteStore: { getAllNotes: async () => feedNotes as never, getNoteIdsForTag: async () => new Set() },
    });

    const resFeed = await s.runFind(parseQuery(':notebook{feed:seed-crossfit}') as never);
    expect(resFeed.notes.map(n => n.id)).toEqual(['n1']);

    const resLocal = await s.runFind(parseQuery(':notebook{feed:local}') as never);
    expect(resLocal.notes.map(n => n.id)).toEqual(['n3']);
  });

  it('applies subscribed filter and default visibility predicate on :notebook{}', async () => {
    const mixedNotes = [
      { id: 'user-note', title: 'User Note', rawContent: '', sourceRevision: 1, blocks: {}, createdAt: 1, notebookId: 'my-nb' },
      { id: 'sub-note', title: 'Subscribed Seed', rawContent: '', sourceRevision: 1, blocks: {}, createdAt: 2, feedSourceId: 'feed-a', seedChunkId: 'notebook.chunk-a' },
      { id: 'unsub-note', title: 'Unsubscribed Seed', rawContent: '', sourceRevision: 1, blocks: {}, createdAt: 3, feedSourceId: 'feed-b', seedChunkId: 'notebook.chunk-b' },
    ];
    const isSub = (fid: string, cid: string) => fid === 'feed-a' && cid === 'notebook.chunk-a';
    const s = new QueryService({
      eventStore: { getEventsByTimeRange: async () => [], getEventsByResult: async () => [] },
      noteStore: { getAllNotes: async () => mixedNotes as never, getNoteIdsForTag: async () => new Set() },
      isNotebookSubscribed: isSub,
    });

    // Default visibility on :notebook{}: user notes + subscribed seed notes (unsubscribed seed excluded)
    const defRes = await s.runFind(parseQuery(':notebook{}') as never);
    expect(defRes.notes.map(n => n.id)).toEqual(['user-note', 'sub-note']);

    // Explicit subscribed:false
    const unsubRes = await s.runFind(parseQuery(':notebook{subscribed:false}') as never);
    expect(unsubRes.notes.map(n => n.id)).toEqual(['unsub-note']);

    // Explicit subscribed:true,false
    const allRes = await s.runFind(parseQuery(':notebook{subscribed:true,false}') as never);
    expect(allRes.notes.map(n => n.id)).toEqual(['user-note', 'sub-note', 'unsub-note']);
  });
});
