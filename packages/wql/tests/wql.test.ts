import { describe, expect, it } from 'vitest';
import {
  parseQuery as _parseQuery,
  isFindQuery,
  isAggregateQuery,
  isPipelineQuery,
  normalizeWql,
  WQL_COMPARISON_OPS,
  type ParsedAggregateQuery,
} from '../src/wql';
import { WQL_CONTENT_FILTER_KEYS, WQL_CHART_HEADS, WQL_SOURCE_HEADS, WQL_STANDARD_DATASETS } from '../src/vocabulary';

function parseQuery(raw: string): ParsedAggregateQuery {
  return _parseQuery(raw) as ParsedAggregateQuery;
}

describe('parseQuery', () => {
  it('parses the full surface: agg:metric{filters} by {dims} .rollup(period)', () => {
    const parsed = parseQuery('sum:totalVolume{discipline:strength,!effort:burpee} by {week,effort}.rollup(2w)');
    expect(parsed.error).toBeUndefined();
    expect(parsed.agg).toBe('sum');
    expect(parsed.metric).toBe('totalVolume');
    expect(parsed.filters).toEqual([
      { key: 'discipline', negate: false, values: [{ value: 'strength', wildcard: false }] },
      { key: 'effort', negate: true, values: [{ value: 'burpee', wildcard: false }] },
    ]);
    expect(parsed.groupBy).toEqual(['week', 'effort']);
    expect(parsed.rollup).toEqual({ size: 2, unit: 'w' });
  });

  it('parses wildcard tag values', () => {
    const parsed = parseQuery('max:tis{effort:back*}');
    expect(parsed.filters).toEqual([{ key: 'effort', negate: false, values: [{ value: 'back', wildcard: true }] }]);
  });

  it('parses multi-value tag filters (OR within a key)', () => {
    const parsed = parseQuery('sum:totalVolume{note:a|b|c}');
    expect(parsed.error).toBeUndefined();
    expect(parsed.filters).toEqual([
      { key: 'note', negate: false, values: [
        { value: 'a', wildcard: false },
        { value: 'b', wildcard: false },
        { value: 'c', wildcard: false },
      ] },
    ]);
  });

  it('parses multi-value tag filters with per-value wildcards and negation', () => {
    const parsed = parseQuery('sum:totalVolume{!effort:back*|squat*}');
    expect(parsed.error).toBeUndefined();
    expect(parsed.filters).toEqual([
      { key: 'effort', negate: true, values: [
        { value: 'back', wildcard: true },
        { value: 'squat', wildcard: true },
      ] },
    ]);
  });

  it('parses mixed single- and multi-value filters in the same query', () => {
    const parsed = parseQuery('sum:totalVolume{discipline:strength,effort:thruster|burpee} by {week}');
    expect(parsed.filters).toEqual([
      { key: 'discipline', negate: false, values: [{ value: 'strength', wildcard: false }] },
      { key: 'effort', negate: false, values: [
        { value: 'thruster', wildcard: false },
        { value: 'burpee', wildcard: false },
      ] },
    ]);
    expect(parsed.groupBy).toEqual(['week']);
  });
  it('parses day rollups and bare heads', () => {
    expect(parseQuery('avg:tis{}.rollup(7d)').rollup).toEqual({ size: 7, unit: 'd' });
    const bare = parseQuery('count:totalReps');
    expect(bare.error).toBeUndefined();
    expect(bare.filters).toEqual([]);
    expect(bare.groupBy).toEqual([]);
  });

  it('rejects unknown aggregators', () => {
    expect(parseQuery('median:tis').error).toContain('Unknown aggregator');
  });

  it('rejects malformed heads', () => {
    expect(parseQuery('not a query').error).toContain('Cannot parse');
  });

  it('parses the display unit directive at the end of the query', () => {
    const parsed = parseQuery('sum:totalVolume{} by {week}.rollup(2w) in kg');
    expect(parsed.error).toBeUndefined();
    expect(parsed.displayUnit).toBe('kg');
    expect(parsed.agg).toBe('sum');
    expect(parsed.metric).toBe('totalVolume');
    expect(parsed.groupBy).toEqual(['week']);
    expect(parsed.rollup).toEqual({ size: 2, unit: 'w' });
  });

  it('parses display unit directive on bare and filtered queries', () => {
    expect(parseQuery('avg:tis{} in lb').displayUnit).toBe('lb');
    expect(parseQuery('sum:totalVolume{discipline:strength} in kg').displayUnit).toBe('kg');
  });

  it('does not treat "in" inside filters as a display directive', () => {
    const parsed = parseQuery('sum:totalVolume{note:in}');
    expect(parsed.error).toBeUndefined();
    expect(parsed.displayUnit).toBeUndefined();
    expect(parsed.filters).toEqual([{ key: 'note', negate: false, values: [{ value: 'in', wildcard: false }] }]);
  });

  it('errors on a dangling "in" without a unit', () => {
    expect(parseQuery('sum:totalVolume{} in').error).toContain('Cannot parse');
  });
});

// ── Colon source head queries ────────────────────────────────────────
describe('parseQuery — colon source heads', () => {
  it('parses :note with filters', () => {
    const parsed = _parseQuery(':note{tags:pr}');
    expect(parsed.error).toBeUndefined();
    expect(isFindQuery(parsed)).toBe(true);
    if (!isFindQuery(parsed)) return;
    expect(parsed.target).toBe('note');
    expect(parsed.filters).toEqual([
      { key: 'tags', negate: false, values: [{ value: 'pr', wildcard: false }] },
    ]);
    expect(parsed.window).toBeUndefined();
  });

  it('carries no default scope on the generic :note head — the inclusive plane', () => {
    const parsed = _parseQuery(':note{tags:pr}');
    if (!isFindQuery(parsed)) throw new Error('expected find query');
    expect(parsed.sourceScope).toBeUndefined();
    expect(parsed.filters).toEqual([
      { key: 'tags', negate: false, values: [{ value: 'pr', wildcard: false }] },
    ]);
  });

  it('suppresses the default scope when an explicit source: filter is authored', () => {
    const explicit = _parseQuery(':note{source:guides}');
    if (!isFindQuery(explicit)) throw new Error('expected find query');
    expect(explicit.sourceScope).toBeUndefined();
    expect(explicit.filters).toContainEqual({
      key: 'source', negate: false, values: [{ value: 'guides', wildcard: false }],
    });
    // A negated source: filter is explicit scope management too.
    const negated = _parseQuery(':note{!source:guides}');
    if (!isFindQuery(negated)) throw new Error('expected find query');
    expect(negated.sourceScope).toBeUndefined();
  });

  it('suppresses the default scope on legacy `in all`', () => {
    const parsed = _parseQuery(':note{source:journal} in all');
    if (!isFindQuery(parsed)) throw new Error('expected find query');
    expect(parsed.sourceScope).toBeUndefined();
    expect(parsed.filters).toContainEqual({
      key: 'source', negate: false, values: [{ value: 'journal', wildcard: false }],
    });
  });

  it('parses source-scoped note heads as target note + injected source filter', () => {
    const journal = _parseQuery(':journal{effort:snatch}');
    expect(journal.error).toBeUndefined();
    if (!isFindQuery(journal)) throw new Error('expected find query');
    expect(journal.target).toBe('note');
    expect(journal.filters).toContainEqual({
      key: 'source', negate: false, values: [{ value: 'journal', wildcard: false }],
    });
    expect(journal.sourceScope).toBeUndefined();

    const feed = _parseQuery(':feed{effort:snatch}');
    if (!isFindQuery(feed)) throw new Error('expected find query');
    expect(feed.target).toBe('note');
    expect(feed.filters).toContainEqual({
      key: 'source', negate: false, values: [{ value: 'feeds', wildcard: false }],
    });
  });

  it('intersects a scoped head with an explicit source: filter (plain AND)', () => {
    const parsed = _parseQuery(':journal{source:guides}');
    if (!isFindQuery(parsed)) throw new Error('expected find query');
    expect(parsed.filters).toContainEqual({
      key: 'source', negate: false, values: [{ value: 'guides', wildcard: false }],
    });
    expect(parsed.filters).toContainEqual({
      key: 'source', negate: false, values: [{ value: 'journal', wildcard: false }],
    });
  });

  it('normalizes legacy scope clause (in journal) to source: filter with advisory (C2)', () => {
    const parsed = _parseQuery(':note{tags:pr} in journal');
    expect(isFindQuery(parsed)).toBe(true);
    if (!isFindQuery(parsed)) return;
    expect(parsed.filters).toContainEqual({
      key: 'source',
      negate: false,
      values: [{ value: 'journal', wildcard: false }],
    });
    expect(parsed.advisories?.[0]).toContain("Legacy 'in <scope>' syntax is deprecated");
  });

  it('parses time window with legacy scope', () => {
    const parsed = _parseQuery(':note{type:wod} in journal last 8w');
    expect(isFindQuery(parsed)).toBe(true);
    if (!isFindQuery(parsed)) return;
    expect(parsed.filters).toContainEqual({
      key: 'source',
      negate: false,
      values: [{ value: 'journal', wildcard: false }],
    });
    expect(parsed.window).toEqual({ kind: 'relative', size: 8, unit: 'w' });
  });

  it('parses time window without scope', () => {
    const parsed = _parseQuery(':note{tags:pr} last 4d');
    expect(isFindQuery(parsed)).toBe(true);
    if (!isFindQuery(parsed)) return;
    expect(parsed.window).toEqual({ kind: 'relative', size: 4, unit: 'd' });
  });

  it('parses empty filters', () => {
    const parsed = _parseQuery(':note{}');
    expect(isFindQuery(parsed)).toBe(true);
    if (!isFindQuery(parsed)) return;
    expect(parsed.filters).toEqual([]);
  });

  it('parses multi-value tag filters in source queries', () => {
    const parsed = _parseQuery(':note{tags:pr|benchmark}');
    expect(isFindQuery(parsed)).toBe(true);
    if (!isFindQuery(parsed)) return;
    expect(parsed.filters[0].values).toEqual([
      { value: 'pr', wildcard: false },
      { value: 'benchmark', wildcard: false },
    ]);
  });

  it('does NOT route analytics queries to the find path', () => {
    expect(isFindQuery(_parseQuery('sum:totalVolume{}'))).toBe(false);
    expect(isFindQuery(_parseQuery('last:sessionLoad{}'))).toBe(false);
  });

  it('parses :block with text filter', () => {
    const parsed = _parseQuery(':block{text:fran}');
    expect(isFindQuery(parsed)).toBe(true);
    if (!isFindQuery(parsed)) return;
    expect(parsed.target).toBe('block');
    expect(parsed.filters).toEqual([
      { key: 'text', negate: false, values: [{ value: 'fran', wildcard: false }] },
    ]);
  });

  it('parses :block with type filter and legacy scope', () => {
    const parsed = _parseQuery(':block{type:wod} in journal');
    expect(isFindQuery(parsed)).toBe(true);
    if (!isFindQuery(parsed)) return;
    expect(parsed.target).toBe('block');
    expect(parsed.filters).toContainEqual({
      key: 'type',
      negate: false,
      values: [{ value: 'wod', wildcard: false }],
    });
    expect(parsed.filters).toContainEqual({
      key: 'source',
      negate: false,
      values: [{ value: 'journal', wildcard: false }],
    });
  });

  it('parses source: filter as an affirmative kind', () => {
    const parsed = _parseQuery(':note{source:journal}');
    if (!isFindQuery(parsed)) throw new Error('expected find query');
    expect(parsed.filters).toEqual([
      { key: 'source', negate: false, values: [{ value: 'journal', wildcard: false }] },
    ]);
  });

  it('parses !source: filter as a negation', () => {
    const parsed = _parseQuery(':note{!source:guides}');
    if (!isFindQuery(parsed)) throw new Error('expected find query');
    expect(parsed.filters).toEqual([
      { key: 'source', negate: true, values: [{ value: 'guides', wildcard: false }] },
    ]);
  });

  it('parses the :dashboard head as target note + injected type:dashboard (no scope)', () => {
    const parsed = _parseQuery(':dashboard{tags:pr}');
    if (!isFindQuery(parsed)) throw new Error('expected find query');
    expect(parsed.target).toBe('note');
    expect(parsed.sourceScope).toBeUndefined();
    expect(parsed.filters).toEqual([
      { key: 'type', negate: false, values: [{ value: 'dashboard', wildcard: false }] },
      { key: 'tags', negate: false, values: [{ value: 'pr', wildcard: false }] },
    ]);
  });

  it('rewrites comma-separated bare values into one OR filter', () => {
    const parsed = _parseQuery(':note{source:journal,feeds} by {date}');
    if (!isFindQuery(parsed)) throw new Error('expected find query');
    expect(parsed.filters).toEqual([
      { key: 'source', negate: false, values: [
        { value: 'journal', wildcard: false },
        { value: 'feeds', wildcard: false },
      ] },
    ]);
    expect(parsed.groupBy).toEqual(['date']);
    // A colon-form after the comma stays a filter boundary.
    const two = _parseQuery(':note{source:journal,collection:girls}');
    if (!isFindQuery(two)) throw new Error('expected find query');
    expect(two.filters).toHaveLength(2);
  });

  it('parses source: with a catalog-prefixed literal id', () => {
    const parsed = _parseQuery(':note{source:collection:crossfit-girls}');
    if (!isFindQuery(parsed)) throw new Error('expected find query');
    expect(parsed.filters[0].values[0].value).toBe('collection:crossfit-girls');
  });

  it('parses source: combined with another key in the same braces', () => {
    const parsed = _parseQuery(':note{!source:guides,text:fran}');
    if (!isFindQuery(parsed)) throw new Error('expected find query');
    expect(parsed.filters).toEqual([
      { key: 'source', negate: true, values: [{ value: 'guides', wildcard: false }] },
      { key: 'text', negate: false, values: [{ value: 'fran', wildcard: false }] },
    ]);
  });

  it('includes `source` in the content filter key vocabulary', () => {
    expect(WQL_CONTENT_FILTER_KEYS).toContain('source');
  });
});

// ── Retired find: + collections ─────────────────────────────────────
describe('find: retirement and feed scope', () => {
  it('find: primary is a retired-error naming the colon spelling', () => {
    const parsed = _parseQuery('find:note{tags:pr}');
    expect(parsed.family).toBe('find');
    expect(parsed.error).toContain('retired');
    expect(parsed.error).toContain(':note');
    expect(_parseQuery('find:').error).toContain('retired');
  });

  it('accepts feed source values — scope feeds selects the collection corpus', () => {
    expect(_parseQuery(':note{source:feed}').error).toBeUndefined();
    expect(_parseQuery(':note{source:feeds}').error).toBeUndefined();
  });

  it('accepts feed:<id> literal sources — one feed or one feed item', () => {
    expect(_parseQuery(':note{source:feed:crossfit-programming}').error).toBeUndefined();
    expect(_parseQuery(':note{source:"feed:crossfit-programming/2026-01-12"}').error).toBeUndefined();
    expect(_parseQuery(':note{source:"feed:feeds/crossfit-programming/2026-01-12/monday"}').error).toBeUndefined();
  });

  it('keeps guides as an explicit source value', () => {
    expect(_parseQuery(':note{source:guides}').error).toBeUndefined();
  });
});

// ── Colon function heads ─────────────────────────────────────────────
describe('parseQuery — colon function heads', () => {
  it('extracts the metric from the metric: filter', () => {
    const parsed = parseQuery(':sum{metric:tis,effort:snatch} by {week}');
    expect(parsed.error).toBeUndefined();
    expect(parsed.agg).toBe('sum');
    expect(parsed.metric).toBe('tis');
    expect(parsed.filters).toEqual([
      { key: 'effort', negate: false, values: [{ value: 'snatch', wildcard: false }] },
    ]);
    expect(parsed.groupBy).toEqual(['week']);
  });

  it('accepts dotted metric keys in the metric: filter', () => {
    const parsed = parseQuery(':avg{metric:calc.acwr}');
    expect(parsed.error).toBeUndefined();
    expect(parsed.metric).toBe('calc.acwr');
  });

  it('rejects a missing metric with a clear diagnostic', () => {
    const parsed = parseQuery(':sum{}');
    expect(parsed.error).toContain("metric:");
    expect(parseQuery(':avg{effort:x}').error).toContain('metric');
  });

  it(':count{} counts observations without a metric', () => {
    const parsed = parseQuery(':count{}');
    expect(parsed.error).toBeUndefined();
    expect(parsed.agg).toBe('count');
    expect(parsed.metric).toBe('');
  });

  it('rejects OR/negated/wildcard metric clauses', () => {
    expect(parseQuery(':sum{metric:tis|reps}').error).toContain('single');
    expect(parseQuery(':sum{!metric:tis}').error).toContain('single');
    expect(parseQuery(':sum{metric:tis*}').error).toContain('single');
  });
});

// ── Pipelines ────────────────────────────────────────────────────────
describe('parseQuery — pipelines', () => {
  it('parses source | function | chart with Lezer Head/Pipeline nodes', () => {
    const parsed = _parseQuery(':journal{effort:snatch} last 8w | :sum{metric:tis} by {week} | :timeseries{}');
    expect(parsed.error).toBeUndefined();
    if (!isPipelineQuery(parsed)) throw new Error('expected pipeline');
    expect(parsed.source.kind).toBe('query');
    if (parsed.source.kind === 'query') {
      expect(isFindQuery(parsed.source.query)).toBe(true);
      if (isFindQuery(parsed.source.query)) {
        expect(parsed.source.query.target).toBe('note');
        expect(parsed.source.query.window).toEqual({ kind: 'relative', size: 8, unit: 'w' });
      }
    }
    expect(parsed.transforms).toHaveLength(1);
    expect(parsed.transforms[0]).toMatchObject({ agg: 'sum', metric: 'tis', groupBy: ['week'] });
    expect(parsed.sink).toEqual({ head: 'timeseries', filters: [] });
  });

  it('parses a dataset source; the name keeps the @ prefix', () => {
    const parsed = _parseQuery('@session | :sum{metric:tis}');
    if (!isPipelineQuery(parsed)) throw new Error('expected pipeline');
    expect(parsed.source).toEqual({ kind: 'dataset', name: '@session' });
    expect(_parseQuery('@today').source).toEqual({ kind: 'dataset', name: '@today' });
    expect(WQL_STANDARD_DATASETS).toEqual(['@session', '@today']);
  });

  it('a bare numeric stage inherits the carried metric', () => {
    const parsed = _parseQuery(':sum{metric:tis} | :max{}');
    if (!isPipelineQuery(parsed)) throw new Error('expected pipeline');
    expect(parsed.transforms[0]?.metric).toBe('tis');
    const standalone = _parseQuery(':max{}');
    expect(standalone.error).toContain('metric:');
  });

  it('a lone chart starts an implicit :segment source', () => {
    const parsed = _parseQuery(':bar{type:session}');
    if (!isPipelineQuery(parsed)) throw new Error('expected pipeline');
    if (parsed.source.kind === 'query' && isFindQuery(parsed.source.query)) {
      expect(parsed.source.query.target).toBe('segment');
    } else {
      throw new Error('expected implicit :segment source');
    }
    expect(parsed.sink?.head).toBe('bar');
  });

  it('keeps row pipes on single source queries while pipes make pipelines', () => {
    expect(isPipelineQuery(_parseQuery(':note{tags:pr} | order by date | limit 5'))).toBe(false);
    expect(isPipelineQuery(_parseQuery(':journal{} | :sum{metric:tis}'))).toBe(true);
  });

  it('OR and quoted pipes inside filters never become stage separators', () => {
    const parsed = _parseQuery(':segment{effort:sn*|cu} | :sum{metric:tis}');
    if (!isPipelineQuery(parsed)) throw new Error('expected pipeline');
    if (parsed.source.kind === 'query' && isFindQuery(parsed.source.query)) {
      expect(parsed.source.query.filters[0].values).toEqual([
        { value: 'sn', wildcard: true },
        { value: 'cu', wildcard: false },
      ]);
    }
    const quoted = _parseQuery(':note{text:"a|b"} | :table');
    expect(quoted.error).toBeUndefined();
    expect(isPipelineQuery(quoted)).toBe(true);
  });

  it('chart params ride the sink filters', () => {
    const parsed = _parseQuery('@today | :count{} | :bar{type:session,discipline:strength}');
    if (!isPipelineQuery(parsed)) throw new Error('expected pipeline');
    expect(parsed.sink?.filters).toEqual([
      { key: 'type', negate: false, values: [{ value: 'session', wildcard: false }] },
      { key: 'discipline', negate: false, values: [{ value: 'strength', wildcard: false }] },
    ]);
  });

  it('errors on invalid stage order, doubled pipes, and unknown heads', () => {
    expect(_parseQuery(':sum{metric:tis} | :journal{}').error).toContain('must come first');
    expect(_parseQuery('@today | :bar{} | :sum{metric:tis}').error).toContain('final');
    expect(_parseQuery(':journal{} | :bar{} | :table{}').error).toContain('final');
    expect(_parseQuery(':journal{} |').error).toContain('Empty');
    expect(_parseQuery(':journal{} || :sum{metric:tis}').error).toContain('Empty');
    expect(_parseQuery(':journal{} | :bogus{}').error).toContain('Unknown');
    expect(_parseQuery(':journal{} | :max{}').error).toContain('metric:'); // bare fn after a content source
  });

  it('advises when a chart stage carries ignored suffixes', () => {
    const parsed = _parseQuery(':journal{} | :sum{metric:tis} | :timeseries{} last 4w');
    expect(parsed.error).toBeUndefined();
    expect(parsed.advisories?.join(' ')).toContain('ignores query suffixes');
  });

  it('exposes the standard vocabulary for pipeline dispatch', () => {
    expect(WQL_SOURCE_HEADS).toContain('journal');
    expect(WQL_CHART_HEADS).toContain('timeseries');
  });
});

// ── Cross-store `where` join tests (#800) ──────────────────────────
describe('parseQuery — cross-store where joins', () => {
  it('parses :note joined to a metric predicate', () => {
    const parsed = _parseQuery(':note where sum:totalVolume{} > 5000');
    expect(isFindQuery(parsed)).toBe(true);
    if (!isFindQuery(parsed) || !parsed.join) return;
    expect(parsed.join).toEqual({
      agg: 'sum', metric: 'totalVolume', filters: [],
      operator: '>', threshold: 5000,
    });
  });

  it('parses :note joined to a colon metric predicate', () => {
    const parsed = _parseQuery(':note where :sum{metric:totalVolume} > 5000');
    if (!isFindQuery(parsed) || !parsed.join) throw new Error('expected join');
    expect(parsed.join).toEqual({
      agg: 'sum', metric: 'totalVolume', filters: [],
      operator: '>', threshold: 5000,
    });
  });

  it('parses an analytics query joined to a find predicate (legacy retained)', () => {
    const parsed = _parseQuery('sum:totalVolume{} where find:note{tags:competition}');
    expect(isFindQuery(parsed)).toBe(false);
    if ('join' in parsed && parsed.join) {
      expect(parsed.join).toEqual({
        target: 'note',
        filters: [{ key: 'tags', negate: false, values: [{ value: 'competition', wildcard: false }] }],
      });
    } else {
      throw new Error('expected a join');
    }
  });

  it('parses an analytics query joined to a colon source predicate', () => {
    const parsed = _parseQuery('sum:totalVolume{} where :note{tags:competition}');
    expect(parsed.error).toBeUndefined();
    if ('join' in parsed && parsed.join) {
      expect(parsed.join).toEqual({
        target: 'note',
        filters: [{ key: 'tags', negate: false, values: [{ value: 'competition', wildcard: false }] }],
      });
    } else {
      throw new Error('expected a join');
    }
  });

  it('preserves the find half\'s own scope + last on the join', () => {
    const parsed = _parseQuery('sum:totalVolume{} where find:note{tags:pr} in journal last 8w');
    expect(isFindQuery(parsed)).toBe(false);
    if (!('join' in parsed) || !parsed.join) throw new Error('expected a join');
    expect(parsed.join.filters).toContainEqual({
      key: 'source',
      negate: false,
      values: [{ value: 'journal', wildcard: false }],
    });
    expect(parsed.join.last).toEqual({ size: 8, unit: 'w' });
  });

  it('parses every comparison operator in WQL_COMPARISON_OPS', () => {
    for (const op of WQL_COMPARISON_OPS) {
      const parsed = _parseQuery(`:block where sum:totalVolume{} ${op} 1000`);
      if (!isFindQuery(parsed) || !parsed.join) throw new Error(`no join for ${op}`);
      expect(parsed.join.operator).toBe(op);
      expect(parsed.join.threshold).toBe(1000);
    }
  });

  it('passes the metric predicate\'s own filters through', () => {
    const parsed = _parseQuery(':note where sum:totalVolume{discipline:strength} >= 4000');
    if (!isFindQuery(parsed) || !parsed.join) throw new Error('expected a join');
    expect(parsed.join.filters).toEqual([
      { key: 'discipline', negate: false, values: [{ value: 'strength', wildcard: false }] },
    ]);
    expect(parsed.join.operator).toBe('>=');
  });

  it('treats `where` inside filters as a tag value, not a join', () => {
    const parsed = _parseQuery(':note{text:where}');
    expect(isFindQuery(parsed)).toBe(true);
    if (!isFindQuery(parsed)) return;
    expect(parsed.join).toBeUndefined();
    expect(parsed.filters[0].values[0].value).toBe('where');
  });

  it('rejects a find query joined to another find half', () => {
    const parsed = _parseQuery(':note where :block{}');
    if (!isFindQuery(parsed)) throw new Error('expected find query');
    expect(parsed.error).toContain('agg:metric');
  });

  it('rejects an analytics query joined to a metric half', () => {
    const parsed = _parseQuery('sum:totalVolume{} where sum:tis{} > 5');
    expect(parsed.error).toContain('find:');
  });

  it('unquotes a multi-word text filter value (#867)', () => {
    const parsed = _parseQuery(':note{text:"300 Air Squats"}');
    expect(isFindQuery(parsed)).toBe(true);
    if (!isFindQuery(parsed)) return;
    expect(parsed.error).toBeUndefined();
    expect(parsed.target).toBe('note');
    expect(parsed.filters).toEqual([
      { key: 'text', negate: false, values: [{ value: '300 Air Squats', wildcard: false }] },
    ]);
  });

  it('round-trips a quoted text value with single-word text unchanged', () => {
    const single = _parseQuery(':note{text:pr}');
    if (!isFindQuery(single)) return;
    expect(single.filters[0].values[0].value).toBe('pr');
  });
});

describe('grain:rollup retirement (ticket 003)', () => {
  it('rejects grain:rollup with a pointer to the .rollup suffix', () => {
    const parsed = _parseQuery('sum:totalVolume{grain:rollup}');
    expect(parsed.error).toContain('.rollup suffix');
  });

  it('accepts the unified grain values', () => {
    expect(_parseQuery('sum:totalVolume{grain:event}').error).toBeUndefined();
    expect(_parseQuery('sum:totalVolume{grain:summary}').error).toBeUndefined();
  });

});

describe('suffix conflicts surface as parse errors (C3)', () => {
  it('analytics: duplicate by clauses error naming both spans', () => {
    const parsed = _parseQuery('sum:tis{} by {week} by {effort}');
    expect(parsed.error).toContain("Duplicate 'by' clause");
    expect(parsed.error).toContain('by {week}');
    expect(parsed.error).toContain('by {effort}');
  });

  it('source heads: duplicate scope clauses error', () => {
    const parsed = _parseQuery(':note{tags:pr} in journal in feeds');
    expect(parsed.error).toContain("'in journal' conflicts with 'in feeds'");
  });

  it('valid queries stay error-free across all families', () => {
    expect(_parseQuery('sum:tis{} by {week}.rollup(2w) in kg').error).toBeUndefined();
    expect(_parseQuery(':note{tags:pr} in journal last 8w').error).toBeUndefined();
    expect(_parseQuery(':session{result:x} last 4w').error).toBeUndefined();
  });
});

describe('discriminated query union (C5)', () => {
  it('stamps family on every parse path, including error results', () => {
    expect(_parseQuery('sum:totalVolume{}').family).toBe('aggregate');
    expect(_parseQuery(':note{tags:pr} in journal').family).toBe('find');
    expect(_parseQuery(':session{result:x}').family).toBe('find');
    expect(_parseQuery(':journal{} | :sum{metric:tis}').family).toBe('pipeline');
    // Error paths keep the family — a malformed query still narrows.
    expect(_parseQuery('sum:').family).toBe('aggregate');
    expect(_parseQuery('find:').family).toBe('find');
    expect(_parseQuery(':session where x').family).toBe('find');
    expect(_parseQuery(':journal{} | :bogus{}').family).toBe('pipeline');
  });

  it('guards discriminate on family alone', () => {
    const agg = _parseQuery('sum:totalVolume{}');
    const find = _parseQuery(':note{}');
    const pipeline = _parseQuery(':journal{} | :sum{metric:tis}');
    expect(isAggregateQuery(agg)).toBe(true);
    expect(isAggregateQuery(find)).toBe(false);
    expect(isFindQuery(agg)).toBe(false);
    expect(isFindQuery(find)).toBe(true);
    expect(isPipelineQuery(pipeline)).toBe(true);
    expect(isPipelineQuery(agg)).toBe(false);
    expect(isPipelineQuery(find)).toBe(false);
  });
});

describe('find/rows target validation (C7)', () => {
  it('unknown colon target errors listing valid targets', () => {
    const parsed = _parseQuery(':exercise{tags:pr}');
    expect(parsed.family).toBe('find');
    expect(parsed.error).toContain('Unknown find target "exercise"');
    expect(parsed.error).toContain('note, block, effort');
  });

  it('known content targets stay error-free', () => {
    expect(_parseQuery(':note{}').error).toBeUndefined();
    expect(_parseQuery(':block{}').error).toBeUndefined();
    expect(_parseQuery(':effort{}').error).toBeUndefined();
  });

  it('validation reaches the join half of an analytics query', () => {
    const parsed = _parseQuery('sum:totalVolume{} where find:exercise{}');
    expect(parsed.family).toBe('aggregate');
    expect(parsed.error).toContain('Unknown find target "exercise"');
  });

});

describe('rows: retirement and hints (#1044)', () => {
  it('rows:all{result:r} fails to parse with a message pointing to :session{result:r}', () => {
    const parsed = _parseQuery('rows:all{result:r1}');
    expect(parsed.error).toContain('rows:all{…} is retired — use :session{result:r1} instead.');
  });

  it('rows:segment without scope points to :segment', () => {
    const parsed = _parseQuery('rows:segment{effort:snatch}');
    expect(parsed.error).toContain('rows:segment{…} is retired — use :segment{effort:snatch} instead.');
  });

  it('rows:segment with scope points to :session with plane:segment', () => {
    const parsed = _parseQuery('rows:segment{result:r1}');
    expect(parsed.error).toContain('rows:segment{…} is retired — use :session{result:r1, plane:segment} instead.');
  });
});

describe('window module (C1)', () => {
  it('aggregates accept a relative window', () => {
    const parsed = _parseQuery('sum:totalVolume{} last 6w');
    expect(parsed.family).toBe('aggregate');
    expect(parsed.error).toBeUndefined();
    expect(isAggregateQuery(parsed) ? parsed.window : undefined)
      .toEqual({ kind: 'relative', size: 6, unit: 'w' });
  });

  it('aggregates accept a from/to civil-date range', () => {
    const parsed = _parseQuery('sum:tis{} from 2026-01-01 to 2026-03-31');
    expect(parsed.error).toBeUndefined();
    expect(isAggregateQuery(parsed) ? parsed.window : undefined)
      .toEqual({ kind: 'range', start: '2026-01-01', end: '2026-03-31' });
  });

  it('from without to is an open-ended range', () => {
    const parsed = _parseQuery('sum:tis{} from 2026-01-01');
    expect(parsed.error).toBeUndefined();
    expect(isAggregateQuery(parsed) ? parsed.window : undefined)
      .toEqual({ kind: 'range', start: '2026-01-01' });
  });

  it('find carries the window too — last folds in', () => {
    const find = _parseQuery(':note{tags:pr} last 8w');
    expect(find.error).toBeUndefined();
    expect(isFindQuery(find) ? find.window : undefined)
      .toEqual({ kind: 'relative', size: 8, unit: 'w' });
    const session = _parseQuery(':session{result:x} from 2026-02-01 to 2026-02-28');
    expect(session.error).toBeUndefined();
    expect(isFindQuery(session) ? session.window : undefined)
      .toEqual({ kind: 'range', start: '2026-02-01', end: '2026-02-28' });
  });
  it('last and from are mutually exclusive — conflict naming both spans', () => {
    const parsed = _parseQuery('sum:tis{} last 4w from 2026-01-01');
    expect(parsed.error).toContain("'last 4w' conflicts with 'from 2026-01-01'");
  });

  it('duplicate from clauses conflict', () => {
    const parsed = _parseQuery('sum:tis{} from 2026-01-01 from 2026-02-01');
    expect(parsed.error).toContain("Duplicate 'window' clause");
  });

  it('rejects impossible civil dates at parse', () => {
    expect(_parseQuery('sum:tis{} from 2026-13-01').error).toContain('Invalid window date');
    expect(_parseQuery('sum:tis{} from 2026-02-30').error).toContain('Invalid window date');
  });

  it('window rides the canonical tail after unit and rollup', () => {
    const parsed = _parseQuery('sum:totalVolume{} by {week}.rollup(2w) in kg last 6w');
    expect(parsed.error).toBeUndefined();
    expect(isAggregateQuery(parsed) ? parsed.window : undefined)
      .toEqual({ kind: 'relative', size: 6, unit: 'w' });
  });

  it('range windows on join halves are a parse error, not a silent drop', () => {
    const parsed = _parseQuery('sum:tis{} where find:note{tags:x} from 2026-01-01');
    expect(parsed.error).toContain('Range windows are not supported on join halves');
  });

  it('relative last on a join half still parses', () => {
    const parsed = _parseQuery('sum:tis{} where find:note{tags:x} last 4w');
    expect(parsed.error).toBeUndefined();
    expect(isAggregateQuery(parsed) && parsed.join ? parsed.join.last : undefined)
      .toEqual({ size: 4, unit: 'w' });
  });
});

describe('de-overload in with compat normalizer (C2)', () => {

  it('rejects unknown source: filter values with clear error', () => {
    const parsed = _parseQuery(':note{source:invalid_scope}');
    expect(parsed.error).toContain('Unknown source "invalid_scope"');
    expect(parsed.error).toContain('Try: journal, feeds, guides, playground');
  });

  it('rejects unknown legacy in <scope> values with clear error', () => {
    const parsed = _parseQuery(':note in invalid_scope');
    expect(parsed.error).toContain('Unknown source "invalid_scope"');
  });
  it('accepts all canonical source values and catalog prefixes', () => {
    for (const src of ['journal', 'feeds', 'playground', 'guides', 'feed']) {
      const p = _parseQuery(`:note{source:${src}}`);
      expect(p.error).toBeUndefined();
    }
    expect(_parseQuery(':note{source:collection:crossfit-girls}').error).toBeUndefined();
  });

  it('retires the collections spellings with a rename hint', () => {
    expect(_parseQuery(':note{source:collections}').error).toContain('source:collections is retired');
    expect(_parseQuery(':note{source:collections}').error).toContain('source:feeds');
    expect(_parseQuery(':note{source:collection}').error).toContain('retired');
    expect(_parseQuery(':note in collections').error).toContain('retired');
  });

  it('in means units on aggregates without triggering scope normalization', () => {
    const parsed = _parseQuery('sum:totalVolume{} in kg');
    expect(parsed.error).toBeUndefined();
    expect(isAggregateQuery(parsed)).toBe(true);
    if (!isAggregateQuery(parsed)) return;
    expect(parsed.displayUnit).toBe('kg');
    expect(parsed.advisories).toBeUndefined();
  });

  it('normalizeWql helper rewrites legacy queries and leaves modern queries unchanged', () => {
    const r1 = normalizeWql('find:note{tags:pr} in journal last 8w');
    expect(r1.query).toBe('find:note{tags:pr,source:journal} last 8w');
    expect(r1.advisories.length).toBe(1);

    const r3 = normalizeWql('sum:totalVolume{} in kg last 4w');
    expect(r3.query).toBe('sum:totalVolume{} in kg last 4w');
    expect(r3.advisories.length).toBe(0);
  });
  it('propagates deprecation advisory from legacy where join find clause', () => {
    const parsed = _parseQuery('sum:totalVolume{} where find:note in journal');
    expect(parsed.error).toBeUndefined();
    expect(parsed.advisories?.[0]).toContain("Legacy 'in <scope>' syntax is deprecated");
  });
});
