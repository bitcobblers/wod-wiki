/**
 * ExportImportService — canonical Note & Telemetry portability + Feed Repository export.
 *
 * All format logic delegates to `@bitcobblers/wod-wiki-engine`:
 *   - `.md`   : canonical Markdown with YAML frontmatter (`composeNoteMarkdown` / `parseNoteMarkdown`)
 *   - `.jsonl`: lossless TelemetryBundle (`serializeNoteBundleToJsonl` / `parseNoteBundleFromJsonl`)
 *   - `.csv`  : lossless tabular TelemetryBundle (`telemetryBundleToCsv` / `csvToTelemetryBundle`)
 *   - `.zip`  : ZipFeedTree archive for multi-Note bundles and `wod-wiki-feed-repository` exports
 */

import JSZip from 'jszip';
import {
  DirectoryHandleFeedTree,
  FeedTreeError,
  composeNoteMarkdown,
  csvToTelemetryBundle,
  encodeUtf8,
  normalizeFeedTreePath,
  parseNoteBundleFromJsonl,
  parseNoteMarkdown,
  publishFeedFromStorage,
  checkUnpublishedFeedChanges,
  serializeNoteBundleToJsonl,
  sha256HexAsync,
  streamNoteBundleToJsonlLines,
  telemetryBundleToCsv,
  wallClockNow,
  type FeedFileStat,
  type FeedPath,
  type FeedTree,
  type FileSystemDirectoryHandleLike,
  type INowProvider,
  type NoteTelemetryBundle,
  type NoteTelemetryBundleResult,
  type PublishFeedOptions,
  type PublishFeedReport,
  type UnpublishedFeedStatus,
} from '@bitcobblers/wod-wiki-engine';
import { eventsToStoredLogs, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import type { HistoryRecord } from '@/types/history';
import type { IContentProvider, NoteSaveInput } from '@/types/content-provider';
import type { EventRecord, Note, NoteBlock } from '@/types/storage';
import { storage, storageBackend, whenStorageReady } from '@/services/storage';

export type { NoteTelemetryBundle, NoteTelemetryBundleResult };
export { parseNoteBundleFromJsonl, serializeNoteBundleToJsonl, streamNoteBundleToJsonlLines };

export interface NoteImportResult {
  imported: number;
  sessionsImported?: number;
  eventsImported?: number;
  errors: string[];
}

export type ParsedNoteEntry = Omit<HistoryRecord, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'> & {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
};

/**
 * Browser `JSZip` adapter implementing `FeedTree`.
 */
export class ZipFeedTree implements FeedTree {
  private readonly zip: JSZip;

  constructor(zip?: JSZip) {
    this.zip = zip ?? new JSZip();
  }

  static async fromBlob(file: Blob | ArrayBuffer | Uint8Array): Promise<ZipFeedTree> {
    const loaded = await JSZip.loadAsync(file);
    return new ZipFeedTree(loaded);
  }

  async read(path: FeedPath): Promise<Uint8Array> {
    const clean = normalizeFeedTreePath(path);
    const entry = this.zip.file(clean);
    if (!entry) throw new FeedTreeError('not-found', `Zip entry not found: ${clean}`);
    return entry.async('uint8array');
  }

  async stat(path: FeedPath): Promise<FeedFileStat | undefined> {
    const clean = normalizeFeedTreePath(path);
    const entry = this.zip.file(clean);
    if (!entry) return undefined;
    const bytes = await entry.async('uint8array');
    return {
      bytes: bytes.byteLength,
      sha256: await sha256HexAsync(bytes),
    };
  }

  async write(path: FeedPath, bytes: Uint8Array): Promise<void> {
    const clean = normalizeFeedTreePath(path);
    this.zip.file(clean, bytes);
  }

  async writeText(path: FeedPath, text: string): Promise<void> {
    await this.write(path, encodeUtf8(text));
  }

  async delete(path: FeedPath): Promise<void> {
    const clean = normalizeFeedTreePath(path);
    this.zip.remove(clean);
  }

  async list(prefix = ''): Promise<FeedPath[]> {
    const clean = prefix ? normalizeFeedTreePath(prefix) + '/' : '';
    return Object.keys(this.zip.files)
      .filter((k) => !this.zip.files[k]?.dir && (!clean || k.startsWith(clean)))
      .sort();
  }

  toBlob(): Promise<Blob> {
    return this.zip.generateAsync({ type: 'blob' });
  }

  toUint8Array(): Promise<Uint8Array> {
    return this.zip.generateAsync({ type: 'uint8array' });
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadTextFile(text: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function pickFile(accept = '.md,.jsonl,.csv,.zip'): Promise<File | null> {
  const { promise, resolve } = Promise.withResolvers<File | null>();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => resolve(input.files?.[0] ?? null);
  input.oncancel = () => resolve(null);
  input.click();
  return promise;
}

function noteFilenameStem(idOrTitle: string): string {
  return idOrTitle.replace(/[^a-zA-Z0-9-_]/g, '_') || 'note';
}

function historyRecordToPortableNote(entry: HistoryRecord): Note {
  return {
    id: entry.id,
    title: entry.title,
    rawContent: entry.rawContent,
    sourceRevision: entry.sourceRevision ?? 1,
    blocks: (entry.blocks ?? {}) as Record<string, NoteBlock>,
    date: entry.targetDate,
    createdAt: entry.createdAt,
    ...(entry.tags.length > 0 ? { tags: entry.tags } : {}),
    ...(entry.sourceId ? { sourceId: entry.sourceId } : {}),
    ...(entry.notebookId ? { notebookId: entry.notebookId } : {}),
  };
}

/**
 * Parse canonical frontmatter or plain Markdown into a `ParsedNoteEntry`.
 */
export function createNoteFromMarkdown(
  markdown: string,
  clock: INowProvider = wallClockNow,
): ParsedNoteEntry {
  const parsed = parseNoteMarkdown(markdown, { defaultDate: clock.nowMs() });
  return {
    ...(parsed.id ? { id: parsed.id } : {}),
    title: parsed.title,
    rawContent: parsed.rawContent,
    tags: parsed.tags,
    targetDate: parsed.date ?? clock.nowMs(),
    sections: [],
    blocks: parsed.blocks,
    sourceRevision: 1,
    ...(parsed.notebookId ? { notebookId: parsed.notebookId } : {}),
  };
}

async function readTelemetry(entry: HistoryRecord, provider?: IContentProvider): Promise<NoteTelemetryBundle> {
  await provider?.persistenceReady;
  const persistence = provider?.persistenceStorage;
  const sessions = persistence ? await persistence.getSessionsForNote(entry.id) : entry.extendedResults ?? [];
  const events: EventRecord[] = [];
  if (persistence) {
    for (const session of sessions) events.push(...(await persistence.getEventsByResult(session.id)));
  }
  const revisions = persistence ? await persistence.getNoteBlockHistory(entry.id) : [];
  return { sessions, events, revisions };
}

function hasTelemetryData(bundle: NoteTelemetryBundle): boolean {
  return (
    bundle.sessions.length > 0 ||
    bundle.events.length > 0 ||
    (bundle.revisions !== undefined && bundle.revisions.length > 0)
  );
}

/**
 * Export all Notes and their telemetry as canonical `.md` + `.jsonl` (or `.csv`) pairs inside a `.zip`.
 */
export async function exportAllNotes(
  provider: IContentProvider,
  options: { telemetryFormat?: 'jsonl' | 'csv' | 'both' } = {},
): Promise<void> {
  const entries = await provider.getRecords();
  if (entries.length === 0) throw new Error('No notes to export');

  const telemetryFormat = options.telemetryFormat ?? 'jsonl';
  const clock = wallClockNow;
  const archive = new ZipFeedTree();

  for (const entry of entries) {
    const stem = noteFilenameStem(entry.id);
    const md = composeNoteMarkdown(historyRecordToPortableNote(entry));
    await archive.writeText(`${stem}.md`, md);

    const bundle = await readTelemetry(entry, provider);
    if (hasTelemetryData(bundle)) {
      if (telemetryFormat === 'jsonl' || telemetryFormat === 'both') {
        await archive.writeText(`${stem}.jsonl`, serializeNoteBundleToJsonl(bundle) + '\n');
      }
      if (telemetryFormat === 'csv' || telemetryFormat === 'both') {
        await archive.writeText(`${stem}.csv`, telemetryBundleToCsv(bundle));
      }
    }
  }

  const blob = await archive.toBlob();
  downloadBlob(blob, `wod-wiki-export-${clock.nowMs()}.zip`);
}

/**
 * Export a single Note as standalone `.md`, standalone `.jsonl`/`.csv` telemetry, or a paired `.zip`.
 */
export async function exportNote(
  entry: HistoryRecord,
  provider?: IContentProvider,
  options: { format?: 'md' | 'jsonl' | 'csv' | 'zip' } = {},
): Promise<void> {
  const clock = wallClockNow;
  const stem = noteFilenameStem(entry.title || entry.id);
  const noteMd = composeNoteMarkdown(historyRecordToPortableNote(entry));

  if (options.format === 'md') {
    downloadTextFile(noteMd, `${stem}.md`, 'text/markdown;charset=utf-8');
    return;
  }

  const bundle = await readTelemetry(entry, provider);
  if (options.format === 'jsonl') {
    downloadTextFile(serializeNoteBundleToJsonl(bundle) + '\n', `${stem}.jsonl`, 'application/x-ndjson;charset=utf-8');
    return;
  }
  if (options.format === 'csv') {
    downloadTextFile(telemetryBundleToCsv(bundle), `${stem}.csv`, 'text/csv;charset=utf-8');
    return;
  }

  const archive = new ZipFeedTree();
  const idStem = noteFilenameStem(entry.id);
  await archive.writeText(`${idStem}.md`, noteMd);
  if (hasTelemetryData(bundle)) {
    await archive.writeText(`${idStem}.jsonl`, serializeNoteBundleToJsonl(bundle) + '\n');
    await archive.writeText(`${idStem}.csv`, telemetryBundleToCsv(bundle));
  }
  const blob = await archive.toBlob();
  downloadBlob(blob, `${stem}-${clock.nowMs()}.zip`);
}

async function importTelemetryBundlesIntoProvider(
  bundles: readonly NoteTelemetryBundle[],
  provider: IContentProvider,
  options: { skipNotes: ReadonlySet<string>; revisionsRestored?: boolean; skipBundles?: ReadonlySet<string> },
): Promise<{ noteIds: Set<string>; sessions: number; events: number; errors: string[] }> {
  const errors: string[] = [];
  const noteIds = new Set<string>();
  let sessions = 0;
  let events = 0;

  for (const bundle of bundles) {
    const bundleNoteId =
      bundle.note?.id ??
      bundle.revisions?.[0]?.noteId ??
      bundle.sessions[0]?.noteId ??
      bundle.events[0]?.noteId;
    if (bundleNoteId && options.skipBundles?.has(bundleNoteId)) continue;

    if (!options.revisionsRestored && bundle.revisions && bundle.revisions.length > 0) {
      try {
        const persistence = provider.persistenceStorage;
        if (!persistence) throw new Error('Revision import requires provider.persistenceStorage');
        await provider.persistenceReady;
        await persistence.saveBlockRevisions(bundle.revisions);
      } catch (err) {
        errors.push(
          `Failed to restore revisions for ${bundleNoteId ?? 'unknown note'}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
    }

    if (bundle.note && !options.skipNotes.has(bundle.note.id)) {
      try {
        const existing = await provider.getRecord(bundle.note.id);
        const input: NoteSaveInput = {
          ...bundle.note,
          tags: bundle.note.tags ?? [],
          sourceRevision: existing?.sourceRevision ?? bundle.note.sourceRevision,
          blocks: existing?.rawContent === bundle.note.rawContent ? existing.blocks : bundle.note.blocks,
        };
        await provider.saveRecord(input);
        noteIds.add(bundle.note.id);
      } catch (err) {
        errors.push(
          `Failed to import note ${bundle.note.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
    }

    if (bundle.sessions.length > 0 || bundle.events.length > 0) {
      const persistence = provider.persistenceStorage;
      if (!persistence) {
        errors.push('Telemetry import requires provider.persistenceStorage');
        continue;
      }
      await provider.persistenceReady;

      for (const session of bundle.sessions) {
        try {
          const parent = await provider.getRecord(session.noteId);
          if (!parent) throw new Error(`Parent note ${session.noteId} does not exist`);
          const rev = await persistence.getBlockRevision(session.noteId, session.blockId, session.blockVersion);
          if (!rev || rev.kind !== 'wod') {
            throw new Error(
              `Pinned wod BlockRevision [${session.noteId}, ${session.blockId}, ${session.blockVersion}] does not exist`,
            );
          }
          const rows = bundle.events.filter((ev) => ev.resultId === session.id);
          for (const ev of rows) {
            if (
              ev.noteId !== session.noteId ||
              ev.blockId !== session.blockId ||
              ev.blockVersion !== session.blockVersion ||
              ev.blockContentId !== session.blockContentId
            ) {
              throw new Error(`Event ${ev.id} does not match session ${session.id} identity`);
            }
          }
          const raw = rows.filter((ev) => ev.grain === 'event');
          const suppliedSummaries = rows.filter((ev) => ev.grain === 'summary');
          const summaries =
            suppliedSummaries.length > 0
              ? suppliedSummaries
              : toSummaryEventRows(eventsToStoredLogs(raw), {
                  noteId: session.noteId,
                  resultId: session.id,
                  blockId: session.blockId,
                  blockVersion: session.blockVersion,
                  blockContentId: session.blockContentId,
                  origin: session.origin,
                  pageId: session.pageId,
                  workoutTimestamp: session.startTime,
                });
          await persistence.withTransaction(['notes', 'block_revisions', 'sessions', 'events'], async (scoped) => {
            await scoped.saveSession(session);
            if (rows.length > 0) {
              await scoped.appendEvents(raw);
              await scoped.finalizeSummaries(session.id, summaries);
            }
          });
          sessions++;
          events += raw.length + summaries.length;
        } catch (err) {
          errors.push(
            `Failed to import session ${session.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  return { noteIds, sessions, events, errors };
}

export async function importFromMarkdown(
  markdownText: string,
  provider: IContentProvider,
): Promise<NoteImportResult> {
  try {
    const entry = createNoteFromMarkdown(markdownText, wallClockNow);
    const existing = entry.id ? await provider.getRecord(entry.id) : null;
    await provider.saveRecord({
      ...entry,
      sourceRevision: existing?.sourceRevision ?? entry.sourceRevision,
      blocks: existing?.rawContent === entry.rawContent ? existing.blocks : entry.blocks,
    });
    return { imported: 1, sessionsImported: 0, eventsImported: 0, errors: [] };
  } catch (err) {
    return {
      imported: 0,
      sessionsImported: 0,
      eventsImported: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

export async function importFromJsonl(
  jsonlText: string,
  provider: IContentProvider,
): Promise<NoteImportResult> {
  const parsed = parseNoteBundleFromJsonl(jsonlText);
  const res = await importTelemetryBundlesIntoProvider(parsed.bundles, provider, { skipNotes: new Set() });
  return {
    imported: res.noteIds.size,
    sessionsImported: res.sessions,
    eventsImported: res.events,
    errors: [...parsed.errors, ...res.errors],
  };
}

export async function importFromCsv(
  csvText: string,
  provider: IContentProvider,
): Promise<NoteImportResult> {
  const parsed = csvToTelemetryBundle(csvText);
  const res = await importTelemetryBundlesIntoProvider(parsed.bundles, provider, { skipNotes: new Set() });
  return {
    imported: res.noteIds.size,
    sessionsImported: res.sessions,
    eventsImported: res.events,
    errors: [...parsed.errors, ...res.errors],
  };
}

/**
 * Import from a `.zip` archive OR a standalone `.md` / `.jsonl` / `.csv` file.
 */
export async function importFromZip(file: File, provider: IContentProvider): Promise<NoteImportResult> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return importFromMarkdown(await file.text(), provider);
  }
  if (lower.endsWith('.jsonl')) {
    return importFromJsonl(await file.text(), provider);
  }
  if (lower.endsWith('.csv')) {
    return importFromCsv(await file.text(), provider);
  }

  const clock = wallClockNow;
  const zip = await JSZip.loadAsync(file);
  const errors: string[] = [];
  const noteIds = new Set<string>();
  const failedRevisionNotes = new Set<string>();
  let sessionsImported = 0;
  let eventsImported = 0;

  const allPaths = Object.keys(zip.files).filter((name) => !zip.files[name]?.dir && !name.startsWith('dist/'));
  const jsonlFiles = allPaths.filter((name) => name.endsWith('.jsonl'));
  const csvFiles = allPaths.filter((name) => name.endsWith('.csv'));
  const mdFiles = allPaths.filter(
    (name) => name.endsWith('.md') && !/(?:^|\/)README\.md$/i.test(name),
  );

  const parsedBundles: Array<{ source: string; parsed: NoteTelemetryBundleResult }> = [];
  for (const name of jsonlFiles) {
    const text = await zip.files[name]!.async('text');
    parsedBundles.push({ source: name, parsed: parseNoteBundleFromJsonl(text) });
  }
  // Only import .csv bundles whose stem does not already have a lossless .jsonl sibling
  const jsonlStems = new Set(jsonlFiles.map((f) => f.replace(/\.jsonl$/i, '')));
  for (const name of csvFiles) {
    if (jsonlStems.has(name.replace(/\.csv$/i, ''))) continue;
    const text = await zip.files[name]!.async('text');
    parsedBundles.push({ source: name, parsed: csvToTelemetryBundle(text) });
  }

  // 1. Restore revisions first so historical session pins survive markdown saves
  for (const { source, parsed } of parsedBundles) {
    for (const bundle of parsed.bundles) {
      if (!bundle.revisions || bundle.revisions.length === 0) continue;
      const bundleNoteId = bundle.note?.id ?? bundle.revisions[0]?.noteId;
      try {
        const persistence = provider.persistenceStorage;
        if (!persistence) throw new Error('Revision import requires provider.persistenceStorage');
        await provider.persistenceReady;
        await persistence.saveBlockRevisions(bundle.revisions);
      } catch (err) {
        if (bundleNoteId) failedRevisionNotes.add(bundleNoteId);
        errors.push(
          `${source}: Failed to restore revisions for ${bundleNoteId ?? 'unknown'}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // 2. Import Markdown notes
  for (const filename of mdFiles) {
    try {
      const content = await zip.files[filename]!.async('text');
      const entry = createNoteFromMarkdown(content, clock);
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
    } catch (err) {
      errors.push(`Failed to import ${filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Import telemetry sessions & events
  for (const { source, parsed } of parsedBundles) {
    errors.push(...parsed.errors.map((e) => `${source}: ${e}`));
    const res = await importTelemetryBundlesIntoProvider(parsed.bundles, provider, {
      skipNotes: noteIds,
      revisionsRestored: true,
      skipBundles: failedRevisionNotes,
    });
    for (const id of res.noteIds) noteIds.add(id);
    sessionsImported += res.sessions;
    eventsImported += res.events;
    errors.push(...res.errors.map((e) => `${source}: ${e}`));
  }

  return { imported: noteIds.size, sessionsImported, eventsImported, errors };
}

// ── Consistent Feed Publishing (Self-Hosted Server vs Browser IndexedDB Repo) ─

export interface OutboundFeedStatus extends UnpublishedFeedStatus {
  mode: 'self-hosted' | 'browser-repo';
  feedUrl?: string;
}

export async function getOutboundFeedStatus(): Promise<OutboundFeedStatus> {
  if (storageBackend === 'api') {
    const apiBase = import.meta.env.VITE_API_URL ?? '/api';
    const res = await fetch(`${apiBase}/v1/feed/status`);
    if (res.ok) {
      const data = (await res.json()) as UnpublishedFeedStatus & { feedUrl?: string };
      return { ...data, mode: 'self-hosted' };
    }
  }
  await whenStorageReady();
  const localStatus = await checkUnpublishedFeedChanges(storage);
  return { ...localStatus, mode: 'browser-repo' };
}

export async function publishSelfHostedFeed(
  options: Pick<PublishFeedOptions, 'name' | 'description' | 'repositoryUrl' | 'notebookSlug'> = {},
): Promise<{ report: PublishFeedReport; feedUrl: string }> {
  const apiBase = import.meta.env.VITE_API_URL ?? '/api';
  const res = await fetch(`${apiBase}/v1/feed/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Publish failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as PublishFeedReport & { feedUrl: string };
  return { report: data, feedUrl: data.feedUrl };
}

export async function exportFeedRepositoryZip(
  options: Pick<PublishFeedOptions, 'name' | 'description' | 'repositoryUrl' | 'notebookSlug'> = {},
): Promise<PublishFeedReport> {
  await whenStorageReady();
  const zipTree = new ZipFeedTree();
  const report = await publishFeedFromStorage(storage, zipTree, {
    ...options,
    layout: 'repository',
    recordCheckpoint: true,
  });
  const blob = await zipTree.toBlob();
  const slug = (options.name ?? 'wod-wiki-feed-repository')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'wod-wiki-feed-repository';
  downloadBlob(blob, `${slug}.zip`);
  return report;
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function exportFeedRepositoryToDirectory(
  options: Pick<PublishFeedOptions, 'name' | 'description' | 'repositoryUrl' | 'notebookSlug'> = {},
): Promise<PublishFeedReport | null> {
  const win = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandleLike>;
  };
  if (!win.showDirectoryPicker) {
    throw new Error('Directory picker is not supported in this browser; use ZIP export instead.');
  }
  let dirHandle: FileSystemDirectoryHandleLike;
  try {
    dirHandle = await win.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return null; // user cancelled picker
  }
  await whenStorageReady();
  const tree = new DirectoryHandleFeedTree(dirHandle);
  return publishFeedFromStorage(storage, tree, {
    ...options,
    layout: 'repository',
    recordCheckpoint: true,
  });
}
