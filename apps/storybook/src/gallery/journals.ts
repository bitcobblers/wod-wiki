import {
  QueryService,
  inMemoryEventStore,
  type BlockIndexRow,
  type BlockQueryStore,
  type EffortQueryStore,
  type NoteQueryStore,
} from '@bitcobblers/wod-wiki-engine';
import { parseDocumentSections } from '@bitcobblers/wod-wiki-core';
import { bundledEfforts } from '@bitcobblers/wod-wiki-lang';
import { parseCorpusJournal, type CorpusJournal } from '../../../../packages/wql/fixtures/corpus/journal';

import crossfitJournal from '../../../../packages/wql/fixtures/corpus/crossfit-multi-week.json';
import enduranceJournal from '../../../../packages/wql/fixtures/corpus/endurance-block.json';
import wellnessJournal from '../../../../packages/wql/fixtures/corpus/mixed-wellness.json';
import climbJournal from '../../../../packages/wql/fixtures/corpus/climb-yoga.json';

export type JournalKey = 'crossfit' | 'endurance' | 'wellness' | 'climb';

export const JOURNALS: Record<JournalKey, CorpusJournal> = {
  crossfit: parseCorpusJournal(crossfitJournal),
  endurance: parseCorpusJournal(enduranceJournal),
  wellness: parseCorpusJournal(wellnessJournal),
  climb: parseCorpusJournal(climbJournal),
};

export function newestTimestamp(journal: CorpusJournal): number {
  return Math.max(...journal.records.map((record) => record.timestamp));
}

export function deriveBlockIndex(journal: CorpusJournal): BlockIndexRow[] {
  return journal.notes.flatMap((note) => {
    const sections = parseDocumentSections(note.rawContent);
    return Object.values(note.blocks).sort((left, right) => left.from - right.from).map((block, position) => ({
      id: `${note.id}:${block.id}`,
      noteId: note.id,
      blockId: block.id,
      blockVersion: block.version,
      sourceRevision: note.sourceRevision,
      from: block.from,
      to: block.to,
      position,
      dataType: block.kind,
      blockContentId: sections.find((section) => section.from === block.from && section.to === block.to)?.contentId,
      rawContent: note.rawContent.slice(block.from, block.to),
      noteTitle: note.title,
      createdAt: note.createdAt,
      sourceId: note.sourceId,
      sourcePath: note.sourcePath,
    }));
  });
}

const bundledEffortStore: EffortQueryStore = {
  getAllEfforts: async () => bundledEfforts.map((effort) => ({
    ...effort,
    baseAttributes: { ...effort.baseAttributes },
  })),
};

export function buildServiceForJournal(journal: CorpusJournal): QueryService {
  const noteStore: NoteQueryStore = {
    getAllNotes: async () => journal.notes,
    getNoteIdsForTag: async (label) => new Set(
      journal.notes.filter((note) => note.tags?.includes(label)).map((note) => note.id),
    ),
    getNoteTagLabels: async (noteId) => journal.notes.find((note) => note.id === noteId)?.tags ?? [],
  };
  const blockStore: BlockQueryStore = {
    getAllBlocks: async () => deriveBlockIndex(journal),
  };
  return new QueryService(
    inMemoryEventStore(journal.records),
    noteStore,
    blockStore,
    bundledEffortStore,
  );
}
