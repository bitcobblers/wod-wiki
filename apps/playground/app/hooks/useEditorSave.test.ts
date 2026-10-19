import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useEditorSave } from './useEditorSave';

describe('useEditorSave', () => {
  it('does not mark a rejected draft saved and permits retry', async () => {
    let rejected = true;
    const committed: string[] = [];
    const { result, unmount } = renderHook(() => useEditorSave({ onSave: async (value: string) => {
      if (rejected) throw new Error('stale source');
      committed.push(value);
    } }));
    act(() => result.current.onChange('draft'));
    await act(async () => { await expect(result.current.flush()).rejects.toThrow('stale source'); });
    expect(result.current.error).toBeInstanceOf(Error);
    rejected = false;
    await act(async () => { await result.current.flush(); });
    expect(committed).toEqual(['draft']);
    expect(result.current.error).toBeNull();
    await act(async () => { await result.current.flush(); });
    expect(committed).toEqual(['draft']);
    unmount();
  });

  it('serializes queued source and identity snapshots without mixing later drafts', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const committed: Array<{ rawContent: string; blockId: string }> = [];
    const { result, unmount } = renderHook(() => useEditorSave({
      onSave: async (snapshot: { rawContent: string; blockId: string }) => {
        if (snapshot.rawContent === 'first') await gate;
        committed.push(snapshot);
      },
    }));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { result.current.onChange({ rawContent: 'first', blockId: 'one' }); first = result.current.flush(); });
    act(() => { result.current.onChange({ rawContent: 'second', blockId: 'two' }); second = result.current.flush(); });
    await act(async () => { release(); await Promise.all([first, second]); });
    expect(committed).toEqual([{ rawContent: 'first', blockId: 'one' }, { rawContent: 'second', blockId: 'two' }]);
    unmount();
  });

  it('coalesces: onChange alone never saves; a line change flushes the pending draft', async () => {
    const committed: string[] = [];
    const { result, unmount } = renderHook(() => useEditorSave<string>({ onSave: async value => { committed.push(value); } }));
    act(() => result.current.onChange('draft'));
    expect(committed).toEqual([]);
    act(() => result.current.onLineChange(1, 0));
    expect(committed).toEqual([]);
    act(() => result.current.onChange('draft v2'));
    act(() => result.current.onLineChange(2, 0));
    // No explicit flush — the line change itself must trigger the save.
    await act(async () => { await Promise.resolve(); });
    expect(committed).toEqual(['draft v2']);
    unmount();
  });
});
