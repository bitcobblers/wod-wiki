/** feedReadiness gate: opt-in activation, settle transitions, busy retry. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { emptySeedMeta, seedMetaKey } from '@/types/seed';
import { InMemoryFeedStorage } from './FeedImportStorage';
import { feedFixture as fixture } from './feedFixture';
import { resetFeedSubscriptionsForTest, setFeedAutoSync, setFeedSubscribed } from './feedSubscriptions';
import type { IFeedSource, SeedChunkPayload } from './IFeedSource';
import {
  getFeedReadiness,
  getFeedSyncProgress,
  isBootImportPending,
  markFeedFirstPaint,
  markFeedSyncProgress,
  markFeedSyncSettled,
  markFeedSyncStarted,
  resetFeedReadinessForTest,
  startFeedBootstrap,
  useFeedImportPending,
  useFeedSyncProgress,
} from './feedReadiness';
import { SEED_CLAIM_TTL_MS, type FeedSourceSpec, type FeedSyncProgress } from './feedSync';

function snapshot(): string {
  return getFeedReadiness();
}

describe('feedReadiness', () => {
  beforeEach(() => resetFeedReadinessForTest());
  it('publishes the current boot phase and clears it on a fresh start', () => {
    const progress = {
      sourceId: 'core',
      sourceLabel: 'Core library',
      sourceIndex: 1,
      totalSources: 1,
      phase: 'checking',
    } satisfies FeedSyncProgress

    markFeedSyncProgress(progress)
    expect(getFeedSyncProgress()).toBe(progress)

    markFeedSyncStarted()
    expect(getFeedSyncProgress()).toBeNull()
  })

  it('notifies progress subscribers when a fresh start clears an in-flight phase', () => {
    const { result } = renderHook(() => useFeedSyncProgress())
    const progress = {
      sourceId: 'core',
      sourceLabel: 'Core library',
      sourceIndex: 1,
      totalSources: 1,
      phase: 'checking',
    } satisfies FeedSyncProgress

    act(() => markFeedSyncStarted())
    act(() => markFeedSyncProgress(progress))
    expect(result.current).toBe(progress)

    act(() => markFeedSyncStarted())
    expect(result.current).toBeNull()
  })

  afterEach(() => resetFeedReadinessForTest());

  it('starts idle, which reports as ready (ungated)', () => {
    expect(snapshot()).toBe('ready');
  });

  it('preparing once a sync starts; ready on a settled import', () => {
    markFeedSyncStarted();
    expect(snapshot()).toBe('preparing');
    markFeedSyncSettled('imported');
    expect(snapshot()).toBe('ready');
  });

  it('ready for current/disabled/server-stale outcomes; error stays error', () => {
    markFeedSyncStarted();
    markFeedSyncSettled('current');
    expect(snapshot()).toBe('ready');

    resetFeedReadinessForTest();
    markFeedSyncStarted();
    markFeedSyncSettled('disabled');
    expect(snapshot()).toBe('ready');

    resetFeedReadinessForTest();
    markFeedSyncStarted();
    markFeedSyncSettled('server-stale');
    expect(snapshot()).toBe('ready');

    resetFeedReadinessForTest();
    markFeedSyncStarted();
    markFeedSyncSettled('error');
    expect(snapshot()).toBe('error');
  });

  it('busy stays preparing, then becomes ready on a later settled attempt', () => {
    markFeedSyncStarted();
    markFeedSyncSettled('busy');
    expect(snapshot()).toBe('preparing');
    markFeedSyncSettled('imported');
    expect(snapshot()).toBe('ready');
  });

  it('busy arms a retry at the claim TTL', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    // Test-only global swap: bun's jsdom global exposes a writable setTimeout
    // whose TS type is the DOM overload set.
    const globalRef = globalThis as unknown as { setTimeout: typeof setTimeout };
    const calls: number[] = [];
    globalRef.setTimeout = ((handler: () => void, ms?: number) => {
      calls.push(ms ?? 0);
      return originalSetTimeout(handler, 0);
    }) as typeof setTimeout;
    try {
      markFeedSyncStarted();
      markFeedSyncSettled('busy');
      expect(calls).toEqual([SEED_CLAIM_TTL_MS]);
    } finally {
      globalRef.setTimeout = originalSetTimeout;
    }
  });

  it('a fresh start clears a pending busy retry', async () => {
    markFeedSyncStarted();
    markFeedSyncSettled('busy');
    markFeedSyncStarted();
    expect(snapshot()).toBe('preparing');
    // No pending timer may flip this later — settle explicitly.
    markFeedSyncSettled('imported');
    expect(snapshot()).toBe('ready');
  });

  it('markFeedFirstPaint ungates readiness while keeping bootImportPending true until settled (WW-019)', () => {
    const { result } = renderHook(() => useFeedImportPending());
    expect(isBootImportPending()).toBe(false);
    expect(result.current).toBe(false);

    act(() => markFeedSyncStarted());
    expect(snapshot()).toBe('preparing');
    expect(isBootImportPending()).toBe(true);
    expect(result.current).toBe(true);

    act(() => markFeedFirstPaint());
    expect(snapshot()).toBe('ready');
    expect(isBootImportPending()).toBe(true);
    expect(result.current).toBe(true);

    act(() => markFeedSyncSettled('imported'));
    expect(snapshot()).toBe('ready');
    expect(isBootImportPending()).toBe(false);
    expect(result.current).toBe(false);
  });

  it('startFeedBootstrap holds bootImportPending across both core and default subscribed feeds on cold boot (WW-019)', async () => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    const storage = new InMemoryFeedStorage();
    const coreSrc = fixture(
      [compileSeedRow('markdown/canvas/a.md', '# A'), compileSeedRow('markdown/notebooks/x/b.md', '# B')],
      1,
      'canvas',
    );
    const sampleSrc = fixture(
      [compileSeedRow('markdown/notebooks/samples/s1.md', '# Sample 1')],
      1,
      'notebook.samples',
    );
    const heldSample = Promise.withResolvers<SeedChunkPayload>();
    const sampleRequested = Promise.withResolvers<void>();
    const heldSampleSource: IFeedSource = {
      fetchManifest: () => sampleSrc.fetchManifest(),
      fetchChunk: (path) => {
        if (path === 'chunks/notebook.samples.json') {
          sampleRequested.resolve();
          return heldSample.promise;
        }
        return sampleSrc.fetchChunk(path);
      },
    };
    setFeedSubscribed('samples-movement', true);
    setFeedAutoSync('samples-movement', true);
    const sources: FeedSourceSpec[] = [
      { source: coreSrc, id: 'core', label: 'Core', url: 'https://feed.test/core/', embeddedVersion: 1 },
      { source: heldSampleSource, id: 'samples-movement', label: 'Samples', url: 'https://feed.test/samples/', embeddedVersion: 0, autoImport: false },
    ];

    const samplePayload = await sampleSrc.fetchChunk('chunks/notebook.samples.json');
    const done = startFeedBootstrap({ sources, storage, isEnabled: () => true });
    try {
      await sampleRequested.promise;

      // First-paint ungated the UI shell (`ready`), AND core finished, yet
      // subscribed sample feed is still importing — bootImportPending MUST stay true!
      expect(getFeedReadiness()).toBe('ready');
      expect(isBootImportPending()).toBe(true);
    } finally {
      heldSample.resolve(samplePayload);
      await done;
    }

    expect(getFeedReadiness()).toBe('ready');
    expect(isBootImportPending()).toBe(false);
  });

  it('startFeedBootstrap keeps bootImportPending false for returning visitors (WW-019)', async () => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    const coreSrc = fixture([compileSeedRow('markdown/canvas/a.md', '# A')], 1, 'canvas');
    const sources: FeedSourceSpec[] = [
      { source: coreSrc, id: 'core', label: 'Core', url: 'https://feed.test/core/', embeddedVersion: 1 },
    ];

    await startFeedBootstrap({ sources, storage, isEnabled: () => true });
    expect(getFeedReadiness()).toBe('ready');
    expect(isBootImportPending()).toBe(false);
  });
});
