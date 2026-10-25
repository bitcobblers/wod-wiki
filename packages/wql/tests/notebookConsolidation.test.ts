import { describe, expect, it } from 'vitest';
import {
  QueryService,
  parseQuery,
  notebookOfItem,
  sourceMatches,
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

    // The notebooks listing head and the authored plural storage scope both
    // route to the catalog executor — one row per notebook, never the
    // generic note plane (which would surface fran-id).
    const notebooksListingRes = await service.runFind(parseQuery(':notebook{} by {tag}') as Parameters<typeof service.runFind>[0]);
    expect(notebooksListingRes.notes.map((n) => n.id)).toEqual(['crossfit-girls']);

    const pluralScopeRes = await service.runFind(parseQuery(':note{type:feed,source:notebooks}') as Parameters<typeof service.runFind>[0]);
    expect(pluralScopeRes.notes.map((n) => n.id)).toEqual(['crossfit-girls']);
  });

  const uuid = (n: number): string =>
    `01950000-0000-7000-8000-${String(n).padStart(12, '0')}`;

  it('resolves every corpus family from its corpus path alone (effort, equipment, dashboard, guide, collection, feed)', () => {
    expect(notebookOfItem(makeNote({ id: uuid(1), seedOrigin: 'seed', sourcePath: 'markdown/efforts/bodyweight/air-squat.md' }))).toBe('notebook/efforts');
    expect(notebookOfItem(makeNote({ id: uuid(2), seedOrigin: 'seed', sourcePath: 'markdown/equipment/air-bike.md' }))).toBe('notebook/equipment');
    expect(notebookOfItem(makeNote({ id: uuid(3), seedOrigin: 'seed', sourcePath: 'markdown/dashboards/benchmark-pr-board.md' }))).toBe('notebook/dashboards');
    expect(notebookOfItem(makeNote({ id: uuid(4), seedOrigin: 'seed', sourcePath: 'markdown/canvas/guide/clock.md' }))).toBe('notebook/guides');
    expect(notebookOfItem(makeNote({ id: uuid(5), seedOrigin: 'seed', sourcePath: 'markdown/collections/girls/fran.md' }))).toBe('notebook/girls');
    expect(notebookOfItem(makeNote({ id: uuid(6), seedOrigin: 'seed', sourcePath: 'markdown/feeds/community/2024-01-01/post.md' }))).toBe('notebook/community');
    // Writer root landings (`collection._root` / `feed._root`): the writer
    // stamps no catalog, so they claim no notebook from either tier.
    expect(notebookOfItem(makeNote({ id: uuid(7), seedOrigin: 'seed', sourcePath: 'markdown/collections/README.md' }))).toBeUndefined();
    expect(notebookOfItem(makeNote({ id: uuid(8), seedOrigin: 'seed', sourcePath: 'markdown/feeds/README.md' }))).toBeUndefined();
    // Unknown markdown/ paths claim nothing from the corpus tier, and the
    // journal fallback rejects every markdown/ path (existing predicate).
    expect(notebookOfItem(makeNote({ id: uuid(9), seedOrigin: 'user', sourcePath: 'markdown/somewhere/else.md' }))).toBeUndefined();
  });

  it('resolves the source-id corpus identities (efforts, equipment, dashboards, typed dashboards)', () => {
    expect(notebookOfItem(makeNote({ id: uuid(1), seedOrigin: 'seed', sourceId: 'efforts' }))).toBe('notebook/efforts');
    expect(notebookOfItem(makeNote({ id: uuid(2), seedOrigin: 'seed', sourceId: 'equipment' }))).toBe('notebook/equipment');
    expect(notebookOfItem(makeNote({ id: uuid(3), seedOrigin: 'seed', sourceId: 'dashboards' }))).toBe('notebook/dashboards');
    // Typed sourceless dashboards (post-repair vault rows) land in the same notebook.
    expect(notebookOfItem(makeNote({ id: uuid(4), seedOrigin: 'user', type: 'dashboard' }))).toBe('notebook/dashboards');
  });

  it('orders fallbacks: notebookId, then the notebook tag, then the corpus path, then the source-id prefix', () => {
    const conflicting = {
      id: uuid(1),
      seedOrigin: 'seed' as const,
      sourceId: 'collection:girls/fran',
      sourcePath: 'markdown/efforts/bodyweight/air-squat.md',
    };
    expect(notebookOfItem({ ...conflicting, notebookId: 'notebook/open-prep', tags: ['notebook:mine'] })).toBe('notebook/open-prep');
    expect(notebookOfItem({ ...conflicting, tags: ['notebook:mine'] })).toBe('notebook/mine');
    // Corpus path outranks the source-id prefix…
    expect(notebookOfItem(conflicting)).toBe('notebook/efforts');
    // …and agrees with it whenever both describe the same corpus note.
    expect(notebookOfItem({ id: uuid(2), sourceId: 'efforts', sourcePath: 'markdown/efforts/bodyweight/air-squat.md' })).toBe('notebook/efforts');
    expect(notebookOfItem({ id: uuid(3), sourceId: 'collection:girls/fran', sourcePath: 'markdown/collections/girls/fran.md' })).toBe('notebook/girls');
    expect(notebookOfItem({ id: uuid(4), sourceId: 'guides:guide/clock', sourcePath: 'markdown/canvas/guide/clock.md' })).toBe('notebook/guides');
    expect(notebookOfItem({ id: uuid(5), sourceId: 'dashboards', sourcePath: 'markdown/dashboards/benchmark-pr-board.md' })).toBe('notebook/dashboards');
    expect(notebookOfItem({ id: uuid(6), sourceId: 'collection:_root', sourcePath: 'markdown/collections/README.md' })).toBeUndefined();
  });

  it('keeps today\'s resolutions stable: journal, playground, feed ids, guides, and the journal predicate', () => {
    expect(notebookOfItem(makeNote({ id: uuid(1), seedOrigin: 'user' }))).toBe('notebook/journal');
    expect(notebookOfItem(makeNote({ id: 'playground/legacy-draft', seedOrigin: 'user' }))).toBe('notebook/playground');
    expect(notebookOfItem(makeNote({ id: uuid(2), seedOrigin: 'seed', sourceId: 'feed:feeds/community/2024-01-01/post' }))).toBe('notebook/community');
    expect(notebookOfItem(makeNote({ id: uuid(3), seedOrigin: 'seed', sourceId: 'guides:guide/clock' }))).toBe('notebook/guides');
    // Corpus notes never journal — the corpus path and the sourceId literal
    // both exclude them from the journal fallback.
    for (const item of [
      makeNote({ id: uuid(4), seedOrigin: 'seed', sourceId: 'efforts', sourcePath: 'markdown/efforts/bodyweight/air-squat.md' }),
      makeNote({ id: uuid(5), seedOrigin: 'seed', sourcePath: 'markdown/equipment/air-bike.md' }),
      makeNote({ id: uuid(6), seedOrigin: 'user', type: 'dashboard' }),
    ]) {
      expect(sourceMatches(item, 'journal')).toBe(false);
    }
    expect(sourceMatches(makeNote({ id: uuid(7), seedOrigin: 'user' }), 'journal')).toBe(true);
  });

  it('keeps the journal predicate resolver-exact: user-notebook notes never journal', () => {
    // An explicit notebookId and the notebook: tag convention both outrank
    // the journal fallback — the note resolves to its notebook, never journal.
    const openPrep = makeNote({ id: uuid(1), seedOrigin: 'user', notebookId: 'notebook/open-prep' });
    const tagged = makeNote({ id: uuid(2), seedOrigin: 'user', tags: ['notebook:mine'] });
    expect(notebookOfItem(openPrep)).toBe('notebook/open-prep');
    expect(notebookOfItem(tagged)).toBe('notebook/mine');
    expect(sourceMatches(openPrep, 'journal')).toBe(false);
    expect(sourceMatches(tagged, 'journal')).toBe(false);
    // Ordinary journal notes remain journal on both answer forms.
    const plain = makeNote({ id: uuid(3), seedOrigin: 'user' });
    expect(notebookOfItem(plain)).toBe('notebook/journal');
    expect(sourceMatches(plain, 'journal')).toBe(true);
    // The `source:journal` predicate IS the resolver's journal answer.
    for (const n of [openPrep, tagged, plain]) {
      expect(sourceMatches(n, 'journal')).toBe(notebookOfItem(n) === 'notebook/journal');
    }
  });

  it('surfaces corpus notebooks through the WQL notebook: filter', async () => {
    const notes: Note[] = [
      makeNote({ id: 'effort-1', title: 'Air Squat', seedOrigin: 'seed', sourceId: 'efforts', sourcePath: 'markdown/efforts/bodyweight/air-squat.md' }),
      makeNote({ id: 'dash-1', title: 'PR Board', seedOrigin: 'seed', type: 'dashboard', sourceId: 'dashboards', sourcePath: 'markdown/dashboards/benchmark-pr-board.md' }),
      makeNote({ id: uuid(1), title: 'Morning Log', seedOrigin: 'user' }),
    ];
    const service = new QueryService({
      noteStore: {
        getAllNotes: async () => notes,
        getNoteIdsForTag: async () => new Set<string>(),
        getNoteTagLabels: async () => [],
      },
      blockStore: { getAllBlocks: async () => [] as BlockIndexRow[] },
    });
    const efforts = await service.runFind(parseQuery(':note{notebook:efforts}') as Parameters<typeof service.runFind>[0]);
    expect(efforts.notes.map((n) => n.id)).toEqual(['effort-1']);
    const dashboards = await service.runFind(parseQuery(':note{notebook:dashboards}') as Parameters<typeof service.runFind>[0]);
    expect(dashboards.notes.map((n) => n.id)).toEqual(['dash-1']);
    const journal = await service.runFind(parseQuery(':note{notebook:journal}') as Parameters<typeof service.runFind>[0]);
    expect(journal.notes.map((n) => n.id)).toEqual([uuid(1)]);
  });
});
