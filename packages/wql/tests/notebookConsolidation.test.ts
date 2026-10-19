import { describe, expect, it } from 'vitest';
import {
  QueryService,
  parseQuery,
  notebookOfItem,
  toNotebookId,
  notebookSlugFromId,
  isNoteEditable,
  DEFAULT_NOTEBOOK_SLUGS,
} from '../src/index';
import type { Note, BlockIndexRow } from '@bitcobblers/wod-wiki-core';

const makeNote = (overrides: Partial<Note> & { id: string }): Note => ({
  title: overrides.id,
  rawContent: '# Workout\n```time\n10 Push-ups\n```',
  sourceRevision: 1,
  blocks: {},
  createdAt: 1000,
  ...overrides,
});

describe('notebook/{slug} consolidation & WQL notebook filtering', () => {
  it('normalizes canonical notebook/{slug} identifiers including default slugs (journal, playground, guides)', () => {
    expect(DEFAULT_NOTEBOOK_SLUGS).toEqual(['journal', 'playground', 'guides']);
    expect(toNotebookId('journal')).toBe('notebook/journal');
    expect(toNotebookId('notebook/journal')).toBe('notebook/journal');
    expect(toNotebookId('notebook:playground')).toBe('notebook/playground');
    expect(toNotebookId('guides')).toBe('notebook/guides');
    expect(toNotebookId('crossfit-girls')).toBe('notebook/crossfit-girls');

    expect(notebookSlugFromId('notebook/journal')).toBe('journal');
    expect(notebookSlugFromId('notebook/crossfit-girls')).toBe('crossfit-girls');
    expect(notebookSlugFromId('playground')).toBe('playground');
  });

  it('derives notebook/{slug} for journal, playground, guides, seed catalogs, and explicit notebookId notes', () => {
    const journalNote = makeNote({ id: '01950000-0000-7000-8000-000000000001', seedOrigin: 'user' });
    const playgroundNote = makeNote({ id: 'pg-1', sourceId: 'playground', type: 'playground', seedOrigin: 'user' });
    const guideNote = makeNote({ id: 'g-1', sourceId: 'guides:start', seedOrigin: 'seed' });
    const girlNote = makeNote({
      id: 'girl-fran',
      sourceId: 'collection:crossfit-girls/fran',
      catalog: 'crossfit-girls',
      seedOrigin: 'seed',
    });
    const customNotebookNote = makeNote({
      id: 'custom-1',
      notebookId: 'notebook/open-prep',
      seedOrigin: 'user',
    });

    expect(notebookOfItem(journalNote)).toBe('notebook/journal');
    expect(notebookOfItem(playgroundNote)).toBe('notebook/playground');
    expect(notebookOfItem(guideNote)).toBe('notebook/guides');
    expect(notebookOfItem(girlNote)).toBe('notebook/crossfit-girls');
    expect(notebookOfItem(customNotebookNote)).toBe('notebook/open-prep');
  });

  it('decides editability at the application level: only user-created notes (seedOrigin !== "seed") are editable', () => {
    expect(isNoteEditable({ seedOrigin: 'user' })).toBe(true);
    expect(isNoteEditable({ seedOrigin: undefined })).toBe(true);
    expect(isNoteEditable({ seedOrigin: 'seed' })).toBe(false);
  });

  it('filters notes and blocks by notebook:{slug} or notebook:notebook/{slug} in WQL', async () => {
    const notes: Note[] = [
      makeNote({ id: '01950000-0000-7000-8000-000000000001', title: 'Morning Log', seedOrigin: 'user' }),
      makeNote({ id: 'pg-1', title: 'Draft EMOM', sourceId: 'playground', type: 'playground', seedOrigin: 'user' }),
      makeNote({ id: 'g-1', title: 'Getting Started', sourceId: 'guides:start', seedOrigin: 'seed' }),
      makeNote({
        id: 'fran-id',
        title: 'Fran',
        sourceId: 'collection:crossfit-girls/fran',
        catalog: 'crossfit-girls',
        seedOrigin: 'seed',
      }),
      makeNote({
        id: 'user-nb-1',
        title: 'Peaking Squat',
        notebookId: 'notebook/open-prep',
        seedOrigin: 'user',
      }),
    ];

    const service = new QueryService({
      noteStore: {
        getAllNotes: async () => notes,
        getNoteIdsForTag: async () => new Set<string>(),
        getNoteTagLabels: async () => [],
      },
      blockStore: { getAllBlocks: async () => [] as BlockIndexRow[] },
    });

    const journalRes = await service.runFind(parseQuery(':note{notebook:journal}') as Parameters<typeof service.runFind>[0]);
    expect(journalRes.notes.map((n) => n.id)).toEqual(['01950000-0000-7000-8000-000000000001']);

    const playgroundRes = await service.runFind(parseQuery(':note{notebook:notebook/playground}') as Parameters<typeof service.runFind>[0]);
    expect(playgroundRes.notes.map((n) => n.id)).toEqual(['pg-1']);

    const guidesRes = await service.runFind(parseQuery(':note{notebook:guides}') as Parameters<typeof service.runFind>[0]);
    expect(guidesRes.notes.map((n) => n.id)).toEqual(['g-1']);

    const girlsRes = await service.runFind(parseQuery(':note{notebook:crossfit-girls}') as Parameters<typeof service.runFind>[0]);
    expect(girlsRes.notes.map((n) => n.id)).toEqual(['fran-id']);

    const customRes = await service.runFind(parseQuery(':note{notebook:open-prep}') as Parameters<typeof service.runFind>[0]);
    expect(customRes.notes.map((n) => n.id)).toEqual(['user-nb-1']);

    const notesHeadRes = await service.runFind(parseQuery(':notes{notebook:open-prep}') as Parameters<typeof service.runFind>[0]);
    expect(notesHeadRes.notes.map((n) => n.id)).toEqual(['user-nb-1']);

    const notebookHeadRes = await service.runFind(parseQuery(':notebook{notebook:crossfit-girls}') as Parameters<typeof service.runFind>[0]);
    expect(notebookHeadRes.notes.map((n) => n.id)).toEqual(['crossfit-girls']);
  });
});
