/**
 * wqlEdits — app-side structural WQL edits over the engine's parse/serialize
 * surface. These cover the stream host's scope/time/filter-clear helpers and
 * the explorer's metric edit; kind/target pivots and occurrence-level filter
 * edits live in the shared composer (resolveQueryDraft/editQueryClause).
 */
import { describe, expect, it } from 'bun:test';
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine';
import {
  scopeOfQuery,
  setScopeFilter,
  setMetricQuery,
  withoutWindow,
} from '../lib/wqlEdits';

describe('scopeOfQuery', () => {
  it('reads the canonical Where-stored scope from the source filter', () => {
    expect(scopeOfQuery(':note last 2w')).toBeNull();
    expect(scopeOfQuery(':note{source:journal}')).toBe('journal');
    expect(scopeOfQuery(':note{source:notebooks,tags:pr} last 2w')).toBe('notebooks');
    expect(scopeOfQuery(':note{source:playground} last 4w')).toBe('playground');
    expect(scopeOfQuery(':block{source:journal}')).toBe('journal');
  });

  it('is null for non-scoped targets, aggregates and unrepresentable scopes', () => {
    expect(scopeOfQuery(':effort{source:journal}')).toBeNull();
    expect(scopeOfQuery(':session{result:abc-123}')).toBeNull();
    expect(scopeOfQuery('sum:totalVolume{} by {week}')).toBeNull();
    expect(scopeOfQuery(':note{!source:journal}')).toBeNull();
    expect(scopeOfQuery(':note{source:journal|guides}')).toBeNull();
    expect(scopeOfQuery('not a query')).toBeNull();
  });
});

describe('setScopeFilter', () => {
  it('sets the scope on an all-sources query, keeping filters and window', () => {
    expect(setScopeFilter(':note{text:"fran",tags:pr} last 2w', 'journal')).toBe(
      ':note{text:fran,tags:pr,source:journal} last 2w',    );
  });

  it('replaces the first source occurrence in place and preserves every other clause', () => {
    expect(setScopeFilter(':note{source:guides,tags:pr} by {tag} last 8w', 'notebooks')).toBe(
      ':note{source:notebooks,tags:pr} by {tag} last 8w',    );
  });

  it('does not merge or drop a second source occurrence', () => {
    expect(setScopeFilter(':note{source:journal,text:"fran",source:guides}', 'notebooks')).toBe(
      ':note{source:notebooks,text:fran,source:guides}',    );
  });

  it('emits the canonical source:notebooks scope — never source:page', () => {
    const next = setScopeFilter(':note{tags:pr} last 2w', 'notebooks');
    expect(next).toBe(':note{tags:pr,source:notebooks} last 2w');
    expect(next).not.toContain('source:page');
    expect(next).not.toContain('type:collection');
  });

  it('clears the scope occurrence without touching the rest', () => {
    // Semantic: the source filter is gone, the tag filter and window stay.
    const cleared = parseQuery(setScopeFilter(':note{source:journal,tags:pr} last 8w', null) ?? '');
    expect(isFindQuery(cleared)).toBe(true);
    if (isFindQuery(cleared)) {
      expect(cleared.filters.filter((f) => f.key === 'source')).toHaveLength(0);
      expect(cleared.filters.some((f) => f.key === 'tags' && f.values.some((v) => v.value === 'pr'))).toBe(true);
      expect(cleared.window).toEqual({ kind: 'relative', size: 8, unit: 'w' });
    }
    const clearedBare = parseQuery(setScopeFilter(':note{source:journal,tags:pr}', '') ?? '');
    expect(isFindQuery(clearedBare)).toBe(true);
    if (isFindQuery(clearedBare)) {
      expect(clearedBare.filters.filter((f) => f.key === 'source')).toHaveLength(0);
      expect(clearedBare.filters.some((f) => f.key === 'tags')).toBe(true);
    }
  });

  it('edits block scopes like note scopes', () => {
    expect(setScopeFilter(':block{text:"cindy"}', 'notebooks')).toBe(
      ':block{text:cindy,source:notebooks}',
    );
  });

  it('leaves other targets, aggregates and unparseable text untouched', () => {
    expect(setScopeFilter(':effort{discipline:strength}', 'journal')).toBe(
      ':effort{discipline:strength}',
    );
    expect(setScopeFilter(':session{} last 4w', 'journal')).toBe(':session{} last 4w');
    expect(setScopeFilter('sum:totalVolume{} by {week}', 'journal')).toBe('sum:totalVolume{} by {week}');
    expect(setScopeFilter('not a query', 'journal')).toBe('not a query');
  });
});

describe('setMetricQuery', () => {
  it('sets the metric on an aggregate, keeping the head and window', () => {
    expect(setMetricQuery('sum:totalVolume{} by {week} last 6w', 'tis')).toBe(
      'sum:tis{} by {week} last 6w',
    );
  });

  it('never pivots a find query — kind pivots run through the composer warned flow', () => {
    expect(setMetricQuery(':note{tags:pr} last 2w', 'totalVolume')).toBe(
      ':note{tags:pr} last 2w',    );
    expect(setMetricQuery(':note{source:journal,tags:pr} last 2w', 'totalVolume')).toBe(
      ':note{source:journal,tags:pr} last 2w',    );
  });

  it('returns unparseable input untouched', () => {
    expect(setMetricQuery('not a query', 'tis')).toBe('not a query');
  });
});

describe('withoutWindow', () => {
  it('drops the window', () => {
    expect(withoutWindow(':note{tags:pr} last 8w')).toBe(':note{tags:pr}');
  });
});
