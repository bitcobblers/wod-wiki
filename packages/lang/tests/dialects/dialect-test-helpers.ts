import { expect } from 'vitest';
import { ICodeStatement, IMetric, MetricType, MetricOrigin } from '@bitcobblers/wod-wiki-core';
import { CrossFitDialect } from '../../src/dialects/CrossFitDialect';
import { CardioDialect } from '../../src/dialects/CardioDialect';
import { YogaDialect } from '../../src/dialects/YogaDialect';
import { HabitsDialect } from '../../src/dialects/HabitsDialect';
import { ClimbDialect } from '../../src/dialects/ClimbDialect';
import { DialectStack } from '../../src/dialects/DialectStack';
import { parseScript } from '../../src/parser/parseScript';
import { getHints, hasHint } from '../../src/metrics/hints';

const DIALECT_MAP: Record<string, () => DialectStack> = {
  crossfit: () => new DialectStack([new CrossFitDialect()]),
  cardio: () => new DialectStack([new CardioDialect()]),
  yoga: () => new DialectStack([new YogaDialect()]),
  habits: () => new DialectStack([new HabitsDialect()]),
  climb: () => new DialectStack([new ClimbDialect()]),
  none: () => new DialectStack([]),
};

export interface DialectFixtureResult {
  statement: ICodeStatement;
  statements: ICodeStatement[];
  registry: DialectStack;
}

export function parseWithDialect(
  block: string,
  dialect: keyof typeof DIALECT_MAP = 'crossfit',
): DialectFixtureResult {
  const script = parseScript(block, { withoutDialects: true });

  if (!script.statements.length) {
    throw new Error(`No statements parsed from block:\n${block}`);
  }

  const registry = DIALECT_MAP[dialect]();
  registry.processAll(script.statements as ICodeStatement[]);

  return {
    statement: script.statements[0] as ICodeStatement,
    statements: script.statements as ICodeStatement[],
    registry,
  };
}

export function hintsOf(statement: ICodeStatement): string[] {
  return getHints(statement);
}

export function statementHasHint(statement: ICodeStatement, hint: string): boolean {
  return hasHint(statement, hint);
}

export function rawMetricsOfType(statement: ICodeStatement, type: MetricType | string): IMetric[] {
  return statement.rawMetrics.filter((m) => m.type === type);
}

export function expectRawMetric(
  statement: ICodeStatement,
  type: MetricType | string,
  origin: MetricOrigin,
  value?: unknown,
): void {
  const matching = statement.rawMetrics.filter((m) => m.type === type && m.origin === origin);
  expect(matching.length).toBeGreaterThan(0);
  if (value !== undefined) {
    expect(matching.some((m) => m.value === value)).toBe(true);
  }
}

export function expectDisplayMetric(
  statement: ICodeStatement,
  type: MetricType | string,
  value?: unknown,
): void {
  const matching = statement.getDisplayMetrics().filter((m) => m.type === type);
  expect(matching.length).toBeGreaterThan(0);
  if (value !== undefined) {
    expect(matching.some((m) => m.value === value)).toBe(true);
  }
}

export function expectNotDisplayed(statement: ICodeStatement, type: MetricType | string): void {
  const matching = statement.getDisplayMetrics().filter((m) => m.type === type);
  expect(matching).toHaveLength(0);
}
