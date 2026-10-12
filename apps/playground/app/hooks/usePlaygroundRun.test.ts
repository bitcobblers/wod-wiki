/**
 * usePlaygroundRun.test.ts — consumer-behavior tests for the shared run lifecycle.
 *
 * Covers the lifecycle guarantees every surface (home tour, canvas/guide pages)
 * relies on: fresh snapshot note per run captured BEFORE execution, record
 * exactly once, reset retains partial + snapshot, and failed saves never lose
 * outputs or allow replacement runs.
 */
import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';

import type { ScriptBlock, Sessions } from '@/components/Editor/types';
import type { Session } from '@/types/storage';
import type { RecordResultInput, ResultRecorder } from '@/services/resultRecorder';
import type { PlaygroundIntake, SnapshotEntryOptions } from '../services/createPlaygroundPage';

import { usePlaygroundRun as useRun, type PlaygroundRun, type UsePlaygroundRunReturn, type UsePlaygroundRunOptions } from './usePlaygroundRun';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import { StorageService } from '@/services/storage/StorageService';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { createResultRecorder } from '@/services/resultRecorder';

function usePlaygroundRun(options: UsePlaygroundRunOptions) {
  const intake = options.intake;
  if (!(intake instanceof StubIntake)) throw new Error('Expected the in-memory intake');
  return useRun({ ...options, persistence: intake.persistence, recorder: options.recorder ?? createResultRecorder(intake.persistence) });
}

const DOC = '# Demo\n```time\nAMRAP 5:00\n```\n';
const RESET_DOC = '# Demo (reset)\n';

function makeBlock(id = 'blk-1'): ScriptBlock {
  return {
    id,
    startLine: 1,
    endLine: 3,
    content: 'AMRAP 5:00',
    state: 'idle',
    widgetIds: {},
    version: 1,
    createdAt: 0,
  };
}

function makeResults(overrides: Partial<Sessions> = {}): Sessions {
  return { startTime: 1_000, endTime: 61_000, duration: 60_000, completed: true, ...overrides };
}

class StubIntake implements PlaygroundIntake {
  readonly persistence = new IndexedDBNotePersistence(new StorageService(new InMemoryStorage()));
  created = 0;
  snapshots: Array<{ content: string; opts: SnapshotEntryOptions }> = [];
  failNext: Error | null = null;
  /** Optional in-flight gate: snapshotEntry pauses until released. */
  gate: (() => Promise<void>) | null = null;

  async createPage(): Promise<string> {
    throw new Error('not used');
  }

  async ensureEntry(): Promise<{ noteId: string; routeId: string }> {
    throw new Error('not used');
  }

  async snapshotEntry(content: string, opts: SnapshotEntryOptions) {
    if (this.gate) await this.gate();
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    this.created += 1;
    this.snapshots.push({ content, opts });
    let occurrence = 0;
    await this.persistence.saveNote({ noteId: `note-${this.created}`, rawContent: content, blocks: reconcileNoteBlocks(content, { sourceRevision: 1, createId: () => `blk-${++occurrence}` }), expectedSourceRevision: 0, metadata: { title: opts.pageTitle } });
    return { noteId: `note-${this.created}`, routeId: `playground/snap-${this.created}` };
  }

  async moveToJournal(): Promise<never> {
    throw new Error('not used');
  }
}

class StubRecorder implements ResultRecorder {
  calls: RecordResultInput[] = [];
  failNext: Error | null = null;
  /** Optional in-flight gate: record pauses until released. */
  gate: (() => Promise<void>) | null = null;

  async record(input: RecordResultInput): Promise<Session> {
    if (this.gate) await this.gate();
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    this.calls.push(input);
    return {
      id: input.resultId,
      noteId: input.noteId,
      blockVersion: 1,
      blockId: input.blockId,
      origin: 'playground',
      startTime: input.data.startTime,
      endTime: input.data.endTime,
      duration: input.data.duration ?? 0,
      completed: input.data.completed,
      createdAt: input.createdAt,
    };
  }
}

async function startRun(hook: { current: UsePlaygroundRunReturn }, block?: ScriptBlock) {
  let identity!: PlaygroundRun;
  await act(async () => {
    identity = await hook.current.start(DOC, block ?? makeBlock(), { pageTitle: 'Home', sectionTitle: 'Run' });
  });
  return identity;
}

describe('usePlaygroundRun — start', () => {
  it('persists a fresh snapshot BEFORE returning the captured identity', async () => {
    const intake = new StubIntake();
    const { result } = renderHook(() => usePlaygroundRun({ intake }));
    const block = makeBlock();

    const identity = await startRun(result, block);

    expect(result.current.run).toBe(identity);
    expect(identity.noteId).toBe('note-1');
    expect(identity.block).not.toBe(block);
    expect(identity.block.content.trim()).toBe(block.content);
    expect(identity.block.dialect).toBe('time');
    expect(intake.snapshots).toEqual([{ content: DOC, opts: { pageTitle: 'Home', sectionTitle: 'Run' } }]);
  });

  it('pins the selected duplicate occurrence and freezes its saved input before execution', async () => {
    const intake = new StubIntake();
    const { result } = renderHook(() => usePlaygroundRun({ intake }));
    const source = '```time\n10 Pushups\n```\n\n```log:crossfit\n20 Pushups\n```';
    const selected = { ...makeBlock('editor-second'), startLine: 4, content: 'mutable editor body', dialect: 'time' as const };
    let identity!: PlaygroundRun;
    await act(async () => { identity = await result.current.start(source, selected, { pageTitle: 'Duplicates' }); });
    expect(identity.block.id).toBe('blk-2');
    expect(identity.block.dialect).toBe('log');
    expect(identity.block.sport).toBe('crossfit');
    expect(identity.block.content.trim()).toBe('20 Pushups');
    expect(await intake.persistence.getSessionById(identity.resultId)).toMatchObject({ noteId: identity.noteId, blockId: 'blk-2', blockVersion: 1 });
    selected.content = 'changed after start';
    expect(identity.block.content.trim()).toBe('20 Pushups');
  });

  it('mints a NEW note per run and never touches the previous one', async () => {
    const intake = new StubIntake();
    const { result } = renderHook(() => usePlaygroundRun({ intake }));

    const first = await startRun(result);
    await act(async () => {
      await result.current.finalize(makeResults(), true);
    });
    const second = await startRun(result, makeBlock('blk-2'));

    expect(intake.created).toBe(2);
    expect(second.noteId).toBe('note-2');
    expect(first.noteId).toBe('note-1');
  });

  it('keeps the run current after finalize (scope views off run.noteId)', async () => {
    const { result } = renderHook(() => usePlaygroundRun({ intake: new StubIntake() }));

    const identity = await startRun(result);
    await act(async () => {
      await result.current.finalize(makeResults(), true);
    });

    expect(result.current.run).toBe(identity);
  });

  it('refuses a second start while an unrecorded run is active', async () => {
    const intake = new StubIntake();
    const { result } = renderHook(() => usePlaygroundRun({ intake }));
    await startRun(result);

    await act(async () => {
      await expect(startRun(result, makeBlock('blk-2'))).rejects.toThrow('already running');
    });
    expect(intake.created).toBe(1);
  });
});

describe('usePlaygroundRun — finalize', () => {
  it('records exactly once against the captured note and block', async () => {
    const recorder = new StubRecorder();
    const { result } = renderHook(() => usePlaygroundRun({ intake: new StubIntake(), recorder }));
    const identity = await startRun(result);
    const results = makeResults();

    // Repeated completions / scroll re-entries must not duplicate.
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await result.current.finalize(results, true);
      });
    }

    expect(recorder.calls.length).toBe(1);
    expect(recorder.calls[0].noteId).toBe(identity.noteId);
    expect(recorder.calls[0].resultId).toBe(identity.resultId);
    expect(recorder.calls[0].runBlock).toBe(identity.block);
    expect(recorder.calls[0].data).toBe(results);
    expect(recorder.calls[0].origin).toBe('playground');
  });

  it('on save failure preserves pending results and refuses a new run until saved', async () => {
    const recorder = new StubRecorder();
    const intake = new StubIntake();
    const { result } = renderHook(() => usePlaygroundRun({ intake, recorder }));
    const identity = await startRun(result);
    recorder.failNext = new Error('idb full');

    await act(async () => {
      await expect(result.current.finalize(makeResults(), true)).rejects.toThrow('idb full');
    });
    expect(result.current.run).toBe(identity);
    // The refusal must not mint a replacement note while results are unsaved.
    await act(async () => {
      await expect(startRun(result)).rejects.toThrow();
    });
    expect(result.current.run).toBe(identity);
    expect(intake.created).toBe(1);

    // Retry the save — outputs were never dropped.
    await act(async () => {
      await result.current.finalize(makeResults(), true);
    });
    expect(recorder.calls.length).toBe(1);
    await act(async () => {
      await result.current.reset(RESET_DOC, { pageTitle: 'Home' });
    });
    await startRun(result);
    expect(recorder.calls.length).toBe(1);
  });
});

describe('usePlaygroundRun — reset', () => {
  it('finalizes the active partial first, retains a reset snapshot, clears the run', async () => {
    const intake = new StubIntake();
    const recorder = new StubRecorder();
    const { result } = renderHook(() => usePlaygroundRun({ intake, recorder }));
    const identity = await startRun(result);
    const partial = makeResults({ completed: false, duration: 20_000 });

    await act(async () => {
      await result.current.reset(RESET_DOC, { pageTitle: 'Home', sectionTitle: 'Run', results: partial });
    });

    expect(recorder.calls.length).toBe(1);
    expect(recorder.calls[0].noteId).toBe(identity.noteId);
    expect(recorder.calls[0].data).toBe(partial);
    expect(recorder.calls[0].data.completed).toBe(false);
    expect(intake.created).toBe(2);
    expect(intake.snapshots[1]).toEqual({ content: RESET_DOC, opts: { pageTitle: 'Home', sectionTitle: 'Run' } });
    expect(result.current.run).toBeNull();
  });

  it('zero-output resets still retain the snapshot note and fabricate no results', async () => {
    const intake = new StubIntake();
    const recorder = new StubRecorder();
    const { result } = renderHook(() => usePlaygroundRun({ intake, recorder }));
    await startRun(result);

    await act(async () => {
      await result.current.reset(RESET_DOC, { pageTitle: 'Home' });
    });

    expect(recorder.calls.length).toBe(0);
    expect(intake.created).toBe(2);
    expect(intake.snapshots[1].content).toBe(RESET_DOC);
    expect(result.current.run).toBeNull();
  });

  it('refuses and preserves everything when the partial save fails', async () => {
    const intake = new StubIntake();
    const recorder = new StubRecorder();
    const { result } = renderHook(() => usePlaygroundRun({ intake, recorder }));
    const identity = await startRun(result);
    recorder.failNext = new Error('idb full');

    await act(async () => {
      await expect(
        result.current.reset(RESET_DOC, { pageTitle: 'Home', results: makeResults({ completed: false }) }),
      ).rejects.toThrow('idb full');
    });

    expect(result.current.run).toBe(identity);
    expect(intake.created).toBe(1);
    expect(recorder.calls.length).toBe(0);

    recorder.failNext = null;
    await act(async () => {
      await result.current.reset(RESET_DOC, { pageTitle: 'Home', results: makeResults({ completed: false }) });
    });
    expect(recorder.calls.length).toBe(1);
    expect(intake.created).toBe(2);
    expect(result.current.run).toBeNull();
  });

  it('after a recorded run, reset retains the snapshot without double-recording', async () => {
    const intake = new StubIntake();
    const recorder = new StubRecorder();
    const { result } = renderHook(() => usePlaygroundRun({ intake, recorder }));
    await startRun(result);
    await act(async () => {
      await result.current.finalize(makeResults(), true);
    });

    await act(async () => {
      await result.current.reset(RESET_DOC, { pageTitle: 'Home', results: makeResults({ completed: false }) });
    });

    expect(recorder.calls.length).toBe(1);
    expect(intake.created).toBe(2);
    expect(result.current.run).toBeNull();
  });
});

describe('usePlaygroundRun — end (stage exit)', () => {
  it('finalizes an unrecorded partial on exit and clears the run without a new snapshot', async () => {
    const intake = new StubIntake();
    const recorder = new StubRecorder();
    const { result } = renderHook(() => usePlaygroundRun({ intake, recorder }));
    const identity = await startRun(result);
    const partial = makeResults({ completed: false, duration: 15_000 });

    await act(async () => {
      await result.current.end(partial);
    });

    expect(recorder.calls.length).toBe(1);
    expect(recorder.calls[0].noteId).toBe(identity.noteId);
    expect(recorder.calls[0].data.completed).toBe(false);
    expect(intake.created).toBe(1);
    expect(result.current.run).toBeNull();
  });

  it('a zero-output exit just clears the run', async () => {
    const intake = new StubIntake();
    const recorder = new StubRecorder();
    const { result } = renderHook(() => usePlaygroundRun({ intake, recorder }));
    await startRun(result);

    await act(async () => {
      await result.current.end();
    });

    expect(recorder.calls.length).toBe(0);
    expect(intake.created).toBe(1);
    expect(result.current.run).toBeNull();
  });

  it('end after a recorded run never double-records', async () => {
    const recorder = new StubRecorder();
    const { result } = renderHook(() => usePlaygroundRun({ intake: new StubIntake(), recorder }));
    await startRun(result);
    await act(async () => {
      await result.current.finalize(makeResults(), true);
    });

    await act(async () => {
      await result.current.end(makeResults({ completed: false }));
    });

    expect(recorder.calls.length).toBe(1);
    expect(result.current.run).toBeNull();
  });

  it('refuses and preserves the run when the partial save fails', async () => {
    const recorder = new StubRecorder();
    const { result } = renderHook(() => usePlaygroundRun({ intake: new StubIntake(), recorder }));
    const identity = await startRun(result);
    recorder.failNext = new Error('idb full');

    await act(async () => {
      await expect(result.current.end(makeResults({ completed: false }))).rejects.toThrow('idb full');
    });
    expect(result.current.run).toBe(identity);

    recorder.failNext = null;
    await act(async () => {
      await result.current.end(makeResults({ completed: false }));
    });
    expect(recorder.calls.length).toBe(1);
    expect(result.current.run).toBeNull();
  });
});

describe('usePlaygroundRun — concurrency (single-flight)', () => {
  it('retry after failure saves the ORIGINAL captured outputs, not newer caller args', async () => {
    const recorder = new StubRecorder();
    const { result } = renderHook(() => usePlaygroundRun({ intake: new StubIntake(), recorder }));
    await startRun(result);
    const original = makeResults({ duration: 45_000 });
    recorder.failNext = new Error('idb full');

    await act(async () => {
      await expect(result.current.finalize(original, true)).rejects.toThrow('idb full');
    });
    expect(result.current.pendingResults?.results).toBe(original);

    // A later caller (e.g. a disposed runtime offering empty outputs) must
    // never overwrite the captured first snapshot.
    await act(async () => {
      await result.current.finalize(makeResults({ duration: 0 }), false);
    });
    expect(recorder.calls.length).toBe(1);
    expect(recorder.calls[0].data).toBe(original);
    expect(result.current.pendingResults).toBeNull();
  });

  it('concurrent finalize callers join the same in-flight write', async () => {
    const recorder = new StubRecorder();
    let release!: () => void;
    recorder.gate = () => new Promise<void>((r) => { release = r });
    const { result } = renderHook(() => usePlaygroundRun({ intake: new StubIntake(), recorder }));
    await startRun(result);

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.finalize(makeResults(), true);
      second = result.current.finalize(makeResults(), true);
    });
    await act(async () => {
      release();
      await Promise.all([first, second]);
    });

    expect(recorder.calls.length).toBe(1);
    expect(result.current.recorded).toBe(true);
    expect(result.current.pendingResults).toBeNull();
  });

  it('concurrent starts are refused — one snapshot, identity not overwritten', async () => {
    const intake = new StubIntake();
    let release!: () => void;
    intake.gate = () => new Promise<void>((r) => { release = r });
    const { result } = renderHook(() => usePlaygroundRun({ intake }));

    let first!: Promise<PlaygroundRun>;
    act(() => {
      first = result.current.start(DOC, makeBlock(), { pageTitle: 'Home', sectionTitle: 'Run' });
    });
    await act(async () => {
      await expect(result.current.start(DOC, makeBlock('blk-2'), { pageTitle: 'Home' })).rejects.toThrow();
    });
    release();

    let identity: PlaygroundRun | undefined;
    await act(async () => {
      identity = await first;
    });
    expect(intake.created).toBe(1);
    expect(result.current.run).toBe(identity);
    expect(identity?.block.id).toBe('blk-1');
  });

  it('reset during an in-flight save joins it — one write, then snapshot + clear', async () => {
    const intake = new StubIntake();
    const recorder = new StubRecorder();
    let release!: () => void;
    recorder.gate = () => new Promise<void>((r) => { release = r });
    const { result } = renderHook(() => usePlaygroundRun({ intake, recorder }));
    await startRun(result);

    let save!: Promise<void>;
    let resetAttempt!: Promise<void>;
    act(() => {
      save = result.current.finalize(makeResults(), true);
      resetAttempt = result.current.reset(RESET_DOC, { pageTitle: 'Home', results: makeResults({ completed: false }) });
    });
    release();
    await act(async () => {
      await Promise.all([save, resetAttempt]);
    });

    expect(recorder.calls.length).toBe(1);
    expect(intake.created).toBe(2);
    expect(result.current.run).toBeNull();
  });

  it('reset during a failing in-flight save aborts with outputs preserved', async () => {
    const intake = new StubIntake();
    const recorder = new StubRecorder();
    let release!: () => void;
    recorder.gate = () => new Promise<void>((r) => { release = r });
    const { result } = renderHook(() => usePlaygroundRun({ intake, recorder }));
    const identity = await startRun(result);
    recorder.failNext = new Error('idb full');

    let save!: Promise<void>;
    let resetAttempt!: Promise<void>;
    act(() => {
      save = result.current.finalize(makeResults(), true);
      resetAttempt = result.current.reset(RESET_DOC, { pageTitle: 'Home', results: makeResults({ completed: false }) });
    });
    // Attach handlers BEFORE releasing the gate — an unhandled rejection
    // between release() and the expects would fail the whole file.
    const settled = Promise.allSettled([save, resetAttempt]);
    release();
    const outcomes = await act(async () => settled);
    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);

    expect(result.current.run).toBe(identity);
    expect(intake.created).toBe(1);
    expect(result.current.pendingResults?.results.completed).toBe(true);
  });
});
