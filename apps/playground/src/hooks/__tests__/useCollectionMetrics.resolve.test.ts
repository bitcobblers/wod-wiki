/**
 * useCollectionMetrics — resolveValueSelection + occurrence identity checks.
 *
 * Drives the real parser (no fabricated statements) and the real
 * MetricContainer, asserting the pre-run target resolution contract (hint →
 * user-plan before JIT), the post-run occurrence keying (sourceBlockKey,
 * not display names), and the shared entry validation rules.
 */

import { describe, expect, it } from 'bun:test';
import {
  ChoiceGroupMetric,
  MetricContainer,
  MetricType,
  createParser,
  type IMetric,
  type Segment,
} from '@bitcobblers/wod-wiki-engine';
import {
  deriveCollectionItems,
  entryFieldId,
  metricDomain,
  resolveValueSelection,
  toClockEntry,
  type CollectionItem,
} from '../useCollectionMetrics';
import { parseClockDraftValue } from '@/clock/clockCommands';
import { validateEntryValue } from '@/clock/ClockValueEntry';

const SCRIPT = '# T\n\n```time\n5:00\n  ? Push Ups\n```\n';

/** Derived segment as AnalyticsTransformer emits it (with optional context). */
type DerivedSegment = Segment & { context?: Record<string, unknown> };

function parseStatements() {
  return createParser().read(SCRIPT).statements;
}

function makeSegment(opts: {
  sourceBlockKey: string;
  statementId?: number;
  userActual?: boolean;
  hinted?: boolean;
  /** Extra metrics merged into the fixture (plan targets, custom actuals). */
  extra?: IMetric[];
}): DerivedSegment {
  const metrics = new MetricContainer(
    [
      ...(opts.hinted === false ? [] : [{ type: MetricType.Rep, value: undefined, origin: 'hinted', image: '?' }]),
      { type: MetricType.Effort, value: 'Push Ups', origin: 'parser' as const, image: 'Push Ups' },
      ...(opts.userActual ? [{ type: MetricType.Rep, value: 12, origin: 'user', image: '12' }] : []),
      ...(opts.extra ?? []),
    ],
    'seg',
  );
  return {
    id: 1,
    name: 'Push Ups [0]',
    type: 'segment',
    startTime: 0,
    endTime: 1,
    elapsed: 1,
    total: 1,
    parentId: null,
    depth: 0,
    metric: {},
    lane: 0,
    metrics,
    context: {
      sourceBlockKey: opts.sourceBlockKey,
      ...(opts.statementId !== undefined ? { sourceStatementId: opts.statementId } : {}),
    },
  };
}

function collectModeB(segments: DerivedSegment[]): CollectionItem[] {
  return deriveCollectionItems(segments, new Map(), null);
}

describe('resolveValueSelection (pre-run target intent)', () => {
  it('replaces the hinted rep with a user-plan metric and keeps the unit', () => {
    const statements = parseStatements();
    const stmt = statements.find((s) => s.metrics.some((m) => m.type === MetricType.Rep && m.origin === 'hinted'))!;
    const item = {
      kind: 'value' as const,
      blockKey: `stmt-${stmt.id}`,
      exerciseLabel: 'Push Ups',
      metricType: MetricType.Rep,
      hint: '?',
      origin: 'hinted' as const,
      intent: 'target' as const,
      deferrable: true,
      statementIndex: statements.indexOf(stmt),
    };
    expect(resolveValueSelection({ statements }, item, 21, 'target')).toBe(true);
    expect(stmt.metrics.some((m) => m.origin === 'hinted' && m.type === MetricType.Rep)).toBe(false);
    const resolved = stmt.metrics.find((m) => m.type === MetricType.Rep && m.origin === 'user-plan');
    expect(resolved?.value).toBe(21);
    expect(resolved?.image).toBe('21');
  });

  it('keeps source statements untouched for actual intent', () => {
    const statements = parseStatements();
    const stmt = statements.find((s) => s.metrics.some((m) => m.type === MetricType.Rep && m.origin === 'hinted'))!;
    const before = stmt.metrics.length;
    const item = {
      kind: 'value' as const,
      blockKey: `stmt-${stmt.id}`,
      exerciseLabel: 'Push Ups',
      metricType: MetricType.Rep,
      hint: '?',
      origin: 'hinted' as const,
      intent: 'actual' as const,
      deferrable: true,
      statementIndex: statements.indexOf(stmt),
    };
    expect(resolveValueSelection({ statements }, item, 21, 'actual')).toBe(false);
    expect(stmt.metrics.length).toBe(before);
  });

  it('collapses a choice group to the selected alternative', () => {
    const statements = parseStatements();
    const stmt = statements[statements.length - 1]!;
    const altA = { type: MetricType.Resistance, value: 135, origin: 'parser' as const, image: '135' };
    const altB = { type: MetricType.Resistance, value: 95, origin: 'parser' as const, image: '95' };
    const choice = new ChoiceGroupMetric([altA, altB]);
    stmt.metrics.add(choice);
    const item = {
      kind: 'choice' as const,
      blockKey: `stmt-${stmt.id}`,
      exerciseLabel: 'Press',
      alternatives: choice.alternatives,
      selectedIndex: 0,
      statementIndex: statements.indexOf(stmt),
    };
    expect(resolveValueSelection({ statements }, item, 1, 'target')).toBe(true);
    expect(stmt.metrics.some((m) => m.type === MetricType.Choice)).toBe(false);
    const chosen = stmt.metrics.find((m) => m.type === MetricType.Resistance && m.origin === 'user-plan');
    expect(chosen?.value).toBe(95);
  });
});

describe('field identity and domains', () => {
  it('builds field ids from statement id pre-run and block key post-run', () => {
    const statements = parseStatements();
    const stmt = statements.find((s) => s.metrics.some((m) => m.type === MetricType.Rep))!;
    expect(entryFieldId({
      kind: 'value',
      blockKey: `stmt-${stmt.id}`,
      exerciseLabel: 'Push Ups',
      metricType: MetricType.Rep,
      hint: '?',
      origin: 'hinted',
      intent: 'target',
      deferrable: true,
      statementIndex: 0,
    })).toBe(`stmt-${stmt.id}:rep`);
    expect(entryFieldId({
      kind: 'value',
      blockKey: 'b8c1-uuid',
      exerciseLabel: 'Push Ups',
      metricType: MetricType.Rep,
      hint: '?',
      origin: 'hinted',
      intent: 'actual',
      deferrable: true,
      statementIndex: 0,
    })).toBe('b8c1-uuid:rep');
  });

  it('maps metric types to validation domains', () => {
    expect(metricDomain(MetricType.Rep)).toBe('integer');
    expect(metricDomain(MetricType.Rounds)).toBe('integer');
    expect(metricDomain(MetricType.Duration)).toBe('duration');
    expect(metricDomain(MetricType.Distance)).toBe('decimal');
    expect(metricDomain(MetricType.Load)).toBe('decimal');
    expect(metricDomain(MetricType.Choice)).toBe('choice');
  });

  it('projects a value item into a required target ClockEntry', () => {
    const entry = toClockEntry({
      kind: 'value',
      blockKey: 'uuid-1',
      exerciseLabel: 'Push Ups',
      metricType: MetricType.Rep,
      hint: '?',
      origin: 'hinted',
      intent: 'target',
      deferrable: true,
      statementIndex: 0,
    }, 2, 5);
    expect(entry.fieldId).toBe('uuid-1:rep');
    expect(entry.domain).toBe('integer');
    expect(entry.intent).toBe('target');
    expect(entry.required).toBe(true);
    expect(entry.index).toBe(2);
    expect(entry.total).toBe(5);
  });
});

describe('post-run queue identity (Mode B)', () => {
  it('keys items by sourceBlockKey, marks them actual, skips user-answered blocks', () => {
    const items = collectModeB([
      makeSegment({ sourceBlockKey: 'uuid-a', statementId: 7 }),
      makeSegment({ sourceBlockKey: 'uuid-b', userActual: true }),
    ]);
    expect(items.length).toBe(1);
    const only = items[0];
    expect(only && only.kind === 'value' && only.blockKey).toBe('uuid-a');
    expect(only && only.kind === 'value' && only.intent).toBe('actual');
    expect(only && only.kind === 'value' && only.sourceStatementId).toBe(7);
  });


  it('prompts an actual for a resolved pre-run target the run did not answer', () => {
    // Target 7 resolved pre-run (user-plan, hint consumed) — the actual is
    // still unknown, so the post-run queue must prompt for it.
    const items = collectModeB([makeSegment({
      sourceBlockKey: 'uuid-plan',
      hinted: false,
      extra: [{ type: MetricType.Rep, value: 7, origin: 'user-plan', image: '7' }],
    })]);
    expect(items.length).toBe(1);
    const only = items[0];
    expect(only && only.kind === 'value' && only.blockKey).toBe('uuid-plan');
    expect(only && only.kind === 'value' && only.intent).toBe('actual');
  });

  it('treats an answered user zero as answered — no prompt', () => {
    const items = collectModeB([makeSegment({
      sourceBlockKey: 'uuid-zero',
      hinted: false,
      extra: [
        { type: MetricType.Rep, value: 7, origin: 'user-plan', image: '7' },
        { type: MetricType.Rep, value: 0, origin: 'user', image: '0' },
      ],
    })]);
    expect(items.length).toBe(0);
  });

  it('never prompts execution-only plan values (duration) post-run', () => {
    const items = collectModeB([makeSegment({
      sourceBlockKey: 'uuid-exec',
      hinted: false,
      extra: [{ type: MetricType.Duration, value: 300_000, origin: 'user-plan', image: '5:00' }],
    })]);
    expect(items.length).toBe(0);
  });
});

describe('entry draft validation (shared parser)', () => {
  it('accepts zero for integers, rejects empty and decimals', () => {
    expect(parseClockDraftValue('0', 'integer')).toEqual({ ok: true, value: 0 });
    expect(parseClockDraftValue('21', 'integer')).toEqual({ ok: true, value: 21 });
    expect(parseClockDraftValue('', 'integer').ok).toBe(false);
    expect(parseClockDraftValue('3.5', 'integer').ok).toBe(false);
    expect(parseClockDraftValue('-2', 'integer').ok).toBe(false);
  });

  it('validates decimals and explicit M:SS durations (zero is valid generic input)', () => {
    expect(parseClockDraftValue('.5', 'decimal')).toEqual({ ok: true, value: 0.5 });
    expect(parseClockDraftValue('52.5', 'decimal')).toEqual({ ok: true, value: 52.5 });
    expect(parseClockDraftValue('5:30', 'duration')).toEqual({ ok: true, value: 330_000 });
    expect(parseClockDraftValue('5:75', 'duration').ok).toBe(false);
  });

  it('revalidates command-path values at the trust boundary', () => {
    const entry = { domain: 'integer' as const };
    expect(validateEntryValue(entry, 0)).toEqual({ ok: true, value: 0 });
    expect(validateEntryValue(entry, -1).ok).toBe(false);
    expect(validateEntryValue(entry, 1.5).ok).toBe(false);
    expect(validateEntryValue(entry, Number.NaN).ok).toBe(false);
  });
});

describe('required execution constraints (real parser)', () => {
  const EXEC_SCRIPT = '# T\n\n```time\n:? AMRAP\n  ? km Row\n  185 ? lb Press\n```\n';

  function parseExecStatements() {
    return createParser().read(EXEC_SCRIPT).statements;
  }

  function hintedItem(statements: ReturnType<typeof parseExecStatements>, metricType: MetricType) {
    const stmt = statements.find((s) => s.metrics.some((m) => m.type === metricType && m.origin === 'hinted'))!;
    return {
      kind: 'value' as const,
      blockKey: `stmt-${stmt.id}`,
      exerciseLabel: 'Row',
      metricType,
      hint: '?',
      origin: 'hinted' as const,
      intent: 'target' as const,
      deferrable: false,
      statementIndex: statements.indexOf(stmt),
    };
  }

  it('rejects zero/negative durations and rounds before touching statements', () => {
    const statements = parseExecStatements();
    const durationItem = hintedItem(statements, MetricType.Duration);
    const durationStmt = statements[durationItem.statementIndex]!;
    const before = durationStmt.metrics.length;
    expect(resolveValueSelection({ statements }, durationItem, 0, 'target')).toBe(false);
    expect(resolveValueSelection({ statements }, durationItem, -60_000, 'target')).toBe(false);
    expect(durationStmt.metrics.length).toBe(before);

    // Hinted rounds fixture (real statement, hinted rounds literal as emitted
    // by loop compilation paths that defer the count to the user).
    const roundsStmt = statements[statements.length - 1]!;
    roundsStmt.metrics.add({ type: MetricType.Rounds, value: undefined, origin: 'hinted', image: '?' });
    const roundsItem = {
      kind: 'value' as const,
      blockKey: `stmt-${roundsStmt.id}`,
      exerciseLabel: 'Burpees',
      metricType: MetricType.Rounds,
      hint: '?',
      origin: 'hinted' as const,
      intent: 'target' as const,
      deferrable: false,
      statementIndex: statements.indexOf(roundsStmt),
    };
    expect(resolveValueSelection({ statements }, roundsItem, 0, 'target')).toBe(false);
    expect(resolveValueSelection({ statements }, roundsItem, 2.5, 'target')).toBe(false);
    expect(roundsStmt.metrics.some((m) => m.origin === 'user-plan')).toBe(false);
    expect(resolveValueSelection({ statements }, roundsItem, 3, 'target')).toBe(true);
    const rounds = roundsStmt.metrics.find((m) => m.type === MetricType.Rounds && m.origin === 'user-plan');
    expect(rounds?.value).toBe(3);
  });

  it('preserves hinted units on load/distance resolution', () => {
    const statements = parseExecStatements();
    const distanceItem = hintedItem(statements, MetricType.Distance);
    expect(resolveValueSelection({ statements }, distanceItem, 5, 'target')).toBe(true);
    const distanceStmt = statements[distanceItem.statementIndex]!;
    const distance = distanceStmt.metrics.find((m) => m.type === MetricType.Distance && m.origin === 'user-plan');
    expect(distance?.value).toEqual({ amount: 5, unit: 'km' });
    expect(distance?.image).toBe('5 km');

    const resistanceItem = hintedItem(statements, MetricType.Resistance);
    expect(resolveValueSelection({ statements }, resistanceItem, 185, 'target')).toBe(true);
    const pressStmt = statements[resistanceItem.statementIndex]!;
    const resistance = pressStmt.metrics.find((m) => m.type === MetricType.Resistance && m.origin === 'user-plan');
    expect(resistance?.value).toEqual({ amount: 185, unit: 'lb' });
    expect(resistance?.image).toBe('185 lb');
  });

  it('rebuilds a hinted duration with parsed components', () => {
    const statements = parseExecStatements();
    const durationItem = hintedItem(statements, MetricType.Duration);
    expect(resolveValueSelection({ statements }, durationItem, 330_000, 'target')).toBe(true);
    const durationStmt = statements[durationItem.statementIndex]!;
    const duration = durationStmt.metrics.find((m) => m.type === MetricType.Duration && m.origin === 'user-plan');
    expect(duration?.value).toBe(330_000);
    expect(duration?.image).toBe('5:30');
    const minutes = duration && 'minutes' in duration ? duration.minutes : undefined;
    const seconds = duration && 'seconds' in duration ? duration.seconds : undefined;
    expect(minutes).toBe(5);
    expect(seconds).toBe(30);
  });
});
