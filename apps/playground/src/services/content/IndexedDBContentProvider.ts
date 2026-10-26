import { v7 as uuidv7 } from 'uuid';
import { formatPlaygroundTimestampId } from '../../lib/playgroundDisplay';
import type { AttachmentCreateInput, IContentProvider, ContentProviderMode, NoteSaveInput, NoteEntryPatch } from '../../types/content-provider';
import type { HistoryEntry, EntryQuery, ProviderCapabilities } from '../../types/history';
import { storageService, type StorageService } from '@/services/storage';
import type { Attachment, Page, Session } from '../../types/storage';
import { parseDocumentSections, reconcileNoteBlocks, KNOWN_SECTION_WIDGETS, projectPlacements, resolvePlacements, type PageTarget } from '@bitcobblers/wod-wiki-core';
import { extractTypedFrontmatterTags } from '../../lib/frontmatter';
import { toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import type { DomainEntry, DomainPredicate } from '@bitcobblers/wod-wiki-storage';
import { sessionToPayload } from '../persistence/sessionPayload';
import { NotePersistenceError } from '../persistence/types';
import { localDateKey } from '@/lib/dateFormat';

const BLOCK_OPTIONS = { registeredWidgets: KNOWN_SECTION_WIDGETS };
const MUTATION_STORES = ['notes', 'block_revisions', 'page', 'page_notes', 'tags', 'note_tags', 'tag_types', 'sessions', 'events', 'block_index', 'block_efforts', 'block_equipment', 'efforts', 'equipment'] as const;

function entryFromDomainRow(row: DomainEntry): HistoryEntry {
    // Every page the note sits on — the membership itself. The single-page
    // fields below are deterministic projections of this list.
    const placements = resolvePlacements(row.links, row.pages);
    const projection = projectPlacements(placements);
    return {
        id: row.note.id, title: row.note.title, slug: projection.pageSlug, pageId: projection.pageId,
        journalDate: projection.journalDate, placements,
        createdAt: row.note.createdAt, updatedAt: row.note.createdAt,
        targetDate: row.note.date ?? row.note.createdAt,
        rawContent: row.note.rawContent, blocks: row.note.blocks, sourceRevision: row.note.sourceRevision,
        tags: row.tags.map(tag => tag.label), type: row.note.type ?? 'note',
        sourceId: row.note.sourceId, catalog: row.note.catalog, notebookId: row.note.notebookId,
        seedOrigin: row.note.seedOrigin, schemaVersion: 1,
    };
}

function entryDateWindow(query?: EntryQuery): { start: number; end: number } | undefined {
    if (query?.dateRange) return query.dateRange;
    if (query?.daysBack != null) {
        const end = Date.now();
        return { start: end - query.daysBack * 86_400_000, end };
    }
    return undefined;
}

export class IndexedDBContentProvider implements IContentProvider {
    constructor(private readonly db: StorageService = storageService) {}
    get persistenceStorage(): StorageService { return this.db; }
    readonly mode: ContentProviderMode = 'history';
    readonly capabilities: ProviderCapabilities = {
        canWrite: true, canDelete: true, canFilter: true, canMultiSelect: true, supportsHistory: true,
    };

    async getEntries(query?: EntryQuery): Promise<HistoryEntry[]> {
        const window = entryDateWindow(query);
        const selection: DomainPredicate[] = [];
        if (window) selection.push({ field: 'date', start: window.start, end: window.end });
        for (const tag of query?.tags ?? []) selection.push({ field: 'tags', values: [tag] });
        const result = await this.db.queryDomain(selection.length ? { plan: 'entries', selection } : { plan: 'entries' });
        let entries: HistoryEntry[];
        if (result?.plan === 'entries') entries = result.rows.map(entryFromDomainRow);
        else {
            const candidates = window ? await this.db.getNotesByDateRange(window.start, window.end) : await this.db.getAllNotes();
            const bundles = await this.db.getEntryBatches(candidates.map(note => note.id));
            entries = [...bundles.values()].map(entryFromDomainRow);
        }
        entries = entries.filter(entry => (!window || entry.targetDate >= window.start && entry.targetDate <= window.end)
            && (query?.tags ?? []).every(tag => entry.tags.includes(tag)));
        return entries.sort((a, b) => b.targetDate - a.targetDate);
    }

    async getEntry(id: string): Promise<HistoryEntry | null> {
        // ponytail: fallback to stripped playground prefix and slug before failing; upgrade to unified locator resolver when route models merge.
        const rawId = id.startsWith('playground/') ? id.slice('playground/'.length) : id;
        const note = await this.db.getNote(id)
            ?? (rawId !== id ? await this.db.getNote(rawId) : undefined)
            ?? await this.db.getNoteBySlug(id)
            ?? (rawId !== id ? await this.db.getNoteBySlug(rawId) : undefined);
        if (!note) return null;
        const bundle = (await this.db.getEntryBatches([note.id])).get(note.id);
        if (!bundle) return null;
        const entry = entryFromDomainRow(bundle);
        const latest = (await this.db.getSessionsForNote(note.id)).sort((a, b) => b.createdAt - a.createdAt)[0];
        const sections = parseDocumentSections(note.rawContent, BLOCK_OPTIONS).map(section => {
            const block = Object.values(note.blocks).find(block => block.from === section.from && block.to === section.to);
            if (!block) return section;
            return { ...section, id: block.id, version: block.version,
                scriptBlock: section.scriptBlock ? { ...section.scriptBlock, id: block.id, version: block.version } : undefined };
        });
        return { ...entry, sections, results: latest ? sessionToPayload(latest, await this.db.getEventsByResult(latest.id)) : undefined };
    }

    async cloneEntry(sourceId: string, targetDate?: number): Promise<HistoryEntry> {
        const source = await this.getEntry(sourceId);
        if (!source) throw new Error(`Source entry not found: ${sourceId}`);
        const date = targetDate ?? Date.now();
        return this.saveEntry({ title: source.title, rawContent: source.rawContent, tags: source.tags,
            targetDate: date, journalDate: localDateKey(new Date(date)), type: 'journal', sourceId: source.id });
    }

    async saveEntry(entry: NoteSaveInput): Promise<HistoryEntry> {
        const now = Date.now();
        let noteId = entry.id ?? (entry.type === 'playground' ? formatPlaygroundTimestampId(now) : uuidv7());
        if (!entry.id && entry.type === 'playground') {
            const base = noteId;
            for (let suffix = 1; await this.db.getNote(noteId); suffix++) {
                if (suffix > 100) throw new Error('Unable to allocate unique playground timestamp ID');
                noteId = `${base}-${suffix}`;
            }
        }
        await this.db.withTransaction([...MUTATION_STORES], async scoped => {
            const previous = await scoped.getNote(noteId);
            const expected = previous ? entry.sourceRevision : 0;
            if (expected === undefined) throw new NotePersistenceError('STALE_SOURCE', `An expected source revision is required for ${noteId}`);
            const tags = await new IndexedDBContentProvider(scoped).changedManualTags(noteId, entry.tags);
            const blocks = entry.blocks ?? (previous?.rawContent === entry.rawContent ? previous.blocks : reconcileNoteBlocks(entry.rawContent, { ...BLOCK_OPTIONS, sourceRevision: expected || 1 }));
            await scoped.saveNoteSource({ noteId, rawContent: entry.rawContent, blocks, expectedSourceRevision: expected,
                createdAt: entry.createdAt, metadata: { title: entry.title, type: entry.type, tags,
                    targetDate: entry.targetDate, sourceId: entry.sourceId } });
            const provider = new IndexedDBContentProvider(scoped);
            await provider.updateRelationships(noteId, { journalDate: entry.journalDate, slug: entry.slug });
            await provider.updateTags(noteId, entry.rawContent, tags);
        });
        const saved = await this.getEntry(noteId);
        if (!saved) throw new Error(`Saved note disappeared: ${noteId}`);
        return saved;
    }

    async updateEntry(id: string, patch: NoteEntryPatch): Promise<HistoryEntry> {
        const rawId = id.startsWith('playground/') ? id.slice('playground/'.length) : id;
        const resolved = await this.db.getNote(id)
            ?? (rawId !== id ? await this.db.getNote(rawId) : undefined)
            ?? await this.db.getNoteBySlug(id)
            ?? (rawId !== id ? await this.db.getNoteBySlug(rawId) : undefined);
        if (!resolved) throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${id}`);
        await this.db.withTransaction([...MUTATION_STORES], async scoped => {
            const note = await scoped.getNote(resolved.id);
            if (!note) throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${resolved.id}`);
            const rawContent = patch.rawContent ?? note.rawContent;
            if (patch.rawContent !== undefined && patch.expectedSourceRevision === undefined) {
                throw new NotePersistenceError('STALE_SOURCE', `An expected source revision is required for ${note.id}`);
            }
            const expected = patch.expectedSourceRevision ?? note.sourceRevision;
            const tags = patch.tags === undefined ? undefined : await new IndexedDBContentProvider(scoped).changedManualTags(note.id, patch.tags);
            const blocks = patch.blocks ?? (rawContent === note.rawContent ? note.blocks : reconcileNoteBlocks(rawContent, { ...BLOCK_OPTIONS, sourceRevision: expected }));
            await scoped.saveNoteSource({ noteId: note.id, rawContent, blocks, expectedSourceRevision: expected,
                metadata: { title: patch.title, type: patch.type, tags, targetDate: patch.targetDate, sourceId: patch.sourceId } });
            const provider = new IndexedDBContentProvider(scoped);
            await provider.updateRelationships(note.id, patch);
            if (patch.tags !== undefined || rawContent !== note.rawContent) await provider.updateTags(note.id, rawContent, tags);
            if (patch.results) {
                if (!patch.blockId || !patch.blockVersion) throw new Error('Recording a result requires its frozen block pin');
                const revision = await scoped.getBlockRevision(note.id, patch.blockId, patch.blockVersion);
                if (!revision || revision.kind !== 'wod') throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', 'Pinned workout revision not found');
                const previous = patch.resultId ? await scoped.getSessionById(patch.resultId) : undefined;
                if (previous && (previous.noteId !== note.id || previous.blockId !== patch.blockId || previous.blockVersion !== patch.blockVersion)) {
                    throw new NotePersistenceError('RESULT_NOTE_MISMATCH', 'Cannot replace a Session pin');
                }
                const data = patch.results;
                const session: Session = { ...previous, id: patch.resultId ?? uuidv7(), noteId: note.id,
                    blockId: patch.blockId, blockVersion: patch.blockVersion, blockContentId: patch.blockContentId,
                    origin: patch.origin ?? previous?.origin, startTime: data.startTime, endTime: data.endTime,
                    duration: data.duration ?? 0, completed: data.completed,
                    roundsCompleted: data.roundsCompleted, totalRounds: data.totalRounds, repsCompleted: data.repsCompleted,
                    status: 'completed', createdAt: previous?.createdAt ?? data.endTime ?? Date.now() };
                await scoped.saveSession(session);
                if (data.logs?.length) {
                    const identity = { noteId: session.noteId, resultId: session.id, blockId: session.blockId,
                        blockVersion: session.blockVersion, blockContentId: session.blockContentId, origin: session.origin,
                        pageId: session.pageId, workoutTimestamp: session.endTime };
                    await scoped.appendEvents(toEventRows(data.logs, identity));
                    await scoped.finalizeSummaries(session.id, toSummaryEventRows(data.logs, identity));
                }
            }
        });
        const updated = await this.getEntry(resolved.id);
        if (!updated) throw new Error(`Saved note disappeared: ${resolved.id}`);
        return updated;
    }

    /**
     * Apply a `journalDate` / `slug` patch to the note's placements.
     *
     * Setting a value ATTACHES the note to that page — it never detaches the
     * note from the pages it is already on (a note may sit on several pages
     * at once). Clearing a value detaches the note from the pages of that
     * flavor only; its other placements stay.
     *
     * Moving between pages is a separate operation (see
     * {@link moveEntryPlacement}) — it detaches exactly one source.
     */
    private async updateRelationships(noteId: string, patch: Pick<NoteEntryPatch, 'journalDate' | 'slug'>): Promise<void> {
        for (const flavor of ['journalDate', 'slug'] as const) {
            const value = patch[flavor];
            if (value === undefined) continue;
            if (!value) {
                for (const link of await this.db.getNotePages(noteId)) {
                    const page = await this.db.getPage(link.pageId);
                    const matches = flavor === 'journalDate' ? !!page?.date : !!page?.slug && !page.date;
                    if (matches) await this.db.removeNoteFromPage(noteId, link.pageId);
                }
                continue;
            }
            const destination = await this.resolvePage(noteId, flavor, value);
            await this.db.addNoteToPage(noteId, destination.id);
        }
    }

    /** The page a placement target addresses — created when it does not exist. */
    private async resolvePage(noteId: string, flavor: 'journalDate' | 'slug', value: string): Promise<Page> {
        if (flavor === 'journalDate') return this.db.getOrCreatePageForDate(value);
        const existing = await this.db.getPageBySlug(value);
        if (existing) return existing;
        const page: Page = { id: uuidv7(), slug: value, title: (await this.db.getNote(noteId))?.title, createdAt: Date.now() };
        await this.db.savePage(page);
        return page;
    }

    /** The page a placement target addresses — created when it does not exist. */
    private async resolveTargetPage(noteId: string, target: PageTarget): Promise<Page> {
        if (target.date) return this.db.getOrCreatePageForDate(target.date);
        if (target.slug) return this.resolvePage(noteId, 'slug', target.slug);
        throw new Error('A placement target needs a date or a slug');
    }

    async addEntryPlacement(id: string, target: PageTarget): Promise<HistoryEntry> {
        const noteId = await this.resolvePlacementNoteId(id);
        const page = await this.resolveTargetPage(noteId, target);
        await this.db.addNoteToPage(noteId, page.id);
        const updated = await this.getEntry(noteId);
        if (!updated) throw new Error(`Saved note disappeared: ${noteId}`);
        return updated;
    }

    async removeEntryPlacement(id: string, pageId: string): Promise<HistoryEntry> {
        const noteId = await this.resolvePlacementNoteId(id);
        await this.db.removeNoteFromPage(noteId, pageId);
        const updated = await this.getEntry(noteId);
        if (!updated) throw new Error(`Saved note disappeared: ${noteId}`);
        return updated;
    }

    async moveEntryPlacement(id: string, fromPageId: string, target: PageTarget): Promise<HistoryEntry> {
        const noteId = await this.resolvePlacementNoteId(id);
        const page = await this.resolveTargetPage(noteId, target);
        // The move validates its source INSIDE the storage transaction — a
        // note that is not on the source page fails with NOTE_NOT_PLACED and
        // changes nothing.
        await this.db.moveNoteBetweenPages(noteId, fromPageId, page.id);
        const updated = await this.getEntry(noteId);
        if (!updated) throw new Error(`Saved note disappeared: ${noteId}`);
        return updated;
    }

    /**
     * The notes placed on a named page, in the canonical placement order —
     * the page's own listing. Each entry addresses its own note.
     */
    async getPageEntries(slug: string): Promise<HistoryEntry[]> {
        const page = await this.db.getPageBySlug(slug);
        if (!page) return [];
        const placements = await this.db.getPagePlacements(page.id);
        if (placements.length === 0) return [];
        const bundles = await this.db.getEntryBatches(placements.map((placement) => placement.noteId));
        return placements
            .map((placement) => bundles.get(placement.noteId))
            .filter((bundle): bundle is DomainEntry => bundle !== undefined)
            .map(entryFromDomainRow);
    }

    /**
     * The stored note id behind a placement operation. Placement resolves
     * ACTUAL note ids only: a page slug can name several notes, so
     * resolving one by slug would silently pick an unrelated first note.
     */
    private async resolvePlacementNoteId(id: string): Promise<string> {
        const rawId = id.startsWith('playground/') ? id.slice('playground/'.length) : id;
        const note = await this.db.getNote(id) ?? (rawId !== id ? await this.db.getNote(rawId) : undefined);
        if (!note) throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${id}`);
        return note.id;
    }

    /** The stored note id behind an entry id — the canonical note route. */
    private async resolveNoteId(id: string): Promise<string> {
        const rawId = id.startsWith('playground/') ? id.slice('playground/'.length) : id;
        const note = await this.db.getNote(id)
            ?? (rawId !== id ? await this.db.getNote(rawId) : undefined)
            ?? await this.db.getNoteBySlug(id)
            ?? (rawId !== id ? await this.db.getNoteBySlug(rawId) : undefined);
        if (!note) throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${id}`);
        return note.id;
    }

    private async changedManualTags(noteId: string, supplied: string[]): Promise<string[] | undefined> {
        const current = (await this.db.getTagsForNote(noteId)).map(tag => tag.label).sort();
        const next = [...new Set(supplied.map(tag => tag.trim()).filter(Boolean))].sort();
        return current.length === next.length && current.every((tag, index) => tag === next[index]) ? undefined : next;
    }

    private async updateTags(noteId: string, rawContent: string, manual?: string[]): Promise<void> {
        const knownTypes = (await this.db.getAllTagTypes()).map(type => type.name);
        const declared = parseDocumentSections(rawContent, BLOCK_OPTIONS)
            .filter(section => section.type === 'frontmatter')
            .flatMap(section => extractTypedFrontmatterTags(section.displayContent, knownTypes));
        const base = manual ?? (await this.db.getNote(noteId))?.tags ?? [];
        await this.db.setNoteTags(noteId, [...base, ...declared.map(tag => tag.type ? tag : tag.label)]);
    }

    async deleteEntry(id: string): Promise<void> { await this.db.deleteNote(id); }
    async getAttachments(noteId: string): Promise<Attachment[]> { return this.db.getAttachmentsForNote(noteId); }
    async saveAttachment(noteId: string, attachment: AttachmentCreateInput): Promise<Attachment> {
        const full: Attachment = { ...attachment, id: attachment.id ?? uuidv7(), noteId, createdAt: Date.now() };
        await this.db.saveAttachment(full);
        return full;
    }
    async deleteAttachment(id: string): Promise<void> { await this.db.deleteAttachment(id); }
}
