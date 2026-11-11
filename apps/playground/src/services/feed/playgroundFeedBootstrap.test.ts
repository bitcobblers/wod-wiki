import { beforeEach, describe, expect, it } from 'bun:test';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { isNoteEditable, type Note } from '@bitcobblers/wod-wiki-core';
import { notebooksOfItem, notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql';
import { seedMetaKey } from '@/types/seed';
import { InMemoryFeedStorage } from './FeedImportStorage';
import { CountingFeedSource } from './InMemoryFeedSource';
import { feedFixture as fixture } from './feedFixture';
import { type FeedSourceSpec } from './feedSync';
import { resetFeedReadinessForTest, startFeedBootstrap } from './feedReadiness';
import {
  isFeedAutoSync,
  isFeedSubscribed,
  resetFeedSubscriptionsForTest,
  setFeedAutoSync,
  setFeedSubscribed,
} from './feedSubscriptions';
import { PLAYGROUND_DEFAULT_SAMPLE_FEED_IDS } from './playgroundFeedBootstrap';

function makeSpec(
  source: FeedSourceSpec['source'],
  id: string,
  embeddedVersion = 0,
  autoImport = false,
): FeedSourceSpec {
  return {
    source,
    id,
    label: id,
    url: `https://feed.test/${id}/`,
    embeddedVersion,
    autoImport,
  };
}

describe('Candidate 04 — Read-only defaults primitives & pre-subscribed Playground guide/sample Feeds', () => {
  beforeEach(() => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    resetFeedReadinessForTest();
  });

  it('pre-subscribes and auto-syncs Playground guides and sample Feeds on first load while keeping optional community Feeds opt-in', async () => {
    const storage = new InMemoryFeedStorage();
    const coreSource = new CountingFeedSource(
      fixture([compileSeedRow('markdown/canvas/guide/start.md', '# Guide Start')], 1, 'canvas'),
    );
    const moveSamples = new CountingFeedSource(
      fixture(
        [compileSeedRow('markdown/notebooks/unconventional/mace.md', '# Mace Flow\n\n```time\n5:00 Club Swings\n```')],
        1,
        'notebook.unconventional',
      ),
    );
    const resultSamples = new CountingFeedSource(
      fixture(
        [compileSeedRow('markdown/notebooks/hyrox-races/race-1.md', '# HYROX Race\n\n```time\n1000m Run\n```')],
        1,
        'notebook.hyrox-races',
      ),
    );
    const optionalCrossfit = new CountingFeedSource(
      fixture(
        [compileSeedRow('markdown/notebooks/crossfit-girls/fran.md', '# Fran\n\n```time\n21-15-9 Thrusters\n```')],
        1,
        'notebook.crossfit-girls',
      ),
    );

    const sources: FeedSourceSpec[] = [
      makeSpec(coreSource, 'core', 1, true),
      makeSpec(moveSamples, 'samples-movement', 0, false),
      makeSpec(resultSamples, 'samples-results', 0, false),
      makeSpec(optionalCrossfit, 'sport-crossfit', 0, false),
    ];

    expect(PLAYGROUND_DEFAULT_SAMPLE_FEED_IDS).toEqual(['samples-movement', 'samples-results']);

    await startFeedBootstrap({ sources, storage, isEnabled: () => true });

    // Core + sample feeds are pre-subscribed, autoSync ON, and auto-imported on first boot
    expect(isFeedSubscribed('core')).toBe(true);
    expect(isFeedSubscribed('samples-movement')).toBe(true);
    expect(isFeedAutoSync('samples-movement')).toBe(true);
    expect(isFeedSubscribed('samples-results')).toBe(true);
    expect(isFeedAutoSync('samples-results')).toBe(true);

    expect((await storage.getSeedMeta(seedMetaKey('core')))?.seedVersion).toBe(1);
    expect((await storage.getSeedMeta(seedMetaKey('samples-movement')))?.seedVersion).toBe(1);
    expect((await storage.getSeedMeta(seedMetaKey('samples-results')))?.seedVersion).toBe(1);

    // Optional community feed remains unsubscribed and untouched
    expect(isFeedSubscribed('sport-crossfit')).toBe(false);
    expect(await storage.getSeedMeta(seedMetaKey('sport-crossfit'))).toBeUndefined();

    // User explicitly unsubscribes samples-movement and disables autoSync on samples-results -> respected on next boot
    setFeedSubscribed('samples-movement', false);
    setFeedAutoSync('samples-results', false);
    resetFeedReadinessForTest();

    await startFeedBootstrap({ sources, storage, isEnabled: () => true });
    expect(isFeedSubscribed('samples-movement')).toBe(false);
    expect(isFeedAutoSync('samples-results')).toBe(false);
  });

  it('exposes bundled core Effort and Equipment primitives inside read-only notebook/defaults', () => {
    const coreEffort: Note = {
      id: 'seed-thruster',
      title: 'Thruster',
      rawContent: '---\nslug: thruster\n---\n',
      sourceRevision: 1,
      blocks: {},
      createdAt: 1,
      sourceId: 'efforts',
      sourcePath: 'markdown/efforts/weightlifting/thruster.md',
      seedOrigin: 'seed',
      feedOrigin: 'feed',
      feedSourceId: 'core',
    };

    const memberships = notebooksOfItem(coreEffort);
    expect(memberships).toContain('notebook/efforts');
    expect(memberships).toContain('notebook/defaults');
    expect(isNoteEditable(coreEffort, notebookOriginOfItem(coreEffort), 'notebook/defaults')).toBe(false);
  });
});
