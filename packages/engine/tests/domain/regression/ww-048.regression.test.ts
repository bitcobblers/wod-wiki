import { afterEach, describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { MemoryFeedTree, notebooksOfItem } from '../../../src';
import { wodNoteGetTool, wodNotebookSaveTool, type AgentDomainContext } from '../../../src/agent';
import { DomainScenarioHarness } from '../../harness/DomainScenarioHarness';

describe('WW-048 — N:M notebook membership on a note', () => {
  let harness: DomainScenarioHarness;
  afterEach(() => harness?.dispose());

  it('preserves and surfaces both linked notebooks on a note promoted into two notebooks', async () => {
    harness = await DomainScenarioHarness.create();
    const { note } = await harness.authorNote({
      id: 'note-nm-provenance-2099',
      title: 'N:M Provenance WOD 2099',
      rawContent: '# N:M Provenance WOD 2099\n\n```time\n20:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n```\n',
      notebookId: 'notebook/garage-crew-2099',
      notebookIds: ['notebook/garage-crew-2099', 'notebook/travel-wods-2099'],
    });

    expect(notebooksOfItem(note)).toEqual(
      expect.arrayContaining(['notebook/garage-crew-2099', 'notebook/travel-wods-2099']),
    );

    const ctx: AgentDomainContext = {
      storage: harness.storage,
      baseUrl: 'https://wod.wiki',
      feedTree: new MemoryFeedTree(),
    };
    await wodNotebookSaveTool.execute({ action: 'create', name: 'Garage Crew 2099' }, ctx);
    await wodNotebookSaveTool.execute({ action: 'create', name: 'Travel Wods 2099' }, ctx);
    await wodNotebookSaveTool.execute(
      { action: 'promote', notebookId: 'travel-wods-2099', noteId: note.id },
      ctx,
    );

    const fetched = await wodNoteGetTool.execute({ noteId: note.id }, ctx);
    const linkedIds = fetched.notebooks.map((nb) => nb.id);
    expect(linkedIds).toEqual(
      expect.arrayContaining(['notebook/garage-crew-2099', 'notebook/travel-wods-2099']),
    );
  });

  it('SqlStorage notebook_links store tracks N:M membership independently of note.notebookId', async () => {
    const storage = new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
    await storage.readwrite('notebook_links').put({
      id: 'link-1',
      notebookId: 'notebook/garage-crew-2099',
      targetKind: 'note',
      noteId: 'note-1',
      createdAt: 1,
    });
    await storage.readwrite('notebook_links').put({
      id: 'link-2',
      notebookId: 'notebook/travel-wods-2099',
      targetKind: 'note',
      noteId: 'note-1',
      createdAt: 2,
    });
    const links = await storage.readonly('notebook_links').getAllFromIndex('by-note', 'note-1');
    expect(links.map((l) => l.notebookId)).toEqual(
      expect.arrayContaining(['notebook/garage-crew-2099', 'notebook/travel-wods-2099']),
    );
  });
});
