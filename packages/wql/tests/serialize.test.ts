import { describe, expect, it } from 'vitest';
import { parseQuery } from '../src/wql';
import type { ParsedAggregateQuery, ParsedFindQuery, QueryWindow, TagFilter } from '../src/wql';
import { WQL_AGGREGATORS, WQL_COMPARISON_OPS, WQL_FIND_TARGETS } from '../src/vocabulary';
import { serialize } from '../src/serialize';
/** Deep equality on query structure — ignores provenance fields (`raw`,
 * `advisories`), the parse-derived `:note` default scope, and filter ORDER
 * (filters are a conjunction; the scope-head collapse re-orders them). */
function structural(a: unknown): unknown {
  if (Array.isArray(a)) return a.map(structural);
  if (a && typeof a === 'object') {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(a as Record<string, unknown>).sort();
    for (const k of keys) {
      const v = (a as Record<string, unknown>)[k];
      if (k === 'raw' || k === 'advisories' || k === 'sourceScope' || k === 'head' || v === undefined) continue;
      out[k] = structural(v);
    }
    if (Array.isArray(out.filters)) {
      out.filters = (out.filters as unknown[]).slice().sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    }
    return out;
  }
  return a;
}

function structurallyEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(structural(a)) === JSON.stringify(structural(b));
}

describe('serialize (C6 structured interface)', () => {
  it('round-trips a plain aggregate query', () => {
    const a = parseQuery('sum:totalVolume{discipline:strength}');
    expect(a.error).toBeUndefined();
    const text = serialize(a);
    expect(text).toBe('sum:totalVolume{discipline:strength}');
    expect(structurallyEqual(parseQuery(text), a)).toBe(true);
  });

  it('round-trips an aggregate with by, rollup, display unit, and window', () => {
    const text = 'sum:totalVolume{discipline:strength} by {week, effort}.rollup(2w) in kg last 4w';
    const a = parseQuery(text);
    expect(a.error).toBeUndefined();
    expect(serialize(a)).toBe(text);
    expect(structurallyEqual(parseQuery(serialize(a)), a)).toBe(true);
  });

  it('round-trips civil-date range windows on aggregates', () => {
    const text = 'sum:tis{} from 2026-01-01 to 2026-03-31';
    const a = parseQuery(text);
    expect(a.error).toBeUndefined();
    expect(serialize(a)).toBe(text);
    expect(structurallyEqual(parseQuery(serialize(a)), a)).toBe(true);
  });

  it('omits the range end when the AST has none', () => {
    const a = parseQuery('sum:tis{} from 2026-01-01');
    expect(a.error).toBeUndefined();
    expect(serialize(a)).toBe('sum:tis{} from 2026-01-01');
  });

  it('serializes a hand-built bare find query without filter braces', () => {
    const a: ParsedFindQuery = {
      family: 'find', raw: '', target: 'note', filters: [],
      window: { kind: 'relative', size: 8, unit: 'w' },
    };
    // No scope on the AST means "all sources" — the `in all` clause keeps
    // serialization from narrowing to the :note default on reparse.
    expect(structurallyEqual(parseQuery(serialize(a)), a)).toBe(true);
  });

  it('serializes hand-built find filters with source, wildcard, and quoted values', () => {
    const a: ParsedFindQuery = {
      family: 'find', raw: '', target: 'note',
      filters: [
        { key: 'source', negate: false, values: [{ value: 'journal', wildcard: false }] },
        { key: 'tags', negate: true, values: [{ value: 'pr', wildcard: false }] },
        { key: 'text', negate: false, values: [{ value: '300 Air Squats', wildcard: false }] },
      ],
      window: { kind: 'range', start: '2026-01-01', end: '2026-02-01' },
    };
    // The source filter stays in its authored slot — never collapsed into
    // a scope-alias head (that would reorder and break composer filterText).
    expect(serialize(a)).toBe(':note{source:journal,!tags:pr,text:"300 Air Squats"} from 2026-01-01 to 2026-02-01');
    expect(structurallyEqual(parseQuery(serialize(a)), a)).toBe(true);
  });

  it('serializes the :dashboard alias head back through the alias', () => {
    expect(serialize(parseQuery(':dashboard{}'))).toBe(':dashboard');
    expect(serialize(parseQuery(':dashboard{text:fran}'))).toBe(':dashboard{text:fran}');
    // A user-authored :note shape with a non-first type filter stays on the
    // generic head in authored order (no lossy reorder).
    const authored = parseQuery(':note{text:fran,type:dashboard}');
    expect(serialize(authored)).toBe(':note{text:fran,type:dashboard}');
    expect(structurallyEqual(parseQuery(serialize(authored)), authored)).toBe(true);
  });

  it('serializes hand-built find:session queries with scope filters and windows', () => {
    const a: ParsedFindQuery = {
      family: 'find', raw: '', target: 'session',
      filters: [
        { key: 'result', negate: false, values: [{ value: 'r13', wildcard: false }] },
        { key: 'source', negate: false, values: [{ value: 'journal', wildcard: false }] },
      ],
      window: { kind: 'relative', size: 4, unit: 'w' },
    };
    // The authored source filter survives on a non-note target — collapsing
    // it into a scope-alias head would broaden the query to notes.
    expect(structurallyEqual(parseQuery(serialize(a)), a)).toBe(true);
  });

  it('serializes an aggregate with a find join and windows on both halves', () => {
    const a: ParsedAggregateQuery = {
      family: 'aggregate', raw: '', agg: 'sum', metric: 'totalVolume',
      filters: [], groupBy: [],
      window: { kind: 'relative', size: 8, unit: 'w' },
      join: {
        target: 'note',
        filters: [{ key: 'tags', negate: false, values: [{ value: 'competition', wildcard: false }] }],
        last: { size: 4, unit: 'w' },
      },
    };
    // Join halves serialize with the canonical colon source head.
    expect(serialize(a)).toBe('sum:totalVolume{} last 8w where :note{tags:competition} last 4w');
    expect(structurallyEqual(parseQuery(serialize(a)), a)).toBe(true);
  });

  it('serializes a find query with a metric join', () => {
    const a: ParsedFindQuery = {
      family: 'find', raw: '', target: 'block',
      filters: [{ key: 'text', negate: false, values: [{ value: '300 Air Squats', wildcard: false }] }],
      join: {
        agg: 'sum', metric: 'totalVolume',
        filters: [{ key: 'discipline', negate: false, values: [{ value: 'strength', wildcard: false }] }],
        operator: '>', threshold: 5000,
      },
    };
    expect(serialize(a)).toBe(':block{text:"300 Air Squats"} where sum:totalVolume{discipline:strength} > 5000');
    expect(structurallyEqual(parseQuery(serialize(a)), a)).toBe(true);
  });

  // ── Demonstrated loss regressions ──────────────────────────────────

  it('retains a standalone offset pipe (demonstrated loss: offset without limit)', () => {
    const a = parseQuery(':note | offset 5');
    expect(a.error).toBeUndefined();
    if (a.family !== 'find' || !a.pipes) throw new Error('expected find query with pipes');
    expect(a.pipes.offset).toBe(5);
    expect(a.pipes.limit).toBeUndefined();
    const text = serialize(a);
    expect(text).toBe(':note | offset 5');
    expect(structurallyEqual(parseQuery(text), a)).toBe(true);
  });

  it('keeps offset 0 through a limit pipe', () => {
    const a: ParsedFindQuery = {
      family: 'find', raw: '', target: 'note', filters: [],
      pipes: { limit: 0, offset: 0 },
    };
    const text = serialize(a);
    expect(structurallyEqual(parseQuery(text), a)).toBe(true);
  });

  it('emits find suffixes in parser order after a time edit (G1 gate)', () => {
    const a = parseQuery(':segment{effort:snatch} by {effort} in lb | limit 5');
    expect(a.error).toBeUndefined();
    // The composer's time edit mutates only the window on the parsed AST.
    if (a.family !== 'find') throw new Error('expected find query');
    a.window = { kind: 'relative', size: 1, unit: 'w' };
    const text = serialize(a);
    expect(text).toBe(':segment{effort:snatch} by {effort} in lb last 1w | limit 5');
    expect(parseQuery(text).error).toBeUndefined();
    expect(structurallyEqual(parseQuery(text), a)).toBe(true);
  });

  it('orders window before the where join with grouping (pivot note→block)', () => {
    // Emitted as `… by {week} last 2w where sum:tis{} > 0`; the pre-fix order
    // (`… last 2w by {week}`) wedged the window into the primary text and
    // failed to parse.
    const a = parseQuery(':note{tags:strength} by {week} last 2w where sum:tis{} > 0');
    expect(a.error).toBeUndefined();
    const text = serialize(a);
    expect(text).toBe(':note{tags:strength} by {week} last 2w where sum:tis{} > 0');
    const back = parseQuery(text);
    expect(back.error).toBeUndefined();
    expect(structurallyEqual(back, a)).toBe(true);
    // The pivot edits only the target on the parsed AST; join survives.
    if (a.family !== 'find') throw new Error('expected find query');
    a.target = 'block';
    const pivoted = serialize(a);
    expect(pivoted).toBe(':block{tags:strength} by {week} last 2w where sum:tis{} > 0');
    expect(parseQuery(pivoted).error).toBeUndefined();
    expect(structurallyEqual(parseQuery(pivoted), a)).toBe(true);
  });

  it('round-trips every find suffix together (group, unit, window, join, pipes)', () => {
    const a = parseQuery(':block{tags:strength} by {week} in lb last 2w where sum:tis{} > 0 | order by date | limit 5 offset 2');
    expect(a.error).toBeUndefined();
    const text = serialize(a);
    expect(text).toBe(':block{tags:strength} by {week} in lb last 2w where sum:tis{} > 0 | order by date | limit 5 offset 2');
    expect(structurallyEqual(parseQuery(text), a)).toBe(true);
  });

  // ── Property: parse(serialize(a)) ≡ a for generated ASTs ──────────

  it('round-trips generated ASTs of every family (property)', () => {
    const BARE_VALUES = ['pr', 'strength', 'back', '2026-01-12', 'hero', 'wod'];
    const KEYS = ['tags', 'discipline', 'effort', 'text', 'category'] as const;
    // Aggregate filter sides only accept fact-resolvable tag keys (parse validates).
    const AGG_KEYS = ['tags', 'discipline', 'effort', 'intensity', 'grade'] as const;
    const SOURCES = ['journal', 'feeds', 'guides', 'playground', 'collection:crossfit-girls'];
    const METRICS = ['totalVolume', 'tis', 'calc.acwr', 'maxHeartRate'];
    const DIMS = ['week', 'day', 'session', 'round', 'effort'];
    const DATES = ['2026-01-01', '2026-03-31', '2025-11-30'];
    const THRESHOLDS = [0, 5, 5000, 1234.5, 0.25];

    // ponytail: rng-comparator .sort() consumes a runtime-dependent number of
    // draws (V8 vs Bun sorts differ), desyncing the seeded stream across CI/local.
    // Upgrade path: none needed — Fisher-Yates is exact and unbiased.
    const shuffled = <T>(rng: () => number, arr: readonly T[]): T[] => {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
    const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
    const int = (rng: () => number, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
    const maybe = (rng: () => number, p: number): boolean => rng() < p;

    function genValue(rng: () => number): { value: string; wildcard: boolean } {
      const roll = rng();
      if (roll < 0.15) return { value: pick(rng, SOURCES), wildcard: false };
      if (roll < 0.3) return { value: '300 Air Squats', wildcard: false };
      return { value: pick(rng, BARE_VALUES), wildcard: maybe(rng, 0.3) };
    }

    function genFilters(rng: () => number, count: number, negate = true, pool: readonly string[] = KEYS): TagFilter[] {
      const keys = shuffled(rng, pool).slice(0, count);
      return keys.map((key) => ({
        key,
        negate: negate && maybe(rng, 0.25),
        values: Array.from({ length: int(rng, 1, 2) }, () => genValue(rng)),
      }));
    }

    function genWindow(rng: () => number): QueryWindow | undefined {
      if (!maybe(rng, 0.5)) return undefined;
      if (maybe(rng, 0.6)) return { kind: 'relative', size: int(rng, 1, 12), unit: maybe(rng, 0.5) ? 'd' : 'w' };
      const start = pick(rng, DATES);
      return maybe(rng, 0.5) ? { kind: 'range', start, end: pick(rng, DATES) } : { kind: 'range', start };
    }

    function genAggregate(rng: () => number): ParsedAggregateQuery {
      const a: ParsedAggregateQuery = {
        family: 'aggregate', raw: '',
        agg: pick(rng, WQL_AGGREGATORS),
        metric: pick(rng, METRICS),
        filters: genFilters(rng, int(rng, 0, 3), true, AGG_KEYS),
        groupBy: maybe(rng, 0.4) ? shuffled(rng, KEYS).slice(0, int(rng, 1, 2)) : [],
      };
      if (maybe(rng, 0.4)) a.rollup = { size: pick(rng, [2, 3, 7]), unit: maybe(rng, 0.5) ? 'd' : 'w' };
      if (maybe(rng, 0.3)) a.displayUnit = pick(rng, ['kg', 'lb', 'reps']);
      const w = genWindow(rng);
      if (w) a.window = w;
      if (maybe(rng, 0.3)) {
        a.join = {
          target: pick(rng, WQL_FIND_TARGETS),
          filters: genFilters(rng, int(rng, 0, 2), false),
          ...(maybe(rng, 0.5) ? { last: { size: int(rng, 1, 8), unit: maybe(rng, 0.5) ? 'd' as const : 'w' as const } } : {}),
        };
      }
      return a;
    }

    function genFind(rng: () => number): ParsedFindQuery {
      const f: ParsedFindQuery = {
        family: 'find', raw: '',
        target: pick(rng, WQL_FIND_TARGETS),
        filters: genFilters(rng, int(rng, 0, 3)),
        // The generic note head carries no default scope anymore — the
        // inclusive plane needs no scope marker on the AST.
      };
      const w = genWindow(rng);
      if (w) f.window = w;
      if (maybe(rng, 0.25)) {
        f.join = {
          agg: pick(rng, WQL_AGGREGATORS),
          metric: pick(rng, METRICS),
          filters: genFilters(rng, int(rng, 0, 2), true, AGG_KEYS),
          operator: pick(rng, WQL_COMPARISON_OPS),
          threshold: pick(rng, THRESHOLDS),
        };
      }
      if (maybe(rng, 0.25)) f.groupBy = shuffled(rng, KEYS).slice(0, int(rng, 1, 2));
      if (maybe(rng, 0.2)) f.displayUnit = pick(rng, ['kg', 'lb']);
      if (maybe(rng, 0.4)) {
        f.pipes = {};
        if (maybe(rng, 0.6)) {
          f.pipes.select = Array.from({ length: int(rng, 1, 2) }, () => ({
            col: pick(rng, ['date', 'effort', 'result']),
            ...(maybe(rng, 0.3) ? { unit: pick(rng, ['kg', 'lb', '%']) } : {}),
          }));
        }
        if (maybe(rng, 0.6)) {
          f.pipes.order = [{ col: pick(rng, ['date', 'effort']), dir: maybe(rng, 0.5) ? 'asc' : 'desc' }];
        }
        if (maybe(rng, 0.4)) f.pipes.limit = int(rng, 0, 50);
        if (maybe(rng, 0.4)) f.pipes.offset = int(rng, 0, 100);
        if (Object.keys(f.pipes).length === 0) delete f.pipes;
      }
      return f;
    }

    function genRows(rng: () => number): ParsedFindQuery {
      const scopeKey = pick(rng, ['result', 'block', 'note']);
      const target = pick(rng, ['session', 'segment'] as const);
      const r: ParsedFindQuery = {
        family: 'find', raw: '',
        target,
        filters: [
          { key: scopeKey, negate: false, values: [{ value: pick(rng, ['r1', 'r13', 'blk-9', 'note-3']), wildcard: false }] },
        ],
      };
      const w = genWindow(rng);
      if (w) r.window = w;
      return r;
    }

    // mulberry32 — deterministic, no new dependencies.
    const rng = (() => {
      let t = 0x9e3779b9;
      return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    })();
    const texts = new Set<string>();
    let joins = 0;
    let windows = 0;
    let rollups = 0;
    let units = 0;
    let pipes = 0;
    let standalones = 0;
    for (let i = 0; i < 400; i++) {
      const a = i % 3 === 0 ? genAggregate(rng) : i % 3 === 1 ? genFind(rng) : genRows(rng);
      const text = serialize(a);
      texts.add(text);
      if (a.join) joins++;
      if (a.window) windows++;
      if (a.family === 'aggregate' && a.rollup) rollups++;
      if (a.family === 'aggregate' && a.displayUnit) units++;
      if (a.family === 'find' && a.pipes) {
        pipes++;
        if (a.pipes.offset !== undefined && a.pipes.limit === undefined) standalones++;
      }
      const back = parseQuery(text);
      expect(back.error, `iteration ${i}: ${text}`).toBeUndefined();
      expect(structurallyEqual(back, a), `iteration ${i}: ${text}`).toBe(true);
      expect(serialize(back), `iteration ${i}: not a fixed point: ${text}`).toBe(text);
    }
    // Generator-coverage guard: the property only proves what it exercises.
    expect(texts.size).toBeGreaterThan(300);
    expect(joins).toBeGreaterThan(50);
    expect(windows).toBeGreaterThan(150);
    expect(rollups).toBeGreaterThan(30);
    expect(units).toBeGreaterThan(20);
    expect(pipes).toBeGreaterThan(40);
    expect(standalones).toBeGreaterThan(8);
  });
  it('round-trips canonical corpus strings semantically (no text re-pinning)', () => {
    const corpus = [
      'sum:tis{}',
      'sum:totalVolume{discipline:strength,!effort:burpee} by {week, effort}.rollup(2w) in kg last 4w',
      'max:tis{effort:back*}',
      'sum:totalVolume{note:a|b|c}',
      'count:exercise{} from 2025-11-30 to 2026-03-31',
      ':note',
      ':note last 8w',
      ':journal{tags:pr}',
      ':block{text:"300 Air Squats"} from 2026-01-01',
      ':effort{category:hero} where sum:totalVolume{discipline:strength} > 5000',
      'sum:totalVolume{} where find:note{tags:competition} last 4w',
      'sum:tis{} by {session}.rollup(7d) last 12w where find:note',
      ':session{result:r13}',
      ':session{result:r13,source:journal} last 4w',
      ':session{note:note-3} from 2026-01-01 to 2026-02-01',
      ':segment{effort:running} | order by date | limit 10',
    ];
    for (const text of corpus) {
      const a = parseQuery(text);
      expect(a.error, text).toBeUndefined();
      const out = serialize(a);
      expect(parseQuery(out).error, out).toBeUndefined();
      expect(structurallyEqual(parseQuery(out), a), text).toBe(true);
    }
  });

  it('serializes a colon function query in the retained legacy aggregate form', () => {
    const a = parseQuery(':sum{metric:tis, effort:snatch} by {week}');
    expect(a.error).toBeUndefined();
    if (a.family !== 'aggregate') throw new Error('expected aggregate');
    expect(a.metric).toBe('tis');
    expect(a.filters).toEqual([{ key: 'effort', negate: false, values: [{ value: 'snatch', wildcard: false }] }]);
    const text = serialize(a);
    expect(text).toBe('sum:tis{effort:snatch} by {week}');
    expect(structurallyEqual(parseQuery(text), a)).toBe(true);
  });

  it('round-trips pipelines end to end', () => {
    const pipelines = [
      ':journal{effort:snatch} last 8w | :sum{metric:tis} by {week} | :timeseries{}',
      '@today | :count{} | :bar{type:session}',
      '@session | :sum{metric:tis} | :max{metric:tis} | :value',
      ':segment{effort:sn*} | :avg{metric:reps} | :table',
      ':sum{metric:tis} | :bar',
      ':note{tags:pr} | :table',
    ];
    for (const text of pipelines) {
      const a = parseQuery(text);
      expect(a.error, text).toBeUndefined();
      expect(a.family, text).toBe('pipeline');
      const out = serialize(a);
      expect(parseQuery(out).error, out).toBeUndefined();
      expect(structurallyEqual(parseQuery(out), a), text).toBe(true);
    }
  });

  it('parses a lone chart as an implicit :segment pipeline (made explicit on serialize)', () => {
    const a = parseQuery(':bar{type:session}');
    expect(a.error).toBeUndefined();
    expect(a.family).toBe('pipeline');
    if (a.family !== 'pipeline') return;
    expect(a.source).toEqual({ kind: 'query', query: { family: 'find', raw: ':segment{}', target: 'segment', filters: [] } });
    expect(a.transforms).toEqual([]);
    expect(a.sink).toEqual({
      head: 'bar',
      filters: [{ key: 'type', negate: false, values: [{ value: 'session', wildcard: false }] }],
    });
    // A bare numeric stage inherits the carried aggregate's metric.
    const chained = parseQuery(':sum{metric:tis} | :max{}');
    expect(chained.error).toBeUndefined();
    if (chained.family === 'pipeline') {
      expect(chained.transforms[0]?.metric).toBe('tis');
    }
    expect(structurallyEqual(parseQuery(serialize(a)), a)).toBe(true);
  });

  it('echoes raw text for errored ASTs (total over all parses)', () => {
    for (const bad of ['find:bogus', 'rows:all{}', 'rows:all{result:r1} by {day}', 'sum: in kg', 'find:note last 8w from 2026-01-01']) {
      const a = parseQuery(bad);
      expect(a.error, bad).toBeDefined();
      expect(serialize(a), bad).toBe(bad);
    }
  });

  it('echoes raw for hand-built ASTs flagged with an error', () => {
    const a: ParsedFindQuery = { family: 'find', raw: 'find:note in journal', target: '', filters: [], error: 'x' };
    expect(serialize(a)).toBe('find:note in journal');
  });
});
