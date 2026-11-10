/**
 * First-class WQL `$param` (`ParamRef`) inspection and AST-level binding.
 *
 * Queries containing `$scope`, `effort:$effort`, `sum:$metric{}`, or
 * `last $range` parse directly into typed AST nodes without pre-parse regex
 * text substitution. At execution time, `bindQueryParams` binds active
 * parameter values onto the AST — cleanly dropping empty optional filters
 * (`$scope = ""`) instead of producing trailing-comma syntax errors, and
 * routing content-only scope filters (`notebook:…`, `source:…`) on aggregate
 * queries into a `where :note{…}` join.
 */

import { serialize } from './serialize';
import { WQL_CONTENT_ONLY_KEYS } from './vocabulary';
import {
  parseQuery,
  type AnyParsedQuery,
  type FindPredicate,
  type MetricPredicate,
  type ParsedAggregateQuery,
  type ParsedFindQuery,
  type ParsedPipelineQuery,
  type QueryWindow,
  type TagFilter,
  type TagValue,
} from './wql';

function collectFromFilters(filters: readonly TagFilter[], out: Set<string>): void {
  for (const f of filters) {
    if (f.kind === 'spreadParam' || (f.key.startsWith('$') && f.values.length === 0)) {
      const name = f.param ?? f.key.replace(/^\$/, '');
      if (name) out.add(name);
      continue;
    }
    for (const v of f.values) {
      if (v.param) out.add(v.param);
    }
  }
}

function collectFromWindow(w: QueryWindow | undefined, out: Set<string>): void {
  if (w?.kind === 'param') out.add(w.param);
}

function collectFromSingle(q: ParsedAggregateQuery | ParsedFindQuery, out: Set<string>): void {
  if (q.family === 'aggregate') {
    if (q.metricParam) out.add(q.metricParam);
    collectFromFilters(q.filters, out);
    collectFromWindow(q.window, out);
    if (q.join) collectFromFilters(q.join.filters, out);
    return;
  }
  collectFromFilters(q.filters, out);
  collectFromWindow(q.window, out);
  if (q.join) collectFromFilters(q.join.filters, out);
}

/**
 * Collect all `$param` names referenced anywhere in a parsed WQL AST, in
 * deterministic appearance order.
 */
export function collectQueryParams(parsed: AnyParsedQuery): string[] {
  const out = new Set<string>();
  if (parsed.family === 'pipeline') {
    if (parsed.source.kind === 'query') collectFromSingle(parsed.source.query, out);
    for (const t of parsed.transforms) collectFromSingle(t, out);
    if (parsed.sink) collectFromFilters(parsed.sink.filters, out);
    return [...out];
  }
  collectFromSingle(parsed, out);
  return [...out];
}

/** Parse a filter fragment (`effort:snatch, discipline:weightlifting` or `:note{tags:pr}`) into `TagFilter[]`. */
export function parseFilterFragment(fragment: string): { filters: TagFilter[]; error?: string } {
  const trimmed = fragment.trim();
  if (!trimmed) return { filters: [] };
  if (trimmed.startsWith(':') || trimmed.startsWith('find:')) {
    const asQuery = parseQuery(trimmed);
    if (asQuery.error) return { filters: [], error: asQuery.error };
    if (asQuery.family === 'find' || asQuery.family === 'aggregate') {
      return { filters: asQuery.filters };
    }
    if (asQuery.family === 'pipeline' && asQuery.source.kind === 'query') {
      return { filters: asQuery.source.query.filters };
    }
    return { filters: [] };
  }
  const inner = trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1).trim() : trimmed;
  if (!inner) return { filters: [] };
  const probe = parseQuery(`:segment{${inner}}`);
  if (!probe.error && probe.family === 'find') {
    return { filters: probe.filters };
  }
  const noteProbe = parseQuery(`:note{${inner}}`);
  if (!noteProbe.error && noteProbe.family === 'find') {
    return { filters: noteProbe.filters };
  }
  return { filters: [], error: noteProbe.error ?? probe.error ?? `Cannot parse filter parameter "${fragment}"` };
}

function bindWindow(
  w: QueryWindow | undefined,
  params: Record<string, string>,
): { window?: QueryWindow; error?: string } {
  if (!w || w.kind !== 'param') return { window: w };
  const raw = (params[w.param] ?? '').trim();
  if (!raw || raw.toLowerCase() === 'all') return { window: undefined };
  const withUnit = w.unit && /^\d+$/.test(raw) ? `${raw}${w.unit}` : raw;
  const rel = /^(?:last\s+)?(\d+)\s*([dw])$/i.exec(withUnit);
  if (rel) {
    return {
      window: {
        kind: 'relative',
        size: Number(rel[1]),
        unit: rel[2]!.toLowerCase() as 'd' | 'w',
      },
    };
  }
  const range = /^(?:from\s+)?(\d{4}-\d{2}-\d{2})(?:\s*(?:to|\.\.)\s*(\d{4}-\d{2}-\d{2}))?$/i.exec(raw);
  if (range) {
    return {
      window: {
        kind: 'range',
        start: range[1]!,
        ...(range[2] ? { end: range[2] } : {}),
      },
    };
  }
  return { error: `Invalid window value "${raw}" for $${w.param} — expected <n>d|<n>w or YYYY-MM-DD[..YYYY-MM-DD]` };
}

function bindFilters(
  filters: readonly TagFilter[],
  params: Record<string, string>,
  opts: { isAggregate: boolean },
): { filters: TagFilter[]; contentJoinFilters: TagFilter[]; error?: string } {
  const bound: TagFilter[] = [];
  const contentJoinFilters: TagFilter[] = [];

  for (const f of filters) {
    if (f.kind === 'spreadParam' || (f.key.startsWith('$') && f.values.length === 0)) {
      const name = f.param ?? f.key.replace(/^\$/, '');
      const rawVal = (params[name] ?? '').trim();
      if (!rawVal) continue;
      const frag = parseFilterFragment(rawVal);
      if (frag.error) return { filters: [], contentJoinFilters: [], error: frag.error };
      for (const expanded of frag.filters) {
        if (opts.isAggregate && (WQL_CONTENT_ONLY_KEYS as readonly string[]).includes(expanded.key)) {
          contentJoinFilters.push(expanded);
        } else {
          bound.push(expanded);
        }
      }
      continue;
    }

    if (!f.values.some((v) => v.param !== undefined)) {
      bound.push(f);
      continue;
    }

    const nextValues: TagValue[] = [];
    for (const v of f.values) {
      if (!v.param) {
        nextValues.push(v);
        continue;
      }
      const rawVal = (params[v.param] ?? '').trim();
      if (!rawVal) continue;
      const formatted = /[\s,{}"]/.test(rawVal) && !rawVal.startsWith('"')
        ? `"${rawVal.replace(/"/g, '')}"`
        : rawVal;
      const probe = parseQuery(`:segment{${f.key}:${formatted}}`);
      if (!probe.error && probe.family === 'find' && probe.filters[0]) {
        nextValues.push(...probe.filters[0].values);
      } else {
        const noteProbe = parseQuery(`:note{${f.key}:${formatted}}`);
        if (!noteProbe.error && noteProbe.family === 'find' && noteProbe.filters[0]) {
          nextValues.push(...noteProbe.filters[0].values);
        } else {
          return {
            filters: [],
            contentJoinFilters: [],
            error: noteProbe.error ?? probe.error ?? `Invalid value "${rawVal}" for $${v.param}`,
          };
        }
      }
    }
    if (nextValues.length > 0) {
      bound.push({ key: f.key, negate: f.negate, values: nextValues });
    }
  }

  return { filters: bound, contentJoinFilters };
}

function bindAggregate(
  q: ParsedAggregateQuery,
  params: Record<string, string>,
  opts: { inPipelineTransform?: boolean } = {},
): ParsedAggregateQuery {
  const metric = q.metricParam ? (params[q.metricParam] ?? '').trim() : q.metric;
  if (q.metricParam && !metric && q.agg !== 'count') {
    return { ...q, error: `Parameter $${q.metricParam} resolved to an empty metric` };
  }
  const win = bindWindow(q.window, params);
  if (win.error) return { ...q, error: win.error };
  const fRes = bindFilters(q.filters, params, { isAggregate: true });
  if (fRes.error) return { ...q, error: fRes.error };

  let join: FindPredicate | undefined = q.join;
  if (join) {
    const jRes = bindFilters(join.filters, params, { isAggregate: false });
    if (jRes.error) return { ...q, error: jRes.error };
    join = { ...join, filters: jRes.filters };
  }
  if (fRes.contentJoinFilters.length > 0 && !opts.inPipelineTransform) {
    join = join
      ? { ...join, filters: [...join.filters, ...fRes.contentJoinFilters] }
      : { target: 'note', filters: fRes.contentJoinFilters };
  }

  return {
    ...q,
    metric,
    metricParam: undefined,
    filters: fRes.filters,
    window: win.window,
    ...(join ? { join } : { join: undefined }),
  };
}

function bindFind(q: ParsedFindQuery, params: Record<string, string>): ParsedFindQuery {
  const win = bindWindow(q.window, params);
  if (win.error) return { ...q, error: win.error };
  const fRes = bindFilters(q.filters, params, { isAggregate: false });
  if (fRes.error) return { ...q, error: fRes.error };

  let join: MetricPredicate | undefined = q.join;
  if (join) {
    const jRes = bindFilters(join.filters, params, { isAggregate: true });
    if (jRes.error) return { ...q, error: jRes.error };
    join = { ...join, filters: jRes.filters };
  }

  return {
    ...q,
    filters: fRes.filters,
    window: win.window,
    ...(join ? { join } : { join: undefined }),
  };
}

/**
 * Bind `$param` AST nodes (`ParamRef`) on a parsed query using `params`.
 *
 * If any referenced `$param` is absent from `params` (`params[name] === undefined`),
 * returns `{ parsed, missing }` without mutating `parsed` so callers can surface
 * `unknownTokensMessage(missing)`. Empty string values (`""`) are treated as
 * "unfiltered / unset" for filter and window parameters.
 */
export function bindQueryParams(
  parsed: AnyParsedQuery,
  params: Record<string, string>,
): { parsed: AnyParsedQuery; missing: string[] } {
  if (parsed.error) return { parsed, missing: [] };
  const referenced = collectQueryParams(parsed);
  if (referenced.length === 0) return { parsed, missing: [] };

  const missing = referenced.filter((name) => params[name] === undefined);
  if (missing.length > 0) return { parsed, missing };

  let bound: AnyParsedQuery;
  if (parsed.family === 'aggregate') {
    bound = bindAggregate(parsed, params);
  } else if (parsed.family === 'find') {
    bound = bindFind(parsed, params);
  } else {
    let source = parsed.source;
    let contentJoinForSource: TagFilter[] = [];
    if (source.kind === 'query') {
      const sq = source.query.family === 'aggregate'
        ? bindAggregate(source.query, params)
        : bindFind(source.query, params);
      if (sq.error) return { parsed: { ...parsed, error: sq.error }, missing: [] };
      source = { kind: 'query', query: sq };
    }
    const transforms: ParsedAggregateQuery[] = [];
    for (const t of parsed.transforms) {
      // Check if spreadParam on transform had content-only keys — lift to find source!
      const rawFilterBind = bindFilters(t.filters, params, { isAggregate: true });
      if (rawFilterBind.contentJoinFilters.length > 0) {
        contentJoinForSource = [...contentJoinForSource, ...rawFilterBind.contentJoinFilters];
      }
      const bt = bindAggregate(t, params, { inPipelineTransform: true });
      if (bt.error) return { parsed: { ...parsed, error: bt.error }, missing: [] };
      transforms.push(bt);
    }
    if (contentJoinForSource.length > 0 && source.kind === 'query' && source.query.family === 'find') {
      if (source.query.target === 'note' || source.query.target === 'block') {
        source = {
          kind: 'query',
          query: { ...source.query, filters: [...source.query.filters, ...contentJoinForSource] },
        };
      }
    }
    let sink = parsed.sink;
    if (sink) {
      const sRes = bindFilters(sink.filters, params, { isAggregate: false });
      if (sRes.error) return { parsed: { ...parsed, error: sRes.error }, missing: [] };
      sink = { ...sink, filters: sRes.filters };
    }
    bound = {
      ...parsed,
      source,
      transforms,
      ...(sink ? { sink } : {}),
    } as ParsedPipelineQuery;
  }

  if (bound.error) return { parsed: bound, missing: [] };
  // Re-parse canonical serialized text so target advisories, retired-source
  // checks, and `raw` provenance match a directly authored query.
  const reparsed = parseQuery(serialize(bound));
  return { parsed: reparsed, missing: [] };
}
