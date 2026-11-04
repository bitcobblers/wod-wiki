import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { areBlocksEqual, useNoteDraft } from './useNoteDraft';
import { notePersistence } from '@/services/persistence';
import type { NoteBlock } from '@/types/storage';

describe('useNoteDraft areBlocksEqual', () => {
  it('compares blocks including dialect and sport', () => {
    const b1: Record<string, NoteBlock> = {
      'block-1': { id: 'block-1', from: 0, to: 10, kind: 'wod', dialect: 'time', version: 1, sourceRevision: 1 },
    };
    const b2: Record<string, NoteBlock> = {
      'block-1': { id: 'block-1', from: 0, to: 10, kind: 'wod', dialect: 'log', version: 1, sourceRevision: 1 },
    };
    const b3: Record<string, NoteBlock> = {
      'block-1': { id: 'block-1', from: 0, to: 10, kind: 'wod', dialect: 'time', version: 1, sourceRevision: 1 },
    };
    expect(areBlocksEqual(b1, b2)).toBe(false);
    expect(areBlocksEqual(b1, b3)).toBe(true);
    expect(areBlocksEqual(undefined, undefined)).toBe(true);
    expect(areBlocksEqual(b1, undefined)).toBe(false);
  });

  it('committedSourceRevision returns the freshly saved source revision after flush', async () => {
    let currentRev = 1;
    notePersistence.saveNote = mock(async (input) => {
      currentRev += 1;
      return {
        id: input.noteId,
        rawContent: input.rawContent,
        blocks: input.blocks ?? {},
        sourceRevision: currentRev,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }) as any;

    const { result } = renderHook(() =>
      useNoteDraft({
        noteId: 'test-note-1',
        initialContent: 'initial content',
        initialRevision: 1,
      }),
    );

    act(() => {
      result.current.onSourceMutate('updated content');
    });

    await act(async () => {
      await result.current.flush();
    });

    expect(result.current.committedSourceRevision()).toBe(2);
    expect(result.current.committedRevision).toBe(2);
  });
});
