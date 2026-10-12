import { afterEach, describe, expect, it, mock, vi } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { NoteBlock } from '@/types/storage';

interface SavedPage { id: string; content: string; sourceRevision: number; noteBlocks: Record<string, NoteBlock> }
const savedPages: SavedPage[] = [];
const existingPages = new Map<string, SavedPage>();
let getPageOverride: (() => Promise<SavedPage | undefined>) | null = null;
let failure: Error | null = null;
mock.module('../services/playgroundContent', () => ({
  pageId: (category: string, name: string) => `${category}/${name}`,
  playgroundContent: { getPage: async (id: string) => getPageOverride ? getPageOverride() : existingPages.get(id) },
}));
mock.module('@/services/persistence', () => ({ notePersistence: {
  saveNote: async (input: { noteId: string; rawContent: string; blocks: Record<string, NoteBlock>; expectedSourceRevision: number }) => {
    if (failure) throw failure;
    const existing = existingPages.get(input.noteId);
    if ((existing?.sourceRevision ?? 0) !== input.expectedSourceRevision) throw new Error('stale source');
    const sourceRevision = input.expectedSourceRevision + 1;
    const blocks = Object.fromEntries(Object.entries(input.blocks).map(([id, block]) => [id, { ...block, sourceRevision }]));
    const page = { id: input.noteId, content: input.rawContent, sourceRevision, noteBlocks: blocks };
    existingPages.set(page.id, page);
    savedPages.push(page);
    return { id: page.id, rawContent: page.content, blocks, sourceRevision };
  },
} }));
const hookModule = import('./usePlaygroundContent');
afterEach(() => { vi.useRealTimers(); getPageOverride = null; failure = null; savedPages.length = 0; existingPages.clear(); });

describe('usePlaygroundContent', () => {
  it('flushes matching source and identities on unmount', async () => {
    existingPages.set('journal/day', { id: 'journal/day', content: 'original', sourceRevision: 1, noteBlocks: {} });
    const { usePlaygroundContent } = await hookModule;
    const { result, unmount } = renderHook(() => usePlaygroundContent({ category: 'journal', name: 'day', mdContent: 'original' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.onChange('edited'));
    unmount();
    await waitFor(() => expect(savedPages).toHaveLength(1));
    expect(savedPages[0]).toMatchObject({ id: 'journal/day', content: 'edited', sourceRevision: 2, noteBlocks: {} });
  });

  it('preserves a draft but refuses saving fallback content after loading times out', async () => {
    getPageOverride = () => new Promise<SavedPage | undefined>(() => {});
    const { usePlaygroundContent, LOAD_TIMEOUT_MS } = await hookModule;
    vi.useFakeTimers();
    const { result } = renderHook(() => usePlaygroundContent({ category: 'girls', name: 'ghost', mdContent: 'bundled' }));
    act(() => vi.advanceTimersByTime(LOAD_TIMEOUT_MS));
    expect(result.current.loading).toBe(false);
    expect(result.current.content).toBe('bundled');
    expect(result.current.error).toBeInstanceOf(Error);
    expect(savedPages).toHaveLength(0);
    act(() => result.current.onChange('draft after timeout'));
    await act(async () => { await expect(result.current.flush()).rejects.toThrow('Note load timed out'); });
    expect(result.current.content).toBe('draft after timeout');
    expect(savedPages).toHaveLength(0);
  });

  it('seeds missing content unless seedOnMount is false', async () => {
    const { usePlaygroundContent } = await hookModule;
    const seeded = renderHook(() => usePlaygroundContent({ category: 'journal', name: 'day', mdContent: 'bundled' }));
    await waitFor(() => expect(seeded.result.current.loading).toBe(false));
    expect(savedPages).toHaveLength(1);
    expect(seeded.result.current.sourceRevision).toBe(1);
    seeded.unmount();
    savedPages.length = 0;
    const { result } = renderHook(() => usePlaygroundContent({ category: 'feed', name: 'new', mdContent: 'bundled', seedOnMount: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(savedPages).toHaveLength(0);
    act(() => result.current.onChange('first edit'));
    await act(async () => { await result.current.flush(); });
    expect(savedPages[0]).toMatchObject({ id: 'feed/new', content: 'first edit', sourceRevision: 1 });
  });

  it('keeps a rejected draft and retries without advancing the committed marker', async () => {
    const { usePlaygroundContent } = await hookModule;
    const { result } = renderHook(() => usePlaygroundContent({ category: 'journal', name: 'day', mdContent: 'original' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.onChange('draft'));
    failure = new Error('commit failed');
    await act(async () => { await expect(result.current.flush()).rejects.toThrow('commit failed'); });
    expect(result.current.content).toBe('draft');
    expect(result.current.committedSourceRevision()).toBe(1);
    expect(result.current.error).toBe(failure);
    failure = null;
    await act(async () => { await result.current.flush(); });
    expect(result.current.committedSourceRevision()).toBe(2);
    expect(savedPages.map(page => page.content)).toEqual(['original', 'draft']);
    await act(async () => { await result.current.flush(); });
    expect(savedPages).toHaveLength(2);
  });

  it('does not replace a newer same-source occurrence map with an older saved map', async () => {
    const { usePlaygroundContent } = await hookModule;
    const source = '```time\n10 Pushups\n```';
    const block = { id: 'first', kind: 'wod' as const, dialect: 'time' as const, version: 1,
      sourceRevision: 1, from: 0, to: source.length };
    existingPages.set('journal/day', { id: 'journal/day', content: source, sourceRevision: 1, noteBlocks: { first: block } });
    const { result, unmount } = renderHook(() => usePlaygroundContent({ category: 'journal', name: 'day', mdContent: source }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.onIdentityChange({ rawContent: source, noteBlocks: { second: { ...block, id: 'second' } }, sourceRevision: 1 }));
    act(() => result.current.onSaved({ rawContent: source, blocks: { first: block }, sourceRevision: 2 }));
    expect(Object.keys(result.current.noteBlocks)).toEqual(['second']);
    failure = new Error('stale source');
    unmount();
    await waitFor(() => expect(savedPages).toHaveLength(0));
  });
});
