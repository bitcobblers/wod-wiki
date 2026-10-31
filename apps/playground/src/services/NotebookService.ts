/**
 * NotebookService — CRUD for user notebooks over the notes store (ticket 05).
 *
 * A user notebook IS a landing note: id `notebook/{slug}`, `notebookId` set,
 * title = name, and a frontmatter block carrying `description` and `icon`.
 * Membership rides the note's own `notebookId` — the same field
 * `notebookOfItem` resolves — so a moved or cloned note is reachable through
 * the WQL notebook plane with no side registry. The former
 * localStorage/`wodwiki:notebooks` registry is retired: notebook definitions
 * now live where the notes live, and `ensureNotebooks` migrates both the
 * old registry rows' shape (nothing — user notebooks were never persisted
 * per note) and the retired `template` note kind into `notebook/defaults`.
 */

import { v7 as uuidv7 } from 'uuid';
import type { Note } from '@bitcobblers/wod-wiki-core';
import { BUILTIN_NOTEBOOKS, reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { notebookSlugFromId, slugifyNotebookName, toNotebookId, type Notebook } from '@/types/notebook';
import { StorageService } from './storage/StorageService';
import { storageService } from './storage';
import { listNotebooks } from './feed/feedSources';

/** The always-present starter-notes notebook (`DEFAULT_NOTEBOOK_SLUGS`). */
export const DEFAULTS_NOTEBOOK_ID = 'notebook/defaults';

/** Always-present notebook slugs (app-owned; user CRUD is refused). */
const RESERVED_SLUGS: ReadonlySet<string> = new Set(BUILTIN_NOTEBOOKS.map((n) => n.slug));
export class NotebookService {
    constructor(private store: StorageService = storageService) {}

    // Invariant: mutations are serialized — an op reads committed state only after the previous op's save landed.
    private tail: Promise<unknown> = Promise.resolve();

    private enqueue<T>(op: () => Promise<T>): Promise<T> {
        const run = this.tail.then(op, op);
        this.tail = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    /** All notebooks the feeds publish (registry + custom feed entries). */
    getFeedNotebooks(): Notebook[] {
        const out: Notebook[] = [];
        for (const notebook of listNotebooks()) {
            if (notebook.category === 'dashboards') continue;
            const slug = notebook.chunkId.replace(/^notebook\./, '');
            out.push({
                id: toNotebookId(slug),
                slug,
                notebookId: toNotebookId(slug),
                name: notebook.label,
                description: notebook.description,
                icon: notebook.category === 'feeds' ? '📡' : '📚',
                origin: 'feed',
                feedEntryId: notebook.feedId,
                seedChunkId: notebook.chunkId,
                createdAt: 0,
            });
        }
        return out;
    }

    /**
     * The always-present notebooks: journal, playground, `defaults` (user-
     * owned and writable), the feed-delivered `guides`, and the app-owned
     * core references (efforts, equipment, dashboards) delivered by the core
     * seed.
     */
    getDefaultNotebooks(): Notebook[] {
        return BUILTIN_NOTEBOOKS.map((spec) => ({
            id: spec.notebookId,
            slug: spec.slug,
            notebookId: spec.notebookId,
            name: spec.name,
            description: spec.description,
            icon: spec.icon,
            origin: 'default',
            ...(spec.feedEntryId ? { feedEntryId: spec.feedEntryId } : {}),
            ...(spec.seedChunkId ? { seedChunkId: spec.seedChunkId } : {}),
            createdAt: 0,
        }));
    }
    /** All notebooks across defaults, user-created, and feed-delivered sources. */
    async getAllNotebooks(): Promise<Notebook[]> {
        const byNotebookId = new Map<string, Notebook>();
        for (const nb of [...this.getDefaultNotebooks(), ...this.getFeedNotebooks(), ...(await this.getAll())]) {
            byNotebookId.set(nb.notebookId, nb);
        }
        return [...byNotebookId.values()];
    }

    /** The user's own notebooks — one landing note each, registry order = creation. */
    async getAll(): Promise<Notebook[]> {
        const notes = await this.store.getAllNotes();
        const landings = notes.filter(isNotebookLanding);
        const landingSlugs = new Set(landings.map((n) => n.id.slice('notebook/'.length)));
        const userNotebooks = landings.map(landingToNotebook);

        for (const note of notes) {
            if (note.notebookId?.startsWith('notebook/')) {
                const slug = note.notebookId.slice('notebook/'.length);
                if (slug && !RESERVED_SLUGS.has(slug) && !landingSlugs.has(slug)) {
                    landingSlugs.add(slug);
                    userNotebooks.push({
                        id: note.notebookId,
                        slug,
                        notebookId: toNotebookId(slug),
                        name: slug,
                        description: '',
                        icon: '📓',
                        origin: 'user',
                        createdAt: note.createdAt,
                    });
                }
            }
        }

        return userNotebooks.sort((a, b) => a.createdAt - b.createdAt);
    }

    async getById(id: string): Promise<Notebook | null> {
        const notebookId = toNotebookId(id);
        const note = await this.store.getNote(notebookId);
        return note && isNotebookLanding(note) ? landingToNotebook(note) : null;
    }

    /** Creates the notebook and its landing note. */
    create(name: string, description = '', icon = '📓'): Promise<Notebook> {
        return this.enqueue(() => this.createNow(name, description, icon));
    }

    private async createNow(name: string, description: string, icon: string): Promise<Notebook> {
        const existing = await this.getAll();
        const baseSlug = slugifyNotebookName(name);
        const taken = new Set([...RESERVED_SLUGS, ...existing.map((n) => n.slug)]);
        let slug = baseSlug;
        for (let i = 2; taken.has(slug); i++) {
            slug = `${baseSlug}-${i}`;
        }
        const canonicalId = toNotebookId(slug);
        const note = await this.saveLanding(canonicalId, name, description, icon);
        return landingToNotebook(note);
    }

    /** Writes a landing note's content through the guarded source save (block
     *  pins + index) and stamps the notebook's own fields on the row. */
    private async saveLanding(notebookId: string, name: string, description: string, icon: string, expectedSourceRevision?: number): Promise<Note> {
        const rawContent = landingRawContent(name, description, icon);
        const saved = await this.store.saveNoteSource({
            noteId: notebookId,
            rawContent,
            blocks: reconcileNoteBlocks(rawContent, { sourceRevision: expectedSourceRevision || 1 }),
            expectedSourceRevision: expectedSourceRevision ?? 0,
            metadata: { title: name },
        });
        const stamped: Note = { ...saved, notebookId, type: 'note' };
        if (expectedSourceRevision === undefined) stamped.createdAt = Date.now();
        await this.store.saveNote(stamped);
        return stamped;
    }

    /** Renames / redescribes / re-icons a user notebook via its landing note.
     *  Reserved always-present slugs are refused at the service boundary. */
    update(id: string, patch: Partial<Pick<Notebook, 'name' | 'description' | 'icon'>>): Promise<Notebook> {
        return this.enqueue(async () => {
            const notebookId = toNotebookId(id);
            assertUserNotebook(notebookId);
            const note = await this.store.getNote(notebookId);
            if (!note || !isNotebookLanding(note)) throw new Error(`Notebook not found: ${id}`);
            const meta = readLandingMeta(note);
            const next = await this.saveLanding(
                note.id,
                patch.name ?? note.title,
                patch.description ?? meta.description,
                patch.icon ?? meta.icon,
                note.sourceRevision,
            );
            return landingToNotebook(next);
        });
    }

    /** Deletes a user notebook. Member notes are not lost — they return to
     *  the journal (their `notebookId` clears, the resolver's fallback).
     *  Reserved always-present slugs are refused at the service boundary. */
    delete(id: string): Promise<void> {
        return this.enqueue(async () => {
            const notebookId = toNotebookId(id);
            assertUserNotebook(notebookId);
            const members = await this.listNotes(notebookId);
            for (const note of members) {
                const { notebookId: _dropped, ...rest } = note;
                await this.store.saveNote(rest);
            }
            await this.store.deleteNote(notebookId);
        });
    }

    /** Notes currently inside a notebook. */
    async listNotes(notebookId: string): Promise<Note[]> {
        const wanted = toNotebookId(notebookId);
        const notes = await this.store.getAllNotes();
        return notes.filter((n) => n.notebookId === wanted && !isNotebookLanding(n));
    }

    /** Moves a note into a user-owned notebook; `null` returns it to the
     *  journal. Moving INTO a feed-delivered notebook is refused — those are
     *  read-only (editability follows notebook ownership). */
    moveNote(noteId: string, notebookId: string | null): Promise<void> {
        return this.enqueue(async () => {
            const note = await this.store.getNote(noteId);
            if (!note) throw new Error(`Note not found: ${noteId}`);
            if (notebookId === null) {
                const { notebookId: _dropped, ...rest } = note;
                await this.store.saveNote(rest);
                return;
            }
            const target = toNotebookId(notebookId);
            if (this.getFeedNotebooks().some((nb) => nb.notebookId === target)) {
                throw new Error(`Notebook ${target} is feed-delivered and read-only.`);
            }
            await this.store.saveNote({ ...note, notebookId: target });
        });
    }

    /** Clones a note into a user-owned notebook: a new note with the source's
     *  content, `sourceId` lineage to the original (the feed identity when
     *  cloned from a feed notebook), and no delivery stamps — the copy is
     *  user-owned, so it is editable even though the original is not. */
    cloneNote(sourceId: string, targetNotebookId: string, title?: string): Promise<Note> {
        return this.enqueue(async () => {
            const source = await this.store.getNote(sourceId);
            if (!source) throw new Error(`Note not found: ${sourceId}`);
            const rawContent = source.rawContent;
            const clone = await this.store.saveNoteSource({
                noteId: uuidv7(),
                rawContent,
                blocks: reconcileNoteBlocks(rawContent, { sourceRevision: 1 }),
                expectedSourceRevision: 0,
                createdAt: Date.now(),
                metadata: { title: title ?? source.title, type: 'note', sourceId: source.id, ...(source.tags?.length ? { tags: [...source.tags] } : {}) },
            });
            const stamped: Note = { ...clone, notebookId: toNotebookId(targetNotebookId), seedOrigin: 'user' };
            await this.store.saveNote(stamped);
            return stamped;
        });
    }

    /**
     * Boot-time notebook plane setup: the `defaults` landing note, its
     * starter notes, and the retired `template` note kind's rows — migrated
     * into `notebook/defaults` as ordinary notes. Idempotent; a failure must
     * not stop the boot (callers catch).
     */
    ensureNotebooks(): Promise<void> {
        return this.enqueue(async () => {
            const notes = await this.store.getAllNotes();
            // Each required default is restored independently: another user
            // landing note existing must not suppress the defaults landing.
            if (!notes.some((n) => isNotebookLanding(n) && n.id === DEFAULTS_NOTEBOOK_ID)) {
                await this.saveLanding(DEFAULTS_NOTEBOOK_ID, 'Defaults', 'Starter notes — clone any of them into your own notebooks.', '📝');
            }
            // Retired `template` note kind → starter notes in defaults.
            for (const note of notes) {
                if (note.type === 'template') {
                    await this.store.saveNote({ ...note, type: 'note', notebookId: note.notebookId ?? DEFAULTS_NOTEBOOK_ID });
                }
            }
            const defaults = await this.listNotes(DEFAULTS_NOTEBOOK_ID);
            if (defaults.length === 0) {
                // The starter note (the retired playground template content,
                // cursor slot stripped): an ordinary note any notebook can be
                // cloned from.
                const rawContent = '# My Workout\n\n```time\n10 Push-ups\n```\n';
                const starter = await this.store.saveNoteSource({
                    noteId: uuidv7(),
                    rawContent,
                    blocks: reconcileNoteBlocks(rawContent, { sourceRevision: 1 }),
                    expectedSourceRevision: 0,
                    createdAt: Date.now(),
                    metadata: { title: 'My Workout', type: 'note' },
                });
                await this.store.saveNote({ ...starter, notebookId: DEFAULTS_NOTEBOOK_ID, seedOrigin: 'user' });
            }
        });
    }
}

/** A user notebook's landing note: id `notebook/{slug}`, notebookId set. */
function isNotebookLanding(note: Note): boolean {
    return note.id.startsWith('notebook/') && note.notebookId === note.id;
}

/** The always-present notebooks are app-owned: user CRUD must not touch them,
 *  regardless of what a surface passes in (the service is the boundary). */
function assertUserNotebook(notebookId: string): void {
    if (RESERVED_SLUGS.has(notebookSlugFromId(notebookId))) {
        throw new Error(`Notebook ${notebookId} is always present and cannot be changed.`);
    }
}

function landingRawContent(name: string, description: string, icon: string): string {
    return `---\ndescription: ${description ? JSON.stringify(description.replace(/\n/g, ' ')) : ''}\nicon: ${icon ? JSON.stringify(icon.replace(/\n/g, ' ')) : ''}\n---\n\n# ${name}\n`;
}

function readLandingMeta(note: Note): { description: string; icon: string } {
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(note.rawContent);
    let description = '';
    let icon = '📓';
    const unquote = (value: string): string => {
        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
            try {
                return JSON.parse(value) as string;
            } catch {
                return value;
            }
        }
        return value;
    };
    if (block) {
        for (const line of block[1].split(/\r?\n/)) {
            const kv = line.match(/^(description|icon):\s*(.*)$/);
            if (!kv) continue;
            if (kv[1] === 'description') description = unquote(kv[2]!.trim());
            else icon = unquote(kv[2]!.trim()) || icon;
        }
    }
    return { description, icon };
}

function landingToNotebook(note: Note): Notebook {
    const { description, icon } = readLandingMeta(note);
    return {
        id: note.id,
        slug: note.id.slice('notebook/'.length),
        notebookId: toNotebookId(note.id),
        name: note.title,
        description,
        icon,
        origin: 'user',
        createdAt: note.createdAt,
    };
}

/** Singleton instance */
export const notebookService = new NotebookService();
