import { describe, expect, it } from 'vitest';
import { parseQuery, type ParsedFindQuery } from '../src/wql';
import { QueryService, type EventStore, type NoteQueryStore } from '../src/QueryService';
import type { Note } from '@bitcobblers/wod-wiki-core';

const CREATED = Date.UTC(2026, 0, 10);
const note = (id: string): Note => ({ id, title: id, type: 'note', createdAt: CREATED, sourceId: 'journal', rawContent: '', sourceRevision: 1, blocks: {} });

const makeNoteStore = (notes: Note[]): NoteQueryStore => ({
  getAllNotes: async () => notes,
  getNoteIdsForTag: async () => new Set<string>(),
  getNoteTagLabels: async () => [],
} as unknown as NoteQueryStore);

const findAst = (filters: ParsedFindQuery['filters']): ParsedFindQuery => ({ family: 'find', raw: '', target: 'note', filters });
const filter = (key: string, value: string) => ({ key, negate: false, values: [{ value, wildcard: false }] });

describe('find target capability advisories', () => {
  it('acceptance query names the ignored key and the recovery target — minimal pinning', () => {
    const parsed = parseQuery(':note{source:journal,discipline:climbing} by {effort}');
    expect(parsed.error).toBeUndefined();
    const advisories = parsed.advisories?.join(' ') ?? '';
    expect(advisories).toContain('discipline');
    expect(advisories).toContain(':effort');
  });

  it('multi-dimension content grouping stays silent (no only-first-dimension warning)', () => {
    const parsed = parseQuery(':note{source:journal} by {week,tag}');
    expect(parsed.error).toBeUndefined();
    expect(parsed.advisories).toBeUndefined();
  });

  it('every find target discloses its unsupported filter keys', () => {
    const cases: Array<[string, string]> = [
      [':note{discipline:climbing}', 'discipline'],
      [':block{domain:crossfit}', 'domain'],
      [':effort{source:journal}', 'source'],
      [':session{type:wod}', 'type'],
      [':segment{plane:load}', 'plane'],
      [':event{text:fran}', 'text'],
    ];
    for (const [query, key] of cases) {
      const parsed = parseQuery(query);
      expect(parsed.error, query).toBeUndefined();
      expect(parsed.advisories?.join(' ') ?? '', query).toContain(key);
    }
  });

  it('effort and session group through content dimensions, not the executor', () => {
    expect(parseQuery(':effort{text:fran} by {discipline}').advisories).toBeUndefined();
    const offDims = parseQuery(':effort{text:fran} by {grade}');
    expect(offDims.advisories?.join(' ') ?? '').toContain('grade');
  });
});

describe('consumer regression: unsupported filters change nothing but the advisories', () => {
  it('discipline on :note keeps baseline IDs and the run names key and alternate target', async () => {
    const service = new QueryService({ eventStore: {} as EventStore, noteStore: makeNoteStore([note('n1'), note('n2')]) });
    const baseline = await service.runFind(findAst([filter('source', 'journal')]));
    const filtered = await service.runFind(findAst([filter('source', 'journal'), filter('discipline', 'climbing')]));
    expect(filtered.notes.map(n => n.id)).toEqual(baseline.notes.map(n => n.id));
    const advisories = filtered.parsed.advisories?.join(' ') ?? '';
    expect(advisories).toContain('discipline');
    expect(advisories).toContain(':effort');
  });
});
