import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDashboardDocument, parseDashboardNote } from '@bitcobblers/wod-wiki-wql';
import { buildSampleWorld } from '../../../src/sample';
import { DomainScenarioHarness } from '../../harness/DomainScenarioHarness';

const BENCHMARK_BOARD_PATH = path.resolve(
  __dirname,
  '../../../../../markdown/dashboards/benchmark-pr-board.md',
);

describe('WW-056 — Benchmark PR Board populates from sample world', () => {
  const anchorNow = Date.now();
  let harness: DomainScenarioHarness;

  beforeAll(async () => {
    const sampleWorld = buildSampleWorld(anchorNow);
    harness = await DomainScenarioHarness.create(sampleWorld);
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it('executes every Benchmark PR Board widget with non-empty data against current sample world', async () => {
    const raw = fs.readFileSync(BENCHMARK_BOARD_PATH, 'utf-8');
    const { meta, sections } = parseDashboardNote(raw);
    const doc = buildDashboardDocument(sections, meta);

    expect(doc.widgets.length).toBe(5);

    for (const widget of doc.widgets) {
      const result = await harness.queryAggregate(widget.body, { anchorNow });
      expect(result.error).toBeUndefined();
      const hasScalar = typeof result.scalar === 'number' && Number.isFinite(result.scalar);
      const hasSeriesPoints = Boolean(result.series?.some((s) => s.points && s.points.length > 0));
      const hasStagesSelected = (result.stages?.selected ?? 0) > 0;
      expect(
        hasScalar || hasSeriesPoints || hasStagesSelected,
        `Widget '${widget.title}' (${widget.body}) returned empty data`,
      ).toBe(true);
    }
  });
});
