import { describe, it, expect } from 'vitest';
import { fuseUnitsInMetrics } from '../../src/dialects/units/fuseUnits';
import { UnitRegistry } from '../../src/metrics/units';
import { MetricType, IMetric, type ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { RepMetric } from '../../src/runtime/compiler/metrics/RepMetric';
import { EffortMetric } from '../../src/runtime/compiler/metrics/EffortMetric';
import { ResistanceMetric } from '../../src/runtime/compiler/metrics/ResistanceMetric';
import { ChoiceGroupMetric } from '../../src/runtime/compiler/metrics/ChoiceGroupMetric';
import { fuseUnits } from '../../src/dialects/units/fuseUnits';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';

const std = UnitRegistry.standard();

function amountUnit(m: any) {
  return { type: m.type, amount: m.value?.amount, unit: m.value?.unit };
}

function choiceAlts(m: any): { type: string; amount?: number; unit?: string }[] {
  const group = m as ChoiceGroupMetric;
  return group.alternatives.map((a: any) => ({
    type: a.type,
    amount: a.value?.amount,
    unit: a.value?.unit ?? a.value,
  }));
}

describe('fuseUnitsInMetrics', () => {
  it('fuses Rep + contiguous unit into a dimensioned metric', () => {
    const out = fuseUnitsInMetrics([new RepMetric(24), new EffortMetric('kg')], std);
    expect(out).toHaveLength(1);
    expect(amountUnit(out[0])).toEqual({ type: MetricType.Resistance, amount: 24, unit: 'kg' });
  });

  it('fuses Rep + leading unit word and keeps the residual effort', () => {
    const out = fuseUnitsInMetrics([new RepMetric(100), new EffortMetric('m Run')], std);
    expect(out).toHaveLength(2);
    expect(amountUnit(out[0])).toEqual({ type: MetricType.Distance, amount: 100, unit: 'm' });
    expect(out[1].type).toBe(MetricType.Effort);
    expect(out[1].value).toBe('Run');
  });

  it('preserves the as-written token (miles, not mi)', () => {
    const out = fuseUnitsInMetrics([new RepMetric(4), new EffortMetric('miles Run')], std);
    expect(amountUnit(out[0])).toEqual({ type: MetricType.Distance, amount: 4, unit: 'miles' });
    expect(out[1].value).toBe('Run');
  });

  it('recognizes units the grammar misses (in, lbs, cal)', () => {
    expect(amountUnit(fuseUnitsInMetrics([new RepMetric(24), new EffortMetric('in')], std)[0]))
      .toEqual({ type: MetricType.Distance, amount: 24, unit: 'in' });
    expect(amountUnit(fuseUnitsInMetrics([new RepMetric(95), new EffortMetric('lbs')], std)[0]))
      .toEqual({ type: MetricType.Resistance, amount: 95, unit: 'lbs' });
    const cal = fuseUnitsInMetrics([new RepMetric(20), new EffortMetric('cal Row')], std);
    expect((cal[0] as any).type).toBe('energy');
    expect((cal[0] as any).value).toEqual({ amount: 20, unit: 'cal' });
    expect(cal[1].value).toBe('Row');
  });

  it('does NOT fuse a number + non-unit word', () => {
    const out = fuseUnitsInMetrics([new RepMetric(5), new EffortMetric('Burpees')], std);
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe(MetricType.Rep);
    expect(out[1].value).toBe('Burpees');
  });

  it('fuses Rep + bare % into an Intensity metric', () => {
    const out = fuseUnitsInMetrics([new RepMetric(80), new EffortMetric('%')], std);
    expect(out).toHaveLength(1);
    expect(amountUnit(out[0])).toEqual({ type: MetricType.Intensity, amount: 80, unit: '%' });
  });

  it('leaves a distance metric intact when intensity follows it', () => {
    const out = fuseUnitsInMetrics(
      [new EffortMetric('Run'), new RepMetric(400), new EffortMetric('m'), new RepMetric(80), new EffortMetric('%')],
      std,
    );
    expect(out).toHaveLength(3);
    expect(out[0].value).toBe('Run');
    expect(amountUnit(out[1])).toEqual({ type: MetricType.Distance, amount: 400, unit: 'm' });
    expect(amountUnit(out[2])).toEqual({ type: MetricType.Intensity, amount: 80, unit: '%' });
  });

  it('does NOT fuse % onto an effort token', () => {
    const out = fuseUnitsInMetrics([new EffortMetric('Run'), new EffortMetric('%')], std);
    expect(out).toHaveLength(2);
    expect(out[1].value).toBe('%');
  });

  it('does NOT fuse a % suffix glued to a word', () => {
    const out = fuseUnitsInMetrics([new RepMetric(80), new EffortMetric('% run')], std);
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe(MetricType.Rep);
  });

  it('fills an empty unit on an @-resistance followed by a unit word', () => {
    const out = fuseUnitsInMetrics([new ResistanceMetric(95, ''), new EffortMetric('lb')], std);
    expect(out).toHaveLength(1);
    expect(amountUnit(out[0])).toEqual({ type: MetricType.Resistance, amount: 95, unit: 'lb' });
  });

  it('is idempotent', () => {
    const once = fuseUnitsInMetrics([new RepMetric(100), new EffortMetric('m Run')], std);
    const twice = fuseUnitsInMetrics(once, std);
    expect(twice.map(amountUnit)).toEqual(once.map(amountUnit));
  });

  it('honors dialect override sets (later wins)', () => {
    const poodSet = std.extend({ canonical: 'pood', dimension: 'mass', aliases: ['poods'] });
    const out = fuseUnitsInMetrics([new RepMetric(1.5), new EffortMetric('pood Swings')], poodSet);
    expect(amountUnit(out[0])).toEqual({ type: MetricType.Resistance, amount: 1.5, unit: 'pood' });
    expect(out[1].value).toBe('Swings');
  });

  it('leaves a standalone bw word as effort instead of emitting orphaned resistance', () => {
    const out = fuseUnitsInMetrics([new EffortMetric('bw')], std);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe(MetricType.Effort);
    expect(out[0].value).toBe('bw');
  });

  it('keeps trailing bodyweight token metadata aligned after trailing whitespace', () => {
    const effort = new EffortMetric('Pushups bw  ');
    const statement = {
      metrics: MetricContainer.from([effort]),
      metricMeta: new Map<IMetric, unknown>([
        [effort, { startOffset: 5, endOffset: 17, columnStart: 5, columnEnd: 17, raw: 'Pushups bw  ' }],
      ]),
    } as unknown as ICodeStatement;

    fuseUnits(statement, std);

    const [residual, resistance] = statement.metrics.toArray();
    expect(residual.value).toBe('Pushups');
    expect(statement.metricMeta.get(resistance)).toMatchObject({
      startOffset: 13,
      endOffset: 15,
      columnStart: 13,
      columnEnd: 15,
      raw: 'bw',
    });
  });

  describe('{number}|{number} {unit} → ChoiceGroupMetric (pipe choices, "/" + "|" ride as effort primitives)', () => {
    it('emits a single ChoiceGroupMetric for N|N resistance', () => {
      const out = fuseUnitsInMetrics(
        [new RepMetric(135), new EffortMetric('|'), new RepMetric(185), new EffortMetric('lbs')],
        std,
      );
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe(MetricType.Choice);
      expect(choiceAlts(out[0])).toEqual([
        { type: MetricType.Resistance, amount: 135, unit: 'lbs' },
        { type: MetricType.Resistance, amount: 185, unit: 'lbs' },
      ]);
    });

    it('emits ChoiceGroupMetric + residual effort for N|N distance with label', () => {
      const out = fuseUnitsInMetrics(
        [new RepMetric(200), new EffortMetric('|'), new RepMetric(400), new EffortMetric('m Run')],
        std,
      );
      expect(out).toHaveLength(2);
      expect(out[0].type).toBe(MetricType.Choice);
      expect(choiceAlts(out[0])).toEqual([
        { type: MetricType.Distance, amount: 200, unit: 'm' },
        { type: MetricType.Distance, amount: 400, unit: 'm' },
      ]);
      expect(out[1].value).toBe('Run');
    });

    it('emits ChoiceGroupMetric for @-resistance N|N', () => {
      const out = fuseUnitsInMetrics(
        [new ResistanceMetric(95, ''), new EffortMetric('|'), new ResistanceMetric(135, ''), new EffortMetric('lb')],
        std,
      );
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe(MetricType.Choice);
      expect(choiceAlts(out[0])).toEqual([
        { type: MetricType.Resistance, amount: 95, unit: 'lb' },
        { type: MetricType.Resistance, amount: 135, unit: 'lb' },
      ]);
    });

    it('does NOT emit ChoiceGroup when the separator is not a pipe', () => {
      const out = fuseUnitsInMetrics(
        [new RepMetric(135), new EffortMetric('+'), new RepMetric(185), new EffortMetric('lbs')],
        std,
      );
      expect(out).toHaveLength(3);
      expect(out[0].type).toBe(MetricType.Rep);
      expect(out[1].type).toBe(MetricType.Effort);
      expect(amountUnit(out[2])).toEqual({ type: MetricType.Resistance, amount: 185, unit: 'lbs' });
    });

    it('is idempotent: re-running on ChoiceGroupMetric output is a no-op', () => {
      const once = fuseUnitsInMetrics(
        [new RepMetric(135), new EffortMetric('|'), new RepMetric(185), new EffortMetric('kg')],
        std,
      );
      expect(once[0].type).toBe(MetricType.Choice);
      const twice = fuseUnitsInMetrics(once, std);
      expect(twice[0].type).toBe(MetricType.Choice);
      expect((twice[0] as ChoiceGroupMetric).alternatives.length).toBe(
        (once[0] as ChoiceGroupMetric).alternatives.length
      );
    });
  });

  describe('effort|effort choice: Effort(A) Pipe Effort(B) → ChoiceGroupMetric', () => {
    it('emits a ChoiceGroupMetric for two efforts', () => {
      const out = fuseUnitsInMetrics(
        [new EffortMetric('Run'), new EffortMetric('|'), new EffortMetric('Walk')],
        std,
      );
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe(MetricType.Choice);
      const alts = (out[0] as ChoiceGroupMetric).alternatives;
      expect(alts).toHaveLength(2);
      expect(alts[0].value).toBe('Run');
      expect(alts[1].value).toBe('Walk');
    });

    it('collects three consecutive pipe-separated efforts into one group', () => {
      const out = fuseUnitsInMetrics(
        [
          new EffortMetric('Run'),
          new EffortMetric('|'),
          new EffortMetric('Walk'),
          new EffortMetric('|'),
          new EffortMetric('Rest'),
        ],
        std,
      );
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe(MetricType.Choice);
      const alts = (out[0] as ChoiceGroupMetric).alternatives;
      expect(alts).toHaveLength(3);
      expect(alts.map((a: any) => a.value)).toEqual(['Run', 'Walk', 'Rest']);
    });

    it('number|pipe|number/unit produces ChoiceGroupMetric, not effort split', () => {
      const out = fuseUnitsInMetrics(
        [new RepMetric(135), new EffortMetric('|'), new RepMetric(185), new EffortMetric('kg')],
        std,
      );
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe(MetricType.Choice);
    });

    it('heterogeneous pipe (Effort + Rep) silently drops the pipe', () => {
      // "Run | 5" — Effort + pipe + Rep — different types, no ChoiceGroup
      const out = fuseUnitsInMetrics(
        [new EffortMetric('Run'), new EffortMetric('|'), new RepMetric(5)],
        std,
      );
      // Pipe is consumed; Effort('Run') and Rep(5) remain
      expect(out).toHaveLength(2);
      expect(out[0].type).toBe(MetricType.Effort);
      expect(out[1].type).toBe(MetricType.Rep);
    });

    it('spanMeta covers the full effort choice range, not just the first effort', () => {
      const run = new EffortMetric('Run');
      const pipe = new EffortMetric('|');
      const walk = new EffortMetric('Walk');
      const meta = new Map<IMetric, any>([
        [run, { startOffset: 0, endOffset: 3, raw: 'Run' }],
        [pipe, { startOffset: 4, endOffset: 5, raw: '|' }],
        [walk, { startOffset: 6, endOffset: 10, raw: 'Walk' }],
      ]);
      const statement = {
        metrics: MetricContainer.from([run, pipe, walk]),
        metricMeta: meta,
      } as any;

      fuseUnits(statement, std);

      const choice = statement.metrics.toArray()[0] as ChoiceGroupMetric;
      expect(choice.type).toBe(MetricType.Choice);
      const choiceMeta = statement.metricMeta.get(choice);
      expect(choiceMeta.startOffset).toBe(0);
      expect(choiceMeta.endOffset).toBe(10);
    });
  });

  describe('{number}/{number} {unit} → single decimal metric (fraction)', () => {
    it('converts 1/4 mile to Distance(0.25, "mile")', () => {
      const out = fuseUnitsInMetrics(
        [new RepMetric(1), new EffortMetric('/'), new RepMetric(4), new EffortMetric('mile')],
        std,
      );
      expect(out).toHaveLength(1);
      expect(amountUnit(out[0])).toEqual({ type: MetricType.Distance, amount: 0.25, unit: 'mile' });
    });

    it('converts 1/2 kg to Resistance(0.5, "kg")', () => {
      const out = fuseUnitsInMetrics(
        [new RepMetric(1), new EffortMetric('/'), new RepMetric(2), new EffortMetric('kg')],
        std,
      );
      expect(out).toHaveLength(1);
      expect(amountUnit(out[0])).toEqual({ type: MetricType.Resistance, amount: 0.5, unit: 'kg' });
    });

    it('unhandled slash between non-fusable tokens is silently dropped', () => {
      const out = fuseUnitsInMetrics(
        [new EffortMetric('Run'), new EffortMetric('/'), new RepMetric(5)],
        std,
      );
      // Slash has no fraction pattern match — dropped. Effort and Rep remain.
      expect(out).toHaveLength(2);
      expect(out[0].type).toBe(MetricType.Effort);
      expect(out[1].type).toBe(MetricType.Rep);
    });
  });
});
