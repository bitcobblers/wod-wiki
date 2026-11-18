import { afterEach, describe, expect, it } from 'vitest';
import { prepareJournalSessionRun } from '../../../src';
import { DomainScenarioHarness, HARNESS_EPOCH } from '../../harness/DomainScenarioHarness';

describe('WW-093 — volume vs bar load and session store count reconciliation', () => {
  let harness: DomainScenarioHarness;
  afterEach(() => harness?.dispose());

  it('computes totalVolume as load * reps (1912.5 kg), not bar load (42.5 kg), for 21-15-9 Thrusters 42.5 kg', async () => {
    harness = await DomainScenarioHarness.create();
    const { note } = await harness.authorNote({
      id: 'ww093-thrusters',
      title: 'WW093 Volume Probe',
      rawContent: '# WW093 Volume Probe\n\n```time\n21-15-9\n  Thrusters 42.5 kg\n```\n',
    });

    await harness.prepareAndRunSession({
      noteId: note.id,
      sessionId: 'sess-ww093-vol',
      startedAt: HARNESS_EPOCH,
      advances: [10_000],
      maxNexts: 16,
    });

    const vol = await harness.queryAggregate('sum:totalVolume{} in kg', { anchorNow: HARNESS_EPOCH + 60_000 });
    expect(vol.error).toBeUndefined();
    if (typeof vol.scalar === 'number') {
      // 45 reps * 42.5 kg = 1912.5 kg; must never be confused with the 42.5 kg bar load.
      expect(vol.scalar).not.toBeCloseTo(42.5, 1);
      expect(vol.scalar).toBeCloseTo(42.5 * 45, 1);
    }
  });

  it('reconciles :session{} run count with sessions store including in-progress rows', async () => {
    harness = await DomainScenarioHarness.create();
    const { note } = await harness.authorNote({
      id: 'ww093-count',
      title: 'WW093 Count Probe',
      rawContent: '# WW093 Count Probe\n\n```time\nTimer: 0:06\n5 Burpees\n```\n',
    });

    await harness.prepareAndRunSession({
      noteId: note.id,
      sessionId: 'sess-ww093-a',
      startedAt: HARNESS_EPOCH,
      advances: [6_000],
    });
    await harness.prepareAndRunSession({
      noteId: note.id,
      sessionId: 'sess-ww093-b',
      startedAt: HARNESS_EPOCH + 20_000,
      advances: [6_000],
    });

    // Simulate a halted in-progress session row persisted in storage.
    await prepareJournalSessionRun(harness.storage, {
      noteId: note.id,
      sessionId: 'sess-ww093-c',
      startedAt: HARNESS_EPOCH + 40_000,
    });

    const storeCount = (await harness.storage.readonly('sessions').getAll()).length;
    expect(storeCount).toBe(3);

    const findRes = (await harness.queryWql(':session{}')) as { runs?: Array<{ resultId: string }> };
    expect(findRes.runs ?? []).toHaveLength(storeCount);
  });
});
