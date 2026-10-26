import { describe, expect, it, beforeEach } from 'bun:test';
import { NotebookService, DEFAULTS_NOTEBOOK_ID } from './NotebookService';
import { StorageService } from './storage/StorageService';
import { InMemoryStorage } from './storage/InMemoryStorage';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import type { Note } from '@bitcobblers/wod-wiki-core';

describe('NotebookService (notes-store backed)', () => {
    let service: NotebookService;
    let store: StorageService;

    beforeEach(() => {
        store = new StorageService(new InMemoryStorage());
        service = new NotebookService(store);
    });

    const saved = async (note: Partial<Note> & { id: string }): Promise<void> => {
        const rawContent = note.rawContent ?? '';
        await store.saveNote({
            title: note.id, sourceRevision: 1, createdAt: 1, ...note,
            rawContent,
            blocks: reconcileNoteBlocks(rawContent, { sourceRevision: 1 }),
        } as Note);
    };

    it('ensureNotebooks seeds the defaults notebook with a starter note, idempotently', async () => {
        await service.ensureNotebooks();
        await service.ensureNotebooks();

        const landing = await store.getNote(DEFAULTS_NOTEBOOK_ID);
        expect(landing?.title).toBe('Defaults');
        expect(landing?.notebookId).toBe(DEFAULTS_NOTEBOOK_ID);

        const starters = await service.listNotes(DEFAULTS_NOTEBOOK_ID);
        expect(starters).toHaveLength(1);
        expect(starters[0]!.type).toBe('note');
        expect(starters[0]!.seedOrigin).toBe('user');
    });

    it('migrates retired template notes into defaults as ordinary notes', async () => {
        await saved({ id: 'tpl-1', type: 'template', title: 'Benchmark day' });
        await service.ensureNotebooks();

        const migrated = await store.getNote('tpl-1');
        expect(migrated?.type).toBe('note');
        expect(migrated?.notebookId).toBe(DEFAULTS_NOTEBOOK_ID);
        expect(migrated?.title).toBe('Benchmark day');
    });

    it('creates a notebook as a landing note and reads it back', async () => {
        const nb = await service.create('Open Prep', 'Metcons for the Open', '🔥');
        expect(nb.slug).toBe('open-prep');
        expect(nb.id).toBe('notebook/open-prep');

        const stored = await store.getNote('notebook/open-prep');
        expect(stored?.notebookId).toBe('notebook/open-prep');
        expect(stored?.title).toBe('Open Prep');

        expect((await service.getAll()).map((n) => n.id)).toEqual(['notebook/open-prep']);
        expect((await service.getById('open-prep'))?.description).toBe('Metcons for the Open');
        expect((await service.getById('notebook/open-prep'))?.icon).toBe('🔥');
    });

    it('never reuses default notebook slugs', async () => {
        const nb = await service.create('Journal');
        expect(nb.slug).toBe('journal-2');
    });

    it('renames and redescribes through the landing note', async () => {
        const nb = await service.create('Old Name', 'old', '📓');
        const updated = await service.update(nb.id, { name: 'New Name', description: 'new', icon: '⭐' });
        expect(updated.name).toBe('New Name');

        const reread = await service.getById(nb.id);
        expect(reread?.description).toBe('new');
        expect(reread?.icon).toBe('⭐');

        const stored = await store.getNote(nb.id);
        expect(stored?.title).toBe('New Name');
        expect(stored?.rawContent).toContain('description: new');
    });

    it('deleting a notebook returns its notes to the journal', async () => {
        const nb = await service.create('Season 2026');
        await saved({ id: 'w-1', notebookId: nb.id, title: 'Fran' });
        await service.delete(nb.id);

        expect(await store.getNote(nb.id)).toBeUndefined();
        expect(await service.getAll()).toEqual([]);
        const member = await store.getNote('w-1');
        expect(member?.notebookId).toBeUndefined();
        expect(member?.title).toBe('Fran');
    });

    it('moveNote retargets membership and refuses feed-delivered notebooks', async () => {
        const nb = await service.create('Trav');
        await saved({ id: 'w-2', title: 'Row 5k' });
        await service.moveNote('w-2', nb.id);
        expect((await store.getNote('w-2'))?.notebookId).toBe(nb.id);

        const feeds = service.getFeedNotebooks();
        expect(feeds.length).toBeGreaterThan(0);
        expect(service.moveNote('w-2', feeds[0]!.notebookId)).rejects.toThrow(/read-only/);

        await service.moveNote('w-2', null);
        expect((await store.getNote('w-2'))?.notebookId).toBeUndefined();
    });

    it('update and delete reject reserved always-present slugs at the service boundary', async () => {
        // Only defaults has a stored landing (journal/playground/guides are
        // resolver fallbacks) — the guard must fire regardless.
        await service.ensureNotebooks();
        for (const slug of ['journal', 'playground', 'defaults', 'guides']) {
            await expect(service.update(`notebook/${slug}`, { name: 'Hijacked' }))
                .rejects.toThrow(/always present/);
            await expect(service.delete(`notebook/${slug}`))
                .rejects.toThrow(/always present/);
        }
        // Nothing was renamed, deleted, or created.
        expect((await store.getNote(DEFAULTS_NOTEBOOK_ID))?.title).toBe('Defaults');
        for (const slug of ['journal', 'playground', 'guides']) {
            expect(await store.getNote(`notebook/${slug}`)).toBeUndefined();
        }
    });

    it('ensureNotebooks recreates the defaults landing independently, keeping other notebooks', async () => {
        const survivor = await service.create('Trip 2026');
        await service.ensureNotebooks();
        // Only the defaults landing is deleted — the user notebook survives.
        await store.deleteNote(DEFAULTS_NOTEBOOK_ID);
        expect(await store.getNote(DEFAULTS_NOTEBOOK_ID)).toBeUndefined();

        await service.ensureNotebooks();

        const restored = await store.getNote(DEFAULTS_NOTEBOOK_ID);
        expect(restored?.title).toBe('Defaults');
        expect(restored?.notebookId).toBe(DEFAULTS_NOTEBOOK_ID);
        // The survivor is neither duplicated nor touched; the restored
        // defaults landing joins the list (creation order: survivor first).
        expect((await service.getAll()).map((n) => n.id)).toEqual(['notebook/trip-2026', DEFAULTS_NOTEBOOK_ID]);
        expect(await store.getNote(survivor.id)).toBeDefined();
    });

    it('cloneNote copies content into a user notebook, editable, with source lineage', async () => {
        // A feed-delivered original: read-only where it lives.
        const rawContent = '# Fran\n\n```time\n21-15-9 Thrusters\n```\n';
        await store.saveNoteSource({
            noteId: 'fran',
            rawContent,
            blocks: reconcileNoteBlocks(rawContent, { sourceRevision: 1 }),
            expectedSourceRevision: 0,
            metadata: { title: 'Fran', type: 'note', sourceId: 'collection:crossfit-girls/fran' },
        });
        const original = await store.getNote('fran');
        await store.saveNote({
            ...original,
            catalog: 'crossfit-girls',
            seedOrigin: 'seed',
            seedChunkId: 'collection.crossfit-girls',
            feedOrigin: 'feed',
            feedSourceId: 'seed-crossfit',
        } as Note);
        const nb = await service.create('My Benchmarks');
        const clone = await service.cloneNote('fran', nb.id, 'Fran (scaled)');

        expect(clone.id).not.toBe('fran');
        expect(clone.notebookId).toBe(nb.id);
        expect(clone.sourceId).toBe('fran');
        expect(clone.seedOrigin).toBe('user');
        expect(clone.feedOrigin).toBeUndefined();
        expect(clone.rawContent).toContain('21-15-9');

        const members = await service.listNotes(nb.id);
        expect(members.map((n) => n.id)).toEqual([clone.id]);
    });
});
