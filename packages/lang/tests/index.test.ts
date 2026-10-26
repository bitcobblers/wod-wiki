import { describe, it, expect } from 'vitest';
import {
  parseScript,
  WhiteboardScript,
  toStoredOutputStatement,
  computeWorkloadRollups,
  dayBucket,
  DAY,
  UnitsDialect,
  CrossFitDialect,
  WodDialect,
  CardioDialect,
  YogaDialect,
  HabitsDialect,
  ClimbDialect,
  DialectStack,
  dialectStack,
  dialectRegistry,
  UnitRegistry,
  CONSUMED_HINTS,
  Registry,
  createCalcEngine,
  CalcEngine,
  TwoPassEffortResolutionProcess,
} from '../src/index';
import { OutputStatement, MetricContainer, MetricType } from '@bitcobblers/wod-wiki-core';

describe('@bitcobblers/wod-wiki-lang exports and pipeline', () => {
  it('parses Whiteboard Script source directly into AST', () => {
    const text = '21 pullups\n15 thrusters\n9 burpees';
    const parsed = parseScript(text, { dialect: 'wod' });

    expect(parsed).toBeInstanceOf(WhiteboardScript);
    expect(parsed.statements.length).toBe(3);
    expect(parsed.statements[0].text?.trim()).toBe('21 pullups');
  });

  it('exports all 7 built-in dialects and DialectStack', () => {
    expect(UnitsDialect).toBeDefined();
    expect(CrossFitDialect).toBeDefined();
    expect(WodDialect).toBeDefined();
    expect(CardioDialect).toBeDefined();
    expect(YogaDialect).toBeDefined();
    expect(HabitsDialect).toBeDefined();
    expect(ClimbDialect).toBeDefined();
    expect(DialectStack).toBeDefined();
    expect(dialectStack).toBeDefined();
    expect(dialectRegistry).toBeDefined();
  });

  it('exports UnitRegistry, hints, and Registry', () => {
    expect(UnitRegistry).toBeDefined();
    expect(CONSUMED_HINTS).toBeDefined();
    expect(Registry).toBeDefined();
  });

  it('exports Analytics Engine and Calc Engine', () => {
    expect(createCalcEngine).toBeDefined();
    expect(CalcEngine).toBeDefined();
    expect(TwoPassEffortResolutionProcess).toBeDefined();
  });

  it('converts output statements to stored output statements', () => {
    const output = new OutputStatement({
      outputType: 'segment',
      timeSpan: { started: 1000, ended: 5000 },
      sourceBlockKey: 'block-1',
      metrics: MetricContainer.from([
        { type: MetricType.Rep, value: 21, origin: 'parser' },
      ]),
    });

    const stored = toStoredOutputStatement(output);
    expect(stored.outputType).toBe('segment');
    expect(stored.timeSpan?.started).toBe(1000);
    expect(stored.metrics[0].value).toBe(21);
  });

  it('computes workload rollups and day buckets', () => {
    const ts = 1700000000000;
    const bucket = dayBucket(ts);
    expect(typeof bucket).toBe('number');
    expect(DAY).toBe(86_400_000);

    const loads = new Map<number, number>([
      [bucket, 100],
      [bucket + 1, 150],
    ]);
    const rollups = computeWorkloadRollups(loads, bucket + 1);
    expect(Array.isArray(rollups)).toBe(true);
  });
});
