/**
 * ExportImportService — the single Note Portability module.
 *
 * Owns the round-trip a user performs: export a Note → archive → import →
 * recover the Note. Format logic lives in the pure serializer/deserializer
 * modules; browser file I/O (zip write, download, pick, read) is inlined here
 * as private helpers — one adapter, not three decorative ports. Both the
 * export and import sides go through JSZip directly (symmetric).
 *
 * Round-trip invariant: a re-imported Note preserves its `id`, `createdAt`,
 * and `updatedAt` (recovered by the deserializer, honored by `saveRecord` via
 * `NoteSaveInput`), so it overwrites its original instead of duplicating.
 */

import type { HistoryRecord } from '@/types/history';
import type { IContentProvider } from '@/types/content-provider';
import { wallClockNow } from '@bitcobblers/wod-wiki-engine';
import JSZip from 'jszip';

import { statementsToCSV, resultsToCSV } from './export/NoteCsvFormatter';
import { noteToMarkdown } from './export/NoteMarkdownSerializer';
import { parseMarkdownToEntry } from './export/NoteMarkdownDeserializer';

// ── File I/O helpers (the single browser adapter; was 3 decorative ports) ──

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

/** Sanitize a note id into a zip-safe filename stem (deduped from the old 2 sites). */
function noteFilenameStem(id: string): string {
    return id.replace(/[^a-zA-Z0-9-_]/g, '_');
}

// ── Export ────────────────────────────────────────────────────────────────

export async function exportAllNotes(provider: IContentProvider): Promise<void> {
    const entries = await provider.getRecords();
    if (entries.length === 0) {
        throw new Error('No notes to export');
    }

    const clock = wallClockNow;
    const archive = new NoteArchive();

    // README
    const readme = [
        '# WOD Wiki Note Export',
        '',
        `Exported: ${new Date(clock.nowMs()).toISOString()}`,
        `Notes: ${entries.length}`,
        '',
        '## Files',
        ...entries.map(e => `- ${noteFilenameStem(e.id)}.md — ${e.title}`),
        '',
        'Each .md file is a note with a `## Metadata` block (ID, Created, Updated,',
        'Target Date, Tags) followed by `## Content`. Re-importing preserves note',
        'identity (same ID → overwrites instead of duplicating).',
    ].join('\n');
    archive.addText('README.md', readme);

    for (const entry of entries) {
        archive.addText(`${noteFilenameStem(entry.id)}.md`, noteToMarkdown(entry, clock));
    }

    const blob = await archive.toBlob();
    downloadBlob(blob, `wod-wiki-export-${clock.nowMs()}.zip`);
}

export async function exportNote(entry: HistoryRecord): Promise<void> {
    const clock = wallClockNow;
    const archive = new NoteArchive();
    const noteId = noteFilenameStem(entry.id);

    archive.addText(`${noteId}.md`, noteToMarkdown(entry, clock));
    archive.addText(`${noteId}_statements.csv`, statementsToCSV(entry));
    archive.addText(`${noteId}_results.csv`, resultsToCSV(entry));

    const readme = [
        `# ${entry.title}`,
        '',
        `Export Date: ${clock.now().toISOString()}`,
        '',
        '## Files',
        '',
        `- \`${noteId}.md\` - Markdown representation with metadata`,
        `- \`${noteId}_statements.csv\` - Parsed code statements and metrics`,
        `- \`${noteId}_results.csv\` - Workout results`,
    ].join('\n');
    archive.addText('README.md', readme);

    const blob = await archive.toBlob();
    const filename = `${noteFilenameStem(entry.title)}-${clock.nowMs()}.zip`;
    downloadBlob(blob, filename);
}

// ── Import ────────────────────────────────────────────────────────────────

export async function importFromZip(
    file: File,
    provider: IContentProvider
): Promise<{ imported: number; errors: string[] }> {
    const clock = wallClockNow;
    const zip = await JSZip.loadAsync(file);
    const errors: string[] = [];
    let imported = 0;

    const mdFiles = Object.keys(zip.files).filter(name => name.endsWith('.md') && name !== 'README.md');

    for (const filename of mdFiles) {
        try {
            const content = await zip.files[filename].async('text');
            const entry = parseMarkdownToEntry(content, clock);
            if (entry) {
                const existing = entry.id ? await provider.getRecord(entry.id) : null;
                await provider.saveRecord({ ...entry, sourceRevision: existing?.sourceRevision ?? entry.sourceRevision,
                    blocks: existing?.rawContent === entry.rawContent ? existing.blocks : entry.blocks });
                imported++;
            } else {
                errors.push(`Failed to import ${filename}: Invalid markdown format or missing metadata`);
            }
        } catch (err) {
            errors.push(`Failed to import ${filename}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    return { imported, errors };
}

export function pickFile(accept: string = '*'): Promise<File | null> {
    return pickFileFromBrowser(accept);
}

export { createNoteFromMarkdown } from './export/NoteMarkdownDeserializer';
