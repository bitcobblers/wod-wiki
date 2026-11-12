import { describe, expect, it } from 'vitest';
import { QueryService, sourceMatches } from '../src/QueryService';
import { parseQuery, suggestWqlSyntaxHint, type ParsedFindQuery } from '../src/wql';
import type { Note, Page, PageNote } from '@bitcobblers/wod-wiki-core';
import type { NoteQueryStore, QueryServiceStores, WqlDomainPredicate, WqlDomainReadResult } from '../src/stores';
import { actionableFixture } from './harness/actionable';

/**
 * WW-024 — `/plan` (`:journal last 2w`) false empty window:
 *   A. the `:journal` source scope must stay residual (the wire's source
 *      predicate cannot decide journal), never a domain selection that
 *      selects zero rows ("0 of 0 · 1 applied"),
 *   B. journal is notebook MEMBERSHIP — a multi-notebook note whose primary
 *      projection is notebook/custom still journals,
 *   C. an undated note placed on a dated journal page is window-dated by
 *      that placement's civil date.
 * Plus WW-034 — the parse-failure syntax hint.
 */

const DAY = 86_400_000;

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return actionableFixture({ id, title: id, createdAt: Date.now() - 300 * DAY, type: 'note', ...overrides },
    [{ id: 's', body: '10 Push-ups' }]).note;
}

const isoOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Anchor the run at today's local noon so "today's page" (local noon) is
// inside a `last 2w` window regardless of when the test executes.
const anchorNow = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const todayIso = isoOf(new Date(anchorNow));
const oldIso = isoOf(new Date(anchorNow - 30 * DAY));

/** Plain journal note: no notebook stamps — the resolver's fallback tier. */
const PLAIN_JOURNAL = makeNote('plain-journal');
/** "My Workout" shape: promoted into a user notebook, base journal kept. */
const MULTI_NOTEBOOK = makeNote('my-workout', { notebookIds: ['notebook/journal', 'notebook/custom'] });
/** A note that lives only in a user notebook — never journal. */
const FOREIGN = makeNote('foreign', { notebookId: 'notebook/custom' });
/** Explicitly dated inside the window, created 300d ago. */
const DATED_IN_WINDOW = makeNote('dated-in-window', { date: anchorNow - DAY });

const JOURNAL_CANDIDATES = [PLAIN_JOURNAL, MULTI_NOTEBOOK, FOREIGN, DATED_IN_WINDOW];

const PAGES: Page[] = [
  { id: 'p-today', date: todayIso, createdAt: anchorNow },
  { id: 'p-old', date: oldIso, createdAt: anchorNow - 30 * DAY },
];

function link(id: string, pageId: string, noteId: string): PageNote {
  return { id, pageId, noteId, position: 1, createdAt: anchorNow };
}

function relationStore(links: PageNote[]): QueryServiceStores['relationStore'] {
  return {
    getBatches: async (ids) => {
      const out = new Map<string, { tags: { label: string }[]; links: PageNote[]; pages: Page[] }>();
      for (const id of ids) {
        const mine = links.filter((l) => l.noteId === id);
        out.set(id, { tags: [], links: mine, pages: mine.map((l) => PAGES.find((p) => p.id === l.pageId)!).filter(Boolean) });
      }
      return out;
    },
  };
}

function noteStore(notes: Note[]): NoteQueryStore {
  return {
    getAllNotes: async () => notes,
    getNoteIdsForTag: async () => new Set<string>(),
    getNoteTagLabels: async () => [],
  };
}

/** The wire's source predicate — exactly the DOMAIN_SOURCE_KINDS the
 *  QueryService may compile into a selection. `journal` is NOT decidable
 *  wire-side: a selection naming it matches nothing (the SQL projection's
 *  source column only covers sourceId shapes). */
const WIRE_SOURCE_KINDS = ['notebooks', 'page', 'pages', 'guide', 'guides', 'playground'];

function wirePredicateHit(row: Note, p: WqlDomainPredicate): boolean {
  const values = 'values' in p ? p.values : [];
  if (p.field === 'sourceFence') return true;
  if (p.field === 'source') return values.some((v) => WIRE_SOURCE_KINDS.includes(v) && sourceMatches(row, v));
  if (p.field === 'type') return values.includes(row.type ?? '');
  if (p.field === 'id') return values.includes(row.id);
  return true;
}

function wireNoteStore(all: Note[], captured: Array<Record<string, unknown>>): NoteQueryStore {
  return {
    ...noteStore(all),
    queryDomain: async (req): Promise<WqlDomainReadResult> => {
      captured.push({ ...req });
      const selected = all.filter((row) => (req.selection ?? []).every((p) => wirePredicateHit(row, p)));
      const filtered = selected.filter((row) => (req.filters ?? []).every((p) => wirePredicateHit(row, p)));
      return {
        plan: 'notes', projectionVersion: 1,
        selectedCount: selected.length, matchedCount: filtered.length,
        rows: filtered,
      };
    },
  };
}

function parse(raw: string): ParsedFindQuery {
  const parsed = parseQuery(raw);
  if (parsed.error || parsed.family !== 'find') throw new Error(`expected find query: ${raw}`);
  return parsed;
}

describe('WW-024 Bug A — the :journal source scope stays residual', () => {
  /** Host-built AST shape: `sourceScope` set, no injected `source:` filter —
   *  exactly the input the unconditional selection push at compileContentRead
   *  mishandles (the wire's source predicate cannot decide journal → 0 rows). */
  const scopedQuery = (): ParsedFindQuery => ({ ...parse(':note{}'), sourceScope: ['journal'] });

  it('never compiles scope:["journal"] into the domain selection (the wire would select 0 rows)', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const service = new QueryService({ noteStore: wireNoteStore(JOURNAL_CANDIDATES, captured) });
    const result = await service.runFind(scopedQuery());
    for (const req of captured) {
      const source = (req.selection as WqlDomainPredicate[] | undefined)?.find((p) => p.field === 'source');
      expect(source).toBeUndefined();
    }
    // Parity with the whole-store path, accurate selected stage included.
    const plain = await new QueryService({ noteStore: noteStore(JOURNAL_CANDIDATES) }).runFind(scopedQuery());
    expect(result.notes.map((n) => n.id).sort()).toEqual(plain.notes.map((n) => n.id).sort());
    expect(result.stages.selected).toBe(3);
  });

  it(':journal last 2w over a domain-backed store keeps the window working ("0 of 0" regression)', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const service = new QueryService({ noteStore: wireNoteStore(JOURNAL_CANDIDATES, captured) });
    const result = await service.runFind({ ...scopedQuery(), window: { kind: 'relative', size: 2, unit: 'w' } }, { anchorNow });
    expect(result.stages.selected).toBe(3);
    // Without a relation store there is no placement to date the undated
    // notes — only the explicitly dated one survives the window.
    expect(result.notes.map((n) => n.id)).toEqual(['dated-in-window']);
  });
});

describe('WW-024 Bug B — journal is notebook membership', () => {
  it('sourceMatches(item, "journal") matches a multi-notebook note whose primary notebook is custom', () => {
    expect(sourceMatches(MULTI_NOTEBOOK, 'journal')).toBe(true);
    expect(sourceMatches(FOREIGN, 'journal')).toBe(false);
  });

  it(':journal{} returns plain and multi-notebook journal notes, not foreign-notebook notes', async () => {
    const service = new QueryService({ noteStore: noteStore(JOURNAL_CANDIDATES) });
    const result = await service.runFind(parse(':journal{}'));
    const ids = result.notes.map((n) => n.id);
    expect(ids).toContain('plain-journal');
    expect(ids).toContain('my-workout');
    expect(ids).not.toContain('foreign');
  });

  it('agrees with :notebook{notebook:journal} on the same corpus', async () => {
    const service = new QueryService({ noteStore: noteStore(JOURNAL_CANDIDATES) });
    const viaJournal = await service.runFind(parse(':journal{}'));
    const viaNotebook = await service.runFind(parse(':note{notebook:journal}'));
    expect(viaJournal.notes.map((n) => n.id).sort()).toEqual(viaNotebook.notes.map((n) => n.id).sort());
  });
});

describe('WW-024 Bug C — placement-dated notes in time windows', () => {
  const links = [
    link('l1', 'p-today', 'my-workout'),      // undated, placed today → inside
    link('l2', 'p-today', 'plain-journal'),   // undated, placed today → inside
    link('l3', 'p-old', 'foreign'),           // foreign notebook: scoped out anyway
  ];

  it('last 2w admits an undated note whose journal page is dated today', async () => {
    const service = new QueryService({
      noteStore: noteStore(JOURNAL_CANDIDATES),
      relationStore: relationStore(links),
    });
    const result = await service.runFind(parse(':journal{} last 2w'), { anchorNow, skipContainers: false });
    const ids = result.notes.map((n) => n.id);
    expect(ids).toContain('my-workout');
    expect(ids).toContain('plain-journal');
    expect(ids).toContain('dated-in-window');
    expect(ids).not.toContain('foreign');
    // Stage counts describe the surviving scope, not the pre-window corpus.
    expect(result.stages.selected).toBe(3);
    expect(result.stages.matched).toBe(3);
  });

  it('last 2w drops an undated note whose only placement is 30 days old', async () => {
    const staleLinks = [...links, link('l4', 'p-old', 'stale-placement')];
    const staleNote = makeNote('stale-placement');
    const service = new QueryService({
      noteStore: noteStore([...JOURNAL_CANDIDATES, staleNote]),
      relationStore: relationStore(staleLinks),
    });
    const result = await service.runFind(parse(':journal{} last 2w'), { anchorNow, skipContainers: false });
    expect(result.notes.map((n) => n.id)).not.toContain('stale-placement');
    // selected counts the scoped scope BEFORE the window; the window drops
    // the stale placement, so matched stays 3.
    expect(result.stages.selected).toBe(4);
    expect(result.stages.matched).toBe(3);
  });

  it('returned relations cover only the surviving notes', async () => {
    const staleLinks = [...links, link('l4', 'p-old', 'stale-placement')];
    const staleNote = makeNote('stale-placement');
    const service = new QueryService({
      noteStore: noteStore([...JOURNAL_CANDIDATES, staleNote]),
      relationStore: relationStore(staleLinks),
    });
    const result = await service.runFind(parse(':journal{} last 2w'), { anchorNow, skipContainers: false });
    const ids = new Set(result.notes.map((n) => n.id));
    for (const id of Object.keys(result.placements ?? {})) expect(ids.has(id)).toBe(true);
    for (const id of Object.keys(result.containers ?? {})) expect(ids.has(id)).toBe(true);
    expect(ids).toContain('my-workout');
  });
});

describe('WW-034 — suggestWqlSyntaxHint', () => {
  it('suggests a text search for bare words, target-aware', () => {
    expect(suggestWqlSyntaxHint('kettlebell')).toContain(':note{text:kettlebell}');
    expect(suggestWqlSyntaxHint('kettlebell', 'note')).toContain(':note{');
    expect(suggestWqlSyntaxHint('kettlebell', 'effort')).toContain(':effort{text:kettlebell}');
  });

  it('names the input target and its supported keys for malformed structured input', () => {
    const hint = suggestWqlSyntaxHint(':effort name~kettlebell');
    expect(hint).toContain(':effort{key:value}');
    expect(hint).toContain('supported keys:');
    expect(hint).toContain(':effort{');
  });

  it('resolves scoped heads (:journal) to their note plane keys', () => {
    const hint = suggestWqlSyntaxHint(':journal{oops');
    expect(hint).toContain(':note{key:value}');
    expect(hint).toContain('text');
  });

  it('falls back to the default target keys with an example', () => {
    const hint = suggestWqlSyntaxHint(':note{oops');
    expect(hint).toMatch(/^Syntax: :note\{key:value\} — supported keys: .+\. Example: :note\{text:/);
  });
});
