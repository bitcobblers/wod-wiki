import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildDashboardDocument,
  parseDashboardNote,
  type DashboardDocument,
} from '@bitcobblers/wod-wiki-wql';
import {
  buildSampleWorld,
  generateSampleSessions,
} from '../../src/sample';
import { DomainScenarioHarness } from '../harness/DomainScenarioHarness';

const DASHBOARDS_DIR = path.resolve(__dirname, '../../../../markdown/dashboards');
const DASHBOARD_FILES = [
  'benchmark-pr-board.md',
  'finger-strength-v8.md',
  'polarized-base-marathon.md',
  'recovery-readiness.md',
  'road-to-560-total.md',
  'training-block-review.md',
] as const;

describe('Tier 1c — Sample Corpus and Prebuilt Dashboards', () => {
  const anchorNow = Date.UTC(2025, 5, 15, 12, 0, 0); // 2025-06-15T12:00:00Z
  let harness: DomainScenarioHarness;

  beforeAll(async () => {
    const sampleWorld = buildSampleWorld(anchorNow);
    harness = await DomainScenarioHarness.create(sampleWorld);
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  describe('Sample data generation contract', () => {
    it('generates a rich training history with 14+ sessions spanning 16 weeks', () => {
      const sessions = generateSampleSessions(anchorNow);
      expect(sessions.length).toBeGreaterThanOrEqual(14);
      expect(sessions.length).toBeGreaterThanOrEqual(48);

      // Verify temporal ordering
      for (let i = 1; i < sessions.length; i++) {
        expect(sessions[i].timestamp).toBeGreaterThanOrEqual(sessions[i - 1].timestamp);
      }

      // Verify benchmark, strength, cardio, and climbing diversity
      const workoutTypes = new Set(sessions.map((s) => s.workoutType));
      expect(workoutTypes.has('fran')).toBe(true);
      expect(workoutTypes.has('cindy')).toBe(true);
      expect(workoutTypes.has('annie')).toBe(true);
      expect(workoutTypes.has('strength')).toBe(true);
      expect(workoutTypes.has('running')).toBe(true);
      expect(workoutTypes.has('rowing')).toBe(true);
      expect(workoutTypes.has('recoveryRun')).toBe(true);
      expect(workoutTypes.has('hangboard')).toBe(true);

      // Verify tag presence
      const allTags = new Set(sessions.flatMap((s) => s.tags));
      expect(allTags.has('sample')).toBe(true);
      expect(allTags.has('benchmark')).toBe(true);
      expect(allTags.has('strength')).toBe(true);
      expect(allTags.has('hangboard')).toBe(true);
    });

    it('persists sample data into live storage through DomainScenarioHarness', async () => {
      const noteRows = await harness.storage.readonly('notes').getAll();
      expect(noteRows.length).toBeGreaterThanOrEqual(14);

      const sessionRows = await harness.storage.readonly('sessions').getAll();
      expect(sessionRows.length).toBeGreaterThanOrEqual(14);

      const eventRows = await harness.storage.readonly('events').getAll();
      expect(eventRows.length).toBeGreaterThan(100);

      const tagRows = await harness.storage.readonly('tags').getAll();
      expect(tagRows.some((t) => t.label === 'benchmark')).toBe(true);
      expect(tagRows.some((t) => t.label === 'sample')).toBe(true);
    });
  });

  describe('Prebuilt dashboards WQL execution', () => {
    for (const fileName of DASHBOARD_FILES) {
      describe(`Dashboard: ${fileName}`, () => {
        let doc: DashboardDocument;
        let rawContent: string;

        beforeAll(() => {
          const filePath = path.join(DASHBOARDS_DIR, fileName);
          expect(fs.existsSync(filePath), `Dashboard file must exist at ${filePath}`).toBe(true);
          rawContent = fs.readFileSync(filePath, 'utf-8');
          const { meta, sections } = parseDashboardNote(rawContent);
          doc = buildDashboardDocument(sections, meta);
        });

        it('parses as a valid dashboard with multiple widget queries', () => {
          expect(doc.isDashboard).toBe(true);
          expect(doc.title).toBeDefined();
          expect(doc.widgets.length).toBeGreaterThanOrEqual(4);
        });

        it('executes every widget query successfully with non-empty and unit-consistent results', async () => {
          for (const widget of doc.widgets) {
            expect(widget.body, `Widget '${widget.title ?? widget.key}' has empty query`).toBeTruthy();

            // Execute the WQL query
            const result = await harness.queryAggregate(widget.body, { anchorNow });

            // 1. Assert no syntax, evaluation, or parsing error
            expect(
              result.error,
              `Widget '${widget.title ?? widget.key}' (${widget.body}) failed with error: ${result.error}`,
            ).toBeUndefined();

            // 2. Assert non-empty result
            const hasScalar = typeof result.scalar === 'number' && Number.isFinite(result.scalar);
            const hasSeries = result.series && result.series.length > 0;
            const hasSeriesPoints = hasSeries && result.series.some((s) => s.points && s.points.length > 0);
            const hasStagesSelected = (result.stages?.selected ?? 0) > 0;

            const isPopulated = hasScalar || hasSeriesPoints || hasStagesSelected;
            expect(
              isPopulated,
              `Widget '${widget.title ?? widget.key}' query '${widget.body}' returned empty results (scalar: ${result.scalar}, series: ${result.series?.length})`,
            ).toBe(true);

            // 3. Assert unit-consistency
            if (result.unit !== undefined && result.unit !== '') {
              expect(typeof result.unit).toBe('string');
              expect(result.unit.length).toBeGreaterThan(0);
            }

            if (result.series) {
              for (const s of result.series) {
                for (const p of s.points) {
                  expect(p.value).toBeDefined();
                  expect(typeof p.value).toBe('number');
                  expect(Number.isFinite(p.value as number)).toBe(true);
                }
              }
            }
          }
        });
      });
    }
  });
});
