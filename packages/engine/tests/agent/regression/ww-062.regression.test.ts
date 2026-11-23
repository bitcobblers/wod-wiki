import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { countNotesByNotebook, getNotebookCapabilities, isNotebookLanding } from '@bitcobblers/wod-wiki-core';
import { MemoryFeedTree, deleteUserNotebook } from '../../../src';
import {
  wodNotebookDeleteTool,
  wodNotebookListTool,
  wodNotebookSaveTool,
  type AgentDomainContext,
} from '../../../src/agent';

describe('WW-062 / WW-037 / WW-101 — Notebook capabilities, listing counts, and atomic deletion', () => {
  it('returns /notebook/:slug rather than /notebooks/:slug for every notebook', async () => {
    const storage = new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
    const ctx: AgentDomainContext = {
      storage,
      baseUrl: 'https://wod.wiki',
      feedTree: new MemoryFeedTree(),
    };

    await wodNotebookSaveTool.execute({ action: 'create', name: 'Regression Probe 2099' }, ctx);
    const list = await wodNotebookListTool.execute({}, ctx);
    const entry = list.notebooks.find((nb) => nb.slug === 'regression-probe-2099');

    expect(entry).toBeDefined();
    expect(entry!.url).not.toContain('/notebooks/');
    expect(entry!.url).toMatch(/\/notebook\/regression-probe-2099$/);
  });

  it('enforces shared notebook capability policy, deduplicates member counts, and deletes user notebooks atomically', async () => {
    expect(getNotebookCapabilities({ slug: 'journal', origin: 'default' })).toMatchObject({
      isBuiltIn: true,
      canEdit: false,
      canDelete: false,
      canTogglePublic: false,
    });
    expect(getNotebookCapabilities({ slug: 'guides', feedId: 'local' })).toMatchObject({
      isBuiltIn: true,
      isSystem: true,
      canEdit: false,
      canDelete: false,
      canTogglePublic: false,
    });
    expect(getNotebookCapabilities({ slug: 'open-prep', feedId: 'local' })).toMatchObject({
      isBuiltIn: false,
      isSystem: false,
      canEdit: true,
      canDelete: true,
      canTogglePublic: true,
    });

    const storage = new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
    const ctx: AgentDomainContext = { storage, feedTree: new MemoryFeedTree() };
    await wodNotebookSaveTool.execute({ action: 'create', name: 'Atomic Shelf' }, ctx);
    await storage.transaction(['notes', 'notebook_links'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put({
        id: 'member-1',
        title: 'Member Workout',
        rawContent: '# Member Workout\n',
        tags: [],
        createdAt: 1000,
        sourceRevision: 1,
        blocks: {},
        notebookId: 'notebook/atomic-shelf',
        notebookIds: ['notebook/journal', 'notebook/atomic-shelf'],
      });
      await tx.readwrite('notebook_links').put({
        id: 'notebook/atomic-shelf:note:member-1',
        notebookId: 'notebook/atomic-shelf',
        targetKind: 'note',
        targetId: 'member-1',
        noteId: 'member-1',
        createdAt: 1000,
      });
    });

    const allNotes = await storage.readonly('notes').getAll();
    const allLinks = await storage.readonly('notebook_links').getAll();
    expect(isNotebookLanding(allNotes.find((n) => n.id === 'notebook/atomic-shelf')!)).toBe(true);
    const counts = countNotesByNotebook(allNotes, allLinks);
    expect(counts.get('notebook/atomic-shelf')).toBe(1);

    await expect(deleteUserNotebook(storage, 'notebook/journal')).rejects.toThrow(/always present/);

    const del = await wodNotebookDeleteTool.execute(
      { notebookId: 'notebook/atomic-shelf', confirmId: 'atomic-shelf' },
      ctx,
    );
    expect(del).toMatchObject({ deleted: true, notebookId: 'notebook/atomic-shelf', slug: 'atomic-shelf' });
    expect(await storage.readonly('notes').get('notebook/atomic-shelf')).toBeUndefined();
    expect(await storage.readonly('notebook_links').getAllFromIndex('by-notebook', 'notebook/atomic-shelf')).toEqual([]);
    const memberAfter = await storage.readonly('notes').get('member-1');
    expect(memberAfter?.notebookId).toBeUndefined();
    expect(memberAfter?.notebookIds).toEqual(['notebook/journal']);
  });
});
