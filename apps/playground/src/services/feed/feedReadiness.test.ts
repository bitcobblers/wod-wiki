/** feedReadiness gate: opt-in activation, settle transitions, busy retry. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { emptySeedMeta, seedMetaKey } from '@/types/seed';
import { InMemoryFeedStorage } from './FeedImportStorage';
import { feedFixture as fixture } from './feedFixture';
import { resetFeedSubscriptionsForTest, setFeedAutoSync, setFeedOfflinePolicy, setFeedSubscribed } from './feedSubscriptions';
import type { IFeedSource, SeedChunkPayload } from './IFeedSource';
import {
  beginImportActivity,
  endImportActivity,
  getActiveImportLabel,
  getFeedImportEpoch,
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

  it('keeps feedReadiness preparing after markFeedFirstPaint while bootImportPending is true, then settles atomically to ready (WW-019)', () => {
    const { result } = renderHook(() => useFeedImportPending());
    expect(isBootImportPending()).toBe(false);
    expect(result.current).toBe(false);

    act(() => markFeedSyncStarted());
    expect(snapshot()).toBe('preparing');
    expect(isBootImportPending()).toBe(true);
    expect(result.current).toBe(true);
    expect(document.documentElement.dataset.feedState).toBe('preparing');
    expect(document.documentElement.dataset.feedImportPending).toBe('true');

    // Canvas first-paint MUST NOT prematurely flip data-feed-state to 'ready' while importPending is true.
    act(() => markFeedFirstPaint());
    expect(snapshot()).toBe('preparing');
    expect(document.documentElement.dataset.feedState).toBe('preparing');
    expect(isBootImportPending()).toBe(true);
    expect(result.current).toBe(true);

    act(() => markFeedSyncSettled('imported'));
    expect(snapshot()).toBe('ready');
    expect(document.documentElement.dataset.feedState).toBe('ready');
    expect(isBootImportPending()).toBe(false);
    expect(result.current).toBe(false);
  });

  it('tracks ref-counted non-boot import activity via beginImportActivity/endImportActivity and html[data-feed-import-pending] (WW-019)', () => {
    const { result } = renderHook(() => useFeedImportPending());
    expect(isBootImportPending()).toBe(false);
    expect(getActiveImportLabel()).toBeNull();

    act(() => beginImportActivity('Loading sample data…'));
    expect(isBootImportPending()).toBe(true);
    expect(result.current).toBe(true);
    expect(getActiveImportLabel()).toBe('Loading sample data…');
    expect(document.documentElement.dataset.feedImportPending).toBe('true');

    act(() => beginImportActivity('Updating…'));
    act(() => endImportActivity());
    expect(isBootImportPending()).toBe(true);
    expect(document.documentElement.dataset.feedImportPending).toBe('true');

    act(() => endImportActivity());
    expect(isBootImportPending()).toBe(false);
    expect(result.current).toBe(false);
    expect(getActiveImportLabel()).toBeNull();
    expect(document.documentElement.dataset.feedImportPending).toBeUndefined();
  });

  it('startFeedBootstrap holds preparing + bootImportPending across both core and default subscribed feeds on cold boot (WW-019)', async () => {
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

      // Subscribed sample feed is still importing — readiness MUST stay 'preparing' and bootImportPending MUST stay true!
      expect(getFeedReadiness()).toBe('preparing');
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

  it('startFeedBootstrap sets bootImportPending synchronously before any checkpoint probe settles (WW-019)', async () => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    const storage = new InMemoryFeedStorage();
    const coreSrc = fixture([compileSeedRow('markdown/canvas/a.md', '# A')], 1, 'canvas');
    const sources: FeedSourceSpec[] = [
      { source: coreSrc, id: 'core', label: 'Core', url: 'https://feed.test/core/', embeddedVersion: 1 },
    ];
    const done = startFeedBootstrap({ sources, storage, isEnabled: () => true });
    // Synchronous window: the bootstrap's async checkpoint probes have not
    // settled yet, but the boot-import signal must already be up.
    expect(isBootImportPending()).toBe(true);
    await done;
    expect(isBootImportPending()).toBe(false);
  });

  it('startFeedBootstrap leaves bootImportPending false when the import flag is disabled (WW-019)', async () => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    const storage = new InMemoryFeedStorage();
    const coreSrc = fixture([compileSeedRow('markdown/canvas/a.md', '# A')], 1, 'canvas');
    const sources: FeedSourceSpec[] = [
      { source: coreSrc, id: 'core', label: 'Core', url: 'https://feed.test/core/', embeddedVersion: 1 },
    ];
    const done = startFeedBootstrap({ sources, storage, isEnabled: () => false });
    expect(isBootImportPending()).toBe(false);
    await done;
    expect(isBootImportPending()).toBe(false);
  });

  it('startFeedBootstrap holds bootImportPending until a newly subscribed feed first-imports on a warm boot (WW-019)', async () => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    const coreSrc = fixture([compileSeedRow('markdown/canvas/a.md', '# A')], 1, 'canvas');
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
      { source: heldSampleSource, id: 'samples-movement', label: 'Samples', url: 'https://feed.test/samples/', embeddedVersion: 1, autoImport: false },
    ];

    const samplePayload = await sampleSrc.fetchChunk('chunks/notebook.samples.json');
    const done = startFeedBootstrap({ sources, storage, isEnabled: () => true });
    try {
      await sampleRequested.promise;

      // Core checkpoint exists (returning visitor) but the newly subscribed
      // auto-sync feed never imported — gate and bootImportPending stay held until it lands.
      expect(getFeedReadiness()).toBe('preparing');
      expect(isBootImportPending()).toBe(true);
    } finally {
      heldSample.resolve(samplePayload);
      await done;
    }

    expect(getFeedReadiness()).toBe('ready');
    expect(isBootImportPending()).toBe(false);
  });

  it('startFeedBootstrap settles to ready (not error) when core is committed and a pending auto-sync feed fails offline', async () => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    const coreSrc = fixture([compileSeedRow('markdown/canvas/a.md', '# A')], 1, 'canvas');
    const failingSource: IFeedSource = {
      fetchManifest: () => Promise.reject(new Error('offline')),
      fetchChunk: () => Promise.reject(new Error('offline')),
    };
    setFeedSubscribed('samples-movement', true);
    setFeedAutoSync('samples-movement', true);
    const sources: FeedSourceSpec[] = [
      { source: coreSrc, id: 'core', label: 'Core', url: 'https://feed.test/core/', embeddedVersion: 1 },
      { source: failingSource, id: 'samples-movement', label: 'Samples', url: 'https://feed.test/samples/', embeddedVersion: 0, autoImport: false },
    ];

    await startFeedBootstrap({ sources, storage, isEnabled: () => true });
    expect(getFeedReadiness()).toBe('ready');
    expect(isBootImportPending()).toBe(false);
  });

  it('settles feedReadiness and bootImportPending atomically without an intermediate torn state (WW-019)', () => {
    const snapshots: Array<{ readiness: string; pending: boolean }> = [];
    const { unmount } = renderHook(() => {
      const pending = useFeedImportPending();
      snapshots.push({ readiness: getFeedReadiness(), pending });
      return pending;
    });
    try {
      act(() => markFeedSyncStarted());
      snapshots.length = 0;

      act(() => markFeedSyncSettled('imported'));
      // Subscribers must never observe a torn (preparing, pending=false) or (ready, pending=true) state.
      expect(snapshots.some((s) => s.readiness === 'preparing' && !s.pending)).toBe(false);
      expect(snapshots.some((s) => s.readiness === 'ready' && s.pending)).toBe(false);
      expect(snapshots[snapshots.length - 1]).toEqual({ readiness: 'ready', pending: false });
    } finally {
      unmount();
    }
  });

  it('WW-036: returning visitor with already-indexed index-only auto-sync feed settles ready immediately without tripping preparing', async () => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    // Simulate prior index-only sync: catalog:<id> exists, seed:<id> does NOT.
    await storage.putMeta({
      key: 'catalog:samples-movement',
      feedId: 'samples-movement',
      manifest: { schema: 9, version: 1, builtAt: new Date(1).toISOString(), chunks: [] },
      updatedAt: Date.now(),
    });
    setFeedSubscribed('samples-movement', true);
    setFeedAutoSync('samples-movement', true);
    setFeedOfflinePolicy('samples-movement', 'index-only');

    const heldManifest = Promise.withResolvers<never>();
    const manifestRequested = Promise.withResolvers<void>();
    const slowSampleSource: IFeedSource = {
      fetchManifest: () => {
        manifestRequested.resolve();
        return heldManifest.promise;
      },
      fetchChunk: () => heldManifest.promise,
    };
    const coreSrc = fixture([compileSeedRow('markdown/canvas/a.md', '# A')], 1, 'canvas');
    const sources: FeedSourceSpec[] = [
      { source: coreSrc, id: 'core', label: 'Core', url: 'https://feed.test/core/', embeddedVersion: 1 },
      { source: slowSampleSource, id: 'samples-movement', label: 'Samples', url: 'https://feed.test/samples/', embeddedVersion: 1, autoImport: false },
    ];

    const boot = startFeedBootstrap({ sources, storage, isEnabled: () => true });
    await manifestRequested.promise;
    // Gate must already be settled to 'ready' without waiting for the slow remote manifest probe!
    expect(getFeedReadiness()).toBe('ready');
    expect(isBootImportPending()).toBe(false);
    // Reject the hanging probe so boot finishes cleanly.
    heldManifest.reject(new Error('abort test probe'));
    await boot;
  });

  it('WW-036/WW-154: feedImportEpoch stays stable on returning-visitor current settle and increments only on real commits', async () => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    const coreSrc = fixture([compileSeedRow('markdown/canvas/a.md', '# A')], 1, 'canvas');
    const sources: FeedSourceSpec[] = [
      { source: coreSrc, id: 'core', label: 'Core', url: 'https://feed.test/core/', embeddedVersion: 1 },
    ];

    expect(getFeedImportEpoch()).toBe(0);
    await startFeedBootstrap({ sources, storage, isEnabled: () => true });
    // Returning visitor with 'current' outcome must NOT bump import epoch (prevents Explorer/Dashboard double-runs).
    expect(getFeedImportEpoch()).toBe(0);

    // Real non-boot sample import DOES bump epoch once it finishes.
    beginImportActivity('Loading sample data…');
    expect(getFeedImportEpoch()).toBe(0);
    endImportActivity();
    expect(getFeedImportEpoch()).toBe(1);

    // Explicit 'imported' settlement ALSO bumps epoch.
    markFeedSyncStarted();
    markFeedSyncSettled('imported');
    expect(getFeedImportEpoch()).toBe(2);
  });

  it('FED-01: returning visitor still checks subscribed auto-sync feeds on consecutive reloads and applies updates', async () => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('manage-library')), seedVersion: 42, builtAt: new Date(1).toISOString() });
    setFeedSubscribed('manage-library', true);
    setFeedAutoSync('manage-library', true);

    let remoteVersion = 42;
    const makeSource = (): FeedSourceSpec[] => [
      { source: fixture([compileSeedRow('markdown/canvas/a.md', '# A')], 1, 'canvas'), id: 'core', label: 'Core', url: 'https://feed.test/core/', embeddedVersion: 1 },
      {
        source: fixture([compileSeedRow('markdown/notebooks/demo/w1.md', `# W ${remoteVersion}`)], remoteVersion, 'notebook.demo'),
        id: 'manage-library',
        label: 'Manage Library',
        url: 'https://feed.test/manage/',
        embeddedVersion: 0,
      },
    ];

    // Initial sync establishes v42 checkpoint + chunks.
    await startFeedBootstrap({ sources: makeSource(), storage, isEnabled: () => true });
    expect((await storage.getSeedMeta(seedMetaKey('manage-library')))?.seedVersion).toBe(42);

    // First returning boot at v42 — stays current, epoch unchanged
    resetFeedReadinessForTest();
    await startFeedBootstrap({ sources: makeSource(), storage, isEnabled: () => true });
    expect(getFeedImportEpoch()).toBe(0);

    // Immediate reload after remote bumps to v43 — must re-check and import v43
    resetFeedReadinessForTest();
    remoteVersion = 43;
    await startFeedBootstrap({ sources: makeSource(), storage, isEnabled: () => true });
    expect((await storage.getSeedMeta(seedMetaKey('manage-library')))?.seedVersion).toBe(43);
    expect(getFeedImportEpoch()).toBe(1);
  });
});
