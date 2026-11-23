import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import type { HistoryRecord } from '@/types/history';
import type { NoteBlock } from '@/types/storage';
import { notePersistence } from '@/services/persistence';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import {
  replayStagedNoteSaves,
  useNoteDraft,
  waitForAllPendingNoteSaves,
  waitForPendingNoteSave,
} from './useNoteDraft';
import type { EditorIdentitySnapshot } from '@/components/organisms/editor/NoteEditor';

const PENDING_KEY = 'wodwiki:pending-note-saves:v1';

function recordOf(rawContent: string, sourceRevision = 2): HistoryRecord {
  return {
    id: 'stub',
    title: 'Stub',
    createdAt: 1,
    updatedAt: 1,
    targetDate: 1,
    rawContent,
    sourceRevision,
    tags: [],
    schemaVersion: 1,
  };
}

type SaveCall = Parameters<typeof notePersistence.saveNote>[0];

/** Test seam: shadow the singleton's prototype method with an own property. */
function stubSaveNote(impl: (input: SaveCall) => Promise<HistoryRecord>): void {
  notePersistence.saveNote = input => impl(input);
}

function snapshot(rawContent: string, sourceRevision = 1): EditorIdentitySnapshot {
  return { rawContent, blocks: {} as Record<string, NoteBlock>, sourceRevision };
}

describe('useNoteDraft durability', () => {
  const realSaveNote = notePersistence.saveNote;

  beforeEach(() => {
    localStorage.removeItem(PENDING_KEY);
    stubSaveNote(async input => recordOf(input.rawContent, (input.expectedSourceRevision ?? 0) + 1));
  });

  afterEach(() => {
    notePersistence.saveNote = realSaveNote;
    localStorage.removeItem(PENDING_KEY);
  });

  it('registers the pending save synchronously when flush is called (SPA navigation race)', async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const saved: string[] = [];
    stubSaveNote(async input => {
      saved.push(input.rawContent);
      await gate;
      return recordOf(input.rawContent);
    });
    const { result, unmount } = renderHook(() => useNoteDraft({ noteId: 'n-spa', initialContent: '# T\n', initialRevision: 1 }));

    act(() => result.current.onIdentityChange(snapshot('# T typed')));
    let settled = false;
    let flush!: Promise<void>;
    act(() => {
      flush = result.current.flush().then(() => { settled = true; });
    });

    // The save must already be invoked AND registered before any microtask
    // runs — the next route's waitForPendingNoteSave happens on this tick.
    expect(saved).toEqual(['# T typed']);
    expect(settled).toBe(false);

    release();
    await act(async () => {
      await flush;
      await waitForPendingNoteSave('n-spa');
    });
    unmount();
  });

  it('waitForPendingNoteSave and waitForAllPendingNoteSaves await the in-flight save', async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    stubSaveNote(async input => {
      await gate;
      return recordOf(input.rawContent);
    });
    const { result, unmount } = renderHook(() => useNoteDraft({ noteId: 'n-wait', initialContent: '# T\n', initialRevision: 1 }));
    act(() => result.current.onIdentityChange(snapshot('# T waiting')));
    let flush!: Promise<void>;
    act(() => { flush = result.current.flush(); });

    let otherDone = false;
    void waitForAllPendingNoteSaves().then(() => { otherDone = true; });
    let noteDone = false;
    void waitForPendingNoteSave('n-wait').then(() => { noteDone = true; });
    await act(async () => { await Promise.resolve(); });
    expect(otherDone).toBe(false);
    expect(noteDone).toBe(false);

    release();
    await act(async () => { await flush; });
    expect(otherDone).toBe(true);
    expect(noteDone).toBe(true);
    unmount();
  });

  it('stages the dirty draft synchronously on pagehide and replays it into IndexedDB on the next load', async () => {
    const saved: SaveCall[] = [];
    stubSaveNote(async input => {
      saved.push(input);
      return recordOf(input.rawContent);
    });
    const { result, unmount } = renderHook(() => useNoteDraft({ noteId: 'n-page', initialContent: '# T\n', initialRevision: 1 }));

    act(() => result.current.onIdentityChange(snapshot('# T lost line')));
    act(() => { window.dispatchEvent(new window.Event('pagehide')); });

    // Hard teardown kills the async save; the staged copy is what survives.
    const staged = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}') as Record<string, { rawContent: string }>;
    expect(staged['n-page']?.rawContent).toBe('# T lost line');

    // Next page load: replay commits the staged draft.
    await act(async () => { await replayStagedNoteSaves(); });
    expect(saved.some(input => input.noteId === 'n-page' && input.rawContent === '# T lost line')).toBe(true);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    unmount();
  });

  it('clears the staged entry once the matching snapshot persists, keeping a newer staged draft', async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const completed: string[] = [];
    stubSaveNote(async input => {
      await gate;
      completed.push(input.rawContent);
      return recordOf(input.rawContent);
    });
    const { result, unmount } = renderHook(() => useNoteDraft({ noteId: 'n-race', initialContent: '# T\n', initialRevision: 1 }));

    // v1 goes into a gated save; v2 supersedes it in the staged copy.
    act(() => result.current.onIdentityChange(snapshot('# T v1')));
    act(() => { void result.current.flush(); });
    act(() => result.current.onIdentityChange(snapshot('# T v2')));
    let staged = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}') as Record<string, { rawContent: string }>;
    expect(staged['n-race']?.rawContent).toBe('# T v2');

    // Drain the queued saves: v1 lands, v2 follows.
    await act(async () => {
      release();
      await waitForPendingNoteSave('n-race');
    });
    expect(completed).toEqual(['# T v1', '# T v2']);
    staged = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}') as Record<string, { rawContent: string }>;
    expect(staged['n-race']).toBeUndefined();
    unmount();
  });

  it('IndexedDBContentProvider reads wait for pending and replayed saves', async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    let saveFinished = false;
    stubSaveNote(async input => {
      await gate;
      saveFinished = true;
      return recordOf(input.rawContent);
    });
    const { result, unmount } = renderHook(() => useNoteDraft({ noteId: 'n-read', initialContent: '# T\n', initialRevision: 1 }));
    act(() => result.current.onIdentityChange(snapshot('# T pending read')));
    act(() => { void result.current.flush(); });

    // Stub the base implementation so the test observes ordering only.
    const baseGetRecord = IndexedDBNotePersistence.prototype.getRecord;
    const order: string[] = [];
    IndexedDBNotePersistence.prototype.getRecord = async function stubGetRecord() {
      order.push(saveFinished ? 'save-landed' : 'read-first');
      return null;
    };
    try {
      let read!: Promise<unknown>;
      act(() => { read = new IndexedDBContentProvider().getRecord('n-read'); });
      await act(async () => { await Promise.resolve(); });
      expect(order).toEqual([]);
      release();
      await act(async () => { await read; });
      expect(order).toEqual(['save-landed']);
    } finally {
      IndexedDBNotePersistence.prototype.getRecord = baseGetRecord;
      release();
    }
    unmount();
  });

  it('coordinates staged replay through a live dirty draft without STALE_SOURCE when an unrelated read triggers waitForAllPendingNoteSaves', async () => {
    const revisions = new Map<string, number>([['n-coord', 1]]);
    const calls: number[] = [];
    stubSaveNote(async input => {
      const current = revisions.get(input.noteId) ?? 0;
      calls.push(input.expectedSourceRevision ?? -1);
      if (input.expectedSourceRevision !== current) {
        throw new Error(`Note ${input.noteId} changed since it was loaded`);
      }
      const next = current + 1;
      revisions.set(input.noteId, next);
      return recordOf(input.rawContent, next);
    });

    const { result, unmount } = renderHook(() =>
      useNoteDraft({ noteId: 'n-coord', initialContent: '# T\n', initialRevision: 1 }),
    );

    act(() => result.current.onIdentityChange(snapshot('# T reconciled', 1)));

    const baseGetRecord = IndexedDBNotePersistence.prototype.getRecord;
    IndexedDBNotePersistence.prototype.getRecord = async () => null;
    try {
      await act(async () => {
        await new IndexedDBContentProvider().getRecord('other-note');
      });
    } finally {
      IndexedDBNotePersistence.prototype.getRecord = baseGetRecord;
    }

    expect(calls).toEqual([1]);
    expect(result.current.committedSourceRevision()).toBe(2);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(result.current.saveError).toBeNull();

    act(() => result.current.onIdentityChange(snapshot('# T edited after replay', 2)));
    await act(async () => {
      await result.current.flush();
    });

    expect(calls).toEqual([1, 2]);
    expect(result.current.committedSourceRevision()).toBe(3);
    expect(result.current.saveError).toBeNull();
    unmount();
  });

  it('still replays an orphaned staged draft on mount before initialRevision loads', async () => {
    const replayed: SaveCall[] = [];
    stubSaveNote(async input => {
      replayed.push(input);
      return recordOf(input.rawContent, (input.expectedSourceRevision ?? 0) + 1);
    });

    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        'n-recover': {
          noteId: 'n-recover',
          rawContent: '# Recovered\n',
          blocks: {},
          expectedSourceRevision: 1,
          stagedAt: 1,
        },
      }),
    );

    const { unmount } = renderHook(() =>
      useNoteDraft({ noteId: 'n-recover', initialContent: '', initialRevision: 0 }),
    );

    await act(async () => {
      await waitForPendingNoteSave('n-recover');
    });

    expect(replayed.some(call => call.noteId === 'n-recover' && call.rawContent === '# Recovered\n')).toBe(true);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    unmount();
  });

  it('waits for an in-flight flush before running replayStagedNoteSaves so saveNote runs once', async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const saved: string[] = [];
    stubSaveNote(async input => {
      saved.push(input.rawContent);
      await gate;
      return recordOf(input.rawContent, 2);
    });

    const { result, unmount } = renderHook(() =>
      useNoteDraft({ noteId: 'n-inflight', initialContent: '# T\n', initialRevision: 1 }),
    );
    act(() => result.current.onIdentityChange(snapshot('# T in-flight', 1)));
    act(() => {
      void result.current.flush();
    });

    let allSettled = false;
    const waitAll = waitForAllPendingNoteSaves().then(() => {
      allSettled = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(allSettled).toBe(false);
    expect(saved).toEqual(['# T in-flight']);

    release();
    await act(async () => {
      await waitAll;
    });

    expect(allSettled).toBe(true);
    expect(saved).toEqual(['# T in-flight']);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    unmount();
  });
});
