import { afterEach, describe, expect, it } from 'vitest';
import { buildTestSession, resetTestingVocabulary } from '@bitcobblers/wod-wiki-core/testing';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { buildDashboardDocument, parseDashboardNote, parseQueryBlock, type RowsRun } from '@bitcobblers/wod-wiki-wql';
import {
  buildContextualPageSource,
  buildWorkoutDashboardScaffold,
} from '../../src/index';
import { DomainScenarioHarness, HARNESS_EPOCH } from '../harness/DomainScenarioHarness';

describe('Domain — Results Experience 8 WQL extensions over SqlStorage', () => {
  let harness: DomainScenarioHarness;

  afterEach(async () => {
    resetTestingVocabulary();
    await harness?.dispose();
  });

  it('persists notebook membership, computes RowsRun.summary, supports !result: exclusion, where :session{...}, and contextual page sources', async () => {
    harness = await DomainScenarioHarness.create();

    const built = await harness.authorNote({
      id: 'note-domain-fran',
      title: 'Domain Fran',
      notebookId: 'notebook/benchmarks',
      rawContent: '# Domain Fran\n\n```time\n21-15-9\n  Thrusters 95lb\n  Pull-Ups\n```\n',
    });
    const benchNote = built.note;
    const blockId = built.blockIndex[0]!.blockId;
    const blockContentId = built.blockIndex[0]!.blockContentId!;
    const run1 = buildTestSession({
      id: 'sess-domain-fran-1',
      noteId: benchNote.id,
      blockId,
      notebookIds: ['notebook/benchmarks'],
      startedAt: HARNESS_EPOCH,
      events: [
        {
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'thruster',
          blockContentId,
          sourceBlockKey: 'seg-1',
          metrics: [
            { type: MetricType.Effort, value: 'thruster', origin: 'parser', metadata: { effortSlug: 'thruster' } },
            { type: MetricType.Rep, value: 21, unit: 'reps', origin: 'runtime', metadata: { canonicalKey: 'reps' } },
            { type: MetricType.Resistance, value: 95, unit: 'lb', origin: 'runtime', metadata: { canonicalKey: 'resistance' } },
          ],
        },
        {
          grain: 'summary',
          outputType: 'analytics',
          blockContentId,
          metrics: [
            { type: 'totalVolume' as MetricType, value: 1995, unit: 'lb', metadata: { canonicalKey: 'totalVolume' } },
            { type: 'tis' as MetricType, value: 82, unit: 'pts', metadata: { canonicalKey: 'tis' } },
          ],
        },
      ],
    });
    run1.session.blockContentId = blockContentId;
    const run2 = buildTestSession({
      id: 'sess-domain-fran-2',
      noteId: benchNote.id,
      blockId,
      notebookIds: ['notebook/benchmarks'],
      startedAt: HARNESS_EPOCH + 86_400_000,
      events: [
        {
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'thruster',
          blockContentId,
          sourceBlockKey: 'seg-2',
          metrics: [
            { type: MetricType.Effort, value: 'thruster', origin: 'parser', metadata: { effortSlug: 'thruster' } },
            { type: MetricType.Rep, value: 15, unit: 'reps', origin: 'runtime', metadata: { canonicalKey: 'reps' } },
            { type: MetricType.Resistance, value: 95, unit: 'lb', origin: 'runtime', metadata: { canonicalKey: 'resistance' } },
          ],
        },
        {
          grain: 'summary',
          outputType: 'analytics',
          blockContentId,
          metrics: [
            { type: 'totalVolume' as MetricType, value: 1425, unit: 'lb', metadata: { canonicalKey: 'totalVolume' } },
          ],
        },
      ],
    });
    run2.session.blockContentId = blockContentId;

    await harness.storage.transaction(['sessions', 'events'], 'readwrite', async (tx) => {
      await tx.readwrite('sessions').putMany([run1.session, run2.session]);
      await tx.readwrite('events').putMany([...run1.events, ...run2.events]);
    });

    const nbAgg = await harness.queryAggregate('sum:totalVolume{notebook:benchmarks} in lb', { anchorNow: HARNESS_EPOCH + 2 * 86_400_000 });
    expect(nbAgg.scalar).toBeCloseTo(3420, 1);

    const negRes = await harness.queryWql<{ runs: RowsRun[] }>(`:session{block:${blockContentId}, !result:sess-domain-fran-2}`, {
      anchorNow: HARNESS_EPOCH + 2 * 86_400_000,
    });
    expect(negRes.runs.map((r) => r.resultId)).toEqual(['sess-domain-fran-1']);
    expect(negRes.runs[0]?.summary?.tis).toBe(82);
    expect(negRes.runs[0]?.summary?.noteTitle).toBe('Domain Fran');

    const ctxSources = await buildContextualPageSource(harness.storage, {
      resultId: 'sess-domain-fran-1',
      blockContentId,
      noteId: benchNote.id,
      notebookSlug: 'benchmarks',
    });
    expect(ctxSources.get('@session')?.events).toHaveLength(2);
    expect(ctxSources.get('@block')?.events).toHaveLength(4);
    expect(ctxSources.get('@notebook')?.notes).toHaveLength(1);

    const parsedSummary = parseQueryBlock('view: summary\nquery: :session{result:sess-domain-fran-1}');
    expect(parsedSummary.view).toBe('summary');

    const scaffoldMd = buildWorkoutDashboardScaffold({
      title: 'Domain Fran Board',
      resultId: 'sess-domain-fran-1',
      blockContentId,
      notebookSlug: 'benchmarks',
    });
    const parsedBoard = parseDashboardNote(scaffoldMd);
    const boardDoc = buildDashboardDocument(parsedBoard.sections, parsedBoard.meta);
    expect(boardDoc.widgets).toHaveLength(4);
  });
});
