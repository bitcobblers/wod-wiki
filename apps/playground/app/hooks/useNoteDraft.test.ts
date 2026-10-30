import { describe, expect, it } from 'bun:test';
import { areBlocksEqual } from './useNoteDraft';
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
});
