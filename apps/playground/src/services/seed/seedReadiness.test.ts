/** seedReadiness gate: opt-in activation, settle transitions, busy retry. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  getSeedReadiness,
  getSeedSyncProgress,
  markSeedSyncProgress,
  markSeedSyncSettled,
  markSeedSyncStarted,
  resetSeedReadinessForTest,
  useSeedSyncProgress,
} from './seedReadiness';
import { SEED_CLAIM_TTL_MS, type SeedSyncProgress } from './seedSync';

function snapshot(): string {
  return getSeedReadiness();
}

describe('seedReadiness', () => {
  beforeEach(() => resetSeedReadinessForTest());
  it('publishes the current boot phase and clears it on a fresh start', () => {
    const progress = {
      sourceId: 'core',
      sourceLabel: 'Core library',
      sourceIndex: 1,
      totalSources: 1,
      phase: 'checking',
    } satisfies SeedSyncProgress

    markSeedSyncProgress(progress)
    expect(getSeedSyncProgress()).toBe(progress)

    markSeedSyncStarted()
    expect(getSeedSyncProgress()).toBeNull()
  })

  it('notifies progress subscribers when a fresh start clears an in-flight phase', () => {
    const { result } = renderHook(() => useSeedSyncProgress())
    const progress = {
      sourceId: 'core',
      sourceLabel: 'Core library',
      sourceIndex: 1,
      totalSources: 1,
      phase: 'checking',
    } satisfies SeedSyncProgress

    act(() => markSeedSyncStarted())
    act(() => markSeedSyncProgress(progress))
    expect(result.current).toBe(progress)

    act(() => markSeedSyncStarted())
    expect(result.current).toBeNull()
  })

  afterEach(() => resetSeedReadinessForTest());

  it('starts idle, which reports as ready (ungated)', () => {
    expect(snapshot()).toBe('ready');
  });

  it('preparing once a sync starts; ready on a settled import', () => {
    markSeedSyncStarted();
    expect(snapshot()).toBe('preparing');
    markSeedSyncSettled('imported');
    expect(snapshot()).toBe('ready');
  });

  it('ready for current/disabled/server-stale outcomes; error stays error', () => {
    markSeedSyncStarted();
    markSeedSyncSettled('current');
    expect(snapshot()).toBe('ready');

    resetSeedReadinessForTest();
    markSeedSyncStarted();
    markSeedSyncSettled('disabled');
    expect(snapshot()).toBe('ready');

    resetSeedReadinessForTest();
    markSeedSyncStarted();
    markSeedSyncSettled('server-stale');
    expect(snapshot()).toBe('ready');

    resetSeedReadinessForTest();
    markSeedSyncStarted();
    markSeedSyncSettled('error');
    expect(snapshot()).toBe('error');
  });

  it('busy stays preparing, then becomes ready on a later settled attempt', () => {
    markSeedSyncStarted();
    markSeedSyncSettled('busy');
    expect(snapshot()).toBe('preparing');
    markSeedSyncSettled('imported');
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
      markSeedSyncStarted();
      markSeedSyncSettled('busy');
      expect(calls).toEqual([SEED_CLAIM_TTL_MS]);
    } finally {
      globalRef.setTimeout = originalSetTimeout;
    }
  });

  it('a fresh start clears a pending busy retry', async () => {
    markSeedSyncStarted();
    markSeedSyncSettled('busy');
    markSeedSyncStarted();
    expect(snapshot()).toBe('preparing');
    // No pending timer may flip this later — settle explicitly.
    markSeedSyncSettled('imported');
    expect(snapshot()).toBe('ready');
  });
});
