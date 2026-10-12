import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BlockHistory, revertBlock } from './BlockHistory';
import { IndexedDBNotePersistence } from '@/services/persistence';
import { StorageService } from '@/services/storage/StorageService';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import type { BlockRevision } from '@/types/storage';

afterEach(cleanup);
const initial = '# Note\n\n```time:crossfit\n10 Pushups\n```\n';

async function harness() {
  const service = new StorageService(new InMemoryStorage());
  const persistence = new IndexedDBNotePersistence(service);
  const blocks = reconcileNoteBlocks(initial, { sourceRevision: 1 });
  const first = await persistence.saveNote({ noteId: 'history-note', rawContent: initial, blocks, expectedSourceRevision: 0, metadata: { title: 'Note' } });
  const id = Object.keys(first.blocks ?? {})[0];
  if (!id) throw new Error('Workout missing');
  const edited = initial.replace('10 Pushups', '20 Pushups');
  const nextBlocks = { ...first.blocks, [id]: { ...blocks[id], to: blocks[id].to + edited.length - initial.length } };
  const second = await persistence.saveNote({ noteId: first.id, rawContent: edited, blocks: nextBlocks, expectedSourceRevision: first.sourceRevision ?? 1 });
  return { service, persistence, first, second, id };
}

describe('saved block history', () => {
  it('compares never-run versions and restoring v1 saves v3', async () => {
    const { service, persistence, second, id } = await harness();
    let current = second;
    render(<BlockHistory noteId={second.id} blocks={second.blocks} persistence={persistence} onRevert={async revision => {
      const restored = revertBlock({ rawContent: current.rawContent, blocks: current.blocks ?? {}, sourceRevision: current.sourceRevision ?? 1 }, revision);
      current = await persistence.saveNote({ noteId: current.id, rawContent: restored.rawContent, blocks: restored.blocks, expectedSourceRevision: current.sourceRevision ?? 1 });
    }} />);
    fireEvent.click(screen.getByText('Saved block history'));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Compare saved version' })).toBeTruthy());
    expect(screen.getByLabelText('Compare saved version source').textContent).toContain('10 Pushups');
    expect(screen.getByLabelText('With saved version source').textContent).toContain('20 Pushups');
    fireEvent.click(screen.getByRole('button', { name: 'Restore v1 as a new saved version' }));
    await waitFor(() => expect(current.rawContent).toBe(initial));
    expect((await service.getBlockHistory(current.id, id)).map(row => row.version)).toEqual([1, 2, 3]);
    expect(await service.getSessionsForNote(current.id)).toEqual([]);
  });

  it('lists removed saved occurrences and restores them through the ordinary save', async () => {
    const { service, persistence, second, id } = await harness();
    const removed = await persistence.saveNote({ noteId: second.id, rawContent: '# Note\n', blocks: {}, expectedSourceRevision: second.sourceRevision ?? 1 });
    let current = removed;
    render(<BlockHistory noteId={removed.id} blocks={removed.blocks} persistence={persistence} onRevert={async revision => {
      const restored = revertBlock({ rawContent: current.rawContent, blocks: current.blocks ?? {}, sourceRevision: current.sourceRevision ?? 1 }, revision);
      current = await persistence.saveNote({ noteId: current.id, rawContent: restored.rawContent, blocks: restored.blocks, expectedSourceRevision: current.sourceRevision ?? 1 });
    }} />);
    fireEvent.click(screen.getByText('Saved block history'));
    await waitFor(() => expect(screen.getByRole('option', { name: new RegExp(`${id}.*removed`) })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Restore v1 as a new saved version' }));
    await waitFor(() => expect(current.rawContent).toContain('10 Pushups'));
    expect(current.blocks?.[id]).toBeDefined();
    expect((await service.getBlockHistory(current.id, id)).map(row => row.version)).toEqual([1, 2, 3]);
    expect(await service.getSessionsForNote(current.id)).toEqual([]);
  });

  it('compares duplicate occurrences independently without running either', async () => {
    const service = new StorageService(new InMemoryStorage());
    const persistence = new IndexedDBNotePersistence(service);
    const source = '```time\n10 Pushups\n```\n\n```time\n10 Pushups\n```';
    let occurrence = 0;
    const blocks = reconcileNoteBlocks(source, { sourceRevision: 1, createId: () => `occurrence-${++occurrence}` });
    const first = await persistence.saveNote({ noteId: 'duplicates', rawContent: source, blocks, expectedSourceRevision: 0 });
    const secondBlock = first.blocks?.['occurrence-2'];
    if (!secondBlock) throw new Error('Second occurrence missing');
    const edited = source.slice(0, secondBlock.from) + source.slice(secondBlock.from).replace('10 Pushups', '20 Pushups');
    const saved = await persistence.saveNote({ noteId: first.id, rawContent: edited, blocks: first.blocks ?? {}, expectedSourceRevision: first.sourceRevision ?? 1 });
    render(<BlockHistory noteId={saved.id} blocks={saved.blocks} persistence={persistence} />);
    fireEvent.click(screen.getByText('Saved block history'));
    const select = await screen.findByRole('combobox', { name: 'Block occurrence' });
    fireEvent.change(select, { target: { value: 'occurrence-2' } });
    expect(screen.getByLabelText('Compare saved version source').textContent).toContain('10 Pushups');
    expect(screen.getByLabelText('With saved version source').textContent).toContain('20 Pushups');
    fireEvent.change(select, { target: { value: 'occurrence-1' } });
    expect(screen.getByLabelText('With saved version source').textContent).toContain('10 Pushups');
    expect((await service.getBlockHistory(saved.id, 'occurrence-1')).map(row => row.version)).toEqual([1]);
    expect((await service.getBlockHistory(saved.id, 'occurrence-2')).map(row => row.version)).toEqual([1, 2]);
    expect(await service.getSessionsForNote(saved.id)).toEqual([]);
  });

  it('keeps removed occurrence history and restores that identity without touching its duplicate', async () => {
    const revision: BlockRevision = { noteId: 'note', blockId: 'removed', version: 2, kind: 'wod', dialect: 'time', rawContent: '```time\n10 Pushups\n```', savedAt: 100 };
    const source = '```time\n10 Pushups\n```';
    const duplicate = { id: 'duplicate', kind: 'wod' as const, dialect: 'time' as const, version: 1, sourceRevision: 3, from: 0, to: source.length };
    const restored = revertBlock({ rawContent: source, blocks: { duplicate }, sourceRevision: 3 }, revision);
    expect(restored.blocks.duplicate).toEqual(duplicate);
    expect(restored.blocks.removed.id).toBe('removed');
    expect(restored.rawContent.slice(restored.blocks.removed.from, restored.blocks.removed.to)).toBe(revision.rawContent);
  });
});
