import { describe, expect, it } from 'vitest';
import { parseQuery, type ParsedFindQuery } from '../src/wql';
import { allowedFilterTypesForTarget, wqlFilterKeys } from '../src/capabilities';
import { WQL_TYPED_TAG_KEYS } from '../src/vocabulary';
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

  it('note and block grouping is open over note properties — typed tags and custom types stay silent', () => {
    expect(parseQuery(':note{source:journal} by {domain}').advisories).toBeUndefined();
    expect(parseQuery(':block{source:journal} by {equipment}').advisories).toBeUndefined();
    // Any configured tag type names a property dimension — no vocabulary check.
    expect(parseQuery(':note{source:journal} by {gym}').advisories).toBeUndefined();
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

describe('container-plane capability sets (ticket 08)', () => {
  it('notebook advertises the note plane’s member-criteria keys — never silently ignored', () => {
    const notebook = wqlFilterKeys('notebook', 'find');
    for (const key of ['text', 'notebook', 'tags', 'effort', 'type', 'source', 'page', 'note', ...WQL_TYPED_TAG_KEYS]) {
      expect(notebook, key).toContain(key);
    }
    expect(notebook).toEqual(wqlFilterKeys('note', 'find'));
  });

  it('page/tag/equipment do not advertise groupby — their executors return flat rows', () => {
    for (const target of ['page', 'tag', 'equipment']) {
      expect([...allowedFilterTypesForTarget(target, 'find')], target).not.toContain('groupby');
    }
    // Grouping stays advertised on the note plane — the notebook head
    // delegates there, so `:notebook{} by {tag}` groups like `:note`.
    expect([...allowedFilterTypesForTarget('note', 'find')]).toContain('groupby');
  });

  it('container planes disclose unsupported keys instead of ignoring them', () => {
    expect(parseQuery(':page{tags:pr}').advisories?.join(' ') ?? '').toContain('tags');
    expect(parseQuery(':equipment{effort:fran}').advisories?.join(' ') ?? '').toContain('effort');
    // Both tag spellings are real label filters on the tag plane — applied,
    // not disclosed as ignored.
    expect(parseQuery(':tag{tags:pr}').advisories).toBeUndefined();
  });
});
