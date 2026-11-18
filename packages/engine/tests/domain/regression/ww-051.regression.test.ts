import { afterEach, describe, expect, it } from 'vitest';
import { DomainScenarioHarness, HARNESS_EPOCH } from '../../harness/DomainScenarioHarness';

describe('WW-051 — segment split timeSpans and session duration consistency', () => {
  let harness: DomainScenarioHarness;
  afterEach(() => harness?.dispose());

  it('persists non-structural segment splits with real, increasing timeSpans and matching session duration', async () => {
    harness = await DomainScenarioHarness.create();
    const { note } = await harness.authorNote({
      id: 'ww051-splits',
      title: 'WW051 Splits Probe',
      rawContent: '# WW051 Splits Probe\n\n```time\n(2)\n  5 Burpees\n  10 Squats\n```\n',
    });

    const run = await harness.prepareAndRunSession({
      noteId: note.id,
      sessionId: 'sess-ww051-1',
      startedAt: HARNESS_EPOCH,
      advances: [10_000],
      maxNexts: 16,
    });

    const segments = run.events.filter(
      (e) =>
        e.outputType === 'segment' &&
        Boolean(e.effortSlug) &&
        !String(e.sourceBlockKey ?? '').toLowerCase().startsWith('waiting-to-start') &&
        !String(e.sourceBlockKey ?? '').toLowerCase().startsWith('session-root'),
    );

    expect(segments.length).toBeGreaterThanOrEqual(2);
    for (const seg of segments) {
      expect(seg.timeSpan).toBeDefined();
      expect(seg.timeSpan!.ended).toBeGreaterThan(seg.timeSpan!.started);
    }
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.timeSpan!.started).toBeGreaterThan(segments[i - 1]!.timeSpan!.started);
    }

    const totalEventSpanMs =
      Math.max(...segments.map((s) => s.timeSpan!.ended)) -
      Math.min(...segments.map((s) => s.timeSpan!.started));
    expect(Math.abs((run.session.duration ?? 0) - totalEventSpanMs)).toBeLessThanOrEqual(3_000);
  });
});
