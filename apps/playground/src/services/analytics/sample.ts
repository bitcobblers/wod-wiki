/**
 * Sample analytics dataset (PRD #767 §5, WW-056, WW-019).
 *
 * Delegates corpus generation to `@bitcobblers/wod-wiki-engine`'s canonical
 * `sampleCorpus` so prebuilt dashboards (Benchmark PR Board, Strength
 * Progression, Recovery & Readiness, Climbing, Endurance, Training Block) all
 * receive identical benchmark tags, session-level `effortSlug`s, and calc
 * rollups, while signaling `feedReadiness` import activity while running.
 */
import { eventsToStoredLogs, toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import { blockContentId, parseNoteBundleFromJsonl, reconcileNoteBlocks, serializeNoteBundleToJsonl, type NoteTelemetryBundle } from '@bitcobblers/wod-wiki-core';
import { SAMPLE_TAG, buildSessionLogs, generateSampleSessions, type SampleSession } from '@bitcobblers/wod-wiki-engine';
import type { Session } from '@/types/storage';
import { beginImportActivity, endImportActivity } from '@/services/feed/feedReadiness';
import { storageService, type StorageService } from '@/services/storage';

/**
 * Backing store, injectable for tests. The full suite has sibling files
 * that stub this module process-globally; tests construct a real instance and
 * install it here (same pattern as queryService integration tests).
 */
let service: StorageService = storageService;

export function setSampleDataService(instance: StorageService): void {
  service = instance;
}

const SAMPLE_BROADCAST_CHANNEL = 'wodwiki.sample';
const sampleChangeListeners = new Set<() => void>();
let sampleChannel: BroadcastChannel | null = null;

function ensureSampleChannel(): void {
  if (sampleChannel || typeof BroadcastChannel === 'undefined') return;
  try {
    sampleChannel = new BroadcastChannel(SAMPLE_BROADCAST_CHANNEL);
    sampleChannel.onmessage = (event) => {
      if ((event.data as { kind?: string } | null)?.kind === 'sample-changed') {
        for (const listener of sampleChangeListeners) listener();
      }
    };
  } catch {
    // Cross-tab BroadcastChannel unavailable; in-tab listeners still receive notifications.
  }
}

function notifySampleDataChanged(): void {
  for (const listener of sampleChangeListeners) {
    listener();
  }
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const ch = new BroadcastChannel(SAMPLE_BROADCAST_CHANNEL);
      ch.postMessage({ kind: 'sample-changed' });
      ch.close();
    } catch {
      // Cross-tab BroadcastChannel unavailable; in-tab listeners already notified.
    }
  }
}

export function onSampleDataChanged(listener: () => void): () => void {
  sampleChangeListeners.add(listener);
  ensureSampleChannel();
  return () => {
    sampleChangeListeners.delete(listener);
    if (sampleChangeListeners.size === 0 && sampleChannel) {
      sampleChannel.close();
      sampleChannel = null;
    }
  };
}

function buildSampleResult(session: SampleSession, contentId: string, createdAt: number): Session {
  const baseId = `sample-${session.noteId}`;
  const resultId = `${baseId}-result`;
  const startTime = session.timestamp;
  const endTime = startTime + session.durationSeconds * 1000;

  return {
    id: resultId,
    noteId: session.noteId,
    blockId: 'sample-block',
    blockVersion: 1,
    blockContentId: contentId,
    origin: 'journal',
    status: 'completed',
    createdAt,
    startTime,
    endTime,
    duration: session.durationSeconds * 1000,
    completed: true,
  };
}

function attachSummaryStats(rows: ReturnType<typeof toSummaryEventRows>) {
  return rows.map((row) => {
    const metric = row.metrics[0];
    if (metric && typeof metric.value === 'number') {
      return {
        ...row,
        reducerStats: {
          observedCount: 1,
          sum: metric.value,
          min: metric.value,
          max: metric.value,
        },
      };
    }
    return row;
  });
}

function buildSampleBundle(session: SampleSession, now: number) {
  const body = session.movements.map(movement => `${movement.distanceMeters ? `${movement.distanceMeters}m` : movement.reps} ${movement.effortSlug.replaceAll('-', ' ')}${movement.loadLbs ? ` ${movement.loadLbs}lb` : ''}`).join('\n');
  const rawContent = `# ${session.title}\n\n\`\`\`log\n${body}\n\`\`\`\n`;
  const blocks = reconcileNoteBlocks(rawContent, { sourceRevision: 1, createId: () => 'sample-block' });
  const logs = buildSessionLogs(session);
  const result = buildSampleResult(session, blockContentId(body), now);
  const identity = {
    noteId: session.noteId,
    resultId: result.id,
    blockId: result.blockId,
    blockVersion: result.blockVersion,
    blockContentId: result.blockContentId,
    origin: result.origin,
    pageId: result.pageId,
    workoutTimestamp: session.timestamp,
  };
  const rawEvents = toEventRows(logs, identity);
  const summaries = attachSummaryStats(toSummaryEventRows(logs, identity));
  const tags = Array.from(new Set([SAMPLE_TAG, ...session.tags]));
  const bundle: NoteTelemetryBundle = {
    note: {
      id: session.noteId,
      title: session.title,
      createdAt: session.timestamp,
      updatedAt: session.timestamp,
      targetDate: session.timestamp,
      rawContent,
      sourceRevision: 1,
      blocks,
      tags,
      type: 'playground',
    },
    sessions: [result],
    events: [...rawEvents, ...summaries],
  };
  return { bundle, rawContent, blocks, result, rawEvents, summaries, tags };
}

async function getSampleTagId(): Promise<string | undefined> {
  const tag = await service.getTagByLabel(SAMPLE_TAG);
  return tag?.id;
}

async function getSampleNoteIds(): Promise<string[]> {
  const notes = await service.getNotesForTag(SAMPLE_TAG);
  return notes.map(n => n.id);
}

export async function hasSampleData(): Promise<boolean> {
  const noteIds = await getSampleNoteIds();
  if (noteIds.length === 0) return false;
  const events = await service.scanAll();
  return events.some((event) => noteIds.includes(event.noteId));
}

let inflightLoadSampleData: Promise<{ facts: number }> | null = null;

async function loadSampleDataImpl(): Promise<{ facts: number }> {
  beginImportActivity('Loading sample data…');
  try {
    if (await hasSampleData()) {
      const noteIds = await getSampleNoteIds();
      const events = await service.scanAll();
      return { facts: events.filter((event) => event.grain === 'summary' && noteIds.includes(event.noteId)).length };
    }

    const now = Date.now();
    const sessions = generateSampleSessions(now);
    let factsWritten = 0;

    for (const session of sessions) {
      const sample = buildSampleBundle(session, now);
      factsWritten += await service.withTransaction(['notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment', 'efforts', 'equipment', 'tags', 'note_tags', 'tag_types', 'sessions', 'events'], async scoped => {
        await scoped.saveNoteSource({ noteId: session.noteId, rawContent: sample.rawContent, blocks: sample.blocks, expectedSourceRevision: 0, metadata: { title: session.title, tags: sample.tags }, noteType: 'playground', createdAt: session.timestamp });
        await scoped.setNoteTags(session.noteId, sample.tags);
        await scoped.saveSession(sample.result);
        await scoped.appendEvents(sample.rawEvents);
        await scoped.finalizeSummaries(sample.result.id, sample.summaries);
        return sample.summaries.length;
      });
    }

    notifySampleDataChanged();
    return { facts: factsWritten };
  } finally {
    endImportActivity();
  }
}

export function loadSampleData(): Promise<{ facts: number }> {
  if (inflightLoadSampleData !== null) return inflightLoadSampleData;
  inflightLoadSampleData = loadSampleDataImpl().finally(() => {
    inflightLoadSampleData = null;
  });
  return inflightLoadSampleData;
}

export function exportSampleDataAsJsonl(now: number = Date.now()): string {
  return generateSampleSessions(now)
    .map((session) => serializeNoteBundleToJsonl(buildSampleBundle(session, now).bundle))
    .join('\n');
}

export async function importSampleDataFromJsonl(jsonlText: string): Promise<{ notes: number; sessions: number; facts: number }> {
  const parsed = parseNoteBundleFromJsonl(jsonlText);
  if (parsed.errors.length > 0) throw new Error(`Invalid sample JSONL: ${parsed.errors.join('; ')}`);

  beginImportActivity('Importing sample data…');
  try {
    let notes = 0;
    let sessions = 0;
    let facts = 0;

    for (const bundle of parsed.bundles) {
      const note = bundle.note;
      if (!note) throw new Error('Sample JSONL bundle is missing its note');
      const tags = Array.from(new Set([SAMPLE_TAG, ...(note.tags ?? [])]));
      await service.withTransaction(['notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment', 'efforts', 'equipment', 'tags', 'note_tags', 'tag_types', 'sessions', 'events'], async scoped => {
        const previous = await scoped.getNote(note.id);
        await scoped.saveNoteSource({
          noteId: note.id,
          rawContent: note.rawContent,
          blocks: note.blocks,
          expectedSourceRevision: previous?.sourceRevision ?? 0,
          metadata: { title: note.title, targetDate: note.targetDate, tags },
          noteType: 'playground',
          createdAt: note.createdAt,
        });
        await scoped.setNoteTags(note.id, tags);
        for (const session of bundle.sessions) {
          const rows = bundle.events.filter((event) => event.resultId === session.id);
          const raw = rows.filter((event) => event.grain === 'event');
          const suppliedSummaries = rows.filter((event) => event.grain === 'summary');
          const summaries = suppliedSummaries.length > 0 ? suppliedSummaries : attachSummaryStats(toSummaryEventRows(eventsToStoredLogs(raw), {
            noteId: session.noteId,
            resultId: session.id,
            blockId: session.blockId,
            blockVersion: session.blockVersion,
            blockContentId: session.blockContentId,
            origin: session.origin,
            pageId: session.pageId,
            workoutTimestamp: session.startTime,
          }));
          await scoped.saveSession(session);
          await scoped.appendEvents(raw);
          await scoped.finalizeSummaries(session.id, summaries);
          sessions++;
          facts += summaries.length;
        }
      });
      notes++;
    }
    notifySampleDataChanged();
    return { notes, sessions, facts };
  } finally {
    endImportActivity();
  }
}

export async function purgeSampleData(): Promise<void> {
  beginImportActivity('Purging sample data…');
  try {
    const noteIds = await getSampleNoteIds();
    if (noteIds.length === 0) return;

    // Removing a sample Note does not garbage-collect its pinned history.
    for (const noteId of noteIds) {
      await service.deleteEvents((await service.getEventsForNote(noteId)).map(event => event.id));
      await service.deleteNote(noteId);
    }

    // Drop the shared sample tag if nothing links to it anymore.
    const notes = await service.getNotesForTag(SAMPLE_TAG);
    if (notes.length === 0) {
      const tagId = await getSampleTagId();
      if (tagId) {
        await service.deleteTag(tagId);
      }
    }
    notifySampleDataChanged();
  } finally {
    endImportActivity();
  }
}
