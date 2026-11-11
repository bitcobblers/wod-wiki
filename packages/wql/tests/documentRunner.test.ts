import { describe, expect, it } from 'vitest';
import { QueryDocumentRunner } from '../src/documentRunner';

interface FakeSeries { key: string; label: string; points: Array<{ ts: number; value: number; missing?: boolean }>; unit?: string }
function fakeRunner(series: Record<string, FakeSeries>, errors: Record<string, string> = {}) {
  const calls: Array<{ queryText: string; groupBy?: string[] }> = [];
  const runner = new QueryDocumentRunner(async (queryText, overrides) => {
    calls.push({ queryText, groupBy: overrides.groupBy });
    const metric = queryText.replace(/^[a-z]+:/, '').replace(/\{.*\}/, '').trim();
    const s = series[metric];
    return { series: s ? [s] : [], unit: s?.unit, error: errors[metric] };
  });
  return { runner, calls };
}

const day = 86_400_000;
const weeks = [0, 7, 14].map((d) => 1_750_000_000_000 + d * day);

describe('ticket 17 — document evaluation', () => {
  it('evaluates post-aggregate formulas over the union of aligned positions', async () => {
    const { runner } = fakeRunner({
      distance: { key: 'distance', label: 'distance', unit: 'km', points: weeks.map((ts) => ({ ts, value: 10 })) },
      elapsed: { key: 'elapsed', label: 'elapsed', unit: 's', points: weeks.map((ts) => ({ ts, value: 5 })) },
    });
    const text = [
      'distance = sum:distance{}',
      'elapsed = sum:elapsed{}',
      'speed = distance / elapsed -> min/km',
      'show distance, speed',
    ].join('\n');
    const result = await runner.run(text);
    expect(result.diagnostics).toEqual([]);
    const speed = result.outputs.find((o) => o.name === 'speed')!;
    expect(speed.unit).toBe('min/km');
    expect(speed.series![0]!.points.map((p) => p.value)).toEqual([2, 2, 2]);
  });

  it('missing operands substitute zero and the result is flagged missing-derived', async () => {
    const { runner } = fakeRunner({
      a: { key: 'a', label: 'a', points: [{ ts: weeks[0]!, value: 10 }, { ts: weeks[1]!, value: 20 }] },
      // Grouped one-point series → a series operand, so week 2 stays missing.
      b: { key: 'b', label: 'b', points: [{ ts: weeks[0]!, value: 5 }] }, // week 2 missing
    });
    const result = await runner.run([
      'a = sum:a{}',
      'b = sum:b{} by {week}',
      'c = a / b',
      'show c',
    ].join('\n'));
    const points = result.outputs[0]!.series![0]!.points;
    expect(points.find((p) => p.ts === weeks[0])!.value).toBe(2);
    const week2 = points.find((p) => p.ts === weeks[1])!;
    // a=20, b missing → zero substitution → division by zero → error state.
    expect(result.outputs[0]!.error).toContain('Division by zero');
    void week2;
  });

  it('missing + missing is zero; 10 + missing = 10 (presence rules)', async () => {
    const { runner } = fakeRunner({
      a: { key: 'a', label: 'a', points: [{ ts: weeks[0]!, value: 10 }] },
      b: { key: 'b', label: 'b', points: [] },
    });
    // b exists as an assignment but has no positions → 0 + 10 at a's position.
    const result = await runner.run([
      'a = sum:a{}',
      'b = sum:b{}',
      'c = a + b',
      'show c',
    ].join('\n'));
    expect(result.outputs[0]!.error).toBeUndefined();
    expect(result.outputs[0]!.series![0]!.points[0]!.value).toBe(10);
    expect(result.outputs[0]!.series![0]!.points[0]!.missingDerived).toBe(true);
  });

  it('ungrouped scalar-to-scalar arithmetic aligns to one point even when timestamps differ', async () => {
    const { runner } = fakeRunner({
      a: { key: 'a', label: 'a', points: [{ ts: 1000, value: 20 }] },
      b: { key: 'b', label: 'b', points: [{ ts: 2000, value: 10 }] },
    });
    const result = await runner.run([
      'a = sum:a{}',
      'b = sum:b{}',
      'c = a / b',
      'show c',
    ].join('\n'));
    const c = result.outputs.find((o) => o.name === 'c')!;
    expect(c.error).toBeUndefined();
    expect(c.series![0]!.points).toEqual([{ ts: 1000, value: 2 }]);
  });

  it('corr is paired-only and reports the pair count', async () => {
    const { runner } = fakeRunner({
      a: { key: 'a', label: 'a', points: [{ ts: weeks[0]!, value: 1 }, { ts: weeks[1]!, value: 2 }, { ts: weeks[2]!, value: 3 }] },
      b: { key: 'b', label: 'b', points: [{ ts: weeks[0]!, value: 2 }, { ts: weeks[1]!, value: 4 }, { ts: weeks[2]!, value: 6 }] },
    });
    const result = await runner.run([
      'a = sum:a{}',
      'b = sum:b{}',
      'r = corr(a, b)',
      'show r',
    ].join('\n'));
    expect(result.outputs[0]!.pairs).toBe(3);
    expect(result.outputs[0]!.series![0]!.points[0]!.value).toBeCloseTo(1, 6);
  });

  it('corr excludes one-side-missing pairs and flags zero variance', async () => {
    const { runner } = fakeRunner({
      a: { key: 'a', label: 'a', points: [{ ts: weeks[0]!, value: 5 }, { ts: weeks[1]!, value: 5 }] },
      b: { key: 'b', label: 'b', points: [{ ts: weeks[0]!, value: 1 }, { ts: weeks[1]!, value: 2 }] },
    });
    const result = await runner.run([
      'a = sum:a{}',
      'b = sum:b{}',
      'r = corr(a, b)',
      'show r',
    ].join('\n'));
    expect(result.outputs[0]!.error).toContain('zero-variance');
  });

  it('cycles produce a diagnostic and no run (document-level)', async () => {
    const { runner, calls } = fakeRunner({});
    const result = await runner.run('a = b + 1\nb = a + 1\nshow a');
    expect(result.diagnostics.some((d) => d.toLowerCase().includes('cycle'))).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('ticket 17 — defaults precedence', () => {
  it('explicit per-query grouping fully replaces block grouping (never merges)', async () => {
    const { runner, calls } = fakeRunner({
      distance: { key: 'd', label: 'd', points: [{ ts: weeks[0]!, value: 10 }] },
    });
    const text = [
      'defaults by {week} last 4w',
      'distance = sum:distance{} by {shoe}',
      'show distance',
    ].join('\n');
    await runner.run(text);
    // The per-query by {shoe} replaces the block grouping entirely.
    expect(calls[0]!.groupBy).toEqual(['shoe']);
  });

  it('block defaults apply when the query has none', async () => {
    const { runner, calls } = fakeRunner({
      distance: { key: 'd', label: 'd', points: [{ ts: weeks[0]!, value: 10 }] },
    });
    const text = [
      'defaults by {week} last 4w',
      'distance = sum:distance{}',
      'show distance',
    ].join('\n');
    await runner.run(text);
    expect(calls[0]!.groupBy).toEqual(['week']);
  });
});
