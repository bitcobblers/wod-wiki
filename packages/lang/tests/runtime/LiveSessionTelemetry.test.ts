import { describe, it, expect, afterEach } from 'vitest';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { ScriptRuntime } from '../../src/runtime/ScriptRuntime';
import { RuntimeStack } from '../../src/runtime/RuntimeStack';
import { EventBus } from '../../src/runtime/events/EventBus';
import { createMockClock } from '../../src/runtime/RuntimeClock';
import { createParser } from '../../src/parser/parserInstance';
import { createCompiler } from '../../src/runtime/services/runtimeServices';
import { StartSessionAction } from '../../src/runtime/actions/stack/StartSessionAction';
import { NextEvent } from '../../src/runtime/events/NextEvent';
import { createAnalyticsEngineForBlock } from '../../src/analytics/createAnalyticsEngineForBlock';
import type { WhiteboardScript } from '../../src/parser/WhiteboardScript';
import { projectLiveSessionTelemetry } from '../../src/runtime/projection/LiveSessionTelemetry';

describe('LiveSessionTelemetry, INowProvider timestamps, and ancestor round stamping', () => {
  const disposables: ScriptRuntime[] = [];

  afterEach(() => {
    while (disposables.length > 0) {
      disposables.pop()?.dispose();
    }
  });

  function bootWithAnalytics(scriptText: string) {
    const parser = createParser();
    const script = parser.read(scriptText) as WhiteboardScript;
    const clock = createMockClock(new Date('2026-02-15T09:00:00Z'));
    const runtime = new ScriptRuntime(
      script,
      createCompiler(),
      { stack: new RuntimeStack(), clock, eventBus: new EventBus() },
      {},
      { now: () => new Date(clock.currentDate.getTime()), nowMs: () => clock.currentDate.getTime() },
    );
    disposables.push(runtime);

    const { engine } = createAnalyticsEngineForBlock({
      id: 'block-1',
      dialect: 'time',
      startLine: 0,
      endLine: 4,
      content: scriptText,
      statements: script.statements,
      state: 'idle',
      widgetIds: {},
      version: 1,
      createdAt: clock.currentDate.getTime(),
    });
    runtime.setAnalyticsEngine(engine);

    runtime.do(new StartSessionAction());
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));
    return { runtime, clock };
  }

  it('stamps MockClock timestamps on AnalyticsEngine outputs, stamps enclosing round onto leaf segments, and computes typed summaries + split deltas', () => {
    const { runtime, clock } = bootWithAnalytics(
      '(2 Rounds)\n  Run 400m\n  10 Kettlebell Swings 24kg',
    );

    // Round 1, Effort 1: Run 400m takes 90s
    clock.advance(90_000);
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));

    // Round 1, Effort 2: 10 KB Swings 24kg takes 40s
    clock.advance(40_000);
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));

    // Round 2, Effort 1: Run 400m takes 99s (+9s slower than Round 1 Run 400m)
    clock.advance(99_000);
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));

    // Verify leaf segment outputs carry enclosing CurrentRoundMetric
    const segments = runtime
      .getOutputStatements()
      .filter((o) => o.outputType === 'segment' && o.sourceStatementId !== undefined);
    expect(segments.length).toBeGreaterThanOrEqual(3);

    const r1RunRound = segments[0]?.getMetric(MetricType.CurrentRound)?.value;
    const r2RunRound = segments[2]?.getMetric(MetricType.CurrentRound)?.value;

    const extractRoundNum = (val: unknown): number | undefined => {
      if (typeof val === 'number') return val;
      if (typeof val === 'object' && val !== null && 'current' in val && typeof val.current === 'number') {
        return val.current;
      }
      return undefined;
    };

    expect(extractRoundNum(r1RunRound)).toBe(1);
    expect(extractRoundNum(r2RunRound)).toBe(2);

    // Verify live analytics timestamps come from MockClock (2026-02-15), not wall-clock Date.now()
    const liveOutputs = runtime.getLiveAnalytics?.() ?? [];
    expect(liveOutputs.length).toBeGreaterThan(0);
    expect(liveOutputs[0]?.timeSpan.started).toBe(clock.currentDate.getTime());

    // Verify typed LiveSessionTelemetry preserves metric types and computes +9s round split delta
    const telemetry = projectLiveSessionTelemetry(runtime);
    expect(telemetry.summaries.length).toBeGreaterThan(0);
    expect(
      telemetry.summaries.some((s) => typeof s.metricType === 'string' && s.metricType.length > 0),
    ).toBe(true);

    const r2RunSplit = telemetry.splits.find((sp) => sp.round === 2 && sp.label.includes('400'));
    expect(r2RunSplit).toBeDefined();
    expect(r2RunSplit?.elapsedMs).toBe(99_000);
    expect(r2RunSplit?.deltaMs).toBe(9_000);
    expect(r2RunSplit?.deltaLabel).toBe('+9s');
  });
});
