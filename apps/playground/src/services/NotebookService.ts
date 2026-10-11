/**
 * NotebookService — CRUD for notebooks.
 *
 * Notebooks are stored under `wodwiki:notebooks` as a JSON array — browser
 * localStorage locally, a `wodwiki:`-namespaced meta row in server mode.
 * The active notebook ID is stored under `wodwiki:active-notebook`.
 *
 * Entry membership is managed through the entry's `tags` array
 * using the `notebook:{id}` convention.
 */

import { v7 as uuidv7 } from 'uuid';
import type { Notebook } from '../types/notebook';
import { LocalStore } from './storage/LocalStore';
import { remotePrefsMode, metaPrefBackend, metaSetPref } from './storage/metaStore';

const NOTEBOOKS_KEY = 'notebooks';
const ACTIVE_KEY = 'active-notebook';

const DEFAULT_ICONS = ['📓', '🏋️', '🔥', '💪', '⭐', '🎯', '🏃', '🧘', '🥊', '🚴'];

export class NotebookService {
    constructor(private store: LocalStore = new LocalStore('wodwiki:', remotePrefsMode ? metaPrefBackend : undefined)) {}

    // Invariant: mutations are serialized — an op reads committed state only after the previous op's saveAll landed.
    private tail: Promise<unknown> = Promise.resolve();

    private enqueue<T>(op: () => Promise<T>): Promise<T> {
        const run = this.tail.then(op, op);
        this.tail = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    getAll(): Notebook[] {
        return this.store.get<Notebook[]>(NOTEBOOKS_KEY) ?? [];
    }

    getById(id: string): Notebook | null {
        return this.getAll().find(n => n.id === id) ?? null;
    }

    /** Persists the list before callers mutate shared state — a failed
     *  server write throws so the caller never reports success. */
    create(name: string, description = '', icon = '📓'): Promise<Notebook> {
        return this.enqueue(() => this.createNow(name, description, icon));
    }

    private async createNow(name: string, description: string, icon: string): Promise<Notebook> {
        const now = Date.now();
        const notebook: Notebook = {
            id: uuidv7(),
            name,
            description,
            icon,
            createdAt: now,
            lastEditedAt: now,
        };
        await this.saveAll([...this.getAll(), notebook]);
        return notebook;
    }

    update(id: string, patch: Partial<Pick<Notebook, 'name' | 'description' | 'icon'>>): Promise<Notebook> {
        return this.enqueue(async () => {
            const notebooks = this.getAll();
            const idx = notebooks.findIndex(n => n.id === id);
            if (idx === -1) throw new Error(`Notebook not found: ${id}`);
            const next = [...notebooks];
            next[idx] = { ...notebooks[idx], ...patch, lastEditedAt: Date.now() };
            await this.saveAll(next);
            return next[idx];
        });
    }

    delete(id: string): Promise<void> {
        return this.enqueue(async () => {
            const notebooks = this.getAll().filter(n => n.id !== id);
            await this.saveAll(notebooks);
            if (this.getActiveId() === id) {
                await this.setActiveIdNow(null);
            }
        });
    }

    /** Freshness-only write (last-edited ordering); callers fire-and-forget
     *  with a logged catch. */
    touchNotebook(id: string): Promise<void> {
        return this.enqueue(async () => {
            const notebooks = this.getAll();
            const idx = notebooks.findIndex(n => n.id === id);
            if (idx !== -1) {
                const next = [...notebooks];
                next[idx] = { ...notebooks[idx], lastEditedAt: Date.now() };
                await this.saveAll(next);
            }
        });
    }

    getActiveId(): string | null {
        return this.store.getRaw(ACTIVE_KEY);
    }

    setActiveId(id: string | null): Promise<void> {
        return this.enqueue(() => this.setActiveIdNow(id));
    }

    private async setActiveIdNow(id: string | null): Promise<void> {
        if (remotePrefsMode) {
            await metaSetPref(this.store.qualify(ACTIVE_KEY), id);
            return;
        }
        this.store.setRaw(ACTIVE_KEY, id);
    }

    /**
     * Returns the last-edited notebook, used for auto-selection on page load.
     */
    getLastEdited(): Notebook | null {
        const notebooks = this.getAll();
        if (notebooks.length === 0) return null;
        return notebooks.reduce((a, b) => (a.lastEditedAt >= b.lastEditedAt ? a : b));
    }

    /**
     * Ensures at least one notebook exists. Creates "My Workouts" if empty.
     * Returns the active notebook ID (resolved or newly created).
     */
    ensureDefault(): Promise<string> {
        return this.enqueue(() => this.ensureDefaultNow());
    }

    private async ensureDefaultNow(): Promise<string> {
        let notebooks = this.getAll();
        if (notebooks.length === 0) {
            const created = await this.createNow('My Workouts', 'Default workout notebook', '📓');
            await this.setActiveIdNow(created.id);
            return created.id;
        }

        // If there's a saved active ID that still exists, use it
        const activeId = this.getActiveId();
        if (activeId && notebooks.some(n => n.id === activeId)) {
            return activeId;
        }

        // Otherwise, auto-select the last edited
        const lastEdited = this.getLastEdited();
        if (lastEdited) {
            await this.setActiveIdNow(lastEdited.id);
            return lastEdited.id;
        }

        return notebooks[0].id;
    }

    /** Available icons for notebook creation */
    static readonly ICONS = DEFAULT_ICONS;

    private async saveAll(notebooks: Notebook[]): Promise<void> {
        if (remotePrefsMode) {
            await metaSetPref(this.store.qualify(NOTEBOOKS_KEY), JSON.stringify(notebooks));
            return;
        }
        this.store.set(NOTEBOOKS_KEY, notebooks);
    }
}

/** Singleton instance */
export const notebookService = new NotebookService();
