import { afterEach, describe, expect, it } from 'vitest';
import { prepareJournalSessionRun } from '../../../src';
import { DomainScenarioHarness, HARNESS_EPOCH } from '../../harness/DomainScenarioHarness';

describe('WW-052 — Ready-to-Start gate does not leave a 0s phantom session row', () => {
  let harness: DomainScenarioHarness;
  afterEach(() => harness?.dispose());

  it('leaves no 0s in-progress phantom session row when preparing a run without starting', async () => {
    harness = await DomainScenarioHarness.create();
    const { note } = await harness.authorNote({
      id: 'ww052-gate-probe',
      title: 'WW052 Gate Probe',
      rawContent: '# WW052 Gate Probe\n\n```time\nTimer: 1:00\n10 Burpees\n```\n',
    });

    await prepareJournalSessionRun(harness.storage, {
      noteId: note.id,
      sessionId: 'sess-ww052-gate',
      startedAt: HARNESS_EPOCH,
    });

    // At the Ready-to-Start gate (before the athlete actually starts),
    // no 0s in-progress phantom session row may be persisted in the sessions store.
    const sessions = await harness.storage.readonly('sessions').getAll();
    expect(sessions).toEqual([]);
  });
});
