/**
 * WQL serializer (C6 — one structured interface for code).
 *
 * The total serializer over the C5 discriminated query union: code holds the
 * AST; strings live only at document edges (URL `?q=`, ```query``` fences,
 * dashboard bodies). Properties (proven by tests/serialize.test.ts):
 *
 *   1. `serialize(parse(x)) === x` for canonical inputs (fixed-point text), and
 *   2. `parse(serialize(a))` is structurally equal to `a` for every AST —
 *      equal on all query-structure fields; `raw` (provenance text) and
 *      `advisories` (parse-time deprecation notices) are intentionally not
 *      reproduced, since serialization emits modern canonical syntax.
 *
 * Errored ASTs serialize to their original `raw` text — a query that failed
 * to parse has no well-defined structure to re-emit, and echoing the input
 * keeps the function total.
 *
 * Round-trip equality holds for text-surface-representable ASTs. Single
 * aggregate queries serialize in the retained legacy `sum:metric{…}` form;
 * find queries serialize with colon source heads (find: is retired) and
 * pipelines as `source | :fn{…} | :chart{…}`. Three value
 * shapes the grammar cannot express (or parses away) sit outside that
 * contract — documented here rather than silently corrupted:
 *   - a `"` inside a filter value: the quoted token has no escape form;
 *   - a quoted value with `wildcard: true`: the parser forces wildcard=false
 *     on quoted atoms (extractFilters), so the flag cannot survive;
 *   - thresholds whose String() is exponential (>= 1e21): outside the join
 *     comparison regex's plain-decimal domain.
 */

import { WQL_TYPE_HEADS } from './vocabulary';
import type { AnyParsedQuery, MetricPredicate, ParsedAggregateQuery, ParsedFindQuery, PipelineSource, ParsedPipelineQuery, QueryWindow, TagFilter } from './wql';

/** `:note{…}` / `:session{…}` — always the target head with the filters in
 *  their authored order. A source: filter is never collapsed into a
 *  scope-alias head: the collapse can reorder/broaden (a :journal head on a
 *  session query) and it breaks composer's filterText editing, which maps
 *  serialized filter clauses back to AST positions. */
/** A note-target AST in the exact shape the `:dashboard` alias head parses
 *  to (first filter = literal `type:dashboard`, no source scope) — shared
 *  by the head and scope serializers so both emit through the alias. */
function isDashboardHeadShape(f: ParsedFindQuery): boolean {
  const first = f.filters[0];
  return f.target === 'note' && f.sourceScope === undefined
    && !!first && first.key === 'type' && !first.negate
    && first.values.length === 1 && !first.values[0]!.wildcard
    && first.values[0]!.value === WQL_TYPE_HEADS.dashboard;
}

function serializeFindHead(f: ParsedFindQuery, extra: TagFilter[] = []): string {
  // The type-alias head serializes back through its alias: reparse
  // re-injects the type filter at the same first position.
  if (isDashboardHeadShape(f)) {
    const filters = [...f.filters.slice(1), ...extra];
    return `:dashboard${filters.length ? `{${serializeFilters(filters)}}` : ''}`;
  }
  const filters = [...f.filters, ...extra];
  return `:${f.target}${filters.length ? `{${serializeFilters(filters)}}` : ''}`;
}

/** Scope handling for the generic note head. The note head is inclusive —
 *  there is no default scope anymore, so no `in all` marker is emitted (the
 *  legacy suffix still parses); a non-canonical sourceScope serializes as
 *  explicit source: filters. */
function serializeScopeInfo(f: ParsedFindQuery): { clause: string; scopeFilters: TagFilter[] } {
  if (f.target !== 'note' || f.filters.some((t) => t.key === 'source')) return { clause: '', scopeFilters: [] };
  // The alias head is scope-free by construction.
  if (isDashboardHeadShape(f)) return { clause: '', scopeFilters: [] };
  if (!f.sourceScope?.length) return { clause: '', scopeFilters: [] };
  return {
    clause: '',
    scopeFilters: [{ key: 'source', negate: false, values: f.sourceScope.map((v) => ({ value: v, wildcard: false })) }],
  };
}

/** Find query text without presentation pipes — a pipeline source stage
 *  (pipes between stages are separators, so a source stage has none). */
function serializeFindStage(f: ParsedFindQuery): string {
  const scope = serializeScopeInfo(f);
  const parts = [serializeFindHead(f, scope.scopeFilters)];
  if (f.groupBy?.length) parts.push(`by {${f.groupBy.join(', ')}}`);
  if (f.displayUnit) parts.push(`in ${f.displayUnit}`);
  parts.push(scope.clause);
  parts.push(serializeWindow(f.window));
  if (f.join) parts.push(`where ${serializeMetricHalf(f.join)}`);
  return parts.filter(Boolean).join(' ');
}

/** `:sum{metric:tis, <filters>} [by {..}] [.rollup(..)] [in u] [window] [where …]`
 *  — the colon function form; the metric re-enters the filters. */
function serializeFunctionStage(a: ParsedAggregateQuery): string {
  const filters = a.metric
    ? [
        {
          key: 'metric',
          negate: false,
          values: [{ value: a.metric, wildcard: false, ...(a.metricParam ? { param: a.metricParam } : {}) }],
        },
        ...a.filters,
      ]
    : a.filters;
  let text = `:${a.agg}{${serializeFilters(filters)}}`;
  if (a.groupBy.length) text += ` by {${a.groupBy.join(', ')}}`;
  if (a.rollup) text += `.rollup(${a.rollup.size}${a.rollup.unit})`;
  if (a.displayUnit) text += ` in ${a.displayUnit}`;
  const win = serializeWindow(a.window);
  if (win) text += ` ${win}`;
  if (a.join) text += ` where ${serializeFindHalf(a.join.target, a.join.filters, a.join.last)}`;
  return text;
}

function serializePipelineStage(source: PipelineSource): string {
  return source.kind === 'dataset'
    ? source.name
    : source.query.family === 'find' ? serializeFindStage(source.query) : serializeFunctionStage(source.query);
}

/** Serialize a pipeline: `source | :fn{…} | :chart{…}`. */
function serializePipeline(p: ParsedPipelineQuery): string {
  const parts = [serializePipelineStage(p.source), ...p.transforms.map(serializeFunctionStage)];
  if (p.sink) {
    parts.push(`:${p.sink.head}${p.sink.filters.length ? `{${serializeFilters(p.sink.filters)}}` : ''}`);
  }
  return parts.join(' | ');
}

/** Quote a filter value unless it fits the grammar's bare forms — a dotted
 *  `Word` chain (`calc.acwr`) or a catalog-id `Word:Word` chain. Quoted
 *  phrases (`"[^"]*"`) carry multi-word text; the grammar has no escape, so
 *  values containing `"` are outside the text surface entirely. */
function serializeValue(value: string): string {
  if (/^[a-zA-Z0-9_-]+((:|\.)[a-zA-Z0-9_-]+)*$/.test(value)) return value;
  return `"${value}"`;
}

/** `{key:val1|val2, !other:val*, $scope}` — commas between keys, `|` between a
 * key's OR-alternatives, per-value `*` wildcard, `!` negation, `$param` refs. */
function serializeFilters(filters: TagFilter[]): string {
  return filters
    .map((f) => {
      if (f.kind === 'spreadParam' || (f.key.startsWith('$') && f.values.length === 0)) {
        const p = f.param ?? f.key.replace(/^\$/, '');
        return `$${p}`;
      }
      return `${f.negate ? '!' : ''}${f.key}:${f.values
        .map((v) => (v.param ? `$${v.param}` : serializeValue(v.value) + (v.wildcard ? '*' : '')))
        .join('|')}`;
    })
    .join(',');
}

/** `<agg>:<metric>{filters}` — the head shared by aggregate queries and the
 * metric half of a cross-store join. Aggregate heads always carry braces,
 * matching the canonical corpus (`sum:tis{}`). */
function serializeAggHead(agg: string, metric: string, filters: TagFilter[]): string {
  return `${agg}:${metric}{${serializeFilters(filters)}}`;
}

function serializeAggregateHead(a: ParsedAggregateQuery): string {
  return serializeAggHead(a.agg, a.metricParam ? `$${a.metricParam}` : a.metric, a.filters);
}

/** `:target{filters}[ last <n><unit>]` — the content half of a cross-store
 * join reuses the colon source head plus its relative window (range windows
 * are rejected on join halves at parse). */
function serializeFindHalf(target: string, filters: TagFilter[], last?: { size: number; unit: 'd' | 'w' }): string {
  const head = `:${target}${filters.length ? `{${serializeFilters(filters)}}` : ''}`;
  return last ? `${head} last ${last.size}${last.unit}` : head;
}

/** `<agg>:<metric>{filters} <op> <threshold>` — the metric half of a
 * cross-store join attached to a find query. */
function serializeMetricHalf(j: MetricPredicate): string {
  return `${serializeAggHead(j.agg, j.metric, j.filters)} ${j.operator} ${j.threshold}`;
}


/** Window clause (C1): `last 8w`, `last $range`, or `from 2026-01-01 [to 2026-03-31]`.
 * Returns '' when the AST has no window. */
function serializeWindow(w: QueryWindow | undefined): string {
  if (!w) return '';
  if (w.kind === 'relative') return `last ${w.size}${w.unit}`;
  if (w.kind === 'param') return `last $${w.param}${w.unit ? ` ${w.unit}` : ''}`;
  return w.end ? `from ${w.start} to ${w.end}` : `from ${w.start}`;
}

/** Serialize any parsed query to canonical WQL text. Total: never throws. */
export function serialize(parsed: AnyParsedQuery): string {
  if (parsed.error) return parsed.raw;
  if (parsed.family === 'aggregate') {
    const a = parsed;
    let text = serializeAggregateHead(a);
    if (a.groupBy.length) text += ` by {${a.groupBy.join(', ')}}`;
    if (a.rollup) text += `.rollup(${a.rollup.size}${a.rollup.unit})`;
    if (a.displayUnit) text += ` in ${a.displayUnit}`;
    const win = serializeWindow(a.window);
    if (win) text += ` ${win}`;
    if (a.join) text += ` where ${serializeFindHalf(a.join.target, a.join.filters, a.join.last)}`;
    return text;
  }
  if (parsed.family === 'find') {
    // Suffix order mirrors the parser's end-anchored extraction (wqlSuffix):
    // head, by, in-unit, in-all scope, window, where-join — pipes trail after `|`.
    const scope = serializeScopeInfo(parsed);
    const parts = [serializeFindHead(parsed, scope.scopeFilters)];
    if (parsed.groupBy?.length) parts.push(`by {${parsed.groupBy.join(', ')}}`);
    if (parsed.displayUnit) parts.push(`in ${parsed.displayUnit}`);
    parts.push(scope.clause);
    parts.push(serializeWindow(parsed.window));
    if (parsed.join) parts.push(`where ${serializeMetricHalf(parsed.join)}`);
    let text = parts.filter(Boolean).join(' ');
    if (parsed.pipes) {
      const pipeParts: string[] = [];
      if (parsed.pipes.select) {
        pipeParts.push(`select ${parsed.pipes.select.map((s) => s.col + (s.unit ? ` in ${s.unit}` : '')).join(', ')}`);
      }
      if (parsed.pipes.order) {
        pipeParts.push(`order by ${parsed.pipes.order.map((o) => o.dir === 'desc' ? `${o.col} desc` : o.col).join(', ')}`);
      }
      if (parsed.pipes.limit !== undefined) {
        pipeParts.push(`limit ${parsed.pipes.limit}${parsed.pipes.offset !== undefined ? ` offset ${parsed.pipes.offset}` : ''}`);
      } else if (parsed.pipes.offset !== undefined) {
        pipeParts.push(`offset ${parsed.pipes.offset}`);
      }
      if (pipeParts.length > 0) {
        text += ` | ${pipeParts.join(' | ')}`;
      }
    }
    return text;
  }
  if (parsed.family === 'pipeline') {
    return serializePipeline(parsed);
  }
  const unhandled = parsed as { raw?: string };
  return unhandled.raw ?? '';
}
