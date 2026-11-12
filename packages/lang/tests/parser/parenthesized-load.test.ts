import { describe, it, expect } from 'vitest';
import { MetricType, type ICodeStatement, type IMetric } from '@bitcobblers/wod-wiki-core';
import { parseScript } from '../../src/parser/parseScript';
import { createReferenceIndex } from '../../src/effort-registry/reference-resolution';

function metricOf(stmt: ICodeStatement, type: MetricType): IMetric | undefined {
  return stmt.metrics.toArray().find((m) => m.type === type);
}

describe('WW-007: parenthesized resistance, distance, and unit annotations', () => {
  it('parses "15 Kettlebell Swings (24kg)" as a single movement with Resistance(24, "kg") and no RoundsMetric', () => {
    const script = parseScript('15 Kettlebell Swings (24kg)');
    expect(script.errors ?? []).toHaveLength(0);
    expect(script.statements).toHaveLength(1);

    const [stmt] = script.statements;
    expect(stmt.isLeaf).toBe(true);
    expect(stmt.children).toEqual([]);
    expect(metricOf(stmt, MetricType.Rounds)).toBeUndefined();
    expect(metricOf(stmt, MetricType.Rep)?.value).toBe(15);
    expect(metricOf(stmt, MetricType.Effort)?.value).toBe('Kettlebell Swings');
    expect(metricOf(stmt, MetricType.Resistance)?.value).toEqual({ amount: 24, unit: 'kg' });
  });

  it.each([
    { source: '15 Kettlebell Swings (24 kg)', expected: { amount: 24, unit: 'kg' } },
    { source: '15 Kettlebell Swings (53lb)', expected: { amount: 53, unit: 'lb' } },
    { source: '15 Kettlebell Swings (53 lbs)', expected: { amount: 53, unit: 'lbs' } },
    { source: '15 Kettlebell Swings (1.5pood)', expected: { amount: 1.5, unit: 'pood' } },
    { source: '15 Kettlebell Swings (1.5 pood)', expected: { amount: 1.5, unit: 'pood' } },
  ])('parses $source cleanly into Resistance without splitting rounds', ({ source, expected }) => {
    const script = parseScript(source);
    expect(script.errors ?? []).toHaveLength(0);
    expect(script.statements).toHaveLength(1);

    const [stmt] = script.statements;
    expect(metricOf(stmt, MetricType.Rounds)).toBeUndefined();
    expect(metricOf(stmt, MetricType.Rep)?.value).toBe(15);
    expect(metricOf(stmt, MetricType.Effort)?.value).toBe('Kettlebell Swings');
    expect(metricOf(stmt, MetricType.Resistance)?.value).toEqual(expected);
  });

  it('also fuses unparenthesized pood loads via WOD/CrossFit dialects', () => {
    const script = parseScript('15 Kettlebell Swings 1.5pood');
    expect(script.errors ?? []).toHaveLength(0);
    expect(script.statements).toHaveLength(1);
    expect(metricOf(script.statements[0], MetricType.Resistance)?.value).toEqual({
      amount: 1.5,
      unit: 'pood',
    });
  });

  it('parses parenthesized distance and energy annotations without emitting RoundsMetric', () => {
    const run = parseScript('Run (400m)');
    expect(run.statements).toHaveLength(1);
    expect(metricOf(run.statements[0], MetricType.Rounds)).toBeUndefined();
    expect(metricOf(run.statements[0], MetricType.Effort)?.value).toBe('Run');
    expect(metricOf(run.statements[0], MetricType.Distance)?.value).toEqual({
      amount: 400,
      unit: 'm',
    });

    const row = parseScript('Row (20 cal)');
    expect(row.statements).toHaveLength(1);
    expect(metricOf(row.statements[0], MetricType.Rounds)).toBeUndefined();
    expect(metricOf(row.statements[0], MetricType.Effort)?.value).toBe('Row');
    expect(metricOf(row.statements[0], 'energy' as MetricType)?.value).toEqual({
      amount: 20,
      unit: 'cal',
    });
  });

  it('parses parenthesized duration and unit-only annotations cleanly', () => {
    const hold = parseScript('Plank (20s)');
    expect(hold.statements).toHaveLength(1);
    expect(metricOf(hold.statements[0], MetricType.Rounds)).toBeUndefined();
    expect(metricOf(hold.statements[0], MetricType.Effort)?.value).toBe('Plank');
    expect(metricOf(hold.statements[0], MetricType.Duration)?.value).toBe(20_000);

    const cal = parseScript('20 Row (cal)');
    expect(cal.statements).toHaveLength(1);
    expect(metricOf(cal.statements[0], MetricType.Rounds)).toBeUndefined();
    expect(metricOf(cal.statements[0], MetricType.Effort)?.value).toBe('Row');

    const reps = parseScript('Max Pushups (reps)');
    expect(reps.statements).toHaveLength(1);
    expect(metricOf(reps.statements[0], MetricType.Rounds)).toBeUndefined();
    expect(metricOf(reps.statements[0], MetricType.Rep)).toBeDefined();
  });

  it('preserves leading rounds when combined with trailing parenthesized load', () => {
    const script = parseScript('(3) 15 Kettlebell Swings (24kg)');
    expect(script.errors ?? []).toHaveLength(0);
    expect(script.statements).toHaveLength(2);

    const [parent, child] = script.statements;
    expect(metricOf(parent, MetricType.Rounds)?.value).toBe(3);
    expect(metricOf(parent, MetricType.Rep)?.value).toBe(15);

    expect(metricOf(child, MetricType.Rounds)).toBeUndefined();
    expect(metricOf(child, MetricType.Effort)?.value).toBe('Kettlebell Swings');
    expect(metricOf(child, MetricType.Resistance)?.value).toEqual({ amount: 24, unit: 'kg' });
  });

  it('preserves valid rounds, sets, rep schemes, and protocol labels in parentheses', () => {
    expect(metricOf(parseScript('(5)').statements[0], MetricType.Rounds)?.value).toBe(5);
    expect(metricOf(parseScript('(3 Rounds)').statements[0], MetricType.Rounds)?.value).toBe(3);
    expect(metricOf(parseScript('(5 Sets)').statements[0], MetricType.Rounds)?.value).toBe(5);
    expect(metricOf(parseScript('(3 Rds)').statements[0], MetricType.Rounds)?.value).toBe(3);
    expect(metricOf(parseScript('(AMRAP)').statements[0], MetricType.Rounds)?.value).toBe('AMRAP');
    expect(metricOf(parseScript('(EMOM)').statements[0], MetricType.Rounds)?.value).toBe('EMOM');

    const ladder = parseScript('(21-15-9) Thruster');
    expect(ladder.statements).toHaveLength(2);
    expect(metricOf(ladder.statements[0], MetricType.Rounds)?.value).toBe(3);
    expect(
      ladder.statements[0].metrics
        .toArray()
        .filter((m) => m.type === MetricType.Rep)
        .map((m) => m.value),
    ).toEqual([21, 15, 9]);
    expect(metricOf(ladder.statements[1], MetricType.Effort)?.value).toBe('Thruster');
  });

  it('resolves canonical effort reference cleanly when trailing parenthesized load is present', () => {
    const index = createReferenceIndex({
      efforts: [
        {
          slug: 'kettlebell-swing',
          label: 'Kettlebell Swing',
          aliases: ['Kettlebell Swings', 'KB Swings'],
          registrySource: 'core',
          baseAttributes: {
            discipline: 'strength',
            met: 6,
            intensityTier: 'vigorous',
          },
        },
      ],
      equipment: [
        {
          slug: 'kettlebell',
          label: 'Kettlebell',
          aliases: ['KB'],
          registrySource: 'core',
        },
      ],
    });

    const script = parseScript('15 Kettlebell Swings (24kg)', { references: index });
    expect(script.statements).toHaveLength(1);
    const [stmt] = script.statements;
    expect(stmt.exerciseId).toBe('kettlebell-swing');
    expect(metricOf(stmt, MetricType.Resistance)?.value).toEqual({ amount: 24, unit: 'kg' });
    expect(metricOf(stmt, MetricType.Rounds)).toBeUndefined();

    const poodScript = parseScript('15 Kettlebell Swings (1.5pood)', { references: index });
    expect(poodScript.statements).toHaveLength(1);
    expect(poodScript.statements[0].exerciseId).toBe('kettlebell-swing');
    expect(metricOf(poodScript.statements[0], MetricType.Resistance)?.value).toEqual({
      amount: 1.5,
      unit: 'pood',
    });
  });
});
