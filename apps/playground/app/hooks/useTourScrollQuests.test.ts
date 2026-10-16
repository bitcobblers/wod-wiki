/**
 * useTourScrollQuests.test.ts — Unit tests for the home tour scroll-quest
 * hook: each tour stage fires its qs-tour-* quest when scrolled into view.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useTourScrollQuests } from './useTourScrollQuests';

const STORAGE_KEY = 'wodwiki.quests.v1';
const PAGE_ROUTE = '/';

const tourQuests = [
  { id: 'qs-arrive', label: 'Welcome to WOD Wiki' },
  { id: 'qs-tour-timer', label: 'See the timer run it' },
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
  it('marks the timer quest complete when a timer stage scrolls into view', () => {
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));

    act(() => result.current('timer-wallclock'));

    expect(readLedger()[PAGE_ROUTE]?.['qs-tour-timer']).toBe(true);
  });

  it('maps both running stages to the timer quest and fires once per stage', () => {
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));

    act(() => {
      result.current('timer-wallclock');
      result.current('timer-wallclock');
      result.current('timer-next');
      result.current('timer-cast');
    });

    const page = readLedger()[PAGE_ROUTE] ?? {};
    expect(page['qs-tour-timer']).toBe(true);
    expect(Object.keys(page)).toEqual(['qs-tour-timer']);
  });

  it('ignores stages without a quest (intro / output / dashboard / unknown)', () => {
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));

    act(() => {
      result.current('timer-intro');
      result.current('timer-output');
      result.current('timer-dashboard');
      result.current('overview');
    });

    expect(readLedger()[PAGE_ROUTE]).toBeUndefined();
  });

  it('is a no-op when the page does not declare the stage quest', () => {
    const { result } = renderHook(() =>
      useTourScrollQuests(PAGE_ROUTE, [{ id: 'qs-arrive', label: 'Welcome' }]),
    );

    act(() => result.current('timer-wallclock'));

    expect(readLedger()[PAGE_ROUTE]).toBeUndefined();
  });

  it('is idempotent — revisiting a stage keeps the quest complete', () => {
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));

    act(() => {
      result.current('timer-wallclock');
    });
    act(() => {
      result.current('timer-wallclock');
    });

    expect(readLedger()[PAGE_ROUTE]?.['qs-tour-timer']).toBe(true);
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

    act(() => result.current('timer-wallclock'));

    expect(readLedger()[PAGE_ROUTE]).toBeUndefined();
  });
});
