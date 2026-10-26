/**
 * WQL — Wod Query Language (Datadog-flavored). See CONTEXT.md glossary.
 *
 *   <aggregator>:<metric.namespace>{<tag filters>} by {<dimensions>} .rollup(<period>)
 *
 *   sum:totalVolume{discipline:strength} by {week}
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
  WQL_CHART_HEADS,
  WQL_CONTENT_ONLY_KEYS,
  WQL_EFFORT_FILTER_KEYS,
  WQL_FIND_TARGETS,
  WQL_FUNCTION_HEADS,
  WQL_NOTE_HEAD_ALIASES,
  WQL_SOURCE_HEADS,
  WQL_SOURCE_HEAD_SCOPES,
  WQL_SOURCE_VALUES,
  WQL_TYPE_HEADS,
  type WqlAggregator,
  type WqlChartHead,
  WQL_TAG_KEYS,
  type WqlComparisonOp,
} from './vocabulary';
import { parseWqlSuffixes, splitAtWhere, type ParsedWqlWindowSuffix } from './wqlSuffix';
import { allowedFilterTypesForTarget, supportsWqlFilterKey, wqlFilterKeys, wqlGroupingDimensions } from './capabilities';

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
    parts.push(`:segment{${filterText}}`);
    if (options.startIso && options.endIso) parts.push(`from ${options.startIso} to ${options.endIso}`);
    else if (options.start !== undefined && options.end !== undefined && options.timeZone) {
        const fmt = (ts: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
        parts.push(`from ${fmt(options.start, options.timeZone)} to ${fmt(options.end - 1, options.timeZone)}`);
    }
    let query = parts.join(' ');
    if (options.limit !== undefined) query += ` | limit ${options.limit}`;
    return query;
}

/** Result of parsing a content-discovery query — the colon source heads
 *  (`:note{…}`, `:journal{…}`); the legacy `find:` spelling is retired and
 *  survives only inside `where` join halves. */
export interface ParsedFindQuery {
  family: 'find';
  raw: string;
  /** Content target — a WQL_FIND_TARGETS value (C7 closed enum). */
  target: string;
  filters: TagFilter[];
  /** Implicit default source scope for the generic `:note` head —
   *  journal | feeds | playground. NOT a filter: authored filters stay
   *  untouched (composer pills never see it); the executor ANDs it in only
   *  when no explicit `source:` filter was written. */
  sourceScope?: string[];
  /** Time-selection window (C1): `last 8w` or `from … [to …]`. */
  window?: QueryWindow;
  /** Cross-store metric join (`where sum:totalVolume{} > 5000`). */
  join?: MetricPredicate;
  /** Presentation pipes (`| select … | order by … | limit …`). */
  pipes?: RowsPipes;
  /** Group-by dimensions (`by {effort}`). */
  groupBy?: string[];
  /** Optional display unit directive (`in kg` / `in lb`). */
  displayUnit?: string;
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

export type AnyParsedQuery = ParsedAggregateQuery | ParsedFindQuery | ParsedPipelineQuery;

/** Type guard: true for content-discovery queries. */
export function isFindQuery(parsed: AnyParsedQuery): parsed is ParsedFindQuery {
  return parsed.family === 'find';
}

/** Type guard: true for analytics (aggregate) queries. */
export function isAggregateQuery(parsed: AnyParsedQuery): parsed is ParsedAggregateQuery {
  return parsed.family === 'aggregate';
}

/** Type guard: true for left-to-right value pipelines (`:src | :fn | :chart`). */
export function isPipelineQuery(parsed: AnyParsedQuery): parsed is ParsedPipelineQuery {
  return parsed.family === 'pipeline';
}

/** A pipeline's input: a full single query, or a named dataset
 *  (`@session` / `@today` / a host-registered page source — name keeps `@`). */
export type PipelineSource =
  | { kind: 'query'; query: ParsedFindQuery | ParsedAggregateQuery }
  | { kind: 'dataset'; name: string };

/** Terminal chart stage of a pipeline: the chart head plus its authored
 *  parameter filters (`:bar{type:session}` → `{head:'bar', filters:[…]}`). */
export interface PipelineSink {
  head: WqlChartHead;
  filters: TagFilter[];
}

/**
 * Left-to-right value pipeline (`:journal{…} last 8w | :sum{metric:tis} | :timeseries{}`).
 * Transforms apply in order to the previous stage's output — the executor
 * reduces in memory, it never rescans stores. A dataset alone (`@today`) is
 * a pipeline with no transforms; a lone chart head starts from an implicit
 * `:segment` source.
 */
export interface ParsedPipelineQuery {
  family: 'pipeline';
  raw: string;
  source: PipelineSource;
  /** Ordered aggregate stages, each applied to the previous stage's rows. */
  transforms: ParsedAggregateQuery[];
  sink?: PipelineSink;
  /** Parse-time disclosures (ignored chart suffixes, …). */
  advisories?: string[];
  error?: string;
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
  return `Cannot parse join "${text}". Expected :source{filters} or find:target{filters}, or agg:metric{filters} <op> <number>`;
}

/**
 * Parse the `where` clause of a cross-store join — the OTHER half of the
 * query. A find predicate on an analytics query (`where find:note{tags:x}`),
 * or a metric predicate on a find query (`where sum:totalVolume{} > 5000`).
 * Both halves reuse the same Lezer Head→Filters grammar; the join keyword is
 * JS-stripped, so no grammar change is required.
 */
function parseJoinClause(where: string): { metric?: MetricPredicate; find?: FindPredicate; advisories?: string[]; error?: string } {
  const t = where.trimStart();
  const headName = /^:?([a-zA-Z0-9_-]+)/.exec(t)?.[1]?.toLowerCase() ?? '';
  // Content half: legacy `find:…` or a colon source head `:note{…}`.
  if (t.startsWith('find:') || (t.startsWith(':') && (WQL_SOURCE_HEADS as readonly string[]).includes(headName))) {
    const fp = parseFindQuery(where, { colon: t.startsWith(':') });
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
  const head = parseAggregateQuery(m[1].trim(), { colon: m[1]!.trimStart().startsWith(':') });
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
export function rowsParseError(raw: string): string {
  const m = /^rows(?::(\w+))?\{([^}]*)\}/.exec(raw);
  if (!m) {
    return 'The "rows:" query family is retired — use :session, :segment, or :event instead.';
  }
  const target = m[1] ?? 'all';
  const inner = m[2].trim();
  if (target === 'all' || ['note', 'block', 'effort', 'page'].includes(target)) {
    return `rows:${target}{…} is retired — use :session{${inner}} instead.`;
  }
  if (target === 'segment' && !inner.includes('result:') && !inner.includes('block:') && !inner.includes('note:')) {
    return `rows:segment{…} is retired — use :segment{${inner}} instead.`;
  }
  if (target === 'event') {
    return `rows:event{…} is retired — use :event{${inner}} instead.`;
  }
  const planePart = inner ? `${inner}, plane:${target}` : `plane:${target}`;
  return `rows:${target}{…} is retired — use :session{${planePart}} instead.`;
}

// ── Colon heads & pipelines ─────────────────────────────────────────

/** True when a pipe segment is a rows presentation clause, not a stage. */
const ROW_PIPE_RE = /^\s*(?:select|order\s+by|limit|offset)\b/i;

/** Split at top-level `|` — brace- AND quote-aware, so OR alternatives and
 *  quoted phrases inside filters never become stage separators. */
function splitTopPipes(raw: string): string[] {
    const segments: string[] = [];
    let depth = 0;
    let quoted = false;
    let start = 0;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (quoted) { if (ch === '"') quoted = false; continue; }
        if (ch === '"') { quoted = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);
        else if (ch === '|' && depth === 0) { segments.push(raw.slice(start, i)); start = i + 1; }
    }
    segments.push(raw.slice(start));
    return segments;
}

/** The leading colon/dataset head of a segment: `:name` or `@name`. */
function leadingHeadName(segment: string): { name: string; dataset: boolean } | undefined {
    const m = /^\s*([:@])([a-zA-Z0-9_-]+)/.exec(segment);
    return m ? { name: m[2]!.toLowerCase(), dataset: m[1] === '@' } : undefined;
}

function cannotParsePipeline(text: string): string {
    return `Cannot parse pipeline "${text}". Expected :source{filters} | :function{metric:key} | :chart{params} or @dataset | :function{…}`;
}

/** Retired `find:` primary — the family stays for narrowing; the message names the colon spelling. */
function retiredFindQuery(raw: string): ParsedFindQuery {
    const head = /^find:([a-zA-Z0-9_-]*)/.exec(raw.trim())?.[1] ?? '';
    return {
        family: 'find',
        raw,
        target: '',
        filters: [],
        error: `The "find:" query family is retired — use the :${head || 'note'}{…} colon head instead.`,
    };
}

/** Single-stage query: legacy `agg:metric` head or a colon source/function head. */
function parseSingleQuery(raw: string): AnyParsedQuery {
    const norm = normalizeWql(raw);
    const head = leadingHeadName(norm.query);
    let result: AnyParsedQuery;
    if (head && !head.dataset) {
        if ((WQL_FUNCTION_HEADS as readonly string[]).includes(head.name)) {
            result = parseAggregateQuery(norm.query, { colon: true });
        } else if ((WQL_SOURCE_HEADS as readonly string[]).includes(head.name)) {
            result = parseFindQuery(norm.query, { colon: true });
        } else {
            // Unknown colon word — let the source-head parser name it through
            // the closed target enum (Unknown find target "…").
            result = parseFindQuery(norm.query, { colon: true });
        }
    } else {
        result = parseAggregateQuery(norm.query, { colon: false });
    }
    if (norm.advisories.length) {
        result.advisories = [...new Set([...(result.advisories ?? []), ...norm.advisories])];
    }
    result.raw = raw;
    return result;
}

/**
 * Parse a WQL query string into one of the query families — analytics
 * aggregate, content find, or pipeline — discriminated by `family` (C5).
 * Dispatch: `rows` is a retired-error; `find:` is retired; a pipe-separated
 * stage list (or a lone `@dataset`/chart head) is a pipeline; a colon
 * source/function head or legacy `agg:metric` head parses as a single query.
 */
export function parseQuery(raw: string): AnyParsedQuery {
  const trimmed = raw.trimStart();
  if (/^rows(?=[:{]|\s|$)/.test(trimmed)) {
    return {
      family: 'find',
      raw,
      target: '',
      filters: [],
      error: rowsParseError(raw.trim()),
    };
  }
  if (/^find:/.test(trimmed)) return retiredFindQuery(raw);
  const segments = splitTopPipes(raw);
  const first = segments[0]!;
  // Trailing `| select / order by / limit / offset` are presentation pipes on
  // a single query (existing families), not pipeline stages.
  if (segments.length > 1 && !ROW_PIPE_RE.test(first)
      && segments.slice(1).every((s) => ROW_PIPE_RE.test(s.trim()))) {
    return parseSingleQuery(raw);
  }
  const head = leadingHeadName(first);
  if (segments.length > 1 || (head && (head.dataset
      || (WQL_CHART_HEADS as readonly string[]).includes(head.name)))) {
    return parsePipelineQuery(raw, segments);
  }
  return parseSingleQuery(raw);
}

/**
 * C2 Compatibility normalizer: rewrites legacy query syntax into modern WQL.
 *   - Legacy trailing `in <scope>` rewrites into `{source:<scope>}`
 * Returns the normalized query string and any deprecation advisories.
 */
function normalizeNotebookFilterText(raw: string): string {
  return raw.replace(/\bnotebook:notebook\/([a-zA-Z0-9_-]+)/g, 'notebook:"notebook/$1"');
}

export function normalizeWql(raw: string): { query: string; advisories: string[] } {
  const advisories: string[] = [];
  let text = normalizeNotebookFilterText(raw.trim());

  const { primary, where } = splitAtWhere(text);
  const isFind = primary.startsWith('find:');
  if (isFind) {
    const suffixes = parseWqlSuffixes(primary);
    if (suffixes.legacyScope && !suffixes.conflicts?.length) {
      advisories.push("Legacy 'in <scope>' syntax is deprecated; use 'source:<scope>' filter instead.");
      const scope = suffixes.legacyScope;
      let head = suffixes.primaryText.trim();
      if (scope !== 'all') {
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

/** Validate source: filter values against canonical sources and catalog literals (C2). */
function validateSourceFilter(filters: TagFilter[]): string | undefined {
  for (const f of filters) {
    if (f.key !== 'source') continue;
    for (const v of f.values) {
      const val = v.value;
      if (val === 'page' || val === 'pages') {
        return `source:${val} is retired — page-ness is handled by type: (e.g. type:feed or source:guides).`;
      }
      if (val === 'all') {
        return `source:all is retired — omit the source: filter to query all sources.`;
      }
      if (val === 'collection' || val === 'collections') {
        return `source:${val} is retired — collections were renamed to feeds; use source:feeds or :feed{}.`;
      }
      if (val === 'notebook' || val === 'notebooks') {
        return `source:${val} is retired — :notebook{} is the notebook plane (every notebook); narrow it with the notebook: filter, e.g. :notebook{notebook:journal}.`;
      }
      if (
        (WQL_SOURCE_VALUES as readonly string[]).includes(val) ||
        val === 'feed' ||
        val.startsWith('collection:') ||
        val.startsWith('feed:') ||
        val.startsWith('notebook:') ||
        val.startsWith('notebook/')
      ) {
        continue;
      }
      return `Unknown source "${val}". Try: ${WQL_SOURCE_VALUES.join(', ')} (or collection:<id>, feed:<id>)`;
    }
  }
  return undefined;
}

/** Extract pipe clauses (| select … | order by … | limit …) outside braces
 *  and quotes — an OR `a|b` or quoted `"x|y"` inside filters is a value. */
function extractPipes(raw: string): { text: string; pipes?: RowsPipes } {
  let pipeIndex = -1;
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quoted) { if (ch === '"') quoted = false; continue; }
    if (ch === '"') { quoted = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === '|' && depth === 0) {
      pipeIndex = i;
      break;
    }
  }
  if (pipeIndex !== -1) {
    const pipeText = raw.slice(pipeIndex + 1);
    const text = raw.slice(0, pipeIndex).trimEnd();
    const pipes = parseRowsPipes(pipeText);
    return { text, pipes };
  }
  return { text: raw };
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

/** Tree helpers over the Single/Pipeline grammar: a single query parses as
 *  Query → Single → Stage → Head Filters?. */
function queryStageNode(top: SyntaxNode): SyntaxNode | undefined {
  return top.getChild(terms.Single)?.getChild(terms.Stage) ?? top.getChild(terms.Stage) ?? undefined;
}

function cannotParseFunction(text: string): string {
  return `Cannot parse "${text}". Expected :function{metric:<key>, filters} by {dims} .rollup(period) — e.g. :sum{metric:tis}`;
}

/**
 * Parse an analytics query: the legacy `agg:metric{filters}` head (retained
 * numerical syntax) or the colon function head `:sum{metric:tis, …}` where
 * the metric is extracted from the filters (and excluded from fact filters).
 * `:count{}` without `metric:` is legal — it counts observations in scope.
 */
function parseAggregateQuery(raw: string, opts: { colon: boolean; inheritedMetric?: string }): ParsedAggregateQuery {
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
  if (rollup) {
    if (rollup.unit !== 'd' && rollup.unit !== 'w') {
      base.error = cannotParse(text);
      return base;
    }
    if ((rollup.unit === 'd' || rollup.unit === 'w') && rollup.size === 1) {
      base.error = `.rollup(1${rollup.unit}) is retired — use by {${rollup.unit === 'd' ? 'day' : 'week'}} instead.`;
      return base;
    }
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
  const stage = queryStageNode(query);
  const head = stage?.getChild(terms.Head);
  const aggNode = head?.getChild(terms.Aggregator);
  const metricNode = head?.getChild(terms.Metric);
  base.filters = stage ? extractFilters(stage, text) : [];
  if (opts.colon) {
    // Colon function head — `:sum{metric:tis, …}`: the aggregate name is the
    // head word; the metric rides the `metric:` filter and is pulled out of
    // the fact filters.
    const word = head?.getChild(terms.Word);
    if (!head || !word) {
      base.error = cannotParseFunction(text);
      return base;
    }
    const fn = text.slice(word.from, word.to).toLowerCase();
    if (!(WQL_FUNCTION_HEADS as readonly string[]).includes(fn)) {
      base.error = `Unknown function ":${fn}". Try: ${WQL_FUNCTION_HEADS.join(', ')}`;
      return base;
    }
    base.agg = fn as Aggregator;
    const metricFilters = base.filters.filter((f) => f.key === 'metric');
    base.filters = base.filters.filter((f) => f.key !== 'metric');
    const mf = metricFilters[0];
    if (!mf) {
      // :count{} counts observations in scope; a bare numeric function in a
      // pipeline inherits the previous stage's metric; standalone it errors.
      if (fn !== 'count' && opts.inheritedMetric === undefined) {
        base.error = `:${fn} requires 'metric:<key>' — e.g. :${fn}{metric:tis}`;
        return base;
      }
      base.metric = fn === 'count' ? '' : opts.inheritedMetric!;
    } else if (mf.negate || metricFilters.length > 1 || mf.values.length !== 1 || mf.values[0]!.wildcard) {
      base.error = `:${fn} takes a single 'metric:<key>' clause — no negation, OR values, or wildcards`;
      return base;
    } else {
      base.metric = mf.values[0]!.value;
    }
  } else {
    // Legacy head — agg:metric. Unknown aggregators are a semantic error,
    // reported exactly like the reference parser (metric left empty).
    if (!stage || !head || !aggNode || !metricNode) {
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
  }

  // Content-plane keys on an aggregate are a category error — a fact row
  // has no note text or source. Every other non-structural key is a
  // candidate custom dimension resolved at runtime (factTagValue falls
  // back to row.dimensions), so it is NOT rejected here.
  const contentKeys = base.filters.map(f => f.key).filter(k => (WQL_CONTENT_ONLY_KEYS as readonly string[]).includes(k));
  if (contentKeys.length > 0) {
    base.error = `Content filter key(s) ${contentKeys.map(k => `"${k}"`).join(', ')} cannot narrow an aggregate — facts carry effort/dimension data, not note text. Aggregate dims: ${WQL_TAG_KEYS.join(', ')}, plus any custom dimension.`;
    return base;
  }
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
  return `Cannot parse "${text}". Expected :source{key:value, !key:value}; filters are optional. Optional suffixes include by {dimension}, last <n>d or last <n>w, from YYYY-MM-DD [to YYYY-MM-DD], where <aggregator>:<metric>{filters} <operator> <number>, and | order by <column> | limit <n>. Support depends on the target.`;
}

function parseFindQuery(raw: string, opts?: { colon?: boolean }): ParsedFindQuery {
  const normalizedRaw = normalizeNotebookFilterText(raw);
  const { text: rawNoPipes, pipes } = extractPipes(normalizedRaw);
  const suffixes = parseWqlSuffixes(rawNoPipes);
  const { where: whereText, window: windowSuffix, legacyScope, groupBy, displayUnit, primaryText: text } = suffixes;
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
    ...(pipes ? { pipes } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(displayUnit ? { displayUnit } : {}),
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
  if (suffixes.conflicts?.length) {
    result.error = suffixes.conflicts.join('; ');
    return result;
  }
  // Parse structural part: `:<target>{filters}` (or legacy `find:<target>`).
  const tree = wqlParser.parse(text);
  let syntaxError = false;
  tree.iterate({ enter(node) { if (node.type.isError) syntaxError = true; } });
  if (syntaxError) {
    result.error = cannotParseFind(text);
    return result;
  }

  const stage = queryStageNode(tree.topNode);
  const head = stage?.getChild(terms.Head);
  const aggNode = head?.getChild(terms.Aggregator);
  const metricNode = head?.getChild(terms.Metric);
  let headName: string;
  if (opts?.colon) {
    const word = head?.getChild(terms.Word);
    if (!stage || !head || !word) {
      result.error = cannotParseFind(text);
      return result;
    }
    headName = text.slice(word.from, word.to).toLowerCase();
  } else {
    if (!stage || !head || !aggNode || !metricNode) {
      result.error = cannotParseFind(text);
      return result;
    }
    // The legacy dispatch keyword must be "find".
    const aggText = text.slice(aggNode.from, aggNode.to);
    if (aggText !== 'find') {
      result.error = `Expected "find:" but got "${aggText}:"`;
      return result;
    }
    headName = text.slice(metricNode.from, metricNode.to);
  }

  const scope = WQL_SOURCE_HEAD_SCOPES[headName];
  const typeScope = WQL_TYPE_HEADS[headName];
  if (scope || typeScope) {
    // Scoped note head: the head IS the scope, injected as authored filters
    // (they intersect any explicit source:/type: — plain AND).
    result.target = 'note';
  } else {
    result.target = (WQL_NOTE_HEAD_ALIASES as readonly string[]).includes(headName) ? 'note' : headName;
    if (result.target === 'page') {
      result.error = 'find:page is retired — page-ness is handled by type: (e.g. :note{source:guides} or type:feed).';
      return result;
    }
    // C7: closed target enum — unknown targets error at parse instead of
    // silently returning empty at runtime.
    if (!(WQL_FIND_TARGETS as readonly string[]).includes(result.target)) {
      result.error = `Unknown find target "${result.target}". Try: ${WQL_FIND_TARGETS.join(', ')}`;
      return result;
    }
  }
  result.filters = extractFilters(stage, text);
  if (typeScope) {
    // Position 0 is the head-authored slot — the serializer's alias-head
    // collapse expects the injected filter first, matching the parse shape
    // of `:dashboard{…}` (authored filters follow).
    result.filters.unshift({
      key: 'type',
      negate: false,
      values: [{ value: typeScope, wildcard: false }],
    });
  }
  if (scope) {
    result.filters.push({
      key: 'source',
      negate: false,
      values: [{ value: scope, wildcard: false }],
    });
    if (headName === 'catalog' || headName === 'catalogs') {
      result.filters.push({
        key: 'type',
        negate: false,
        values: [{ value: 'feed', wildcard: false }],
      });
    }
  }
  // Colon heads treat a trailing non-unit `in <word>` as the legacy scope
  // clause (the suffix layer files it under display-unit for non-find text).
  const inScope = opts?.colon && result.displayUnit && result.displayUnit !== 'kg' && result.displayUnit !== 'lb'
    ? result.displayUnit
    : legacyScope;
  if (opts?.colon && inScope) {
    delete result.displayUnit;
    advisories.push("Legacy 'in <scope>' syntax is deprecated; use 'source:<scope>' filter instead.");
  }
  if (inScope && inScope !== 'all') {
    result.filters.push({
      key: 'source',
      negate: false,
      values: [{ value: inScope, wildcard: false }],
    });
  }
  // The generic `:note` head carries NO default scope — it is the inclusive
  // note plane (every row; authored source: filters and negations scope it).
  // WQL_NOTE_DEFAULT_SOURCES remains exported (empty) for the serializer.
  const sourceError = validateSourceFilter(result.filters);
  if (sourceError) { result.error = sourceError; return result; }
  const findGrainError = retiredGrainRollup(result.filters);
  if (findGrainError) { result.error = findGrainError; return result; }
  const target = result.target;
  if (suffixes.rollup) advisories.push(`:${target} ignores '.rollup(...)'; rollup is supported by aggregate queries.`);
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
  const computed = findTargetAdvisories(result);
  if (advisories.length || computed.length) {
    result.advisories = [...new Set([...advisories, ...computed])];
  }
  return result;
}

// ── Pipeline parsing ────────────────────────────────────────────────

/** Stage classification for pipeline validation. */
type StageKind = 'dataset' | 'source' | 'function' | 'chart' | 'unknown';

function stageKind(head: { name: string; dataset: boolean } | undefined): StageKind {
  if (!head) return 'unknown';
  if (head.dataset) return 'dataset';
  if ((WQL_FUNCTION_HEADS as readonly string[]).includes(head.name)) return 'function';
  if ((WQL_SOURCE_HEADS as readonly string[]).includes(head.name)) return 'source';
  if ((WQL_CHART_HEADS as readonly string[]).includes(head.name)) return 'chart';
  return 'unknown';
}

/**
 * Parse a left-to-right value pipeline: one input stage (dataset, source or
 * function head), ordered function stages, at most one terminal chart. Every
 * stage keeps its own suffixes (windows/grouping/unit/joins). The stripped
 * stage list re-parses through the Lezer grammar so Head/Pipeline/
 * DatasetReference nodes are the structural authority — a stage that is not
 * a clean head+filters (or a `|` with nothing after it) fails here.
 */
function parsePipelineQuery(raw: string, segments: string[]): ParsedPipelineQuery {
  const advisories: string[] = [];
  const fail = (error: string): ParsedPipelineQuery => ({
    family: 'pipeline',
    raw,
    source: { kind: 'dataset', name: '' },
    transforms: [],
    error,
  });

  const heads = segments.map(leadingHeadName);
  const kinds = heads.map(stageKind);
  // The first stage may also be the retained legacy aggregate head
  // (`sum:tis{…} by {session}`) — parse it through the single-query path;
  // anything else headless (row pipes, garbage) fails here.
  let legacySource: ParsedAggregateQuery | undefined;
  if (!heads[0]) {
    if (ROW_PIPE_RE.test(segments[0]!)) {
      return fail('Presentation pipes (| select / order by / limit) apply to a single source query — they cannot sit between pipeline stages.');
    }
    const legacy = parseAggregateQuery(segments[0]!, { colon: false });
    if (legacy.error) return fail(legacy.error);
    legacySource = legacy;
    kinds[0] = 'function';
  }
  for (let i = 0; i < segments.length; i++) {
    if (i === 0 && legacySource) continue;
    const name = heads[i] ? `:${heads[i]!.name}` : `"${segments[i]!.trim()}"`;
    if (!heads[i]) {
      return fail(`Empty or unparseable pipeline stage ${name} — check for doubled or trailing "|".`);
    }
    if (kinds[i] === 'unknown') {
      return fail(`Unknown pipeline head ${name}. Sources: ${WQL_SOURCE_HEADS.join(', ')}; functions: ${WQL_FUNCTION_HEADS.join(', ')}; charts: ${WQL_CHART_HEADS.join(', ')}.`);
    }
    if (i > 0 && (kinds[i] === 'source' || kinds[i] === 'dataset')) {
      return fail(`Pipeline stage ${name} must come first — a pipeline starts at its source, transforms follow.`);
    }
    if (kinds[i] === 'chart' && i < segments.length - 1) {
      return fail(`Chart head ${name} must be the final pipeline stage — nothing may follow a chart.`);
    }
  }

  // Structural gate: the stripped stages must re-parse as a clean Lezer
  // Pipeline (or a lone Stage for the implicit-source single chart).
  const stripped = segments.map((s) => parseWqlSuffixes(s).primaryText.trim());
  const treeText = stripped.join(' | ');
  const tree = wqlParser.parse(treeText);
  let syntaxError = false;
  tree.iterate({ enter(node) { if (node.type.isError) syntaxError = true; } });
  const pipelineNode = syntaxError ? undefined : tree.topNode.getChild(terms.Pipeline);
  const singleNode = syntaxError ? undefined : tree.topNode.getChild(terms.Single);
  const stageNodes = pipelineNode
    ? pipelineNode.getChildren(terms.Stage)
    : singleNode
      ? [singleNode.getChild(terms.Stage)].filter((s): s is SyntaxNode => s !== null)
      : [];
  if (!pipelineNode && segments.length > 1) return fail(cannotParsePipeline(raw));
  if (stageNodes.length !== segments.length) return fail(cannotParsePipeline(raw));

  const last = segments.length - 1;
  let source: PipelineSource;
  if (kinds[0] === 'dataset') {
    source = { kind: 'dataset', name: '@' + heads[0]!.name };
  } else if (kinds[0] === 'chart') {
    // Lone chart head: implicit `:segment` source — the executor may reject
    // unusable chart/data combinations rather than fabricate values.
    source = { kind: 'query', query: { family: 'find', raw: ':segment{}', target: 'segment', filters: [] } };
  } else {
    const q = kinds[0] === 'function'
      // Leading ':' chooses the colon grammar; the retained legacy
      // `sum:tis{…}` aggregate head stays parseable as a pipeline source.
      ? parseAggregateQuery(segments[0]!, { colon: segments[0]!.trimStart().startsWith(':') })
      : parseFindQuery(segments[0]!, { colon: true });
    if (q.error) return fail(q.error);
    source = { kind: 'query', query: q };
  }

  const transforms: ParsedAggregateQuery[] = [];
  // Bare numeric stages reduce the carried stage: `:sum{metric:tis} | :max{}`
  // inherits 'tis' at parse. count keeps its metric-less form; find sources
  // carry no single metric, so a bare function after one errors clearly.
  let carriedMetric: string | undefined =
    source.kind === 'query' && source.query.family === 'aggregate' ? source.query.metric : undefined;
  const lastFunction = kinds[last] === 'chart' ? last - 1 : last;
  for (let i = 1; i <= lastFunction; i++) {
    const t = parseAggregateQuery(segments[i]!, { colon: true, inheritedMetric: carriedMetric });
    if (t.error) return fail(t.error);
    transforms.push(t);
    carriedMetric = t.metric || carriedMetric;
  }

  let sink: PipelineSink | undefined;
  if (kinds[last] === 'chart') {
    const chartStage = stageNodes[last]!;
    const word = chartStage.getChild(terms.Head)?.getChild(terms.Word);
    if (!word) return fail(cannotParsePipeline(raw));
    const chartHead = treeText.slice(word.from, word.to).toLowerCase();
    if (!(WQL_CHART_HEADS as readonly string[]).includes(chartHead)) {
      return fail(`Unknown chart head ":${chartHead}". Try: ${WQL_CHART_HEADS.join(', ')}`);
    }
    const chartSuffixes = parseWqlSuffixes(segments[last]!);
    if (chartSuffixes.window || chartSuffixes.rollup || chartSuffixes.groupBy
        || chartSuffixes.displayUnit || chartSuffixes.where || chartSuffixes.legacyScope) {
      advisories.push(`:${chartHead} ignores query suffixes — apply windows and grouping to the source or function stages.`);
    }
    sink = { head: chartHead as WqlChartHead, filters: extractFilters(chartStage, treeText) };
  }

  const result: ParsedPipelineQuery = {
    family: 'pipeline',
    raw,
    source,
    transforms,
    ...(sink ? { sink } : {}),
    ...(advisories.length ? { advisories } : {}),
  };
  return result;
}

/**
 * Target-capability advisories for a find AST: every clause the executor will
 * silently drop, apply differently than written, or group outside the
 * executor. A pure function of the parsed shape — `parseFindQuery` attaches
 * these at parse time and `QueryService.runFind` re-derives them, so
 * hand-built ASTs get the same loud disclosure without re-serializing text.
 */
export function findTargetAdvisories(query: ParsedFindQuery): string[] {
  const advisories: string[] = [];
  const target = query.target;
  const supported = allowedFilterTypesForTarget(target, 'find');
  const ignored = [...new Set(query.filters.filter(f => !supportsWqlFilterKey(target, 'find', f.key)).map(f => f.key))];
  if (ignored.length) {
    const custom = target === 'segment' || target === 'event' ? ', custom fact dimensions' : '';
    const effortKey = ignored.find(key => (WQL_EFFORT_FILTER_KEYS as readonly string[]).includes(key));
    const recovery = effortKey && target !== 'effort' ? ` To filter by ${effortKey}, use :effort{${effortKey}:…}.` : '';
    advisories.push(`:${target} ignores ${ignored.map(key => `'${key}:'`).join(', ')} — the filter is not applied.${recovery} Supported keys: ${wqlFilterKeys(target, 'find').join(', ')}${custom}.`);
  }
  for (const filter of query.filters) {
    if (ignored.includes(filter.key)) continue;
    const scope = ['result', 'block', 'note'].includes(filter.key);
    const negationIgnored = target === 'note'
      ? ['effort', 'text', 'type', 'domain', 'format', 'equipment', 'quality', 'intent'].includes(filter.key)
      : target === 'block' ? ['text', 'type', 'tags', 'effort'].includes(filter.key)
      : (target === 'session' || target === 'segment' || target === 'event') && scope;
    if (filter.negate && negationIgnored) {
      advisories.push(`:${target} does not support '!${filter.key}:' negation; this clause is not applied as a negated filter.`);
    }
    const wildcardSupported = target === 'effort' ? ['effort', 'text'].includes(filter.key)
      : (target === 'segment' || target === 'event') && !scope;
    if (filter.values.some(value => value.wildcard) && !wildcardSupported) {
      advisories.push(`:${target} does not support '${filter.key}:…*' wildcards; values are matched without wildcard expansion.`);
    }
  }
  if (query.window && !supported.has('time')) {
    advisories.push(`:${target} ignores the window because its registry has no time dimension.`);
  }
  if (query.groupBy?.length) {
    const dimensions = wqlGroupingDimensions(target, 'find');
    const unsupported = query.groupBy.filter(dim => !dimensions.some(d => d.toLowerCase() === dim.toLowerCase()));
    if (target === 'note' || target === 'block') {
      // Content grouping is open: any note property (typed-tag key) names a
      // valid dimension — values resolve from entry metadata, missing → Unassigned.
    } else if (target === 'segment' || target === 'event') {
      const selected = query.pipes?.select?.map(column => column.col);
      const unavailable = query.groupBy.filter(dim => selected ? !selected.includes(dim) : !dimensions.includes(dim));
      if (unavailable.length) advisories.push(`:${target} groups only emitted table columns; ${unavailable.join(', ')} may be unassigned. Select each grouping column explicitly.`);
    } else if (unsupported.length) {
      advisories.push(`:${target} cannot group by ${unsupported.join(', ')}; the view groups by content dimensions. Valid alternatives: ${dimensions.join(', ')}.`);
    }
  }
  if (query.displayUnit && !supported.has('unit')) advisories.push(`:${target} ignores the display unit 'in ${query.displayUnit}'.`);
  if (query.join && !supported.has('where')) advisories.push(`:${target} ignores the 'where' join; joins are supported by :note and :block.`);
  if (query.pipes?.select && target !== 'segment' && target !== 'event') advisories.push(`:${target} ignores '| select'; the result keeps its original fields.`);
  if (query.pipes?.order && target === 'session') advisories.push(`:session ignores '| order by'; sessions remain ordered by completion time.`);
  return [...new Set(advisories)];
}
