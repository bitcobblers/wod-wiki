/**
 * Fake-data corpus loader (spec: wayfinder test-validation-harness asset
 * 002, v1.1). Reads the journal catalog at `packages/wql/fixtures/corpus/`
 * and builds in-memory stores over one journal — the same seam shape
 * `inMemoryEventStore` provides in the engine package, kept local because
 * wql tests must not import engine (engine depends on wql).
 *
 * Notes carry authored source/maps. Immutable revisions and Sessions pin
 * the same occurrences; the corpus parser validates those relationships.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import type { NoteQueryStore, EventStore } from '../../src/stores';
import { parseCorpusJournal, type CorpusJournal } from '../../fixtures/corpus/journal';
export type { CorpusJournal } from '../../fixtures/corpus/journal';


export const CORPUS_DIR = join(__dirname, '../../fixtures/corpus');
/** Catalog filenames in directory order. */
export function listCorpusJournals(): string[] {
  return readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.json'));
}

export const CORPUS_JOURNALS: string[] = listCorpusJournals();

/** Load one journal by filename; throws with file context on bad JSON. */
export function loadJournal(file: string): CorpusJournal {
  const raw = readFileSync(join(CORPUS_DIR, file), 'utf-8');
  try {
    return parseCorpusJournal(JSON.parse(raw));
  } catch (e) {
    throw new Error(`corpus/${file}: invalid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
}

/** In-memory store pair over one journal — event rows + note tags. */
export function journalStores(journal: CorpusJournal): {
  eventStore: EventStore;
  noteStore: NoteQueryStore;
} {
  const rows = [...journal.records];
  const tagsByNote = new Map(journal.notes.map((n) => [n.id, n.tags ?? []]));

  const eventStore: EventStore = {
    getEventsByTimeRange: (start, end) =>
      Promise.resolve(rows.filter((r) => r.timestamp >= start && r.timestamp <= end)),
    getEventsByResult: (resultId) => Promise.resolve(rows.filter((r) => r.resultId === resultId)),
    getEventsForNote: (noteId) => Promise.resolve(rows.filter((r) => r.noteId === noteId)),
    getEventsByContent: (blockContentId) =>
      Promise.resolve(rows.filter((r) => r.blockContentId === blockContentId)),
    scanAll: () => Promise.resolve(rows),
    appendEvents: async (appended) => {
      rows.push(...appended);
    },
    finalizeSummaries: async () => {},
    deleteEvents: async () => {},
  };

  const noteStore: NoteQueryStore = {
    getAllNotes: () => Promise.resolve(journal.notes),
    getNoteIdsForTag: (label) =>
      Promise.resolve(
        new Set(journal.notes.filter((n) => (n.tags ?? []).includes(label)).map((n) => n.id)),
      ),
    getNoteTagLabels: (noteId) => Promise.resolve(tagsByNote.get(noteId) ?? []),
  };

  return { eventStore, noteStore };
}
