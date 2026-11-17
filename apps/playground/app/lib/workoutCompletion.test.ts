/**
 * workoutCompletion tests — the completion-target mapping is the load-bearing
 * contract of write-on-completion (#944): EVERY completed run must persist
 * under the same result id the note's query:table references, against the
 * note that owns the block. These tests lock the two entry paths and their
 * edge cases.
 */
import { describe, expect, it } from 'bun:test';
import { resolveCompletionTargets } from './workoutCompletion';
import type { ScriptBlock } from '@/components/Editor/types';

const resolveNoteUuid = (_line: number): string => {
  // Single-note page: every line maps to 'note-a'.
  return 'note-a';
};

const makeBlock = (overrides: Partial<ScriptBlock> = {}): ScriptBlock => ({
  id: 'time-3-abc12345',
  contentId: 'bc-1',
  startLine: 2, // 0-based
  endLine: 6,
  content: '5s',
  state: 'idle',
  version: 1,
  createdAt: 0,
  widgetIds: {},
  ...overrides,
});

const base = {
  blocks: [makeBlock()],
  activeNoteId: null,
  timerBlock: null,
  activeRuntimeId: null,
  resolveNoteUuid,
};

describe('resolveCompletionTargets', () => {
  it('editor-run: uses the threaded block + result id, maps `time-<line>-` id to the note', () => {
    const targets = resolveCompletionTargets({
      ...base,
      blockId: 'time-3-abc12345',
      editorRunBlock: { id: 'time-3-abc12345', contentId: 'bc-1' },
      editorResultId: 'run-editor-9',
    });
    expect(targets).toEqual({
      runBlock: { id: 'time-3-abc12345', contentId: 'bc-1' },
      noteId: 'note-a',
      resultId: 'run-editor-9',
    });
  });

  it('editor-run without threaded block falls back to the compiled block list', () => {
    const targets = resolveCompletionTargets({
      ...base,
      blockId: 'time-3-abc12345',
      editorResultId: 'run-editor-10',
    });
    expect(targets?.runBlock).toMatchObject({ id: 'time-3-abc12345', contentId: 'bc-1' });
    expect(targets?.resultId).toBe('run-editor-10');
  });

  it('autoStart run: activeNoteId + timerBlock resolve even when the block id embeds a foreign doc line', () => {
    const timerBlock = makeBlock({ id: 'wod-42-deadbeef', contentId: 'bc-1', startLine: 3 });
    const targets = resolveCompletionTargets({
      ...base,
      blockId: 'wod-42-deadbeef',
      activeNoteId: 'note-pending',
      timerBlock,
      activeRuntimeId: 'run-pending-1',
    });
    expect(targets).toEqual({
      runBlock: timerBlock,
      noteId: 'note-pending',
      resultId: 'run-pending-1',
    });
  });

  it('autoStart run with a foreign block line still lands on the sourced note via activeNoteId', () => {
    // Pending-run block: the id line refers to its source doc, but the
    // attributed note comes from activeNoteId regardless.
    const timerBlock = makeBlock({ id: 'time-99-zz9', contentId: 'bc-x', startLine: 3 });
    const targets = resolveCompletionTargets({
      ...base,
      blockId: 'time-99-zz9',
      activeNoteId: 'note-pending-2',
      timerBlock,
      activeRuntimeId: 'run-pending-2',
    });
    expect(targets?.noteId).toBe('note-pending-2');
    expect(targets?.resultId).toBe('run-pending-2');
    expect(targets?.runBlock).toMatchObject({ id: 'time-99-zz9', contentId: 'bc-x' });
  });

  it('non-line id lands on the owning note via the block startLine fallback', () => {
    const targets = resolveCompletionTargets({
      ...base,
      blocks: [makeBlock({ id: 'custom-block-1', contentId: 'bc-1', startLine: 4 })],
      blockId: 'custom-block-1',
      editorResultId: 'run-12',
    });
    expect(targets?.noteId).toBe('note-a');
    expect(targets?.resultId).toBe('run-12');
  });

  it('drops the run only when the block is unattributable (no editor block, no list match, no timer)', () => {
    const targets = resolveCompletionTargets({
      ...base,
      blockId: 'wod-42-deadbeef', // foreign id, no activeNoteId, no timer
    });
    expect(targets).toBeNull();
  });
});