import { describe, expect, it } from 'vitest';
import {
  projectEventToFacts,
  toEventRows,
  toSummaryEventRows,
  type EventRowIdentity,
} from '../src/derivation';
import type { StoredOutputStatement, EventRecord } from '@bitcobblers/wod-wiki-core';

const TS = 1_700_000_000_000;
const IDENTITY: EventRowIdentity = {
  noteId: 'n1',
  resultId: 'r1',
  blockContentId: 'bc1',
  origin: 'journal',
  pageId: 'p1',
  workoutTimestamp: TS,
};

function statement(overrides: Partial<StoredOutputStatement> = {}): StoredOutputStatement {
  return {
    outputType: 'segment',
    metrics: [
      { type: 'label', value: 'Total Volume' },
      { type: 'volume', value: 142, unit: 'kg', metadata: { effortSlug: 'effort-01' } },
    ],
    timeSpan: { started: TS + 5_000, ended: TS + 65_000 },
    sourceBlockKey: 'blk-1',
    stackLevel: 2,
    ...overrides,
  } as StoredOutputStatement;
}

function summaryStatement(
  projection: string,
  value: number,
  unit: string,
  metadata: Record<string, unknown> = {},
): StoredOutputStatement {
  return {
    outputType: 'analytics',
    metrics: [
      { type: 'label', value: projection },
      { type: 'volume', value, unit, metadata },
    ],
    timeSpan: { started: TS, ended: TS },
  } as StoredOutputStatement;
}

/** Narrow the loose stored-metric union down to the metadata-carrying shape. */
function metricMetadata(metric: unknown): Record<string, unknown> | undefined {
  if (metric && typeof metric === 'object' && 'metadata' in metric) {
    const meta = (metric as { metadata?: unknown }).metadata;
    return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : undefined;
  }
  return undefined;
}

describe('toEventRows — logs → event rows, 1:1 per statement (ticket 002)', () => {
  it('maps every statement to an event row with promoted identity and deterministic id', () => {
    const rows = toEventRows([statement(), statement({ outputType: 'system' })], IDENTITY);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'r1:0',
      resultId: 'r1',
      noteId: 'n1',
      blockContentId: 'bc1',
      pageId: 'p1',
      origin: 'journal',
      grain: 'event',
      outputType: 'segment',
      // Ticket 12: the statement's OWN timeSpan wins — the workout-start
      // timestamp never relocates an observation whose own instant differs.
      metricTemporal: [
        { temporalKind: 'instant', instant: TS + 5_000 },
        { temporalKind: 'instant', instant: TS + 5_000 },
      ],
      sourceBlockKey: 'blk-1',
      stackLevel: 2,
    });
    expect(rows[1].id).toBe('r1:1');
    expect(rows[1].timestamp).toBe(TS + 5_000);
    // metrics array carried verbatim
    expect(rows[0].metrics).toEqual(statement().metrics);
  });

  it('falls back to the workout timestamp when the statement has no timeSpan', () => {
    const rows = toEventRows([statement({ timeSpan: undefined })], IDENTITY);
    expect(rows[0].timestamp).toBe(TS);
    expect(rows[0].metricTemporal).toBeUndefined();
  });

  it('takes effortSlug from the first metric that carries one', () => {
    const s = statement({
      metrics: [
        { type: 'label', value: 'X' },
        { type: 'reps', value: 21 },
        { type: 'volume', value: 100, metadata: { effortSlug: 'effort-09' } },
      ],
    } as Partial<StoredOutputStatement>);
    expect(toEventRows([s], IDENTITY)[0].effortSlug).toBe('effort-09');
  });
});

describe('projectEventToFacts — grade dim promotion', () => {
  it('promotes a grade-typed metric to every projected fact row', () => {
    const rows = toEventRows(
      [
        statement({
          metrics: [
            { type: 'label', value: 'Send' },
            { type: 'rep', value: 1 },
            { type: 'grade', value: 'V8' },
          ],
        } as StoredOutputStatement),
      ],
      IDENTITY,
    );
    const facts = projectEventToFacts(rows[0]!);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.grade === 'V8')).toBe(true);
  });

  it('keeps metadata-stamped grades ahead of the grade metric fallback', () => {
    const rows = toEventRows(
      [
        statement({
          metrics: [
            { type: 'label', value: 'Send' },
            { type: 'volume', value: 1, metadata: { grade: 'V5' } },
            { type: 'grade', value: 'V8' },
          ],
        } as StoredOutputStatement),
      ],
      IDENTITY,
    );
    const facts = projectEventToFacts(rows[0]!);
    expect(facts.find((f) => f.metricKey !== 'grade')!.grade).toBe('V5');
  });
});

describe('projectEventToFacts — user-authored custom dims', () => {
  it('promotes a string-valued property metric into every fact row dims', () => {
    const rows = toEventRows(
      [
        statement({
          metrics: [
            { type: 'label', value: 'Send' },
            { type: 'rep', value: 1 },
            { type: 'custom', value: 'greg', metadata: { fieldRef: { path: 'coach', kind: 'string' } } },
          ],
        } as StoredOutputStatement),
      ],
      IDENTITY,
    );
    const facts = projectEventToFacts(rows[0]!);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.dimensions?.coach === 'greg')).toBe(true);
    expect(facts.every((f) => f.dimensions?.label === undefined)).toBe(true);
  });

  it('inherits grouped partition identity from summary metadata groupTags', () => {
    const rows = toSummaryEventRows([
      summaryStatement('Total Volume', 142, 'kg', { effortSlug: 'thruster', groupTags: { coach: 'greg' } }),
    ], IDENTITY);
    const facts = projectEventToFacts(rows[0]!);
    expect(facts[0]?.dimensions?.coach).toBe('greg');
  });
});

describe('toSummaryEventRows — analytics outputs → deterministic summary rows (tickets 002/004)', () => {
  it('emits one keep-last summary row per metricKey+groupTags with a deterministic id', () => {
    const logs: StoredOutputStatement[] = [
      summaryStatement('Total Volume', 100, 'kg', { effortSlug: 'effort-01' }),
      summaryStatement('Total Volume', 200, 'kg', { effortSlug: 'effort-01' }), // keep-last
      summaryStatement('TIS', 12, 'min'),
    ];
    const rows = toSummaryEventRows(logs, IDENTITY);

    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const vol = byId.get('r1:summary:totalVolume:effort=effort-01');
    expect(vol).toBeDefined();
    expect(vol!.grain).toBe('summary');
    expect(vol!.outputType).toBe('analytics');
    expect(vol!.timestamp).toBe(TS);
    // exactly one metrics entry; fold identity lives in metadata
    expect(vol!.metrics).toHaveLength(1);
    const m = vol!.metrics[0] as { value: unknown };
    expect(m.value).toBe(200);
    expect(metricMetadata(vol!.metrics[0])).toMatchObject({ canonicalKey: 'totalVolume', effortSlug: 'effort-01' });
    expect(byId.get('r1:summary:tis')).toBeDefined();
  });

  it('is deterministic — same logs, same ids, no timestamp salt', () => {
    const logs = [summaryStatement('Total Volume', 100, 'kg')];
    const a = toSummaryEventRows(logs, IDENTITY);
    const b = toSummaryEventRows(logs, IDENTITY);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
  });

  it('carries grade through the summary fold and back out of projection', () => {
    const logs: StoredOutputStatement[] = [
      summaryStatement('Total Volume', 200, 'kg', { effortSlug: 'effort-01', grade: 'Rx' }),
    ];
    const [row] = toSummaryEventRows(logs, IDENTITY);
    expect(metricMetadata(row.metrics[0])?.grade).toBe('Rx');
    const [fact] = projectEventToFacts(row);
    expect(fact.grade).toBe('Rx');
  });
});

describe('projectEventToFacts — event rows → flat fact currency (ticket 003 SELECT)', () => {
  it('flattens an event row to one fact per numeric metric, canonical key first', () => {
    const row: EventRecord = toEventRows(
      [
        statement({
          metrics: [
            { type: 'label', value: 'Total Volume' },
            { type: 'volume', value: 142, unit: 'kg', metadata: { canonicalKey: 'totalVolume', effortSlug: 'effort-01' } },
            { type: 'reps', value: 21 },
          ],
        } as Partial<StoredOutputStatement>),
      ],
      IDENTITY,
    )[0];
    const facts = projectEventToFacts(row);

    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({
      id: 'r1:0:0',
      resultId: 'r1',
      grain: 'event',
      metricKey: 'totalVolume', // metadata.canonicalKey wins
      value: 142,
      timestamp: TS + 5_000, // the metric's own occurrence instant (ticket 12)
    });
    // no canonicalKey → name-derived from the row's label metric
    expect(facts[1].metricKey).toBe('totalVolume');
    expect(facts[1].value).toBe(21);
  });

  it('projects a summary row to exactly one fact from its single metrics entry', () => {
    const summary = toSummaryEventRows(
      [summaryStatement('Total Volume', 200, 'kg', { effortSlug: 'effort-01' })],
      IDENTITY,
    )[0];
    const facts = projectEventToFacts(summary);

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      id: `${summary.id}:0`,
      grain: 'summary',
      metricKey: 'totalVolume',
      value: 200,
    });
  });
});

describe('projectEventToFacts — ownership precedence (user actuals)', () => {
  it('projects one rep fact — the user correction — not planned+actual double count', () => {
    // A corrected segment row keeps the planned (parser) rep raw alongside the
    // user-origin actual; raw fact queries must count the authoritative value once.
    const row: EventRecord = {
      id: 'r1:0',
      resultId: 'r1',
      noteId: 'n1',
      timestamp: TS,
      grain: 'event',
      outputType: 'segment',
      sourceBlockKey: 'blk-1',
      stackLevel: 2,
      metrics: [
        { type: 'rep', value: 21, image: '21', origin: 'parser' }, // planned target
        { type: 'rep', value: 17, image: '17', origin: 'user' }, // user actual
        { type: 'effort', value: 'Deadlift', image: 'Deadlift', origin: 'parser' },
        { type: 'elapsed', value: 30_000, origin: 'runtime' },
      ],
    };
    const facts = projectEventToFacts(row);

    const repFacts = facts.filter((f) => f.metricKey === 'reps');
    expect(repFacts).toHaveLength(1);
    expect(repFacts[0]).toMatchObject({ value: 17, grain: 'event' });
    // non-rep metrics unaffected
    expect(facts.some((f) => f.metricKey === 'elapsed' && f.value === 30_000)).toBe(true);
    // effort is a string value — projects no numeric fact of its own
    expect(facts.filter((f) => f.metricKey === 'effort')).toHaveLength(0);
  });

  it('collapses same-type layered values to the highest layer (runtime over parser)', () => {
    const row: EventRecord = {
      id: 'r1:1',
      resultId: 'r1',
      noteId: 'n1',
      timestamp: TS,
      grain: 'event',
      outputType: 'segment',
      sourceBlockKey: 'blk-1',
      metrics: [
        { type: 'rep', value: 10, image: '10', origin: 'parser' },
        { type: 'rep', value: 8, image: '8', origin: 'runtime' }, // counted value
      ],
    };
    const facts = projectEventToFacts(row);
    const repFacts = facts.filter((f) => f.metricKey === 'reps');
    expect(repFacts).toHaveLength(1);
    expect(repFacts[0].value).toBe(8);
  });
});
