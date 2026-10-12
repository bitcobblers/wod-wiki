import { describe, expect, it } from 'vitest';
import {
  projectEventToFacts,
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
    id: 's1',
    outputType: 'segment',
    metrics: [],
    ...overrides,
  } as StoredOutputStatement;
}

function eventRow(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'r1:0',
    resultId: 'r1',
    noteId: 'n1',
    blockContentId: 'bc1',
    pageId: 'p1',
    origin: 'journal',
    timestamp: TS,
    grain: 'event',
    outputType: 'segment',
    metrics: [],
    blockId: 'seg1',
    blockVersion: 1,
    ...overrides,
  };
}

function metric(m: {
  type?: string; value?: unknown; unit?: string; metadata?: Record<string, unknown>;
}): StoredOutputStatement['metrics'][number] {
  return m as StoredOutputStatement['metrics'][number];
}

describe('ticket 11 — typed field identity survives projection', () => {
  it('projects two custom properties under their own keys, never a pooled `custom` (acceptance 1)', () => {
    const row = eventRow({
      metrics: [
        metric({ type: 'custom', value: 48, metadata: { fieldRef: { path: 'hrv', kind: 'number' }, originalKey: 'hrv' } }),
        metric({ type: 'custom', value: 7.5, metadata: { fieldRef: { path: 'sleep', kind: 'number' }, originalKey: 'sleep' } }),
      ],
    } as Partial<EventRecord>);
    const facts = projectEventToFacts(row);
    expect(facts.map((f) => f.metricKey).sort()).toEqual(['hrv', 'sleep']);
    expect(facts.every((f) => f.metricKey !== 'custom')).toBe(true);
  });

  it('normalizes equivalent spellings to one key with the original spelling as provenance (acceptance 2)', () => {
    // Authored side: PropertyMetric stamps the normalized path — simulate
    // three authorings of the same field via the classifier's constructor.
    // Projection side: each collapses to heartRate; heartrate stays distinct.
    const spellings = ['heart rate', 'heart_rate', 'HeartRate'];
    for (const spelling of spellings) {
      const row = eventRow({
        metrics: [metric({ type: 'custom', value: 60, metadata: { fieldRef: { path: 'heartRate', kind: 'number' }, originalKey: spelling } })],
      } as Partial<EventRecord>);
      const facts = projectEventToFacts(row);
      expect(facts).toHaveLength(1);
      expect(facts[0]!.metricKey).toBe('heartRate');
    }
    const distinct = eventRow({
      metrics: [metric({ type: 'custom', value: 60, metadata: { fieldRef: { path: 'heartrate', kind: 'number' }, originalKey: 'heartrate' } })],
    } as Partial<EventRecord>);
    expect(projectEventToFacts(distinct)[0]!.metricKey).toBe('heartrate');
  });

  it('numeric facts exclude text variants without synthesizing zeros (acceptance 3)', () => {
    const row = eventRow({
      metrics: [
        metric({ type: 'custom', value: 85, metadata: { fieldRef: { path: 'score', kind: 'number' } } }),
        metric({ type: 'custom', value: 'excellent', metadata: { fieldRef: { path: 'score', kind: 'string' } } }),
      ],
    } as Partial<EventRecord>);
    const facts = projectEventToFacts(row);
    // Fact currency is numeric-only: the text variant never projects, so a
    // numeric aggregation of `score` sees exactly the numeric observation.
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metricKey).toBe('score');
    expect(facts[0]!.value).toBe(85);
  });

  it('treats flat dotted and nested forms as one identity at projection (acceptance 4)', () => {
    const flat = eventRow({
      metrics: [metric({ type: 'custom', value: 85, metadata: { fieldRef: { path: 'sleep.score', kind: 'number' }, originalKey: 'sleep.score' } })],
    } as Partial<EventRecord>);
    const nested = eventRow({
      metrics: [metric({ type: 'custom', value: 85, metadata: { fieldRef: { path: 'sleep.score', kind: 'number' }, originalKey: 'sleep' } })],
    } as Partial<EventRecord>);
    const flatFacts = projectEventToFacts(flat);
    const nestedFacts = projectEventToFacts(nested);
    expect(flatFacts[0]!.metricKey).toBe('sleep.score');
    expect(nestedFacts[0]!.metricKey).toBe(flatFacts[0]!.metricKey);
  });

  it('folds two typed variants of one path into separate summary rows (never together)', () => {
    const logs = [
      statement({
        outputType: 'analytics',
        metrics: [
          metric({ type: 'label', value: 'score', metadata: {} }),
          metric({ type: 'custom', value: 85, metadata: { fieldRef: { path: 'score', kind: 'number' } } }),
        ],
      }),
      statement({
        outputType: 'analytics',
        metrics: [
          metric({ type: 'label', value: 'score', metadata: {} }),
          metric({ type: 'custom', value: 90, metadata: { fieldRef: { path: 'score', kind: 'number', dimension: 'mass' } } }),
        ],
      }),
    ] as unknown as StoredOutputStatement[];
    const rows = toSummaryEventRows(logs, IDENTITY);
    // Two distinct fold identities — the dimensionless and mass variants of
    // `score` never fold into one keep-last row.
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    // Both carry the queryable path as their canonical key.
    for (const row of rows) {
      const m = row.metrics[0] as { metadata?: Record<string, unknown> };
      expect(m.metadata?.canonicalKey).toBe('score');
    }
  });

  it('keeps built-in family keys identical (acceptance 6 — canonicalKey wins over fieldRef)', () => {
    const row = eventRow({
      metrics: [
        metric({ type: 'distance', value: 1000, unit: 'm', metadata: { canonicalKey: 'distance', fieldRef: { path: 'distance', kind: 'number', dimension: 'length' } } }),
        metric({ type: 'elapsed', value: 60, unit: 's', metadata: { canonicalKey: 'elapsed' } }),
      ],
    } as Partial<EventRecord>);
    const facts = projectEventToFacts(row);
    expect(facts.map((f) => f.metricKey).sort()).toEqual(['distance', 'elapsed']);
  });

  it('keeps legacy label-derived fallback for unlabeled legacy data and drops pooled custom', () => {
    // Legacy unlabeled statement: label metric drives the key.
    const labeled = eventRow({
      metrics: [
        metric({ type: 'label', value: 'Total Volume' }),
        metric({ type: 'rep', value: 21 }),
      ],
    } as Partial<EventRecord>);
    const facts = projectEventToFacts(labeled);
    expect(facts.map((f) => f.metricKey)).toEqual(['totalVolume']);

    // Pre-fieldRef custom property with no identity source: no invented key.
    const pooled = eventRow({
      metrics: [metric({ type: 'custom', value: 5 })],
    } as Partial<EventRecord>);
    expect(projectEventToFacts(pooled)).toEqual([]);

    // Unlabeled rep metrics keep the genuine legacy `reps` fallback.
    const unlabeledReps = eventRow({
      metrics: [metric({ type: 'rep', value: 15 })],
    } as Partial<EventRecord>);
    expect(projectEventToFacts(unlabeledReps)[0]!.metricKey).toBe('reps');
  });
});
