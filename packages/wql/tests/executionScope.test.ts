import { describe, expect, it } from 'vitest';
import type { EventRecord, Note } from '@bitcobblers/wod-wiki-core';
import {
  resolveEntityScope,
  resolveQueryExecutionScope,
  substituteTokens,
  substituteTokensRaw,
  WQL_STANDARD_DATASETS,
  PageSourceRegistry,
  QueryService,
  type EventStore,
} from '../src';
import { parseQuery, isPipelineQuery } from '../src/wql';

let seq = 0;
function fact(metricKey: string, value: number, timestamp: number): EventRecord {
  seq += 1;
  return {
    id: `r${seq}:summary:${metricKey}`,
    resultId: `r${seq}`,
    noteId: 'note-fran',
    grain: 'summary',
    outputType: 'analytics',
    blockId: 's1',
    blockVersion: 1,
    timestamp,
    representationKind: 'calculated',
    reducerStats: { observedCount: 1 },
    metrics: [{ type: metricKey, value, metadata: { canonicalKey: metricKey } }],
  } as EventRecord;
}

function emptyEventStore(): EventStore {
  return {
    getEventsByTimeRange: async () => [],
    getEventsByResult: async () => [],
    getEventsForNote: async () => [],
    getEventsByContent: async () => [],
    scanAll: async () => [],
    appendEvents: async () => {},
    finalizeSummaries: async () => {},
    deleteEvents: async () => {},
  };
}

describe('WQL-1 unified substituteTokens', () => {
  it('returns { query, missing } with raw-text substitution (existing contract)', () => {
    expect(substituteTokens('sum:totalVolume{} last $weeks w', { weeks: '16' })).toEqual({
      query: 'sum:totalVolume{} last 16 w',
      missing: [],
    });
  });

  it('supports underscore-leading token names: [A-Za-z_][\\w-]*', () => {
    expect(substituteTokens(':value{note:$_private}', { _private: 'note-9' })).toEqual({
      query: ':value{note:note-9}',
      missing: [],
    });
  });

  it('substitutes dashed and underscored interior token names', () => {
    expect(substituteTokens('last $week-1 w sum{effort:$w_2}', { 'week-1': '5', w_2: 'thruster' }).query).toBe(
      'last 5 w sum{effort:thruster}',
    );
  });

  it('reports each missing reference once and leaves it literal', () => {
    expect(substituteTokens('$goal $goal $ok', { ok: '1' })).toEqual({ query: '$goal $goal 1', missing: ['goal'] });
  });

  it('substituteTokensRaw matches the unified substituteTokens output', () => {
    const q = ':bar{note:$_p, effort:$eff} last $week-1 w';
    const v = { _p: 'note-9', eff: 'thruster', 'week-1': '5' };
    expect(substituteTokensRaw(q, v)).toBe(substituteTokens(q, v).query);
    expect(substituteTokensRaw(q, v)).toBe(':bar{note:note-9, effort:thruster} last 5 w');
  });

  it('substituteTokensRaw leaves unknown tokens literal (runner contract)', () => {
    expect(substituteTokensRaw('sum{effort:$nope}', {})).toBe('sum{effort:$nope}');
  });
});

describe('WQL-1 $thisnote binding in resolveEntityScope', () => {
  it('binds thisnote alongside note for a note id', () => {
    const tokens = resolveEntityScope({ noteId: 'note-123', label: 'Fran' }).tokens;
    expect(tokens.note).toBe('note-123');
    expect(tokens.thisnote).toBe('note-123');
    expect(tokens.scope).toBe('note:note-123');
  });

  it('falls back to the slug when no note id is given', () => {
    const tokens = resolveEntityScope({ slug: 'fran-session' }).tokens;
    expect(tokens.note).toBe('fran-session');
    expect(tokens.thisnote).toBe('fran-session');
  });

  it('prefers the id over the slug', () => {
    expect(resolveEntityScope({ noteId: 'note-abc', slug: 'fran' }).tokens.thisnote).toBe('note-abc');
  });

  it('$thisnote and $note substitute identically in :note, :segment, and chart attributes', () => {
    const tokens = resolveEntityScope({ noteId: 'note-123', label: 'Fran' }).tokens;
    expect(substituteTokens(':note{note:$thisnote}', tokens).query).toBe(':note{note:note-123}');
    expect(substituteTokens(':segment{note:$note}', tokens).query).toBe(':segment{note:note-123}');
    expect(substituteTokens(':bar{note:$thisnote, title:$note}', tokens)).toEqual({
      query: ':bar{note:note-123, title:note-123}',
      missing: [],
    });
  });
});

describe('WQL-1 resolveQueryExecutionScope', () => {
  it('merges entity scope tokens and registers @note for a note id', () => {
    const scope = resolveQueryExecutionScope({ noteId: 'note-123' });
    expect(scope.tokens.thisnote).toBe('note-123');
    expect(scope.tokens.note).toBe('note-123');
    expect(scope.tokens.scope).toBe('note:note-123');
    expect(scope.pageSources).toBeInstanceOf(PageSourceRegistry);
    const note = scope.pageSources.get('@note');
    expect(note).toBeDefined();
    expect(Array.isArray(note!.events)).toBe(true);
    expect(Array.isArray(note!.notes)).toBe(true);
  });

  it('populates the @note entry from noteEvents and note', () => {
    const event = fact('reps', 12, 1_700_000_000_000);
    const noteRecord = { id: 'note-123' } as unknown as Note;
    const scope = resolveQueryExecutionScope({ noteId: 'note-123', noteEvents: [event], note: noteRecord });
    expect(scope.pageSources.get('@note')).toEqual({ events: [event], notes: [noteRecord] });
  });

  it('preserves a pre-registered @note entry instead of clobbering it', () => {
    const event = fact('reps', 30, 1_700_000_000_000);
    const registry = new PageSourceRegistry();
    registry.set('@note', { events: [event], notes: [] });
    const scope = resolveQueryExecutionScope({ noteId: 'note-123', pageSources: registry });
    expect(scope.pageSources.get('@note')).toEqual({ events: [event], notes: [] });
  });

  it('applies frontmatter dashboard.* token defaults from rawContent', () => {
    const rawContent = '---\ntitle: Dash\ndashboard: "true"\ndashboard.weeks: "16"\ndashboard.equipment:\n  - kettlebell\n  - barbell\n---\nBody';
    const scope = resolveQueryExecutionScope({ noteId: 'note-123', rawContent });
    expect(scope.tokens.weeks).toBe('16');
    expect(scope.tokens.equipment).toBe('kettlebell');
  });

  it('frontmatter defaults override entity-scope token defaults', () => {
    const rawContent = '---\ndashboard.metric: load\n---\n';
    expect(resolveQueryExecutionScope({ noteId: 'note-123', rawContent }).tokens.metric).toBe('load');
  });

  it('caller tokenValues override entity scope and frontmatter defaults', () => {
    const rawContent = '---\ndashboard.weeks: "16"\n---\n';
    const scope = resolveQueryExecutionScope({
      noteId: 'note-123',
      rawContent,
      tokenValues: { weeks: '42', thisnote: 'caller-note' },
    });
    expect(scope.tokens.weeks).toBe('42');
    expect(scope.tokens.thisnote).toBe('caller-note');
    expect(scope.tokens.note).toBe('note-123');
  });

  it('accepts a plain Map of page sources and preserves other datasets', () => {
    const scope = resolveQueryExecutionScope({
      noteId: 'note-123',
      pageSources: new Map([['@session', { events: [], notes: [] }]]),
    });
    expect(scope.pageSources.get('@session')).toEqual({ events: [], notes: [] });
    expect(scope.pageSources.getDataset('@session')).toBeDefined();
    expect(scope.pageSources.get('@note')).toBeDefined();
  });

  it('registers nothing for an empty input', () => {
    const scope = resolveQueryExecutionScope({});
    expect(scope.tokens.note).toBeUndefined();
    expect(scope.pageSources.has('@note')).toBe(false);
  });
});

describe('WQL-1 @note standard dataset', () => {
  it('is a member of WQL_STANDARD_DATASETS in canonical order', () => {
    expect(WQL_STANDARD_DATASETS).toEqual(['@session', '@today', '@note']);
  });

  it('parses as a dataset pipeline source', () => {
    const parsed = parseQuery('@note | :sum{metric:reps}');
    if (!isPipelineQuery(parsed)) throw new Error('expected pipeline');
    expect(parsed.source).toEqual({ kind: 'dataset', name: '@note' });
    const bare = parseQuery('@note');
    if (!isPipelineQuery(bare)) throw new Error('expected pipeline');
    expect(bare.source).toEqual({ kind: 'dataset', name: '@note' });
  });

  it('resolves @note from a PageSourceRegistry through QueryService', async () => {
    const registry = new PageSourceRegistry();
    registry.set('@note', {
      events: [fact('reps', 12, 1_700_000_000_000), fact('reps', 8, 1_700_086_400_000)],
      notes: [],
    });
    const service = new QueryService({ eventStore: emptyEventStore() });
    const res = await service.runPipelineParsed(parseQuery('@note | :sum{metric:reps}'), { pageSources: registry });
    expect(res.error).toBeUndefined();
    expect(res.series?.[0]?.key).toBe('reps');
    expect(res.series?.[0]?.points[0]?.value).toBe(20);
  });

  it('fails with a host-registration hint when @note is absent', async () => {
    const service = new QueryService({ eventStore: emptyEventStore() });
    const res = await service.runPipelineParsed(parseQuery('@note | :sum{metric:reps}'), {});
    expect(res.error).toContain('Unknown dataset "@note"');
  });
});
