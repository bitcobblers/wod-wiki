import React from 'react';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import * as persistenceModule from '@/services/persistence';
import * as storageModule from '@/services/storage';
import { StorageService } from '@/services/storage/StorageService';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import * as seedContentModule from '@/services/content/seedContent';
import { NavContext, initialNavState } from '../nav/NavContext';
import * as journalNotesModule from '../services/journalNotes';
import { JournalDatePage } from '../pages/JournalDatePage';
import { useDashboardSource } from './useDashboards';

describe('useDashboardSource bounded resolution & slow-load escalation (WW-001)', () => {
  let testStorage: StorageService;
  let testPersistence: IndexedDBNotePersistence;
  let getAllNotesCalls = 0;

  beforeEach(async () => {
    testStorage = new StorageService(new InMemoryStorage());
    testPersistence = new IndexedDBNotePersistence(testStorage);
    getAllNotesCalls = 0;

    // Seed 25 non-dashboard corpus notes + 1 prebuilt seed dashboard note.
    for (let i = 0; i < 25; i++) {
      await testPersistence.createNote({
        id: `workout-${i}`,
        title: `Workout ${i}`,
        rawContent: '```time\n10 Pushups\n```',
        targetDate: 1_000 + i,
      });
    }
    await testStorage.saveNote({
      id: 'seed-dash-1',
      title: 'Benchmark PR Board',
      rawContent: '---\ndashboard: true\ntitle: Benchmark PR Board\n---\n# Benchmark PR Board\n',
      sourceRevision: 1,
      blocks: {},
      createdAt: 1,
      type: 'dashboard',
      seedOrigin: 'seed',
      sourcePath: 'markdown/dashboards/benchmark-pr-board.md',
    });

    const origGetAllNotes = testStorage.getAllNotes.bind(testStorage);
    testStorage.getAllNotes = async () => {
      getAllNotesCalls++;
      return origGetAllNotes();
    };

    spyOn(storageModule.storageService, 'getNotesByType').mockImplementation((type) =>
      testStorage.getNotesByType(type),
    );
    spyOn(storageModule.storageService, 'getAllNotes').mockImplementation(() => testStorage.getAllNotes());
    spyOn(persistenceModule.notePersistence, 'listNotes').mockImplementation((q) =>
      testPersistence.listNotes(q),
    );
    // Simulate cold load before full-vault seedContent cache has populated.
    spyOn(seedContentModule, 'useSeedContent').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    mock.restore();
  });

  it('resolves unknown dashboard slug to not-found immediately without scanning non-dashboard notes', async () => {
    const { result } = renderHook(() => useDashboardSource('does-not-exist-xyz'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.source).toBeNull();
    expect(getAllNotesCalls).toBe(0);
  });

  it('resolves prebuilt seed dashboard via by-type index even when seedContent cache is cold, and lets vault clone shadow it', async () => {
    const { result, rerender } = renderHook(
      ({ slug, refreshKey }: { slug: string; refreshKey?: number }) => useDashboardSource(slug, refreshKey),
      { initialProps: { slug: 'benchmark-pr-board', refreshKey: 0 } },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.source).toMatchObject({
      slug: 'benchmark-pr-board',
      title: 'Benchmark PR Board',
      editable: false,
    });
    expect(getAllNotesCalls).toBe(0);

    // Clone to vault and refresh -> editable vault note shadows prebuilt seed.
    await testPersistence.createNote({
      id: 'vault-dash-1',
      title: 'My Cloned PR Board',
      rawContent: '---\ndashboard: true\nslug: benchmark-pr-board\ntitle: My Cloned PR Board\n---\n# My Cloned PR Board\n',
      type: 'dashboard',
      slug: 'benchmark-pr-board',
      targetDate: 9_000,
    });

    rerender({ slug: 'benchmark-pr-board', refreshKey: 1 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.source).toMatchObject({
      slug: 'benchmark-pr-board',
      title: 'My Cloned PR Board',
      editable: true,
      noteId: 'vault-dash-1',
    });
    expect(getAllNotesCalls).toBe(0);
  });

  it('escalates JournalDatePage loading status with a clear hint when a query takes longer than 3 seconds', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const globalRef = globalThis as unknown as { setTimeout: typeof setTimeout };
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    globalRef.setTimeout = ((fn: () => void, ms?: number) => {
      scheduled.push({ fn, ms: ms ?? 0 });
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    const pendingList = Promise.withResolvers<never[]>();
    spyOn(journalNotesModule.journalNotes, 'listByDate').mockReturnValue(pendingList.promise);

    try {
      render(
        <MemoryRouter initialEntries={['/day/2026-04-17']}>
          <NavContext.Provider
            value={{
              tree: [],
              navState: initialNavState,
              dispatch: () => {},
              l3Items: [],
              setL3Items: () => {},
              l3Actions: [],
              setL3Actions: () => {},
              secondarySpec: undefined,
              setSecondarySpec: () => {},
              contextNav: undefined,
              setContextNav: () => {},
              streamControls: null,
              setStreamControls: () => {},
              analyticsControls: null,
              setAnalyticsControls: () => {},
              scrollToSection: () => {},
              registerScrollFn: () => {},
              openCreateJournal: () => {},
              registerCreateJournal: () => {},
            }}
          >
            <JournalDatePage journalDate="2026-04-17" theme="light" />
          </NavContext.Provider>
        </MemoryRouter>,
      );

      expect(screen.queryByTestId('journal-slow-loading-hint')).toBeNull();
      const slowTimer = scheduled.find((t) => t.ms >= 3_000);
      expect(slowTimer).toBeDefined();

      act(() => {
        slowTimer!.fn();
      });

      expect(screen.getByTestId('journal-slow-loading-hint')).toBeTruthy();
    } finally {
      globalRef.setTimeout = originalSetTimeout;
      cleanup();
      pendingList.resolve([]);
    }
  });
});
