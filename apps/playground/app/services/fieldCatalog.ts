/**
 * App adapter — IFieldCatalog over the V17 IndexedDB catalog stores
 * (wayfinder datadog-analytics ticket 15). Every lookup is a bounded index
 * read; no events/results store is ever touched. Change notification is a
 * simple listener registry that the catalog-mutating seams signal after
 * commit (typeahead re-queries without reload).
 */

import type {
    CatalogFieldSuggestion,
    CatalogValueSuggestion,
    IFieldCatalog,
} from '@bitcobblers/wod-wiki-wql';
import type { FieldCatalogEntry } from '@/types/storage';
import { storage, type IStorage } from '@/services/storage';
import {
    applyCatalogSourceContributions,
    extractContributionsFromEventRows,
    extractContributionsFromNote,
    fieldSourceId,
    notifyFieldCatalogChanged,
    onFieldCatalogChanged,
} from '@/services/catalog/fieldCatalog';

const BACKFILL_REVISION = 1;
const BACKFILL_CHUNK_SIZE = 50;

function entryToSuggestion(entry: FieldCatalogEntry): CatalogFieldSuggestion {
    return {
        id: entry.id,
        path: entry.path,
        kind: entry.kind,
        ...(entry.dimension ? { dimension: entry.dimension } : {}),
        units: Object.keys(entry.units ?? {}),
        spellings: Object.keys(entry.spellings ?? {}),
    };
}

export class IndexedDbFieldCatalog implements IFieldCatalog {
    private readonly listeners = new Set<() => void>();
    private readonly unsubscribeGlobal: () => void;

    constructor(private readonly storageInstance: IStorage = storage) {
        this.unsubscribeGlobal = onFieldCatalogChanged(() => this.notifyChanged());
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    dispose(): void {
        this.unsubscribeGlobal();
        this.listeners.clear();
    }

    async listByPrefix(prefix: string, limit = 20): Promise<CatalogFieldSuggestion[]> {
        const range = prefix && typeof IDBKeyRange !== 'undefined'
            ? IDBKeyRange.bound(prefix, `${prefix}\uFFFF`, false, true)
            : undefined;
        const entries = await this.storageInstance.readonly('field_catalog').getAllFromIndex('by-path', range, limit);
        if (prefix && !range) {
            return entries
                .filter((e) => e.path.startsWith(prefix))
                .slice(0, limit)
                .map(entryToSuggestion);
        }
        return entries.map(entryToSuggestion);
    }

    async lookup(path: string): Promise<CatalogFieldSuggestion[]> {
        const entries = await this.storageInstance.readonly('field_catalog').getAllFromIndex('by-path', path);
        return entries.map(entryToSuggestion);
    }

    async listValues(path: string, valuePrefix: string, limit = 20): Promise<CatalogValueSuggestion[]> {
        const variants = await this.lookup(path);
        const lowerPrefix = valuePrefix.toLowerCase();
        const out: CatalogValueSuggestion[] = [];
        for (const variant of variants) {
            if (out.length >= limit) break;
            const records = await this.storageInstance.readonly('field_values').getAllFromIndex('by-field', variant.id);
            for (const record of records) {
                if (out.length >= limit) break;
                if (!lowerPrefix || record.value.toLowerCase().startsWith(lowerPrefix)) {
                    out.push({ fieldId: record.fieldId, value: record.value });
                }
            }
        }
        return out;
    }

    notifyChanged(): void {
        for (const listener of this.listeners) listener();
    }

    observeStore(_store?: unknown): void {
        // Post-commit notifications arrive via onFieldCatalogChanged from StorageService.
    }
}

export const fieldCatalog = new IndexedDbFieldCatalog(storage);

const inFlightBackfills = new WeakMap<IStorage, Promise<void>>();

/**
 * Resumable background backfill of `field_catalog*` from existing `notes` and
 * `events` rows (zero DB schema migration). Idempotent once
 * `field_catalog_meta` records `status: 'complete'` at `BACKFILL_REVISION`.
 */
export function startFieldCatalogBackfill(storageInstance: IStorage = storage): Promise<void> {
    const existing = inFlightBackfills.get(storageInstance);
    if (existing) return existing;

    const run = (async () => {
        try {
            const meta = await storageInstance.readonly('field_catalog_meta').get('backfill');
            if (meta?.status === 'complete' && meta.revision >= BACKFILL_REVISION) {
                return;
            }

            const cursor = { ...(meta?.cursor ?? {}) };
            await storageInstance.transaction(['field_catalog_meta'], 'readwrite', async (tx) => {
                await tx.readwrite('field_catalog_meta').put({
                    id: 'backfill',
                    status: 'initializing',
                    cursor: { ...cursor },
                    revision: BACKFILL_REVISION,
                    updatedAt: Date.now(),
                });
            });

            let anyChanged = false;

            // 1. Backfill notes frontmatter contributions in bounded chunks
            const allNotes = (await storageInstance.readonly('notes').getAll())
                .sort((a, b) => a.id.localeCompare(b.id));
            const remainingNotes = cursor.notes
                ? allNotes.filter((n) => n.id > cursor.notes!)
                : allNotes;

            for (let i = 0; i < remainingNotes.length; i += BACKFILL_CHUNK_SIZE) {
                const chunk = remainingNotes.slice(i, i + BACKFILL_CHUNK_SIZE);
                await storageInstance.transaction(
                    ['field_catalog', 'field_sources', 'field_values', 'field_catalog_meta'],
                    'readwrite',
                    async (tx) => {
                        for (const note of chunk) {
                            const changed = await applyCatalogSourceContributions(
                                tx,
                                fieldSourceId('note', note.id),
                                extractContributionsFromNote(note),
                                note.createdAt || Date.now(),
                            );
                            if (changed) anyChanged = true;
                        }
                        cursor.notes = chunk[chunk.length - 1]!.id;
                        await tx.readwrite('field_catalog_meta').put({
                            id: 'backfill',
                            status: 'initializing',
                            cursor: { ...cursor },
                            revision: BACKFILL_REVISION,
                            updatedAt: Date.now(),
                        });
                    },
                );
            }

            // 2. Backfill persisted events grouped by resultId in bounded chunks
            const allEvents = await storageInstance.readonly('events').getAll();
            const byResult = new Map<string, typeof allEvents>();
            for (const ev of allEvents) {
                if (!ev.resultId) continue;
                const list = byResult.get(ev.resultId);
                if (list) list.push(ev);
                else byResult.set(ev.resultId, [ev]);
            }
            const sortedResults = [...byResult.keys()].sort();
            const remainingResults = cursor.results
                ? sortedResults.filter((id) => id > cursor.results!)
                : sortedResults;

            for (let i = 0; i < remainingResults.length; i += BACKFILL_CHUNK_SIZE) {
                const chunkIds = remainingResults.slice(i, i + BACKFILL_CHUNK_SIZE);
                await storageInstance.transaction(
                    ['field_catalog', 'field_sources', 'field_values', 'field_catalog_meta'],
                    'readwrite',
                    async (tx) => {
                        for (const resultId of chunkIds) {
                            const rows = byResult.get(resultId) ?? [];
                            const changed = await applyCatalogSourceContributions(
                                tx,
                                fieldSourceId('result', resultId),
                                extractContributionsFromEventRows(rows),
                            );
                            if (changed) anyChanged = true;
                        }
                        cursor.results = chunkIds[chunkIds.length - 1]!;
                        await tx.readwrite('field_catalog_meta').put({
                            id: 'backfill',
                            status: 'initializing',
                            cursor: { ...cursor },
                            revision: BACKFILL_REVISION,
                            updatedAt: Date.now(),
                        });
                    },
                );
            }

            await storageInstance.transaction(['field_catalog_meta'], 'readwrite', async (tx) => {
                await tx.readwrite('field_catalog_meta').put({
                    id: 'backfill',
                    status: 'complete',
                    cursor,
                    revision: BACKFILL_REVISION,
                    updatedAt: Date.now(),
                });
            });

            if (anyChanged) {
                notifyFieldCatalogChanged();
            }
        } finally {
            inFlightBackfills.delete(storageInstance);
        }
    })();

    inFlightBackfills.set(storageInstance, run);
    return run;
}
