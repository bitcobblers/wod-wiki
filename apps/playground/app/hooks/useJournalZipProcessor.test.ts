/**
 * useJournalZipProcessor.test.ts — journal zip-load pipeline.
 *
 * The hook runs inside the real provider tree (MemoryRouter + NuqsTestingAdapter
 * via PlaygroundProviderTree) with injected deps — no mock.module.
 * Route/date plumbing is real; decode and journal creation are injected fakes.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { Location } from 'react-router-dom';
import { PlaygroundProviderTree, setupPlaygroundTestHost, type PlaygroundHostHandle } from '@/testing/host';
import type { CreateJournalNoteInput } from '../services/journalNotes';
import { useJournalZipProcessor } from './useJournalZipProcessor';

const CONTENT = '# Journal Entry\n\n```time\n\n```\n';
const TODAY = '2026-05-26';

const toastMock = mock((_args?: unknown) => {});
const createNoteMock = mock((input: CreateJournalNoteInput) =>
  Promise.resolve({ id: `journal-${input.journalDate}`, journalDate: input.journalDate, blocks: {} }),
);
const decodeMock = mock((_z: string) => Promise.resolve(CONTENT));

// Stable identities across renders — inline arrows inside renderHook would
// re-trigger the hook's effect every render (infinite loop).
const journalDeps = {
  decodeZip: decodeMock,
  getTodayDateKey: () => TODAY,
  isDateInPast: (dateKey: string) => dateKey < TODAY,
  journalNotes: { create: createNoteMock },
  toast: toastMock,
};

let host: PlaygroundHostHandle;

function renderAt(route: string, searchParams?: Record<string, string>) {
  const locations: Location[] = [];
  const rendered = renderHook(() => useJournalZipProcessor(journalDeps), {
    wrapper: ({ children }) =>
      createElement(
        PlaygroundProviderTree,
        { route, routePath: '/load/journal/:date?', searchParams, onLocationChange: (loc: Location) => locations.push(loc) },
        children,
      ),
  });
  return { ...rendered, locations, landed: () => locations.at(-1)?.pathname };
}

beforeEach(async () => {
  host = await setupPlaygroundTestHost({});
});

afterEach(async () => {
  await host.cleanup();
});

describe('useJournalZipProcessor', () => {
  beforeEach(() => {
    toastMock.mockClear();
    createNoteMock.mockClear();
    decodeMock.mockClear();
  });

  it('stays mounted in a recoverable missing-zip state instead of bouncing (WW-031)', async () => {
    const { result, landed } = renderAt('/load/journal');

    await waitFor(() => {
      expect(result.current.state).toBe('missing-zip');
    });

    // No navigation happened — the page surfaces the upload fallback itself.
    expect(landed()).toBe('/load/journal');
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('loads with loading state initially', () => {
    const { result } = renderAt('/load/journal', { zip: 'encoded-zip-content' });
    expect(result.current.state).toBe('loading');
  });

  it('creates entry and redirects for today without date param', async () => {
    const { result, landed } = renderAt('/load/journal', { zip: 'encoded-zip-content' });

    await waitFor(() => {
      expect(result.current.state).toBe('success');
    });

    expect(result.current.dateKey).toBe('2026-05-26');
    expect(landed()).toBe('/note/journal-2026-05-26');
    expect(createNoteMock.mock.calls[0]?.[0]).toMatchObject({ journalDate: '2026-05-26' });
  });

  it('sets pending-confirmation state for past dates', async () => {
    const { result } = renderAt('/load/journal/2026-05-20', { zip: 'encoded-zip-content' }); // Past date

    await waitFor(() => {
      expect(result.current.state).toBe('pending-confirmation');
    });

    expect(result.current.dateKey).toBe('2026-05-20');
    expect(result.current.content).toBeDefined();
    expect(result.current.onConfirmBackdate).toBeDefined();
    expect(createNoteMock).not.toHaveBeenCalled();
  });

  it('creates entry directly for future dates', async () => {
    const { result, landed } = renderAt('/load/journal/2026-06-01', { zip: 'encoded-zip-content' }); // Future date

    await waitFor(() => {
      expect(result.current.state).toBe('success');
    });

    expect(result.current.dateKey).toBe('2026-06-01');
    expect(landed()).toBe('/note/journal-2026-06-01');
  });

  it('sets error state and redirects on invalid date format', async () => {
    const { result, landed } = renderAt('/load/journal/invalid-date', { zip: 'encoded-zip-content' });

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });

    expect(result.current.error).toBe('Invalid date format');
    expect(landed()).toBe('/journal');
    expect(toastMock).toHaveBeenCalled();
  });

  it('confirms backdate via onConfirmBackdate for past dates', async () => {
    const { result } = renderAt('/load/journal/2026-05-20', { zip: 'encoded-zip-content' });

    await waitFor(() => {
      expect(result.current.state).toBe('pending-confirmation');
    });

    expect(typeof result.current.onConfirmBackdate).toBe('function');
    await result.current.onConfirmBackdate!();
    await waitFor(() => {
      expect(result.current.state).toBe('success');
    });
    expect(createNoteMock.mock.calls[0]?.[0]).toMatchObject({ journalDate: '2026-05-20' });
  });
});
