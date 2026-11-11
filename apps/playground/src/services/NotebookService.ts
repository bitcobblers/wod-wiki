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
import type { Note, NotebookId } from '@bitcobblers/wod-wiki-core';
import {
    BUILTIN_NOTEBOOKS,
    isSystemReadOnlyNotebook,
    reconcileNoteBlocks,
} from '@bitcobblers/wod-wiki-core';
import {
    buildNoteProvenance,
    getNoteNotebooks as engineGetNoteNotebooks,
    notebooksOfItem,
    promoteNoteToNotebooks as enginePromoteNote,
    removeNoteFromNotebook as engineRemoveFromNotebook,
    setNoteNotebooks as engineSetNoteNotebooks,
    type PromoteNoteResult,
} from '@bitcobblers/wod-wiki-engine';
import { notebookSlugFromId, slugifyNotebookName, toNotebookId, type Notebook } from '@/types/notebook';
import { StorageService } from './storage/StorageService';
import { storageService } from './storage';
import { listNotebooks } from './feed/feedSources';

/** Read-only base primitives notebook (`DEFAULT_NOTEBOOK_SLUGS`). */
export const DEFAULTS_NOTEBOOK_ID = 'notebook/defaults';
/** User overrides & custom definitions notebook (`DEFAULT_NOTEBOOK_SLUGS`). */
export const CUSTOM_NOTEBOOK_ID = 'notebook/custom';
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

    /** Deletes a user notebook. Member notes detach from this notebook while
     *  retaining `notebook/journal` and any other linked user notebooks.
     *  Reserved always-present slugs are refused at the service boundary. */
    delete(id: string): Promise<void> {
        return this.enqueue(async () => {
            const notebookId = toNotebookId(id);
            assertUserNotebook(notebookId);
            const members = await this.listNotes(notebookId);
            for (const note of members) {
                const remaining = (note.notebookIds ?? (note.notebookId ? [note.notebookId] : []))
                    .map((nb) => toNotebookId(nb))
                    .filter((nb) => nb !== notebookId);
                const primaryUser = remaining.find((nb) => nb !== 'notebook/journal' && nb !== 'notebook/playground');
                const { notebookId: _dropped, notebookIds: _droppedIds, ...rest } = note;
                await this.store.saveNote({
                    ...rest,
                    ...(remaining.length > 0 ? { notebookIds: remaining } : {}),
                    ...(primaryUser ? { notebookId: primaryUser } : {}),
                });
            }
            try {
                const links = await this.store.storage.readonly('notebook_links').getAllFromIndex('by-notebook', notebookId);
                for (const link of links) {
                    await this.store.storage.readwrite('notebook_links').delete(link.id);
                }
            } catch {
                // Optional index on mocks
            }
            await this.store.deleteNote(notebookId);
        });
    }

    /** Notes currently linked to a notebook (many-to-many). */
    async listNotes(notebookId: string): Promise<Note[]> {
        const wanted = toNotebookId(notebookId);
        const notes = await this.store.getAllNotes();
        let linkedIds = new Set<string>();
        try {
            const links = await this.store.storage.readonly('notebook_links').getAllFromIndex('by-notebook', wanted);
            linkedIds = new Set(links.filter((l) => l.targetKind === 'note').map((l) => l.noteId));
        } catch {
            // Optional index on mocks
        }
        return notes.filter(
            (n) => !isNotebookLanding(n) && (linkedIds.has(n.id) || n.notebookId === wanted || notebooksOfItem(n).includes(wanted)),
        );
    }

    /** Promotes a note (and optional attached sessions) to one or more user notebooks (many-to-many) while keeping it in `notebook/journal`. */
    promoteNote(
        noteId: string,
        notebookIds: readonly string[],
        options: { sessionIds?: readonly string[]; shareSessionsPublicly?: boolean } = {},
    ): Promise<PromoteNoteResult> {
        return this.enqueue(async () => {
            for (const raw of notebookIds) {
                const target = toNotebookId(raw);
                if (isSystemReadOnlyNotebook(target) || this.getFeedNotebooks().some((nb) => nb.notebookId === target)) {
                    throw new Error(`Notebook ${target} is read-only.`);
                }
            }
            return enginePromoteNote(this.store.storage, {
                noteId,
                notebookIds,
                sessionIds: options.sessionIds,
                shareSessionsPublicly: options.shareSessionsPublicly,
            });
        });
    }

    /** Replaces the set of promoted user notebooks for a note while keeping `notebook/journal`. */
    setNoteNotebooks(noteId: string, notebookIds: readonly string[]): Promise<NotebookId[]> {
        return this.enqueue(async () => {
            for (const raw of notebookIds) {
                const target = toNotebookId(raw);
                if (target === 'notebook/journal' || target === 'notebook/playground') continue;
                if (isSystemReadOnlyNotebook(target) || this.getFeedNotebooks().some((nb) => nb.notebookId === target)) {
                    throw new Error(`Notebook ${target} is read-only.`);
                }
            }
            return engineSetNoteNotebooks(this.store.storage, { noteId, notebookIds });
        });
    }

    removeNoteFromNotebook(noteId: string, notebookId: string): Promise<NotebookId[]> {
        return this.enqueue(() => engineRemoveFromNotebook(this.store.storage, noteId, notebookId));
    }

    getNoteNotebooks(noteId: string): Promise<NotebookId[]> {
        return engineGetNoteNotebooks(this.store.storage, noteId);
    }

    /** Moves/promotes a note into a user-owned notebook; `null` detaches user notebooks and leaves it in `notebook/journal`. */
    moveNote(noteId: string, notebookId: string | null): Promise<void> {
        return this.enqueue(async () => {
            const note = await this.store.getNote(noteId);
            if (!note) throw new Error(`Note not found: ${noteId}`);
            if (notebookId === null) {
                await engineSetNoteNotebooks(this.store.storage, { noteId, notebookIds: [] });
                return;
            }
            const target = toNotebookId(notebookId);
            if (isSystemReadOnlyNotebook(target) || this.getFeedNotebooks().some((nb) => nb.notebookId === target)) {
                throw new Error(`Notebook ${target} is feed-delivered or system read-only.`);
            }
            await engineSetNoteNotebooks(this.store.storage, { noteId, notebookIds: [target] });
        });
    }

    /** Clones a note into a user-owned notebook with full structured `provenance` back to the original Note. */
    cloneNote(sourceId: string, targetNotebookId: string, title?: string): Promise<Note> {
        return this.enqueue(async () => {
            const target = toNotebookId(targetNotebookId);
            if (isSystemReadOnlyNotebook(target) || this.getFeedNotebooks().some((nb) => nb.notebookId === target)) {
                throw new Error(`Notebook ${target} is read-only.`);
            }
            const source = await this.store.getNote(sourceId);
            if (!source) throw new Error(`Note not found: ${sourceId}`);
            const rawContent = source.rawContent;
            const now = Date.now();
            const sourceNb = notebooksOfItem(source)[0];
            const clone = await this.store.saveNoteSource({
                noteId: uuidv7(),
                rawContent,
                blocks: reconcileNoteBlocks(rawContent, { sourceRevision: 1 }),
                expectedSourceRevision: 0,
                createdAt: now,
                metadata: { title: title ?? source.title, type: 'note', sourceId: source.id, ...(source.tags?.length ? { tags: [...source.tags] } : {}) },
            });
            const stamped: Note = {
                ...clone,
                notebookId: target,
                notebookIds: target === 'notebook/journal' ? ['notebook/journal'] : ['notebook/journal', target],
                seedOrigin: 'user',
                provenance: buildNoteProvenance(source, sourceNb, now),
            };
            await this.store.saveNote(stamped);
            await enginePromoteNote(this.store.storage, {
                noteId: stamped.id,
                notebookIds: target === 'notebook/journal' ? ['notebook/journal'] : [target],
            });
            return (await this.store.getNote(stamped.id)) ?? stamped;
        });
    }

    /**
     * Boot-time notebook plane setup:
     * - `notebook/custom` landing note (user's writable overrides & starter notes),
     * - migrates retired `template` notes into `notebook/custom`,
     * - keeps `notebook/defaults` strictly read-only primitives (never mutating it with user starter workouts).
     */
    ensureNotebooks(): Promise<void> {
        return this.enqueue(async () => {
            const notes = await this.store.getAllNotes();
            if (!notes.some((n) => isNotebookLanding(n) && n.id === CUSTOM_NOTEBOOK_ID)) {
                await this.saveLanding(CUSTOM_NOTEBOOK_ID, 'Custom', 'User overrides and custom Tags, Efforts, Equipment, and starter workouts.', 'C');
            }
            for (const note of notes) {
                if (note.type === 'template') {
                    await this.store.saveNote({ ...note, type: 'note', notebookId: note.notebookId ?? CUSTOM_NOTEBOOK_ID });
                }
            }
            const customNotes = await this.listNotes(CUSTOM_NOTEBOOK_ID);
            if (customNotes.length === 0) {
                const rawContent = '# My Workout\n\n```time\n10 Push-ups\n```\n';
                const starter = await this.store.saveNoteSource({
                    noteId: uuidv7(),
                    rawContent,
                    blocks: reconcileNoteBlocks(rawContent, { sourceRevision: 1 }),
                    expectedSourceRevision: 0,
                    createdAt: Date.now(),
                    metadata: { title: 'My Workout', type: 'note' },
                });
                await this.store.saveNote({
                    ...starter,
                    notebookId: CUSTOM_NOTEBOOK_ID,
                    notebookIds: ['notebook/journal', CUSTOM_NOTEBOOK_ID],
                    seedOrigin: 'user',
                });
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
