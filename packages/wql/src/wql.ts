/**
 * WQL — Wod Query Language (Datadog-flavored). See CONTEXT.md glossary.
 *
 *   <aggregator>:<metric.namespace>{<tag filters>} by {<dimensions>} .rollup(<period>)
 *
 *   sum:totalVolume{discipline:strength} by {week}.rollup(1w)
 *   avg:tis{effort:thruster,!discipline:recovery} by {session}
 *
 * This module holds the AST contract the Query Service executes and the
 * Lezer-backed `parseQuery` front-end over grammar/wql.grammar (house
 * pattern). The grammar accepts the full WQL surface with error recovery;
 * this mapper validates the recovered tree and produces the AST below.
 */

import { parser as wqlParser } from './grammar/wql.parser';
import type { SyntaxNode } from '@lezer/common';
import * as terms from './grammar/wql.parser.terms';
import {
  WQL_AGGREGATORS,
  WQL_FIND_TARGETS,
  WQL_ROWS_SCOPE_KEYS,
  WQL_ROWS_TARGETS,
  WQL_SOURCE_VALUES,
  type WqlAggregator,
  WQL_TAG_KEYS,
  type WqlComparisonOp,
} from './vocabulary';
import { parseWqlSuffixes, splitAtWhere, type ParsedWqlWindowSuffix } from './wqlSuffix';

export { WQL_AGGREGATORS, WQL_COMPARISON_OPS, WQL_SOURCE_VALUES } from './vocabulary';
export { parseWqlSuffixes, splitAtWhere } from './wqlSuffix';

export type Aggregator = WqlAggregator;

export interface TagValue {
  value: string;
  wildcard: boolean;
}

export interface TagFilter {
  key: string;
  negate: boolean;
  values: TagValue[];
}

/** Comparison operator in a cross-store metric predicate (`> 5000`). */
export type ComparisonOp = WqlComparisonOp;

/**
 * Analytics half of a cross-store join — the metric predicate attached to a
 * find query via `where`. Example: `sum:totalVolume{discipline:strength} > 5000`.
 * Aggregates are evaluated against RAW WorkoutResult logs (not derived facts),
 * joined at the blockContentId level ("logs win", issue #800).
 */
export interface MetricPredicate {
  agg: Aggregator;
  metric: string;
  filters: TagFilter[];
  operator: ComparisonOp;
  threshold: number;
}

/**
 * Content half of a cross-store join — the find predicate attached to an
 * analytics query via `where`. Example: `find:note{tags:competition,source:journal}`.
 * Restricts the metric computation to the blockContentIds owned by matching
 * content; the metric is recomputed from raw logs for those blocks only.
 */
export interface FindPredicate {
  target: string;
  filters: TagFilter[];
  last?: { size: number; unit: 'd' | 'w' };
}

/**
 * Result of parsing an analytics (aggregate) query — `agg:metric{filters} …`.
 * Discriminated union member: `family === 'aggregate'` (C5).
 */
export interface ParsedAggregateQuery {
  family: 'aggregate';
  raw: string;
  agg: Aggregator;
  /** Canonical Metric Key (fact row `metricKey`). */
  metric: string;
  filters: TagFilter[];
  /** Tag keys, or virtual dims: day | week | session | round. */
  groupBy: string[];
  rollup?: { size: number; unit: 'd' | 'w' };
  /** Time-selection window (C1): `last 6w` or `from … [to …]`. */
  window?: QueryWindow;
  /** Optional display unit directive — `in kg` / `in lb`. */
  displayUnit?: string;
  /** Cross-store content join (`where find:note{...}`); restricts to raw logs. */
  join?: FindPredicate;
  /** Deprecation advisories (C2 normalizer). */
  advisories?: string[];
  error?: string;
}

/** Parse `| select col [in unit], … | order by col [asc|desc] | limit n [offset m]`. */
function parseRowsPipes(text: string): RowsPipes {
    const pipes: RowsPipes = {};
    const segments = text.split('|').map((s) => s.trim()).filter(Boolean);
    for (const segment of segments) {
        const lower = segment.toLowerCase();
        if (lower.startsWith('select')) {
            const body = segment.slice(6).trim();
            pipes.select = body.split(',').map((col) => {
                const m = /^([\w-]+)(?:\s+in\s+([\w/%]+))?$/i.exec(col.trim());
                return m
                    ? { col: m[1]!, ...(m[2] ? { unit: m[2] } : {}) }
                    : { col: col.trim() };
            });
        } else if (lower.startsWith('order by')) {
            const body = segment.slice(8).trim();
            pipes.order = body.split(',').map((col) => {
                const m = /^(\S+)(?:\s+(asc|desc))?$/i.exec(col.trim());
                return { col: m?.[1] ?? col.trim(), dir: (m?.[2]?.toLowerCase() as 'asc' | 'desc') ?? 'asc' };
            });
        } else if (lower.startsWith('limit')) {
            const m = /^limit\s+(\d+)(?:\s+offset\s+(\d+))?$/i.exec(segment);
            if (!m) {
                pipes.error = `Cannot parse pipe "${segment}". Expected limit <n> [offset <m>]`;
                return pipes;
            }
            pipes.limit = Number(m[1]);
            if (m[2]) pipes.offset = Number(m[2]);
        } else if (lower.startsWith('offset')) {
            const m = /^offset\s+(\d+)$/i.exec(segment);
            if (!m) {
                pipes.error = `Cannot parse pipe "${segment}". Expected offset <n>`;
                return pipes;
            }
            pipes.offset = Number(m[1]);
        } else {
            pipes.error = `Unknown pipe "${segment}". Try: select, order by, limit`;
            return pipes;
        }
    }
    return pipes;
}

/**
 * Ticket 18 — drill-down: construct a cross-workout `rows:segment` query
 * inheriting an aggregate point's tag/metadata filters, the clicked bucket's
 * EXACT half-open civil boundaries (structural, not display timestamps), and
 * the clicked group tuple as exact filters.
 */
export function buildDrillDownQuery(options: {
    filters?: Array<{ key: string; values: readonly string[] }>;
    /** Half-open bucket bounds (ms epoch) from the clicked point's bucket. */
    start?: number;
    end?: number;
    /** Civil dates (YYYY-MM-DD) — used when the point is a calendar bucket. */
    startIso?: string;
    endIso?: string;
    timeZone?: string;
    limit?: number;
}): string {
    const parts: string[] = [];
    const filterText = (options.filters ?? [])
        .map((f) => `${f.key}:${f.values.join('|')}`)
        .join(',');
    parts.push(`rows:segment{${filterText}}`);
    if (options.startIso && options.endIso) parts.push(`from ${options.startIso} to ${options.endIso}`);
    else if (options.start !== undefined && options.end !== undefined && options.timeZone) {
        const fmt = (ts: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
        parts.push(`from ${fmt(options.start, options.timeZone)} to ${fmt(options.end - 1, options.timeZone)}`);
    }
    let query = parts.join(' ');
    if (options.limit !== undefined) query += ` | limit ${options.limit}`;
    return query;
}

/** Result of parsing a content-discovery query (`find:target{filters} in scope`). */
export interface ParsedFindQuery {
  family: 'find';
  raw: string;
  /** Content target — a WQL_FIND_TARGETS value (C7 closed enum). */
  target: string;
  filters: TagFilter[];
  /** Time-selection window (C1): `last 8w` or `from … [to …]`. */
  window?: QueryWindow;
  /** Cross-store metric join (`where sum:totalVolume{} > 5000`). */
  join?: MetricPredicate;
  /** Deprecation advisories (C2 normalizer). */
  advisories?: string[];
  error?: string;
}

/**
 * Time-selection window (C1) — legal on every query family. `last <n><d|w>`
 * is relative; `from <YYYY-MM-DD> [to <YYYY-MM-DD>]` is a civil-date range
 * (local-midnight semantics, inclusive end day). One window per query;
 * `last` and `from` are mutually exclusive (C3-style conflict).
 */
export type QueryWindow =
  | { kind: 'relative'; size: number; unit: 'd' | 'w' }
  | { kind: 'range'; start: string; end?: string };

export type AnyParsedQuery = ParsedAggregateQuery | ParsedFindQuery | ParsedRowsQuery;

/** Type guard: true for content-discovery queries. */
export function isFindQuery(parsed: AnyParsedQuery): parsed is ParsedFindQuery {
  return parsed.family === 'find';
}

/** Type guard: true for rows queries. */
export function isRowsQuery(parsed: AnyParsedQuery): parsed is ParsedRowsQuery {
  return parsed.family === 'rows';
}

/** Type guard: true for analytics (aggregate) queries. */
export function isAggregateQuery(parsed: AnyParsedQuery): parsed is ParsedAggregateQuery {
  return parsed.family === 'aggregate';
}

export interface SeriesPoint {
  ts: number;
  value: number;
  /** True for a structurally present bucket with no recorded observations
   *  (ticket 12 calendar domain generation) — display zero-fill, never an
   *  observation. */
  missing?: boolean;
}

/**
 * Result of parsing a rows query (`rows:{filters}` / `rows:segment{filters}`) —
 * the third WQL family (ADR docs/adr/rows-query-plane.md, #949): raw
 * output-statement rows re-derived from WorkoutResult logs, scoped by
 * `result:` / `block:` / `note:`. Never aggregates — no by/rollup/where.
 */
/** Ticket 18 — pipe clauses: presentation only, never alter the match. */
export interface RowsPipes {
    error?: string;
    select?: Array<{ col: string; unit?: string }>;
    order?: Array<{ col: string; dir: 'asc' | 'desc' }>;
    limit?: number;
    offset?: number;
}

export interface ParsedRowsQuery {
    /** Ticket 18 — pipe clauses (| select / | order by / | limit). */
    pipes?: RowsPipes;
  raw: string;
  /** Family discriminator shared by all three query ASTs (C5). */
  family: 'rows';
  /** Output-statement type narrowing from the optional target (`rows:segment{…}`); undefined = all types. */
  outputType?: string;
  /** The rows target itself — 'all' | 'segment' | content plane (ticket 18:
   *  segment without scope = cross-workout form). */
  target?: string;
  filters: TagFilter[];
  /** Time-selection window (C1): `last 4w` or `from … [to …]` over the
   *  workout end time. */
  window?: QueryWindow;
  /** Deprecation advisories (C2 normalizer). */
  advisories?: string[];
  error?: string;
}

/** One aggregated series. `error` carries the diagnostic when this series'
 *  calculation failed (ticket 13) — an errored series has no valid values. */
export interface Series { key: string; label: string; points: SeriesPoint[]; unit?: string; error?: string }
/** Aggregate head vocabulary is owned by vocabulary.ts (#871). */
const AGGS: readonly Aggregator[] = WQL_AGGREGATORS;

function cannotParse(text: string): string {
  return `Cannot parse "${text}". Expected agg:metric{filters} by {dims} .rollup(period)`;
}
// ── Cross-store `where` joins (#800) ───────────────────────────────
//
// `where` is the join glue between a content query and an analytics query.
// Like `in <scope>` / `last <n>w` / `in <unit>`, it is stripped in JS rather
// than lexed: a top-level WhereClause node ending in a free `Word` would
// reintroduce the token-overlap conflict documented at the top of the
// grammar. The split is brace-aware so a `where` inside `{filters}` (a tag
// value such as `text:where`) is never mistaken for the join.

/** Comparison predicate at the tail of a metric join: `<op> <number>`. */
const CMP_RE = /^(.+?)\s*(>=|<=|!=|==|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/;

function cannotParseJoin(text: string): string {
  return `Cannot parse join "${text}". Expected find:target{filters} or agg:metric{filters} <op> <number>`;
}

/**
 * Parse the `where` clause of a cross-store join — the OTHER half of the
 * query. A find predicate on an analytics query (`where find:note{tags:x}`),
 * or a metric predicate on a find query (`where sum:totalVolume{} > 5000`).
 * Both halves reuse the same Lezer Head→Filters grammar; the join keyword is
 * JS-stripped, so no grammar change is required.
 */
function parseJoinClause(where: string): { metric?: MetricPredicate; find?: FindPredicate; advisories?: string[]; error?: string } {
  if (where.trimStart().startsWith('find:')) {
    const fp = parseFindQuery(where);
    if (fp.error) return { error: fp.error };
    if (fp.window?.kind === 'range') {
      return { error: 'Range windows are not supported on join halves — use last <n>d|w' };
    }
    return {
      find: { target: fp.target, filters: fp.filters, last: fp.window?.kind === 'relative' ? { size: fp.window.size, unit: fp.window.unit } : undefined },
      advisories: fp.advisories,
    };
  }
  const m = CMP_RE.exec(where.trim());
  if (!m) return { error: cannotParseJoin(where) };
  const head = parseAnalyticsQuery(m[1].trim());
  if (head.error) return { error: head.error };
  return {
    metric: {
      agg: head.agg,
      metric: head.metric,
      filters: head.filters,
      operator: m[2] as ComparisonOp,
      threshold: parseFloat(m[3]),
    },
  };
}

/**
 * Parse a WQL query string into one of the three query families —
 * analytics aggregate, content find, or rows — discriminated by `family`
 * (C5). Dispatch is textual: a leading `find:` routes to the content path,
 * `rows` to the rows path, everything else to analytics.
 */
export function parseQuery(raw: string): AnyParsedQuery {
  const norm = normalizeWql(raw);
  const trimmed = norm.query.trimStart();
  let result: AnyParsedQuery;
  if (trimmed.startsWith('find:')) {
    result = parseFindQuery(norm.query);
  } else if (/^rows(?=[:{]|\s|$)/.test(trimmed)) {
    result = parseRowsQuery(norm.query);
  } else {
    result = parseAnalyticsQuery(norm.query);
  }
  if (norm.advisories.length) {
    result.advisories = [...(result.advisories ?? []), ...norm.advisories];
  }
  result.raw = raw;
  return result;
}

/**
 * C2 Compatibility normalizer: rewrites legacy query syntax into modern WQL.
 *   - Bare `rows:{…}` heads rewrite to `rows:all{…}`
 *   - Legacy trailing `in <scope>` rewrites into `{source:<scope>}`
 * Returns the normalized query string and any deprecation advisories.
 */
export function normalizeWql(raw: string): { query: string; advisories: string[] } {
  const advisories: string[] = [];
  let text = raw.trim();

  // 1. Bare rows head rewrite
  if (/^rows:?\s*[{]/.test(text)) {
    text = text.replace(/^rows:?\s*[{]/, 'rows:all{');
    advisories.push("Bare 'rows:{...}' syntax is deprecated; use 'rows:all{...}' instead.");
  }

  // 2. Legacy `in <scope>` on find: or rows:
  const { primary, where } = splitAtWhere(text);
  const isFind = primary.startsWith('find:');
  const isRows = /^rows(?=[:{]|\s|$)/.test(primary);

  if (isFind || isRows) {
    const suffixes = parseWqlSuffixes(primary);
    if (suffixes.legacyScope && !suffixes.conflicts?.length) {
      advisories.push("Legacy 'in <scope>' syntax is deprecated; use 'source:<scope>' filter instead.");
      const scope = suffixes.legacyScope;
      let head = suffixes.primaryText.trim();

      const braceOpen = head.indexOf('{');
      const braceClose = head.lastIndexOf('}');
      if (braceOpen !== -1 && braceClose !== -1 && braceClose > braceOpen) {
        const beforeBrace = head.slice(0, braceOpen + 1);
        const inside = head.slice(braceOpen + 1, braceClose).trim();
        const afterBrace = head.slice(braceClose);
        const newInside = inside ? `${inside},source:${scope}` : `source:${scope}`;
        head = `${beforeBrace}${newInside}${afterBrace}`;
      } else {
        head = `${head}{source:${scope}}`;
      }

      const parts: string[] = [head];
      if (suffixes.groupBy) {
        parts.push(`by {${suffixes.groupBy.join(', ')}}`);
      }
      if (suffixes.rollup) {
        parts.push(`.rollup(${suffixes.rollup.raw})`);
      }
      if (suffixes.window) {
        parts.push(suffixes.window.raw);
      }
      if (where) {
        parts.push(`where ${where}`);
      }
      text = parts.join(' ');
    }
  }

  return { query: text, advisories };
}

// ── Rows query parsing (#949) ────────────────────────────────────

function cannotParseRows(text: string): string {
  return `Cannot parse "${text}". Expected rows:all{result:…|block:…|note:…}, rows:<plane>{…}, or rows:segment{…} last 8w`;
}

/**
 * Rows-only filter rules (C4), relaxed for the cross-workout form (ticket
 * 18): `rows:segment{<tag/metadata filters>}` is valid without any
 * result:/block:/note: scope — single-session `rows:all` and scoped forms
 * keep their existing behavior. No negation, no wildcards.
 */
function validateRowsFilters(filters: TagFilter[], target: string): string | undefined {
  const scopeKeys = new Set<string>(WQL_ROWS_SCOPE_KEYS);
  const crossWorkout = target === 'segment';
  const allowedKeys = new Set<string>([...WQL_ROWS_SCOPE_KEYS, 'source', ...(crossWorkout ? WQL_TAG_KEYS : [])]);
  const unsupported = filters.filter(
    (f) => !allowedKeys.has(f.key) || f.negate || f.values.some((v) => v.wildcard),
  );
  if (unsupported.length > 0) {
    const allowed = [...WQL_ROWS_SCOPE_KEYS, 'source', ...(crossWorkout ? WQL_TAG_KEYS : [])];
    return `Unsupported rows filter(s): ${unsupported.map((f) => (f.negate ? '!' : '') + f.key).join(', ')}. Rows queries support exact ${allowed.map((k) => `${k}:`).join(', ')} values.`;
  }
  if (!crossWorkout && !filters.some((f) => scopeKeys.has(f.key))) {
    return `Rows query needs a scope: ${WQL_ROWS_SCOPE_KEYS.map((k) => `${k}:`).join(', ')}.`;
  }
  return undefined;
}

/** Validate source: filter values against canonical sources and catalog literals (C2). */
function validateSourceFilter(filters: TagFilter[]): string | undefined {
  const validSources = new Set<string>(WQL_SOURCE_VALUES);
  for (const f of filters) {
    if (f.key !== 'source') continue;
    for (const v of f.values) {
      const val = v.value;
      if (
        validSources.has(val) ||
        val === 'collection' ||
        val === 'feed' ||
        val.startsWith('collection:') ||
        val.startsWith('feed:')
      ) {
        continue;
      }
      return `Unknown source "${val}". Try: ${WQL_SOURCE_VALUES.join(', ')} (or collection:<id>, feed:<id>)`;
    }
  }
  return undefined;
}

const BARE_ROWS_RETIRED = 'Bare "rows:" is retired — name a target: rows:all{…} for every output type, or a plane like rows:segment{…}.';

/**
 * Parse a rows query (#949, C4 cutover). The whole primary text parses under
 * the shared Lezer grammar — the `Word colon Word` head fits `rows:<target>`
 * natively (ticket 001), so the synthetic `find:_` head is gone. The bare
 * `rows:{…}` alias is retired (spec v2 decision 1): a head without a target
 * errors with a migrate-to-`all` message; C2's normalizer rewrites stored
 * documents. `all` normalizes to no outputType narrowing.
 */
function parseRowsQuery(raw: string): ParsedRowsQuery {
  // Ticket 18 — pipe clauses ride the tail (`| select … | order by … |
  // limit …`); they govern presentation only and are stripped before the
  // language parses the query.
  let pipes: RowsPipes | undefined;
  // The first '|' OUTSIDE filter braces starts the pipe tail — an '|' inside
  // `{result:a|b}` is an OR-value, not a pipe.
  let pipeIndex = -1;
  {
    let depth = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
      else if (ch === '|' && depth === 0) {
        pipeIndex = i;
        break;
      }
    }
  }
  if (pipeIndex !== -1) {
    const pipeText = raw.slice(pipeIndex + 1);
    raw = raw.slice(0, pipeIndex).trimEnd();
    pipes = parseRowsPipes(pipeText);
  }
  const suffixes = parseWqlSuffixes(raw);
  const { where: whereText, window: windowSuffix, legacyScope, groupBy, rollup, primaryText } = suffixes;
  const win = toQueryWindow(windowSuffix);
  const advisories: string[] = [];
  if (legacyScope) {
    advisories.push("Legacy 'in <scope>' syntax is deprecated; use 'source:<scope>' filter instead.");
  }
  const result: ParsedRowsQuery = {
    family: 'rows',
    raw,
    filters: [],
    window: win.window,
    ...(advisories.length ? { advisories } : {}),
  };
  if (win.error) {
    result.error = win.error;
    return result;
  }
  if (pipes?.error) {
    result.error = pipes.error;
    return result;
  }
  if (pipes) result.pipes = pipes;
  if (suffixes.conflicts?.length) {
    result.error = suffixes.conflicts.join('; ');
    return result;
  }
  if (whereText || groupBy || rollup) {
    result.error = `Rows queries return raw statements — no where / by / rollup. Got "${primaryText.trim()}"`;
    return result;
  }

  const text = primaryText.trim();
  // The bare alias is structurally ungrammatical (ticket 001: Word ∩ By),
  // so it surfaces as a syntax error — intercept it first for the
  // migrate-to-`all` message instead of a generic cannot-parse.
  if (/^rows:?\s*[{]?$/.test(text) || /^rows:?\s*[{]/.test(text)) {
    result.error = BARE_ROWS_RETIRED;
    return result;
  }
  const tree = wqlParser.parse(text);
  let syntaxError = false;
  tree.iterate({ enter(node) { if (node.type.isError) syntaxError = true; } });
  if (syntaxError) {
    result.error = cannotParseRows(text);
    return result;
  }

  const query = tree.topNode;
  const head = query.getChild(terms.Head);
  const aggNode = head?.getChild(terms.Aggregator);
  const metricNode = head?.getChild(terms.Metric);
  if (!head || !aggNode || !metricNode) {
    // A rows head without a target — the retired bare alias.
    result.error = BARE_ROWS_RETIRED;
    return result;
  }
  const aggText = text.slice(aggNode.from, aggNode.to);
  if (aggText !== 'rows') {
    result.error = cannotParseRows(text);
    return result;
  }

  const target = text.slice(metricNode.from, metricNode.to);
  // C7: closed plane enum — content planes, result planes (the store's
  // known outputType values), and `all`. Custom stored types stay queryable
  // via hand-built ASTs; the text surface reopens only with a registry
  // decision.
  if (!(WQL_ROWS_TARGETS as readonly string[]).includes(target)) {
    result.error = `Unknown rows target "${target}". Try: ${WQL_ROWS_TARGETS.join(', ')}`;
    return result;
  }
  result.target = target;
  if (target !== 'all') result.outputType = target;

  result.filters = extractFilters(query, text);
  if (legacyScope) {
    result.filters.push({
      key: 'source',
      negate: false,
      values: [{ value: legacyScope, wildcard: false }],
    });
  }
  const sourceError = validateSourceFilter(result.filters);
  if (sourceError) { result.error = sourceError; return result; }
  const grainError = retiredGrainRollup(result.filters);
  if (grainError) { result.error = grainError; return result; }
  const filterError = validateRowsFilters(result.filters, target);
  if (filterError) { result.error = filterError; return result; }
  return result;
}

/** True when `s` is a real civil date in YYYY-MM-DD form (rejects 02-30,
 *  month 13, etc. via Date component round-trip). */
function isCivilDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** Map the suffix-layer window to the AST window, validating civil dates. */
function toQueryWindow(w: ParsedWqlWindowSuffix | undefined): { window?: QueryWindow; error?: string } {
  if (!w) return {};
  if (w.kind === 'relative') {
    return { window: { kind: 'relative', size: w.size, unit: w.unit } };
  }
  for (const d of [w.start, w.end]) {
    if (d !== undefined && !isCivilDate(d)) {
      return { error: `Invalid window date "${d}" — expected a real calendar date YYYY-MM-DD` };
    }
  }
  return { window: { kind: 'range', start: w.start, end: w.end } };
}

/** Ticket 003: grain:rollup is retired — rollup grains are never stored
 *  under the unified model; they are computed at read time via the
 *  .rollup suffix. The tag would silently match zero rows. */
function retiredGrainRollup(filters: TagFilter[]): string | undefined {
  if (filters.some(f => f.key === 'grain' && f.values.some(v => v.value === 'rollup'))) {
    return 'grain:rollup is retired — rollup grains are never stored; compute them with the .rollup suffix';
  }
  return undefined;
}

/** Shared filter extraction from a Lezer Query top node. */
function extractFilters(query: SyntaxNode, text: string): TagFilter[] {
  const out: TagFilter[] = [];
  const filters = query.getChild(terms.Filters);
  if (!filters) return out;
  for (const filter of filters.getChildren(terms.Filter)) {
    const keyNode = filter.getChild(terms.TagKey);
    const valueNode = filter.getChild(terms.TagValue);
    if (!keyNode || !valueNode) continue;
    const values: { value: string; wildcard: boolean }[] = [];
    for (const valueChild of valueNode.getChildren(terms.Value)) {
      // Each Value is `Word(:Word)?Star?` or a quoted phrase `"..."` per the
      // grammar. Slice its source text; a quoted node (#867) carries its
      // surrounding quotes (stripped here), a word value strips a trailing
      // wildcard — the colon stays in the value when the grammar accepts a
      // catalog-id style literal like `collection:crossfit-girls` for the
      // `source:` filter.
      const raw = text.slice(valueChild.from, valueChild.to);
      const quoted = valueChild.getChild(terms.Quoted) !== null;
      let value = quoted ? raw.slice(1, -1) : raw;
      const wildcard = quoted ? false : value.endsWith('*');
      if (wildcard) value = value.slice(0, -1);
      if (!value) continue;
      values.push({ value, wildcard });
    }
    if (values.length === 0) continue;
    out.push({
      key: text.slice(keyNode.from, keyNode.to),
      negate: filter.getChild(terms.Negate) !== null,
      values,
    });
  }
  return out;
}

function parseAnalyticsQuery(raw: string): ParsedAggregateQuery {
  const suffixes = parseWqlSuffixes(raw);
  const { where: whereText, displayUnit, groupBy, rollup, window: windowSuffix, primaryText: text } = suffixes;
  const win = toQueryWindow(windowSuffix);

  const base: ParsedAggregateQuery = {
    family: 'aggregate',
    raw,
    agg: 'sum',
    metric: '',
    filters: [],
    groupBy: groupBy ?? [],
    displayUnit,
    rollup: rollup ? { size: rollup.size, unit: rollup.unit as 'd' | 'w' } : undefined,
    window: win.window,
  };
  if (win.error) {
    base.error = win.error;
    return base;
  }
  if (suffixes.conflicts?.length) {
    base.error = suffixes.conflicts.join('; ');
    return base;
  }

  // Validate rollup unit if a rollup suffix was present
  if (rollup && rollup.unit !== 'd' && rollup.unit !== 'w') {
    base.error = cannotParse(text);
    return base;
  }

  const tree = wqlParser.parse(text);

  // Lezer recovers from malformed input by inserting ⚠ nodes — any of them
  // means the query is not the WQL surface.
  let syntaxError = false;
  tree.iterate({ enter(node) { if (node.type.isError) syntaxError = true; } });
  if (syntaxError) {
    base.error = cannotParse(text);
    return base;
  }

  const query = tree.topNode;

  // Head — agg:metric. Unknown aggregators are a semantic error, reported
  // exactly like the reference parser (metric left empty).
  const head = query.getChild(terms.Head);
  const aggNode = head?.getChild(terms.Aggregator);
  const metricNode = head?.getChild(terms.Metric);
  if (!head || !aggNode || !metricNode) {
    base.error = cannotParse(text);
    return base;
  }
  const aggText = text.slice(aggNode.from, aggNode.to);
  if (!AGGS.includes(aggText as Aggregator)) {
    base.error = `Unknown aggregator "${aggText}". Try: ${AGGS.join(', ')}`;
    return base;
  }
  base.agg = aggText as Aggregator;
  base.metric = text.slice(metricNode.from, metricNode.to);

  base.filters = extractFilters(query, text);
  const grainError = retiredGrainRollup(base.filters);
  if (grainError) { base.error = grainError; return base; }
  if (whereText) {
    const join = parseJoinClause(whereText);
    if (join.error) {
      base.error = join.error;
      return base;
    }
    if (join.advisories?.length) {
      base.advisories = [...(base.advisories ?? []), ...join.advisories];
    }
    // An analytics query joins on a content (find:) clause — a metric half
    // here would be `sum:x{} where sum:y{}`, a no-op nonsensical join.
    if (!join.find) {
      base.error = `Cross-store join on an analytics query must be find:…, got "${whereText}"`;
      return base;
    }
    base.join = join.find;
  }
  return base;
}

// ── Find query parsing ──────────────────────────────────────────────

function cannotParseFind(text: string): string {
  return `Cannot parse "${text}". Expected find:target{filters} last 8w`;
}

function parseFindQuery(raw: string): ParsedFindQuery {
  const suffixes = parseWqlSuffixes(raw);
  const { where: whereText, window: windowSuffix, legacyScope, primaryText: text } = suffixes;
  const win = toQueryWindow(windowSuffix);
  const advisories: string[] = [];
  if (legacyScope) {
    advisories.push("Legacy 'in <scope>' syntax is deprecated; use 'source:<scope>' filter instead.");
  }
  const result: ParsedFindQuery = {
    family: 'find',
    raw,
    target: '',
    filters: [],
    window: win.window,
    ...(advisories.length ? { advisories } : {}),
  };
  if (win.error) {
    result.error = win.error;
    return result;
  }
  if (suffixes.conflicts?.length) {
    result.error = suffixes.conflicts.join('; ');
    return result;
  }
  // Parse structural part: find:target{filters}
  const tree = wqlParser.parse(text);
  let syntaxError = false;
  tree.iterate({ enter(node) { if (node.type.isError) syntaxError = true; } });
  if (syntaxError) {
    result.error = cannotParseFind(text);
    return result;
  }

  const query = tree.topNode;
  const head = query.getChild(terms.Head);
  const aggNode = head?.getChild(terms.Aggregator);
  const metricNode = head?.getChild(terms.Metric);
  if (!head || !aggNode || !metricNode) {
    result.error = cannotParseFind(text);
    return result;
  }

  // The first word must be "find" (the dispatch keyword).
  const aggText = text.slice(aggNode.from, aggNode.to);
  if (aggText !== 'find') {
    result.error = `Expected "find:" but got "${aggText}:"`;
    return result;
  }

  result.target = text.slice(metricNode.from, metricNode.to);
  // C7: closed target enum — unknown targets error at parse instead of
  // silently returning empty at runtime.
  if (!(WQL_FIND_TARGETS as readonly string[]).includes(result.target)) {
    result.error = `Unknown find target "${result.target}". Try: ${WQL_FIND_TARGETS.join(', ')}`;
    return result;
  }
  result.filters = extractFilters(query, text);
  if (legacyScope) {
    result.filters.push({
      key: 'source',
      negate: false,
      values: [{ value: legacyScope, wildcard: false }],
    });
  }
  const sourceError = validateSourceFilter(result.filters);
  if (sourceError) { result.error = sourceError; return result; }
  const findGrainError = retiredGrainRollup(result.filters);
  if (findGrainError) { result.error = findGrainError; return result; }

  if (whereText) {
    const join = parseJoinClause(whereText);
    if (join.error) {
      result.error = join.error;
      return result;
    }
    // A find query joins on a metric predicate — a find half here would be
    // `find:note where find:block{}`, a no-op nonsensical join.
    if (!join.metric) {
      result.error = `Cross-store join on a find query must be agg:metric{} <op> <number>, got "${whereText}"`;
      return result;
    }
    result.join = join.metric;
  }
  return result;
}
