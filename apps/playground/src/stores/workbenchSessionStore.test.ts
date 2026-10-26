/**
 * workbenchSessionStore.test.ts — non-React test for the Workbench Session.
 *
 * Per Step 4 of Finding 01's implementation handoff: drive the store
 * through its factory with in-memory collaborators; assert the bucket
 * migrations (S1a–S1d) and the reactive observer seams (S2) without
 * rendering React.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { createWorkbenchSessionStore } from './workbenchSessionStore';
import type { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import type { INowProvider } from '@bitcobblers/wod-wiki-engine';
import type { INotePersistence } from '@/services/persistence';
import type { CreateNoteInput, NoteMutation, NoteLocator, GetNoteOptions } from '@/services/persistence';
import type { HistoryRecord } from '@/types/history';
import type { Sessions, StoredOutputStatement } from '@/components/Editor/types';
import type { Attachment } from '@/types/storage';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import { StorageService } from '@/services/storage/StorageService';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import type { SaveNoteInput } from '@/services/persistence';
import type { Session } from '@/types/storage';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import type {
  IContentProvider,
  ContentProviderMode,
  NoteSaveInput,
  AttachmentCreateInput,
} from '@/types/content-provider';

/* ─── Mocks ────────────────────────────────────────────────────────────── */

class FakeNotePersistence extends IndexedDBNotePersistence {
  readonly saved: SaveNoteInput[] = [];
  readonly finished: Session[] = [];
  constructor() { super(new StorageService(new InMemoryStorage())); }
  override async saveNote(input: SaveNoteInput) {
    const note = await super.saveNote(input);
    this.saved.push(input);
    this.notes.set(note.id, note);
    return note;
  }
  override async finishSession(id: string, outcome: Sessions, createdAt?: number) {
    const result = await super.finishSession(id, outcome, createdAt);
    this.finished.push(result);
    return result;
  }
  public readonly mutated: Array<{ locator: NoteLocator; mutation: NoteMutation }> = [];
  private readonly notes = new Map<string, HistoryRecord>();

  async createNote(input: CreateNoteInput): Promise<HistoryRecord> {
    const entry = makeEntry({
      ...input,
      tags: input.tags ?? [],
      schemaVersion: 1,
    });
    this.notes.set(entry.id, entry);
    return entry;
  }

  async getNote(locator: NoteLocator, _options?: GetNoteOptions): Promise<HistoryRecord> {
    const id = typeof locator === 'string' ? locator : locator.id;
    if (!id) throw new Error('missing note id in locator');
    const note = this.notes.get(id);
    if (note && !note.blocks) return note;
    try { return await super.getNote(locator, _options); }
    catch (error) { if (note) return note; throw error; }
  }

  async listNotes() {
    return Array.from(this.notes.values());
  }

  async mutateNote(locator: NoteLocator, mutation: NoteMutation): Promise<HistoryRecord> {
    this.mutated.push({ locator, mutation });
    const id = typeof locator === 'string' ? locator : locator.id;
    if (!id) throw new Error('missing note id in locator');
    return super.mutateNote(locator, mutation);
  }

  async deleteNote(locator: NoteLocator) {
    await super.deleteNote(locator);
    const id = typeof locator === 'string' ? locator : locator.id;
    if (id) this.notes.delete(id);
  }

  seed(note: HistoryRecord) {
    this.notes.set(note.id, note);
  }
}

class FakeContentProvider implements IContentProvider {
  readonly mode: ContentProviderMode = 'history';
  readonly capabilities = {
    canWrite: true,
    canDelete: true,
    canFilter: false,
    canMultiSelect: false,
    supportsHistory: true,
  } as const;
  public readonly updated: Array<{ id: string; rawContent?: string; title?: string }> = [];
  private entries = new Map<string, HistoryRecord>();

  async getRecords() {
    return Array.from(this.entries.values());
  }
  async getRecord(id: string) {
    return this.entries.get(id) ?? null;
  }
  async getAttachments(_noteId: string) {
    return [];
  }
  async saveRecord(input: NoteSaveInput): Promise<HistoryRecord> {
    const id = input.id ?? 'saved';
    const entry = { ...input, id, type: 'note' } as HistoryRecord;
    this.entries.set(id, entry);
    return entry;
  }
  async updateRecord(
    id: string,
    patch: { rawContent?: string; title?: string; tags?: string[] },
  ): Promise<HistoryRecord> {
    this.updated.push({ id, ...patch });
    const existing = this.entries.get(id);
    const next = existing
      ? { ...existing, ...patch }
      : ({ ...patch, id, type: 'note' } as HistoryRecord);
    this.entries.set(id, next);
    return next;
  }
  async cloneRecord(sourceId: string, _targetDate?: number): Promise<HistoryRecord> {
    const existing = this.entries.get(sourceId);
    if (!existing) throw new Error(`clone failed: ${sourceId} not found`);
    return { ...existing, id: `${sourceId}-clone` };
  }
  async deleteRecord(id: string): Promise<void> {
    /* no-op */
  }
  async addRecordPlacement(id: string): Promise<HistoryRecord> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`clone failed: ${id} not found`);
    return entry;
  }
  async removeRecordPlacement(id: string): Promise<HistoryRecord> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`clone failed: ${id} not found`);
    return entry;
  }
  async moveRecordPlacement(id: string): Promise<HistoryRecord> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`clone failed: ${id} not found`);
    return entry;
  }
  async getPageRecords(_slug: string): Promise<HistoryRecord[]> {
    return [];
  }
  async saveAttachment(
    _noteId: string,
    _attachment: AttachmentCreateInput,
  ): Promise<Attachment> {
    throw new Error('not used in tests');
  }
  async deleteAttachment(_id: string): Promise<void> {
    /* no-op */
  }
  seed(note: HistoryRecord) {
    this.entries.set(note.id, note);
  }
}

function frozenClock(atIso: string): INowProvider {
  const at = new Date(atIso);
  return { now: () => at, nowMs: () => at.getTime() };
}

function fakeTimers() {
  const slots: Array<{ fn: (() => void) | null }> = [];
  const setTimeoutFn = (handler: () => void, _ms: number) => {
    const slot: { fn: (() => void) | null } = { fn: handler };
    slots.push(slot);
    return slots.length - 1;
  };
  const clearTimeoutFn = (handle: unknown) => {
    const idx = typeof handle === 'number' ? handle : -1;
    if (idx >= 0 && idx < slots.length) slots[idx].fn = null;
  };
  return {
    slots,
    setTimeoutFn,
    clearTimeoutFn,
    getLiveCount: () => slots.filter((s) => s.fn !== null).length,
    fireFirst: () => {
      const slot = slots.find((s) => s.fn !== null);
      if (slot?.fn) slot.fn();
    },
  };
}

function makeEntry(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'note-1',
    title: 'Test',
    tags: [],
    rawContent: '',
    createdAt: Date.parse('2026-01-01T00:00:00Z'),
    updatedAt: Date.parse('2026-01-01T00:00:00Z'),
    targetDate: Date.parse('2026-01-01T00:00:00Z'),
    schemaVersion: 1,
    sourceRevision: 0,
    blocks: {},
    ...overrides,
  };
}

/* ─── Tests ─────────────────────────────────────────────────────────────── */

describe('workbenchSessionStore', () => {
  let notePersistence: FakeNotePersistence;
  let provider: FakeContentProvider;
  let timer: ReturnType<typeof fakeTimers>;
  let now: INowProvider;
  let intents: unknown[];

  beforeEach(() => {
    notePersistence = new FakeNotePersistence();
    provider = new FakeContentProvider();
    timer = fakeTimers();
    now = frozenClock('2026-01-01T00:00:00Z');
    intents = [];
  });

  it('setContent derives sections + blocks from content', () => {
    const store = createWorkbenchSessionStore({
      nowProvider: now,
      notePersistence,
      provider,
      setTimeout: timer.setTimeoutFn,
      clearTimeout: timer.clearTimeoutFn,
      navigate: (i) => intents.push(i),
    });

    store.getState().setContent('');
    expect(store.getState().sections).toEqual([]);
    expect(store.getState().blocks).toEqual([]);

    store.getState().setContent('# Title\n\n```time\nFran\n21-15-9\n```\n');
    expect(store.getState().sections?.length ?? 0).toBeGreaterThan(0);
    expect(store.getState().blocks.length).toBeGreaterThan(0);
  });

  it('setContent debounces the source and identity snapshot through persistence', async () => {
    const store = createWorkbenchSessionStore({
      nowProvider: now,
      notePersistence,
      provider,
      setTimeout: timer.setTimeoutFn,
      clearTimeout: timer.clearTimeoutFn,
      navigate: () => undefined,
    });

    provider.seed(makeEntry({ id: 'note-1' }));
    store.getState().setCurrentEntry(makeEntry({ id: 'note-1' }));
    expect(provider.updated.length).toBe(0);

    store.getState().setContent('# Title\n\n```time\nbody\n```\n');
    expect(provider.updated.length).toBe(0);
    expect(timer.getLiveCount()).toBe(1);

    store.getState().setContent('# Title\n\n```time\nbody v2\n```\n');
    store.getState().setContent('# Title\n\n```time\nbody v3\n```\n');
    // Reschedule cancels the prior timer, so only the latest is live.
    expect(timer.getLiveCount()).toBe(1);

    timer.fireFirst();
    await store.getState().flushSave();
    expect(notePersistence.saved).toHaveLength(1);
    expect(notePersistence.saved[0].rawContent).toContain('body v3');
    expect(Object.values(notePersistence.saved[0].blocks)).toHaveLength(1);
  });

  it('flushSave runs the provider immediately when the debounce is pending', async () => {
    const store = createWorkbenchSessionStore({
      nowProvider: now,
      notePersistence,
      provider,
      setTimeout: timer.setTimeoutFn,
      clearTimeout: timer.clearTimeoutFn,
      navigate: () => undefined,
    });

    provider.seed(makeEntry({ id: 'note-2' }));
    store.getState().setCurrentEntry(makeEntry({ id: 'note-2' }));
    store.getState().setContent('# Title\n\n```time\nunsaved\n```\n');
    expect(provider.updated.length).toBe(0);

    await store.getState().flushSave();
    expect(notePersistence.saved).toHaveLength(1);
  });

  it('captures a saved occurrence before execution and completes its pin after source changes', async () => {
    const store = createWorkbenchSessionStore({ nowProvider: now, notePersistence, provider, setTimeout: timer.setTimeoutFn, clearTimeout: timer.clearTimeoutFn, navigate: i => intents.push(i) });
    store.getState().setCurrentEntry(makeEntry({ id: 'note-run' }));
    store.getState().setContent('```time:crossfit\n10 Thrusters\n```');
    const selected = store.getState().blocks[0];
    const frozen = await store.getState().startPinnedRun(selected);
    expect(frozen.content.trim()).toBe('10 Thrusters');
    expect(frozen.dialect).toBe('time');
    const pin = store.getState().capturedRun?.session;
    if (!pin) throw new Error('Run pin missing');
    store.getState().setContent('The workout was removed.');
    await notePersistence.deleteNote('note-run');
    const outcome: Sessions = { startTime: 1, endTime: 2, duration: 1, completed: true };
    expect(await store.getState().completeWorkout(outcome)).toBe(pin.id);
    expect(notePersistence.finished[0]).toMatchObject({ noteId: 'note-run', blockId: frozen.id, blockVersion: 1 });
    expect(notePersistence.mutated).toEqual([]);
    expect(store.getState().results).toEqual([outcome]);
    expect(intents).toEqual([]);
  });

  it('finishes an editor-owned explicit persisted pin without selectedBlock', async () => {
    const store = createWorkbenchSessionStore({ nowProvider: now, notePersistence, provider, setTimeout: timer.setTimeoutFn, clearTimeout: timer.clearTimeoutFn });
    store.getState().setCurrentEntry(makeEntry({ id: 'inline-note' }));
    store.getState().setContent('```time\n10 Pushups\n```');
    const block = await store.getState().startPinnedRun(store.getState().blocks[0]);
    const pin = store.getState().capturedRun?.session;
    if (!pin) throw new Error('Run pin missing');
    store.setState({ capturedRun: null });
    expect(store.getState().selectedBlock).toBeNull();
    expect(await store.getState().completeWorkout({ startTime: 1, endTime: 2, duration: 1, completed: true }, pin.id)).toBe(pin.id);
    expect(notePersistence.finished[0]).toMatchObject({ blockId: block.id, blockVersion: 1 });
  });

  it('rejects unpinned completion rather than inventing a latest occurrence', async () => {
    const store = createWorkbenchSessionStore({ nowProvider: now, notePersistence, provider });
    await expect(store.getState().completeWorkout({ startTime: 1, endTime: 2, duration: 1, completed: true })).rejects.toThrow('saved run pin');
    expect(notePersistence.finished).toEqual([]);
  });
  it('loadEntry populates content + currentEntry', async () => {
    const store = createWorkbenchSessionStore({
      nowProvider: now,
      notePersistence,
      provider,
      setTimeout: timer.setTimeoutFn,
      clearTimeout: timer.clearTimeoutFn,
      navigate: () => undefined,
    });

    const entry = makeEntry({
      id: 'note-4',
      rawContent: '# Loaded Title\n\n```time\nwod-A\n```\n',
      sourceRevision: 1,
      blocks: reconcileNoteBlocks('# Loaded Title\n\n```time\nwod-A\n```\n', { sourceRevision: 1, createId: () => 'saved-workout' }),
    });
    notePersistence.seed(entry);

    const result = await store.getState().loadEntry({
      routeId: 'note-4',
      routeView: 'review',
      routeSectionId: undefined,
      routeResultId: undefined,
      initialActiveEntryId: undefined,
      propInitialContent: '',
    });
    expect(result).toBe(entry);

    const state = store.getState();
    expect(state.content).toContain('Loaded Title');
    expect(state.currentEntry).toEqual(entry);
    expect(state.sourceRevision).toBe(1);
    expect(state.blocks[0].id).toBe('saved-workout');
    // loadEntry marks the content as already saved to avoid an immediate
    // autosave firing.
    expect(state.lastSavedContent).toBe(entry.rawContent);
  });

  it('feedLogOutputs derives analytics from persisted logs', () => {
    const store = createWorkbenchSessionStore({
      nowProvider: now,
      notePersistence,
      provider,
      setTimeout: timer.setTimeoutFn,
      clearTimeout: timer.clearTimeoutFn,
      navigate: () => undefined,
    });

    const logs: StoredOutputStatement[] = [
      {
        id: 1,
        outputType: 'segment',
        timeSpan: { started: Date.parse('2026-01-01T00:00:00Z') },
        metrics: [],
        sourceBlockKey: 'wod-1',
        stackLevel: 0,
      } satisfies StoredOutputStatement,
    ];

    store.getState().feedLogOutputs(logs, Date.parse('2026-01-01T00:00:00Z'));
    expect(store.getState().logOutputList).toBe(logs);
    expect(store.getState().analyticsSegments.length).toBeGreaterThan(0);
  });

  it('setViewMode + setSelectedBlockId update the session surface', () => {
    const store = createWorkbenchSessionStore({
      nowProvider: now,
      notePersistence,
      provider,
      setTimeout: timer.setTimeoutFn,
      clearTimeout: timer.clearTimeoutFn,
      navigate: () => undefined,
    });

    store.getState().setViewMode('track');
    store.getState().setSelectedBlockId('wod-1');

    const state = store.getState();
    expect(state.viewMode).toBe('track');
    expect(state.selectedBlockId).toBe('wod-1');
  });

  it('resetStore clears the entire session', () => {
    const store = createWorkbenchSessionStore({
      nowProvider: now,
      notePersistence,
      provider,
      setTimeout: timer.setTimeoutFn,
      clearTimeout: timer.clearTimeoutFn,
      navigate: () => undefined,
    });

    store.getState().setContent('# Title');
    store.getState().setViewMode('track');
    store.getState().setSelectedBlockId('wod-1');

    store.getState().resetStore();

    const state = store.getState();
    expect(state.content).toBe('');
    expect(state.viewMode).toBe('plan');
    expect(state.selectedBlockId).toBeNull();
    expect(state.blocks).toEqual([]);
  });

  it('factory accepts no collaborators and degrades gracefully', () => {
    // Default module-load factory — no provider, no persistence. `setContent`
    // still derives the document; `flushSave` is a no-op.
    const store = createWorkbenchSessionStore();

    store.getState().setContent('# Title\n\n```time\nbody\n```\n');
    expect(store.getState().blocks.length).toBeGreaterThan(0);

    expect(() => store.getState().flushSave()).not.toThrow();
  });

  // ── Reactive observer seams (S2) ────────────────────────────────
  // The handoff Step 4 requires the live subscription path be exercised, not
  // just the log fallback. Build a minimal IScriptRuntime stub so the store
  // can wire `subscribeToOutput` + `subscribeToStack` and we can emit
  // synthetic events to verify the round-trip.

  /** Minimal IScriptRuntime for testing the session's reactive wiring. */
  class FakeRuntime {
    public readonly outputs: unknown[] = [];
    private readonly outputListeners: Set<(output: unknown) => void> = new Set();
    private readonly stackListeners: Set<(snapshot: unknown) => void> = new Set();

    subscribeToOutput(listener: (output: unknown) => void): () => void {
      this.outputListeners.add(listener);
      return () => { this.outputListeners.delete(listener); };
    }

    subscribeToStack(listener: (snapshot: unknown) => void): () => void {
      this.stackListeners.add(listener);
      return () => { this.stackListeners.delete(listener); };
    }

    getOutputStatements(): unknown[] {
      return [...this.outputs];
    }

    addOutput(output: unknown): void {
      this.outputs.push(output);
      for (const l of this.outputListeners) l(output);
    }

    emitStack(snapshot: unknown): void {
      for (const l of this.stackListeners) l(snapshot);
    }

    // The remaining IScriptRuntime surface is not exercised by these tests
    // (the session only calls subscribeToOutput / subscribeToStack /
    // getOutputStatements here). Cast to `unknown as IScriptRuntime` so the
    // type system is satisfied without us having to stub 15 fields.
    dispose = () => {};
  }

  it('setRuntime wires subscribeToOutput; emitted output grows outputStatementList + derives analytics', () => {
    const store = createWorkbenchSessionStore({
      nowProvider: now,
      notePersistence,
      provider,
      setTimeout: timer.setTimeoutFn,
      clearTimeout: timer.clearTimeoutFn,
      navigate: () => undefined,
    });
    const fakeRuntime = new FakeRuntime();
    // Cast: the session only touches subscribeToOutput / subscribeToStack /
    // getOutputStatements on the runtime; the rest of IScriptRuntime's
    // 13-method / 10-field surface isn't exercised by these tests.
    store.getState().setRuntime(fakeRuntime as unknown as IScriptRuntime);
    // Initial state: empty output buffer → no analytics segments.
    expect(store.getState().outputStatementList).toEqual([]);
    expect(store.getState().analyticsSegments).toEqual([]);


    // Emit a synthetic segment. The session's captured `subscribeToOutput`
    // listener fires `appendOutputStatement({})`, which:
    //   - appends a placeholder to `outputStatementList`
    //   - re-derives `analyticsSegments` from `runtime.getOutputStatements()`
    //     (which now contains the synthetic segment).
    const syntheticSegment = {
      id: 1,
      outputType: 'segment' as const,
      timeSpan: { started: Date.parse('2026-01-01T00:00:00Z'), ended: Date.parse('2026-01-01T00:01:00Z') },
      metrics: [],
      sourceBlockKey: 'wod-1',
      stackLevel: 0,
    };
    fakeRuntime.addOutput(syntheticSegment);

    // Live path round-trip verified: the placeholder grew + analytics derived.
    expect(store.getState().outputStatementList.length).toBe(1);
    expect(store.getState().analyticsSegments.length).toBeGreaterThan(0);
  });

  it('setRuntime wires subscribeToStack; emitted snapshot updates activeSegmentIds + activeStatementIds', () => {
    const store = createWorkbenchSessionStore({
      nowProvider: now,
      notePersistence,
      provider,
      setTimeout: timer.setTimeoutFn,
      clearTimeout: timer.clearTimeoutFn,
      navigate: () => undefined,
    });

    const fakeRuntime = new FakeRuntime();
    store.getState().setRuntime(fakeRuntime as unknown as IScriptRuntime);

    // Emit a synthetic snapshot with two blocks in real (top-first) order;
    // the current leaf block is blocks[0]. The session derives segmentIds
    // from block-key hashes and statementIds from the leaf's sourceIds.
    fakeRuntime.emitStack({
      type: 'push',
      depth: 2,
      blocks: [
        { key: { toString: () => 'block-leaf' }, sourceIds: [30, 40] },
        { key: { toString: () => 'block-root' }, sourceIds: [10, 20] },
      ],
      clockTime: new Date(0),
    });

    const state = store.getState();
    expect(state.activeSegmentIds.size).toBe(2);
    // The leaf's sourceIds: {30, 40}.
    expect(Array.from(state.activeStatementIds).sort()).toEqual([30, 40]);
  });

  it('setRuntime(null) tears down subscriptions + clears the live output list (analytics falls back to logs)', () => {
    const store = createWorkbenchSessionStore({
      nowProvider: now,
      notePersistence,
      provider,
      setTimeout: timer.setTimeoutFn,
      clearTimeout: timer.clearTimeoutFn,
      navigate: () => undefined,
    });

    const fakeRuntime = new FakeRuntime();
    store.getState().setRuntime(fakeRuntime as unknown as IScriptRuntime);
    fakeRuntime.addOutput({
      id: 1,
      outputType: 'segment',
      timeSpan: { started: 0, ended: 60_000 },
      metrics: [],
      sourceBlockKey: 'wod-1',
      stackLevel: 0,
    });
    expect(store.getState().outputStatementList.length).toBe(1);

    // Dispose the runtime. Live list clears; analytics fall back to logs.
    store.getState().setRuntime(null);
    expect(store.getState().runtime).toBeNull();
    expect(store.getState().outputStatementList).toEqual([]);

    // After disposal, further emits from the old runtime have no effect on
    // the session — the subscription was torn down.
    fakeRuntime.addOutput({
      id: 2,
      outputType: 'segment',
      timeSpan: { started: 0, ended: 60_000 },
      metrics: [],
      sourceBlockKey: 'wod-1',
      stackLevel: 0,
    });
    expect(store.getState().outputStatementList).toEqual([]);
  });
 });
