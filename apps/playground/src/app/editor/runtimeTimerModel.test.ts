import { describe, expect, it } from 'bun:test';
import { MetricContainer, MetricType, frozenNow } from '@bitcobblers/wod-wiki-engine';
import { setTagIndex, getTagIndex } from '@/services/tags/tagCatalogue';
import type { ScriptBlock } from '@/components/Editor/types';
import { buildSessions, countSegmentOutputs, createRuntimeForBlock, prepareRuntimeBlock } from './runtimeTimerModel';

function makeBlock(content: string): ScriptBlock {
  return {
    id: 'block-1',
    startLine: 0,
    endLine: 2,
    content,
    state: 'parsed',
    widgetIds: {},
    version: 1,
    createdAt: Date.now(),
  };
}

describe('runtimeTimerModel', () => {
  it('prepares parsed statements without collapsing choices', () => {
    const block = prepareRuntimeBlock(makeBlock('135|185 lbs'));

    expect(block.statements.length).toBeGreaterThan(0);
    expect(block.statements.some(stmt => stmt.metrics.some(m => m.type === MetricType.Choice))).toBe(true);
  });
  it('counts only segment outputs', () => {
    const outputs = [
      { outputType: 'segment' },
      { outputType: 'milestone' },
      { outputType: 'segment' },
    ] as unknown as IOutputStatement[];

    expect(countSegmentOutputs(outputs)).toBe(2);
  });

  it('counts zero when no segment outputs', () => {
    const outputs = [
      { outputType: 'system' },
      { outputType: 'compiler' },
    ] as unknown as IOutputStatement[];

    expect(countSegmentOutputs(outputs)).toBe(0);
  });

  it('counts zero for empty outputs array', () => {
    expect(countSegmentOutputs([])).toBe(0);
  });

  it('builds persisted workout results from runtime outputs', () => {
    const startTime = 1_700_000_000_000;
    const outputs = [
      {
        outputType: 'segment',
        id: 1,
        timeSpan: { started: 0, ended: 60 },
        spans: [],
        elapsed: 60000,
        total: 60000,
        sourceBlockKey: 'block-1',
        stackLevel: 0,
        metrics: new MetricContainer(),
        metricMeta: new Map(),
        order: 0,
        line: 1,
        raw: '5:00 Run',
        value: '5:00 Run',
        parentId: null,
        fragments: [],
        getMetric: () => undefined,
        getMetricsByType: () => [],
        getAllMetricsByType: () => [],
        hasMetric: () => false,
        hasAnyMetric: () => false,
        getPrimaryMetric: () => undefined,
        getDisplayMetrics: () => [],
      },
    ] as unknown as IOutputStatement[];

    const results = buildSessions(outputs, {
      startTime,
      elapsedTime: 60000,
      completed: true,
      now: frozenNow(new Date(startTime)),
    });

    expect(results.startTime).toBe(startTime);
    expect(results.duration).toBe(60000);
    expect(results.completed).toBe(true);
    expect(results.logs).toHaveLength(1);
  });

  it('uses Date.now() as startTime fallback when not provided', () => {
    const startTime = Date.now();
    const results = buildSessions([], {
      elapsedTime: 0,
      completed: false,
      now: frozenNow(new Date(startTime)),
    });

    // startTime should fall back to the provider's now
    expect(results.startTime).toBe(startTime);
    expect(results.endTime).toBe(startTime);
    expect(results.duration).toBe(0);
    expect(results.completed).toBe(false);
    expect(results.logs).toHaveLength(0);
  });

  it('buildSessions handles zero elapsedTime and incomplete state', () => {
    const results = buildSessions([], {
      startTime: 1_700_000_000_000,
      elapsedTime: 0,
      now: frozenNow(new Date(1_700_000_000_000)),
      completed: false,
    });

    expect(results.duration).toBe(0);
    expect(results.completed).toBe(false);
    expect(results.logs).toHaveLength(0);
  });
});

// ── Dogfood findings #1 and #3 — the Run seam ──────────────────────────────
// Deployed repro: a note with `tags: [tonnage]` + `summaries.totalWork:
// sum(work)*2` crashed RuntimeTimerPanel on Run with CalcRegistrationError
// "Unknown symbol: work" (runtimeTimerModel.ts → RuntimeFactory →
// createCalcStack), because the storage-loaded tag index no longer carries
// the built-in tonnage definition.

const TONNAGE_TAG = {
  id: 'tag-tonnage',
  label: 'tonnage',
  createdAt: 0,
  contributions: [
    { kind: 'metric' as const, type: 'resistance', value: 24, unit: 'kg' },
    { kind: 'metric' as const, type: 'work', value: 'reps * resistance' },
    { kind: 'metric' as const, type: 'summaries.totalWork', value: 'sum(work)' },
  ],
};

const TONNAGE_OVERRIDE_NOTE = [
  '---',
  'tags: [tonnage]',
  'summaries.totalWork: sum(work)*2',
  '---',
  '',
].join('\n');

describe('runtimeTimerModel property-note Run regressions (dogfood #1, #3)', () => {
  it('storage loads keep the built-in tonnage tag and creation never crashes on a note summary', () => {
    // The deployed defect: a storage load replaced the cached index and the
    // built-in definitions vanished — `tonnage` resolved to nothing, so the
    // note's `sum(work)*2` had no `work` rule and runtime creation threw
    // CalcRegistrationError, blanking the Run.
    setTagIndex([]);
    try {
      expect(getTagIndex().resolve('tonnage')).toBeDefined();
      expect(() => createRuntimeForBlock(makeBlock('10 Kettlebell Swings'), TONNAGE_OVERRIDE_NOTE)).not.toThrow();
    } finally {
      setTagIndex([TONNAGE_TAG]);
    }
  });

  it('createRuntimeForBlock succeeds with the built-in tonnage tag and the note override', () => {
    setTagIndex([TONNAGE_TAG]);
    const runtime = createRuntimeForBlock(makeBlock('10 Kettlebell Swings'), TONNAGE_OVERRIDE_NOTE);
    try {
      expect(runtime).not.toBeNull();
    } finally {
      runtime?.dispose();
      setTagIndex([TONNAGE_TAG]);
    }
  });

  it('applies frontmatter tags and lets the note summary override the tag default', () => {
    setTagIndex([TONNAGE_TAG]);
    const rt = createRuntimeForBlock(makeBlock('10 Kettlebell Swings'), TONNAGE_OVERRIDE_NOTE);
    expect(rt).not.toBeNull();
    const runtime = rt!;
    try {
      for (let i = 0; i < 10 && runtime.stack.count > 0; i++) {
        runtime.handle({ name: 'next', timestamp: runtime.clock.currentDate, data: {} });
      }
      runtime.finalizeAnalytics();
      const outputs = runtime.getOutputStatements();
      const segment = outputs.find((output) => output.outputType === 'segment' && output.metrics.rawMetrics.some((m) => m.type === 'work'));
      expect(segment?.metrics.rawMetrics.find((m) => m.type === 'work')?.value).toBe(240);
      const totalWork = outputs
        .filter((output) => output.outputType === 'analytics')
        .flatMap((output) => output.metrics.rawMetrics)
        .find((metric) => metric.metadata?.canonicalKey === 'totalWork');
      expect(totalWork?.value).toBe(480);
    } finally {
      runtime.dispose();
    }
  });

  it('prepareRuntimeBlock resolves inline #tonnage to a tag marker and the tag resistance', () => {
    setTagIndex([TONNAGE_TAG]);
    const block = prepareRuntimeBlock(makeBlock('10 Kettlebell Swings #tonnage'));
    const metrics = block.statements.flatMap((stmt) => stmt.getDisplayMetrics());
    // Parser marker — the runtime keys tag-carried functions off it.
    expect(metrics.some((m) => m.type === 'tag.tonnage')).toBe(true);
    // Static tag contribution stamped at parse time: 24 kg resistance.
    expect(metrics.some((m) => m.type === MetricType.Resistance && m.value === 24)).toBe(true);
  });

  it('re-resolves pre-parsed inline tags against the catalogue active at Run time', () => {
    const customTag = {
      id: 'tag-e2e-heavy',
      label: 'e2e-heavy',
      createdAt: 0,
      contributions: [{ kind: 'metric' as const, type: 'resistance', value: 24, unit: 'kg' }],
    };
    setTagIndex([]);
    const stale = prepareRuntimeBlock(makeBlock('10 Kettlebell Swings #e2e-heavy'));
    expect(stale.statements.flatMap((stmt) => stmt.getDisplayMetrics()).some((m) => m.type === 'tag.e2e-heavy')).toBe(false);

    setTagIndex([customTag]);
    const resolved = prepareRuntimeBlock(stale);
    const metrics = resolved.statements.flatMap((stmt) => stmt.getDisplayMetrics());
    expect(metrics.some((m) => m.type === 'tag.e2e-heavy')).toBe(true);
    expect(metrics.some((m) => m.type === MetricType.Resistance && m.value === 24)).toBe(true);
  });

  it('createRuntimeForBlock round-trips a note summary into saved, valued analytics logs', () => {
    // RuntimeTimerPanel.handleComplete path: finalizeAnalytics →
    // getOutputStatements → buildSessions. The note's totalWork summary must
    // land in the saved log stream as a valued analytics row — the live
    // finding #2 showed the row valueless and `sum:totalWork{}` empty.
    setTagIndex([]);
    try {
      const note = [
        '---',
        'metrics.work: reps * resistance',
        'summaries.totalWork: sum(work)',
        '---',
        '',
      ].join('\n');
      const rt = createRuntimeForBlock(makeBlock('10 Kettlebell Swings 24kg'), note);
      expect(rt).not.toBeNull();
      const runtime = rt!;

      // Drive the single statement to completion through the runtime.
      for (let i = 0; i < 10 && runtime.stack.count > 0; i++) {
        runtime.handle({ name: 'next', timestamp: runtime.clock.currentDate, data: {} });
      }

      runtime.finalizeAnalytics();
      const results = buildSessions(runtime.getOutputStatements(), {
        elapsedTime: 0,
        completed: true,
        now: runtime.nowProvider,
      });

      // The SessionRoot's own mount segment carries no workout metrics —
      // select the leaf segment that actually recorded the set.
      const segment = (results.logs ?? []).find(
        (o) => o.outputType === 'segment' && o.metrics.some((m) => m.type === 'work'),
      );
      expect(segment?.metrics.find((m) => m.type === 'work')?.value).toBe(240);

      const totalWorkRow = (results.logs ?? []).find(
        (o) => o.outputType === 'analytics'
          && o.metrics.some((m) => m.type === MetricType.Label && m.value === 'totalWork'),
      );
      expect(totalWorkRow).toBeDefined();
      const valueMetric = totalWorkRow!.metrics.find(
        (m) => m.type !== MetricType.Label && typeof m.value === 'number',
      );
      expect(valueMetric?.value).toBe(240);
    } finally {
      setTagIndex([TONNAGE_TAG]);
    }
  });
});
