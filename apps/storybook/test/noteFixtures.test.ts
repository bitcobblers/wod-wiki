import { describe, expect, it } from 'vitest';
import { parseDocumentSections, reconcileNoteBlocks, validateNoteBlocks } from '@bitcobblers/wod-wiki-core';
import type { Note, BlockRevision } from '@bitcobblers/wod-wiki-core';
import noteEditorData from '../src/screens/data/note-editor';
import journalDateStackData from '../src/screens/data/journal-date-stack';
import sessionDetailData from '../src/screens/data/session-detail';
import { JOURNALS, buildServiceForJournal, deriveBlockIndex } from '../src/gallery/journals';
import { isFindQuery, parseQuery } from '@bitcobblers/wod-wiki-engine';
import type { CorpusJournal } from '../../../packages/wql/fixtures/corpus/journal';

function expectSavedNote(note: Note, revisions: readonly BlockRevision[]): void {
  validateNoteBlocks(note.rawContent, note.blocks, note.sourceRevision);
  for (const block of Object.values(note.blocks)) {
    const revision = revisions.find((saved) => saved.noteId === note.id && saved.blockId === block.id && saved.version === block.version);
    expect(revision).toBeDefined();
    expect(revision?.rawContent).toBe(note.rawContent.slice(block.from, block.to));
    expect(revision?.kind).toBe(block.kind);
    expect(revision?.dialect).toBe(block.dialect);
    expect(revision?.sport).toBe(block.sport);
  }
}

describe('whole Note story fixtures', () => {
  it('stores prose in the Note and revisions only for actionable ranges', () => {
    expectSavedNote(noteEditorData.note, noteEditorData.revisions);
    expect(Object.values(noteEditorData.note.blocks)).toHaveLength(1);
    expect(noteEditorData.note.rawContent).toContain('Active recovery');
    expect(noteEditorData.revisions.every((revision) => !revision.rawContent.includes('Active recovery'))).toBe(true);
    for (const note of journalDateStackData.notes) expectSavedNote(note, journalDateStackData.revisions);
  });

  it('retains both saved workout versions without fabricating a Session', () => {
    expect(noteEditorData.revisions.map((revision) => revision.version)).toEqual([1, 2]);
    expect(noteEditorData.revisions[0].savedAt).toBeLessThan(noteEditorData.revisions[1].savedAt);
    expect(noteEditorData.revisions[0].rawContent).not.toContain('*:45 Rest');
    expect(noteEditorData.revisions[1].rawContent).toContain('*:45 Rest');
    expect(noteEditorData.note.blocks['triplet-workout'].version).toBe(2);
  });

  it('indexes workouts, queries, registered widgets and embeds but not prose or unknown fences', () => {
    const rawContent = [
      '# Mixed authored Note', '', 'Recovery prose stays outside the map.', '',
      '```time', '10 Push-ups', '```', '',
      '```query', 'sum:rep{}', '```', '',
      '```widget:attention', 'Keep a steady pace.', '```', '',
      '[Workout video](https://www.youtube.com/watch?v=fixture)', '',
      '```widget:unknown', 'Recoverable source.', '```',
    ].join('\n');
    let nextId = 0;
    const note: Note = {
      id: 'mixed-story-note', title: 'Mixed authored Note', createdAt: 1, sourceRevision: 1, rawContent,
      blocks: reconcileNoteBlocks(rawContent, { sourceRevision: 1, createId: () => `occurrence-${nextId++}` }),
    };
    validateNoteBlocks(note.rawContent, note.blocks, note.sourceRevision);
    const rows = deriveBlockIndex({ ...JOURNALS.crossfit, notes: [note], records: [], blockRevisions: [], sessions: [] });
    expect(rows.map((row) => row.dataType)).toEqual(['wod', 'query', 'widget', 'embed']);
    expect(rows.some((row) => row.rawContent.includes('Recovery prose'))).toBe(false);
    expect(rows.some((row) => row.rawContent.includes('widget:unknown'))).toBe(false);
  });

  it('pins the session and runtime segment events to the same immutable workout revision', () => {
    const { note, revision, session, statements } = sessionDetailData;
    expectSavedNote(note, [revision]);
    expect(session.noteId).toBe(revision.noteId);
    expect(session.blockId).toBe(revision.blockId);
    expect(session.blockVersion).toBe(revision.version);
    expect(statements.some((statement) => statement.outputType === 'segment')).toBe(true);
    for (const statement of statements) {
      expect(statement.blockId).toBe(session.blockId);
      expect(statement.blockVersion).toBe(session.blockVersion);
    }
  });

  it('keeps WQL :segment scoped to runtime output events', async () => {
    const journal: CorpusJournal = {
      ...JOURNALS.crossfit,
      notes: [sessionDetailData.note],
      blockRevisions: [sessionDetailData.revision],
      sessions: [sessionDetailData.session],
      records: sessionDetailData.statements,
    };
    const query = parseQuery(`:segment{result:${sessionDetailData.session.id}}`);
    if (!isFindQuery(query)) throw new Error('Expected runtime segment query');
    const result = await buildServiceForJournal(journal).runFind(query);
    expect(result.table?.totalCount).toBe(3);
    expect(result.blocks).toEqual([]);
  });

  it('projects corpus blocks from authored Notes rather than event rows or titles', () => {
    for (const journal of Object.values(JOURNALS)) {
      for (const note of journal.notes) expectSavedNote(note, journal.blockRevisions);
      const rows = deriveBlockIndex(journal);
      expect(rows).toEqual(deriveBlockIndex({ ...journal, records: [] }));
      expect(rows).toHaveLength(journal.notes.reduce((count, note) => count + Object.keys(note.blocks).length, 0));
      for (const row of rows) {
        const note = journal.notes.find((candidate) => candidate.id === row.noteId);
        expect(note).toBeDefined();
        expect(row.rawContent).toBe(note?.rawContent.slice(row.from, row.to));
        expect(row.id).toBe(`${row.noteId}:${row.blockId}`);
        expect(row.blockContentId).toBe(parseDocumentSections(row.rawContent).find((section) => section.scriptBlock)?.contentId);
      }
      for (const session of journal.sessions) {
        expect(journal.blockRevisions.some((revision) => revision.noteId === session.noteId && revision.blockId === session.blockId && revision.version === session.blockVersion)).toBe(true);
      }
    }
  });

  it('finds prose through Notes and keeps duplicate actionable occurrences distinct', async () => {
    const fence = '```time\n// Fran\n(21-15-9)\n  Thrusters 95 lb\n  Pull-ups\n```';
    const prose = '# Training diary\n\nRecoveryonly 🏋️ stays in authored prose.\n\n';
    const rawContent = `${prose}${fence}\n\n${fence}`;
    const note: Note = {
      id: 'duplicate-story-note', title: 'Training diary', createdAt: 1, sourceRevision: 1, rawContent,
      blocks: {
        first: { id: 'first', kind: 'wod', version: 1, sourceRevision: 1, from: prose.length, to: prose.length + fence.length, dialect: 'time' },
        second: { id: 'second', kind: 'wod', version: 1, sourceRevision: 1, from: prose.length + fence.length + 2, to: rawContent.length, dialect: 'time' },
      },
    };
    const blockRevisions: BlockRevision[] = Object.values(note.blocks).map((block) => ({
      noteId: note.id, blockId: block.id, version: block.version, kind: block.kind,
      rawContent: fence, dialect: block.dialect, savedAt: note.createdAt,
    }));
    const journal: CorpusJournal = { ...JOURNALS.crossfit, notes: [note], records: [], blockRevisions, sessions: [] };
    const service = buildServiceForJournal(journal);
    const notesQuery = parseQuery(':note{text:Recoveryonly}');
    const proseBlocksQuery = parseQuery(':block{text:Recoveryonly}');
    const workoutQuery = parseQuery(':block{text:Fran}');
    if (!isFindQuery(notesQuery) || !isFindQuery(proseBlocksQuery) || !isFindQuery(workoutQuery)) throw new Error('Expected content find queries');
    const notes = await service.runFind(notesQuery);
    const proseBlocks = await service.runFind(proseBlocksQuery);
    const workouts = await service.runFind(workoutQuery);
    expect(notes.notes.map((found) => found.id)).toEqual([note.id]);
    expect(proseBlocks.blocks).toEqual([]);
    expect(workouts.blocks.map((block) => block.blockId)).toEqual(['first', 'second']);
    expect(workouts.blocks[0].blockContentId).toBe(workouts.blocks[1].blockContentId);
  });
});
