import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { runQueryCli, type QueryResult } from '../src/index';

const FIXTURE_PATH = join(__dirname, '../../wql/fixtures/corpus/crossfit-multi-week.json');

describe('Corpus Parity Tests (crossfit-multi-week.json)', () => {
  it('matches expected series for weekly volume rollup: sum:totalVolume{} by {week}', async () => {
    const ir = await runQueryCli('sum:totalVolume{} by {week}', {
      corpusPath: FIXTURE_PATH,
      preferredUnit: 'lb',
    });

    expect(ir.kind).toBe('query-result');
    const result = ir.data as QueryResult;

    expect(result.series.length).toBe(1);
    const series = result.series[0];
    expect(series.key).toBe('totalVolume');
    // Ticket 13 arithmetic contract: the corpus's totalVolume facts mix mass
    // (lb) and count (rep) dimensions — the aggregate reports the
    // incompatible-units diagnostic instead of a silently pooled sum.
    expect(series.error).toContain('Incompatible units');
    expect(series.points.length).toBe(0);
    // The incompatible-units diagnostic leaves no valid points.
    expect(series.points).toEqual([]);
  });

  it('matches expected scalar for overall average intensity: avg:tis{}', async () => {
    const ir = await runQueryCli('avg:tis{}', {
      corpusPath: FIXTURE_PATH,
    });

    expect(ir.kind).toBe('query-result');
    const result = ir.data as QueryResult;

    expect(result.scalar).toBeCloseTo(49.08, 2);
  });

  it('matches expected breakdown for discipline session load: sum:sessionLoad{} by {discipline}', async () => {
    const ir = await runQueryCli('sum:sessionLoad{} by {discipline}', {
      corpusPath: FIXTURE_PATH,
    });

    expect(ir.kind).toBe('query-result');
    const result = ir.data as QueryResult;

    const disciplines = result.series.map((s) => ({
      key: s.label,
      total: s.points.reduce((acc, p) => acc + p.value, 0),
    }));

    const gym = disciplines.find((d) => d.key === 'gymnastics');
    const kb = disciplines.find((d) => d.key === 'kettlebell');
    const bw = disciplines.find((d) => d.key === 'bodyweight');

    expect(gym).toBeDefined();
    expect(gym?.total).toBe(1380);

    expect(kb).toBeDefined();
    expect(kb?.total).toBe(1710);

    expect(bw).toBeDefined();
    expect(bw?.total).toBe(990);
  });

  it('preserves legacy fact-set ingestion pin (ticket 010)', async () => {
    const legacyFacts = [
      {
        id: 'f1',
        resultId: 'r1',
        noteId: 'n1',
        grain: 'summary',
        type: 'totalVolume',
        value: 1000,
        unit: 'lb',
        timestamp: Date.parse('2026-06-01T12:00:00Z'),
      },
      {
        id: 'f2',
        resultId: 'r2',
        noteId: 'n1',
        grain: 'summary',
        type: 'totalVolume',
        value: 2000,
        unit: 'lb',
        timestamp: Date.parse('2026-06-08T12:00:00Z'),
      },
    ];

    const ir = await runQueryCli('sum:totalVolume{}', {
      stdinFacts: JSON.stringify(legacyFacts),
    });

    expect(ir.kind).toBe('query-result');
    const result = ir.data as QueryResult;
    // Ticket 13: the kg system default applies even to legacy fact ingestion.
    expect(result.scalar).toBeCloseTo(3000 * 0.45359237, 6);
  });
});
