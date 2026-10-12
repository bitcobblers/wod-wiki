import { describe, expect, it } from 'vitest';

import { KNOWN_OUTPUT_TYPES, type EventRecord } from '@bitcobblers/wod-wiki-core';
import { EFFORT_DISCIPLINES } from '../src/disciplines';
import { QueryService } from '../src/QueryService';
import {
  listCorpusJournals,
  loadJournal,
  journalStores,
  CORPUS_JOURNALS,
} from './harness/corpus';
import { parseCorpusJournal } from '../fixtures/corpus/journal';

const KNOWN_ENVELOPE_KEYS = ['$schema', 'kind', 'id', 'title', 'description', 'notes', 'records', 'blockRevisions', 'sessions'] as const;

describe('fake-data corpus', () => {
  it('discovers the four catalog journals', () => {
    expect(listCorpusJournals().sort()).toEqual([
      'climb-yoga.json',
      'crossfit-multi-week.json',
      'endurance-block.json',
      'mixed-wellness.json',
    ]);
  });

  it('rejects a Note without authored source and a conflicting revision slice', () => {
    const journal = loadJournal('crossfit-multi-week.json');
    expect(() => parseCorpusJournal({ ...journal, notes: [{ ...journal.notes[0], blocks: undefined }] })).toThrow();
    expect(() => parseCorpusJournal({ ...journal, blockRevisions: journal.blockRevisions.map((row, index) =>
      index === 0 ? { ...row, rawContent: 'wrong source' } : row) })).toThrow();
  });
  describe.each(CORPUS_JOURNALS)('%s', (file) => {
    const journal = loadJournal(file);

    it('envelope: id matches filename, kind, known keys only, title present', () => {
      expect(journal.kind).toBe('event-journal');
      expect(journal.id).toBe(file.replace(/\.json$/, ''));
      expect(journal.title).toBeTruthy();
      expect(Object.keys(journal).every((k) => (KNOWN_ENVELOPE_KEYS as readonly string[]).includes(k))).toBe(true);
      expect(journal.records.length).toBeGreaterThan(0);
      expect(journal.notes.length).toBeGreaterThan(0);
    });
    it('keeps authored source slices and immutable session pins coherent', () => {
      for (const note of journal.notes) {
        expect(note.sourceRevision).toBe(1);
        expect(note.rawContent).toContain(note.title);
        for (const block of Object.values(note.blocks)) {
          const revision = journal.blockRevisions.find(row => row.noteId === note.id && row.blockId === block.id && row.version === block.version);
          expect(revision?.rawContent).toBe(note.rawContent.slice(block.from, block.to));
          expect(block.kind).toBe('wod');
        }
      }
      for (const session of journal.sessions) {
        expect(journal.blockRevisions.some(row => row.noteId === session.noteId && row.blockId === session.blockId && row.version === session.blockVersion)).toBe(true);
      }
    });

    it('record ids are unique and follow the id grammar', () => {
      const seen = new Set<string>();
      for (const r of journal.records) {
        expect(seen.has(r.id), `duplicate id ${r.id}`).toBe(false);
        seen.add(r.id);
        if (r.id.startsWith('wellness:')) continue;
        if (r.grain === 'summary') {
          expect(r.id).toMatch(/:summary:/);
        } else {
          expect(r.id).toMatch(/:\d+$/);
        }
      }
    });

    it('referential integrity: noteIds resolve; resultIds non-empty; blocks well-formed', () => {
      const noteIds = new Set(journal.notes.map((n) => n.id));
      for (const r of journal.records) {
        expect(r.resultId.length, `empty resultId on ${r.id}`).toBeGreaterThan(0);
        expect(noteIds.has(r.noteId), `${r.id} references unknown noteId ${r.noteId}`).toBe(true);
        if (r.blockContentId !== undefined) {
          expect(r.blockContentId).toMatch(/^blk-[a-z0-9-]+$/);
        }
      }
    });

    it('grain/outputType/canonicalKey contracts hold', () => {
      for (const r of journal.records) {
        expect(['event', 'summary']).toContain(r.grain);
        expect(KNOWN_OUTPUT_TYPES as readonly string[]).toContain(r.outputType);
        if (r.grain === 'summary') {
          expect(r.metrics).toHaveLength(1);
          expect(r.metrics[0].metadata?.canonicalKey).toBeTruthy();
        }
        const discipline = r.metrics[0].metadata?.effortDiscipline;
        if (discipline !== undefined) {
          expect(EFFORT_DISCIPLINES as readonly string[]).toContain(discipline);
        }
      }
    });

    it('timestamps are non-decreasing within each result', () => {
      const byResult = new Map<string, EventRecord[]>();
      for (const r of journal.records) {
        const group = byResult.get(r.resultId) ?? [];
        group.push(r);
        byResult.set(r.resultId, group);
      }
      for (const [resultId, rows] of byResult) {
        const stamps = rows.map((r) => r.timestamp);
        const sorted = [...stamps].sort((a, b) => a - b);
        expect(stamps, `${resultId} timestamps out of order`).toEqual(sorted);
      }
    });

    it('feeds QueryService through journalStores (smoke)', async () => {
      const service = new QueryService(journalStores(journal));
      const result = await service.runQuery('sum:tis{}');
      expect(result.error).toBeUndefined();
      expect(result.series[0]?.points.length).toBeGreaterThan(0);
    });
  });

  it('covers all ten disciplines across the catalog', () => {
    const seen = new Set<string>();
    for (const file of CORPUS_JOURNALS) {
      for (const r of loadJournal(file).records) {
        const d = r.metrics[0].metadata?.effortDiscipline;
        if (d !== undefined) seen.add(d);
      }
    }
    expect([...seen].sort()).toEqual([...EFFORT_DISCIPLINES].sort());
  });

  it('spans six or more weeks in the multi-week journals (rollup windows)', () => {
    for (const file of ['crossfit-multi-week.json', 'endurance-block.json']) {
      const stamps = loadJournal(file).records.map((r) => r.timestamp);
      const spanDays = (Math.max(...stamps) - Math.min(...stamps)) / 86_400_000;
      expect(spanDays).toBeGreaterThanOrEqual(35);
    }
  });
});
