/**
 * useTourScrollQuests.test.ts — Unit tests for the home tour scroll-quest
 * hook: the session-insights section fires its qs-tour-* quest when scrolled
 * into view; run-started quests are never scroll-completed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useTourScrollQuests } from './useTourScrollQuests';

const STORAGE_KEY = 'wodwiki.quests.v1';
const PAGE_ROUTE = '/';

const tourQuests = [
  { id: 'qs-arrive', label: 'Welcome to WOD Wiki' },
  { id: 'qs-tour-analytics', label: 'Review the session' },
];

function readLedger(): Record<string, Record<string, boolean>> {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe('useTourScrollQuests', () => {
  it('marks the analytics quest complete when the insights section scrolls into view', () => {
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));

    act(() => result.current('session-insights'));

    expect(readLedger()[PAGE_ROUTE]?.['qs-tour-analytics']).toBe(true);
  });

  it('is idempotent — revisiting the section keeps the quest complete', () => {
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));

    act(() => {
      result.current('session-insights');
    });
    act(() => {
      result.current('session-insights');
    });

    expect(readLedger()[PAGE_ROUTE]?.['qs-tour-analytics']).toBe(true);
  });

  it('ignores sections without a quest (hero / boards / unknown)', () => {
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));

    act(() => {
      result.current('tour-hero');
      result.current('tour-section-boards');
      result.current('overview');
    });

    expect(readLedger()[PAGE_ROUTE]).toBeUndefined();
  });

  it('is a no-op when the page does not declare the section quest', () => {
    const { result } = renderHook(() =>
      useTourScrollQuests(PAGE_ROUTE, [{ id: 'qs-arrive', label: 'Welcome' }]),
    );

    act(() => result.current('session-insights'));

    expect(readLedger()[PAGE_ROUTE]).toBeUndefined();
  });

  it('does not mark interaction-gated quests on scroll', () => {
    const quests = [
      { id: 'qs-arrive', label: 'Welcome to WOD Wiki' },
      {
        id: 'qs-tour-timer',
        label: 'See the timer run it',
        validation: { type: 'run-started' },
      },
    ];
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, quests));

    act(() => result.current('session-insights'));

    expect(readLedger()[PAGE_ROUTE]).toBeUndefined();
  });
});
