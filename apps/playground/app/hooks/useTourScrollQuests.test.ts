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
  { id: 'qs-tour-editor', label: 'Watch a workout write itself' },
  { id: 'qs-tour-timer', label: 'See the timer run it' },
  { id: 'qs-tour-analytics', label: 'Review the session' },
  { id: 'qs-tour-library', label: 'Tour the library' },
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
  it('marks the stage quest complete when the stage scrolls into view', () => {
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));

    act(() => result.current('timer'));

    expect(readLedger()[PAGE_ROUTE]?.['qs-tour-timer']).toBe(true);
    expect(readLedger()[PAGE_ROUTE]?.['qs-tour-editor']).toBeUndefined();
  });

  it('fires each content stage exactly once per stage', () => {
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));

    act(() => {
      result.current('editor');
      result.current('analytics');
      result.current('library');
    });

    const page = readLedger()[PAGE_ROUTE] ?? {};
    expect(page['qs-tour-editor']).toBe(true);
    expect(page['qs-tour-analytics']).toBe(true);
    expect(page['qs-tour-library']).toBe(true);
    expect(page['qs-tour-timer']).toBeUndefined();
  });

  it('maps the editor runway stages to the editor quest', () => {
    // The runway resolves discrete stage ids (editor-metrics / editor-run);
    // all of them count as "the editor stage scrolled into view".
    for (const stageId of ['editor-metrics', 'editor-run']) {
      window.localStorage.clear();
      const { result, unmount } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));
      act(() => result.current(stageId));
      expect(readLedger()[PAGE_ROUTE]?.['qs-tour-editor']).toBe(true);
      unmount();
    }
  });

  it('ignores the overview stage (no quest attached)', () => {
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));

    act(() => result.current('overview'));

    expect(readLedger()[PAGE_ROUTE]).toBeUndefined();
  });

  it('is a no-op when the page does not declare the stage quest', () => {
    const { result } = renderHook(() =>
      useTourScrollQuests(PAGE_ROUTE, [{ id: 'qs-arrive', label: 'Welcome' }]),
    );

    act(() => result.current('timer'));

    expect(readLedger()[PAGE_ROUTE]).toBeUndefined();
  });

  it('is idempotent — revisiting a stage keeps the quest complete', () => {
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, tourQuests));

    act(() => {
      result.current('timer');
      result.current('timer');
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
      { id: 'qs-tour-analytics', label: 'Review the session' },
    ];
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, quests));

    act(() => result.current('timer'));

    const page = readLedger()[PAGE_ROUTE] ?? {};
    expect(page['qs-tour-timer']).toBeUndefined();
    expect(page['qs-arrive']).toBeUndefined();
    expect(page['qs-tour-analytics']).toBeUndefined();
  });

  it('still marks passive scroll quests complete', () => {
    const quests = [
      { id: 'qs-arrive', label: 'Welcome to WOD Wiki' },
      {
        id: 'qs-tour-timer',
        label: 'See the timer run it',
        validation: { type: 'run-started' },
      },
      { id: 'qs-tour-analytics', label: 'Review the session' },
    ];
    const { result } = renderHook(() => useTourScrollQuests(PAGE_ROUTE, quests));

    act(() => result.current('analytics'));

    const page = readLedger()[PAGE_ROUTE] ?? {};
    expect(page['qs-tour-analytics']).toBe(true);
    expect(page['qs-tour-timer']).toBeUndefined();
  });
});
