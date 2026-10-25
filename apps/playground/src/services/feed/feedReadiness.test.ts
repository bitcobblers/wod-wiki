/** feedReadiness gate: opt-in activation, settle transitions, busy retry. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  getFeedReadiness,
  getFeedSyncProgress,
  markFeedSyncProgress,
  markFeedSyncSettled,
  markFeedSyncStarted,
  resetFeedReadinessForTest,
  useFeedSyncProgress,
} from './feedReadiness';
import { SEED_CLAIM_TTL_MS, type FeedSyncProgress } from './feedSync';

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
});
