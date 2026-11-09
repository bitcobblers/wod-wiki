/**
 * ExportImportService — the single Note Portability module.
 *
 * Owns the round-trip a user performs: export a Note → archive → import →
 * recover the Note and its telemetry. Format logic lives in the pure
 * serializer/deserializer modules; browser file I/O stays here.
 */

import type { HistoryRecord } from '@/types/history';
import type { IContentProvider, NoteSaveInput } from '@/types/content-provider';
import type { EventRecord } from '@/types/storage';
import { wallClockNow } from '@bitcobblers/wod-wiki-engine';
import { eventsToStoredLogs, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import JSZip from 'jszip';

import { eventsToCSV, resultsToCSV, statementsToCSV } from './export/NoteCsvFormatter';
import {
    parseNoteBundleFromJsonl,
    serializeNoteBundleToJsonl,
    type NoteJsonlNote,
    type NoteTelemetryBundle,
} from './export/NoteJsonlFormatter';
import { noteToMarkdown } from './export/NoteMarkdownSerializer';
import { parseMarkdownToEntry } from './export/NoteMarkdownDeserializer';

export interface NoteImportResult {
    imported: number;
    sessionsImported?: number;
    eventsImported?: number;
    errors: string[];
}

/** Build a zip archive incrementally, then materialize it as a Blob. */
class NoteArchive {
    private readonly zip = new JSZip();
    addText(name: string, content: string): void { this.zip.file(name, content); }
    toBlob(): Promise<Blob> { return this.zip.generateAsync({ type: 'blob' }); }
}

/** Trigger a browser download of a Blob under the given filename. */
function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/** Open the browser file picker; resolves to the chosen File or null. */
function pickFileFromBrowser(accept: string = '*'): Promise<File | null> {
    const { promise, resolve } = Promise.withResolvers<File | null>();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
    return promise;
}

function noteFilenameStem(id: string): string {
    return id.replace(/[^a-zA-Z0-9-_]/g, '_');
}

async function readTelemetry(entry: HistoryRecord, provider?: IContentProvider): Promise<NoteTelemetryBundle> {
    await provider?.persistenceReady;
    const storage = provider?.persistenceStorage;
    const sessions = storage ? await storage.getSessionsForNote(entry.id) : entry.extendedResults ?? [];
    const events: EventRecord[] = [];
    if (storage) {
        for (const session of sessions) events.push(...await storage.getEventsByResult(session.id));
    }
    const revisions = storage ? await storage.getNoteBlockHistory(entry.id) : [];
    return { sessions, events, revisions };
}

function hasTelemetrySource(entry: HistoryRecord, provider?: IContentProvider): boolean {
    return provider?.persistenceStorage !== undefined || entry.extendedResults !== undefined || entry.results !== undefined;
}

export async function exportAllNotes(provider: IContentProvider): Promise<void> {
    const entries = await provider.getRecords();
    if (entries.length === 0) throw new Error('No notes to export');

    const clock = wallClockNow;
    const archive = new NoteArchive();
    const bundles: NoteTelemetryBundle[] = [];
    const readme = [
        '# WOD Wiki Note Export',
        '',
        `Exported: ${new Date(clock.nowMs()).toISOString()}`,
        `Notes: ${entries.length}`,
        '',
        '## Files',
        ...entries.map(e => `- ${noteFilenameStem(e.id)}.md — ${e.title}`),
        '- telemetry.jsonl — Note-linked Session and EventRecord telemetry',
        '',
        'Each .md file is a note with a `## Metadata` block (ID, Created, Updated,',
        'Target Date, Tags) followed by `## Content`. Re-importing preserves note',
        'identity (same ID → overwrites instead of duplicating).',
    ].join('\n');
    archive.addText('README.md', readme);

    for (const entry of entries) {
        const noteId = noteFilenameStem(entry.id);
        const bundle = await readTelemetry(entry, provider);
        archive.addText(`${noteId}.md`, noteToMarkdown(entry, clock));
        archive.addText(`${noteId}_statements.csv`, statementsToCSV(entry));
        archive.addText(`${noteId}_results.csv`, resultsToCSV(entry));
        if (bundle.events.length > 0) archive.addText(`${noteId}_events.csv`, eventsToCSV(entry.id, bundle.events));
        bundles.push(bundle);
    }
    archive.addText('telemetry.jsonl', bundles.map(serializeNoteBundleToJsonl).filter(Boolean).join('\n'));

    const blob = await archive.toBlob();
    downloadBlob(blob, `wod-wiki-export-${clock.nowMs()}.zip`);
}

export async function exportNote(entry: HistoryRecord, provider?: IContentProvider): Promise<void> {
    const clock = wallClockNow;
    const archive = new NoteArchive();
    const noteId = noteFilenameStem(entry.id);

    archive.addText(`${noteId}.md`, noteToMarkdown(entry, clock));
    archive.addText(`${noteId}_statements.csv`, statementsToCSV(entry));
    archive.addText(`${noteId}_results.csv`, resultsToCSV(entry));

    const files = [
        `- \`${noteId}.md\` - Markdown representation with metadata`,
        `- \`${noteId}_statements.csv\` - Parsed code statements and metrics`,
        `- \`${noteId}_results.csv\` - Workout results`,
    ];
    if (hasTelemetrySource(entry, provider)) {
        const bundle = await readTelemetry(entry, provider);
        archive.addText(`${noteId}_telemetry.jsonl`, serializeNoteBundleToJsonl(bundle));
        archive.addText(`${noteId}_events.csv`, eventsToCSV(entry.id, bundle.events));
        files.push(`- \`${noteId}_telemetry.jsonl\` - Note-linked sessions and events`);
        files.push(`- \`${noteId}_events.csv\` - Event metrics with note and session identity`);
    }

    archive.addText('README.md', [
        `# ${entry.title}`,
        '',
        `Export Date: ${clock.now().toISOString()}`,
        '',
        '## Files',
        '',
        ...files,
    ].join('\n'));

    const blob = await archive.toBlob();
    downloadBlob(blob, `${noteFilenameStem(entry.title)}-${clock.nowMs()}.zip`);
}

async function saveJsonlNote(note: NoteJsonlNote, provider: IContentProvider): Promise<void> {
    const existing = await provider.getRecord(note.id);
    const input: NoteSaveInput = {
        ...note,
        sourceRevision: existing?.sourceRevision ?? note.sourceRevision,
        blocks: existing?.rawContent === note.rawContent ? existing.blocks : note.blocks,
    };
    await provider.saveRecord(input);
}

async function importTelemetryBundle(
    bundle: NoteTelemetryBundle,
    provider: IContentProvider,
): Promise<{ sessions: number; events: number; errors: string[] }> {
    const errors: string[] = [];
    let sessionsImported = 0;
    let eventsImported = 0;
    if ((bundle.sessions.length > 0 || bundle.events.length > 0) && !provider.persistenceStorage) {
        return { sessions: 0, events: 0, errors: ['Telemetry import requires provider.persistenceStorage'] };
    }
    const storage = provider.persistenceStorage;
    if (!storage) return { sessions: 0, events: 0, errors };
    await provider.persistenceReady;

    for (const session of bundle.sessions) {
        try {
            const note = await provider.getRecord(session.noteId);
            if (!note) throw new Error(`Parent note ${session.noteId} does not exist`);
            const revision = await storage.getBlockRevision(session.noteId, session.blockId, session.blockVersion);
            if (!revision || revision.kind !== 'wod') {
                throw new Error(`Pinned wod BlockRevision [${session.noteId}, ${session.blockId}, ${session.blockVersion}] does not exist`);
            }
            const rows = bundle.events.filter((event) => event.resultId === session.id);
            for (const event of rows) {
                if (event.noteId !== session.noteId || event.blockId !== session.blockId
                    || event.blockVersion !== session.blockVersion || event.blockContentId !== session.blockContentId) {
                    throw new Error(`Event ${event.id} does not match session ${session.id} identity`);
                }
            }
            const raw = rows.filter((event) => event.grain === 'event');
            const suppliedSummaries = rows.filter((event) => event.grain === 'summary');
            const summaries = suppliedSummaries.length > 0 ? suppliedSummaries : toSummaryEventRows(eventsToStoredLogs(raw), {
                noteId: session.noteId,
                resultId: session.id,
                blockId: session.blockId,
                blockVersion: session.blockVersion,
                blockContentId: session.blockContentId,
                origin: session.origin,
                pageId: session.pageId,
                workoutTimestamp: session.startTime,
            });
            await storage.withTransaction(['notes', 'block_revisions', 'sessions', 'events'], async (scoped) => {
                await scoped.saveSession(session);
                if (rows.length > 0) {
                    await scoped.appendEvents(raw);
                    await scoped.finalizeSummaries(session.id, summaries);
                }
            });
            sessionsImported++;
            eventsImported += raw.length + summaries.length;
        } catch (error) {
            errors.push(`Failed to import session ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { sessions: sessionsImported, events: eventsImported, errors };
}

async function restoreBundleRevisions(bundle: NoteTelemetryBundle, provider: IContentProvider): Promise<void> {
    const revisions = bundle.revisions ?? [];
    if (revisions.length === 0) return;
    const storage = provider.persistenceStorage;
    if (!storage) throw new Error('Revision import requires provider.persistenceStorage');
    await provider.persistenceReady;
    await storage.saveBlockRevisions(revisions);
}

async function importJsonl(
    jsonlText: string,
    provider: IContentProvider,
    options: {
        skipNotes: ReadonlySet<string>;
        revisionsRestored?: boolean;
        skipBundles?: ReadonlySet<string>;
    },
): Promise<{ noteIds: Set<string>; sessions: number; events: number; errors: string[] }> {
    const parsed = parseNoteBundleFromJsonl(jsonlText);
    const errors = [...parsed.errors];
    const noteIds = new Set<string>();
    let sessions = 0;
    let events = 0;

    for (const bundle of parsed.bundles) {
        const bundleNoteId = bundle.note?.id ?? bundle.revisions?.[0]?.noteId ?? bundle.sessions[0]?.noteId ?? bundle.events[0]?.noteId;
        if (bundleNoteId && options.skipBundles?.has(bundleNoteId)) continue;
        if (!options.revisionsRestored) {
            try {
                await restoreBundleRevisions(bundle, provider);
            } catch (error) {
                errors.push(`Failed to restore revisions for ${bundleNoteId ?? 'unknown note'}: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
        }
        if (bundle.note && !options.skipNotes.has(bundle.note.id)) {
            try {
                await saveJsonlNote(bundle.note, provider);
                noteIds.add(bundle.note.id);
            } catch (error) {
                errors.push(`Failed to import note ${bundle.note.id}: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
        }
        const imported = await importTelemetryBundle(bundle, provider);
        sessions += imported.sessions;
        events += imported.events;
        errors.push(...imported.errors);
    }
    return { noteIds, sessions, events, errors };
}

export async function importFromJsonl(jsonlText: string, provider: IContentProvider): Promise<NoteImportResult> {
    const result = await importJsonl(jsonlText, provider, { skipNotes: new Set() });
    return {
        imported: result.noteIds.size,
        sessionsImported: result.sessions,
        eventsImported: result.events,
        errors: result.errors,
    };
}

export async function importFromZip(file: File, provider: IContentProvider): Promise<NoteImportResult> {
    const clock = wallClockNow;
    const zip = await JSZip.loadAsync(file);
    const errors: string[] = [];
    const noteIds = new Set<string>();
    const failedRevisionNotes = new Set<string>();
    let sessionsImported = 0;
    let eventsImported = 0;

    const jsonlFiles = Object.keys(zip.files).filter(name => name.endsWith('.jsonl'));
    const jsonlTexts = await Promise.all(jsonlFiles.map(filename => zip.files[filename].async('text')));

    // Revisions must exist before markdown reconciliation. Otherwise a fresh
    // note save assigns current text to version 1 and falsifies historical pins.
    for (const [index, jsonlText] of jsonlTexts.entries()) {
        const parsed = parseNoteBundleFromJsonl(jsonlText);
        for (const bundle of parsed.bundles) {
            const bundleNoteId = bundle.note?.id ?? bundle.revisions?.[0]?.noteId ?? bundle.sessions[0]?.noteId ?? bundle.events[0]?.noteId;
            try {
                await restoreBundleRevisions(bundle, provider);
            } catch (error) {
                if (bundleNoteId) failedRevisionNotes.add(bundleNoteId);
                errors.push(`${jsonlFiles[index]}: Failed to restore revisions for ${bundleNoteId ?? 'unknown note'}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    const mdFiles = Object.keys(zip.files).filter(name => name.endsWith('.md') && name !== 'README.md');
    for (const filename of mdFiles) {
        try {
            const content = await zip.files[filename].async('text');
            const entry = parseMarkdownToEntry(content, clock);
            if (!entry) {
                errors.push(`Failed to import ${filename}: Invalid markdown format or missing metadata`);
                continue;
            }
            if (entry.id && failedRevisionNotes.has(entry.id)) {
                errors.push(`Failed to import ${filename}: revision restoration failed for ${entry.id}`);
                continue;
            }
            const existing = entry.id ? await provider.getRecord(entry.id) : null;
            const saved = await provider.saveRecord({
                ...entry,
                sourceRevision: existing?.sourceRevision ?? entry.sourceRevision,
                blocks: existing?.rawContent === entry.rawContent ? existing.blocks : entry.blocks,
            });
            noteIds.add(saved.id);
        } catch (error) {
            errors.push(`Failed to import ${filename}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    for (const [index, jsonlText] of jsonlTexts.entries()) {
        try {
            const result = await importJsonl(jsonlText, provider, {
                skipNotes: noteIds,
                revisionsRestored: true,
                skipBundles: failedRevisionNotes,
            });
            for (const id of result.noteIds) noteIds.add(id);
            sessionsImported += result.sessions;
            eventsImported += result.events;
            errors.push(...result.errors.map(error => `${jsonlFiles[index]}: ${error}`));
        } catch (error) {
            errors.push(`Failed to import ${jsonlFiles[index]}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return { imported: noteIds.size, sessionsImported, eventsImported, errors };
}

export function pickFile(accept: string = '*'): Promise<File | null> {
    return pickFileFromBrowser(accept);
}

export { createNoteFromMarkdown } from './export/NoteMarkdownDeserializer';
export {
    parseNoteBundleFromJsonl,
    serializeNoteBundleToJsonl,
    streamNoteBundleToJsonlLines,
    type NoteTelemetryBundle,
    type NoteTelemetryBundleResult,
} from './export/NoteJsonlFormatter';
