/**
 * queryBlockCodec — Canonical `QueryBlockObject` model and lossless YAML /
 * 1-line shorthand codec for ```query fences.
 *
 * Design boundary:
 *   - **YAML** inside ```query owns layout, presentation, titles, multi-series
 *     composition, formulas, goals, table columns, and sorting.
 *   - **WQL** inside `query:` / `series[].query:` (and bare 1-line shorthand
 *     fences like `:session{result:<id>}`) owns search and data selection.
 *
 * Zero external runtime dependencies — safe in Web Workers, CLI, and browser.
 */

import { parseDocument } from './document';
import {
  DASHBOARD_WIDGET_TYPES,
  isDashboardWidgetType,
  parseQueryWidgetSuffix,
} from './dashboard/fenceSuffix';
import { serialize } from './serialize';
import {
  isFindQuery,
  isPipelineQuery,
  parseQuery,
  type AnyParsedQuery,
  type ParsedAggregateQuery,
  type ParsedFindQuery,
  type QueryWindow,
  type TagFilter,
} from './wql';

export type QueryViewKind =
  | 'table'
  | 'list'
  | 'value'
  | 'timeseries'
  | 'bar'
  | 'donut'
  | 'toplist'
  | 'stacked-bar'
  | 'goal-rings'
  | 'zone-distribution';

export interface QuerySeriesSpec {
  id: string;
  label?: string;
  /** Standard WQL query expression (when this layer is a data query). */
  query?: string;
  /** Arithmetic / correlation formula referencing sibling series ids. */
  formula?: string;
  normalize?: string;
  unit?: string;
  /** When false, computed as an intermediate dependency (e.g. for a formula) without plotting. */
  visible?: boolean;
}

export type ScalarOrParam = number | { param: string };

export interface QuerySortSpec {
  col: string;
  dir: 'asc' | 'desc';
}

export interface QueryBlockObject {
  title?: string;
  description?: string;
  /** Active view kind (defaults to `'table'`). Unknown legacy types ride `rawViewType`. */
  view: QueryViewKind;
  /** Preserved raw view string when a legacy fence named an unknown widget type. */
  rawViewType?: string;
  span?: 1 | 2 | 3 | 4 | 'full';
  unit?: string;
  window?: QueryWindow;
  groupBy?: string[];
  /** Shorthand single WQL query when there is 1 data layer and no formula. */
  query?: string;
  /** Multi-layer series & formula definitions. */
  series?: QuerySeriesSpec[];
  /** Table presentation options. */
  columns?: string[];
  sort?: QuerySortSpec[];
  limit?: number;
  /** Chart / threshold options. */
  goal?: ScalarOrParam;
  targets?: ScalarOrParam[];
  comparePr?: boolean;
  /** Preserved extra legacy attributes. */
  attributes?: Record<string, string>;
  /** Malformed fence/YAML syntax error, if any. */
  error?: string;
}

export interface ParseQueryBlockOptions {
  /** Optional fence tag (`query`, `query:timeseries-2 goal=$x`, or suffix `timeseries-2`). */
  fenceTag?: string;
  /** Legacy fallback title from an adjacent `## Heading` above the fence. */
  adjacentTitle?: string;
  /** Legacy fallback description/question from an adjacent paragraph above the fence. */
  adjacentDescription?: string;
}

const KNOWN_YAML_KEYS = new Set([
  'title',
  'description',
  'question',
  'view',
  'type',
  'span',
  'unit',
  'window',
  'groupBy',
  'query',
  'series',
  'columns',
  'sort',
  'limit',
  'goal',
  'targets',
  'comparePr',
]);

// ── Minimal deterministic 2-space YAML helpers ─────────────────────────────

function unquoteYaml(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

function stripInlineYamlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inDouble) {
      if (ch === '\\') i++;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === '"') inDouble = true;
    else if (ch === "'") inSingle = true;
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function quoteYamlString(value: string, opts: { allowWqlBare?: boolean } = {}): string {
  if (value === '') return '""';
  // WQL expressions in `query: sum:totalVolume{...}` are clean and readable unquoted in YAML
  // as long as they don't start with `{`, `[`, `"`, `'`, `-`, `#`, or contain `: ` (colon-space) or `#`.
  if (
    opts.allowWqlBare &&
    value === value.trim() &&
    !/^[{["'&*!|>%@`#-]/.test(value) &&
    !value.includes(': ') &&
    !value.includes(' #') &&
    !value.includes('\n')
  ) {
    return value;
  }
  const looksNumeric = /^-?\d+(?:\.\d+)?$/.test(value);
  const looksKeyword = /^(true|false|null|yes|no|on|off)$/i.test(value);
  if (
    /^[$a-zA-Z0-9_./-]+$/.test(value) &&
    !value.startsWith('-') &&
    !looksNumeric &&
    !looksKeyword
  ) {
    return value;
  }
  if (
    !/[:"'\n#{}[\],&*?|<>=!%@`]/.test(value) &&
    value === value.trim() &&
    !value.startsWith('-') &&
    !looksNumeric &&
    !looksKeyword
  ) {
    return value;
  }
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

function splitFlowList(inner: string): string[] {
  const out: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (inDouble) {
      if (ch === '\\' && i + 1 < inner.length) {
        current += ch + inner[i + 1]!;
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      current += ch;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === ',') {
      if (current.trim()) out.push(unquoteYaml(current));
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(unquoteYaml(current));
  return out;
}

/** True when `rawBody` is authored in YAML `key: value` form (not bare WQL or legacy QueryDocument). */
export function isYamlQueryBlockBody(rawBody: string): boolean {
  const lines = rawBody
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));
  if (lines.length === 0) return false;
  const first = lines[0]!;
  // Bare colon head `:session{...}` or dataset `@today` or legacy QueryDocument `defaults ...` / `x = ...`
  if (first.startsWith(':') || first.startsWith('@')) return false;
  const m = /^([a-zA-Z][a-zA-Z0-9_]*)\s*:(?:\s+(.*))?$/.exec(first);
  if (!m) return false;
  return KNOWN_YAML_KEYS.has(m[1]!);
}

function parseScalarOrParam(raw: string): ScalarOrParam | undefined {
  const clean = unquoteYaml(raw).trim();
  if (!clean) return undefined;
  if (clean.startsWith('$') && clean.length > 1) {
    return { param: clean.slice(1) };
  }
  const num = Number(clean);
  if (!Number.isNaN(num)) return num;
  return undefined;
}

function formatScalarOrParam(val: ScalarOrParam): string {
  return typeof val === 'number' ? String(val) : `$${val.param}`;
}

function parseYamlWindow(raw: string): { window?: QueryWindow; error?: string } {
  const clean = unquoteYaml(raw).trim();
  if (!clean || clean.toLowerCase() === 'all') return {};
  if (clean.startsWith('$') && clean.length > 1) {
    const m = /^\$([a-zA-Z_][\w-]*)(?:\s*([dw]))?$/i.exec(clean);
    if (m) {
      return {
        window: {
          kind: 'param',
          param: m[1]!,
          ...(m[2] ? { unit: m[2].toLowerCase() as 'd' | 'w' } : {}),
        },
      };
    }
  }
  const relParam = /^last\s+\$([a-zA-Z_][\w-]*)(?:\s*([dw]))?$/i.exec(clean);
  if (relParam) {
    return {
      window: {
        kind: 'param',
        param: relParam[1]!,
        ...(relParam[2] ? { unit: relParam[2].toLowerCase() as 'd' | 'w' } : {}),
      },
    };
  }
  const rel = /^(?:last\s+)?(\d+)\s*([dw])$/i.exec(clean);
  if (rel) {
    return {
      window: {
        kind: 'relative',
        size: Number(rel[1]),
        unit: rel[2]!.toLowerCase() as 'd' | 'w',
      },
    };
  }
  const range = /^(?:from\s+)?(\d{4}-\d{2}-\d{2})(?:\s*(?:to|\.\.)\s*(\d{4}-\d{2}-\d{2}))?$/i.exec(clean);
  if (range) {
    return {
      window: {
        kind: 'range',
        start: range[1]!,
        ...(range[2] ? { end: range[2] } : {}),
      },
    };
  }
  return { error: `Invalid window "${clean}" — expected 8w, 14d, $range, or YYYY-MM-DD..YYYY-MM-DD` };
}

function formatYamlWindow(w: QueryWindow): string {
  if (w.kind === 'relative') return `${w.size}${w.unit}`;
  if (w.kind === 'param') return w.unit ? `$${w.param} ${w.unit}` : `$${w.param}`;
  return w.end ? `${w.start}..${w.end}` : `from ${w.start}`;
}

function parseSortItem(raw: string): QuerySortSpec | undefined {
  const clean = unquoteYaml(raw).trim();
  if (!clean) return undefined;
  const m = /^(\S+)(?:\s+(asc|desc))?$/i.exec(clean);
  if (!m) return undefined;
  return { col: m[1]!, dir: (m[2]?.toLowerCase() as 'asc' | 'desc') ?? 'asc' };
}

interface RawYamlMap {
  scalars: Record<string, string>;
  stringLists: Record<string, string[]>;
  objectLists: Record<string, Array<Record<string, string>>>;
}

function parseIndentedYamlMap(rawBody: string): { data: RawYamlMap; error?: string } {
  const scalars: Record<string, string> = {};
  const stringLists: Record<string, string[]> = {};
  const objectLists: Record<string, Array<Record<string, string>>> = {};

  const rawLines = rawBody.split(/\r?\n/);
  let i = 0;

  while (i < rawLines.length) {
    const cleaned = stripInlineYamlComment(rawLines[i]!);
    const trimmed = cleaned.trim();
    if (!trimmed || trimmed.startsWith('//')) {
      i++;
      continue;
    }
    const indent = cleaned.length - cleaned.trimStart().length;
    if (indent !== 0) {
      return { data: { scalars, stringLists, objectLists }, error: `Unexpected indentation on line ${i + 1}: "${trimmed}"` };
    }
    const m = /^([a-zA-Z][a-zA-Z0-9_]*)\s*:(?:\s*(.*))?$/.exec(trimmed);
    if (!m) {
      return { data: { scalars, stringLists, objectLists }, error: `Malformed YAML property on line ${i + 1}: "${trimmed}"` };
    }
    const key = m[1]!;
    const rest = (m[2] ?? '').trim();

    if (rest !== '') {
      if (rest.startsWith('[') && rest.endsWith(']')) {
        stringLists[key] = splitFlowList(rest.slice(1, -1));
      } else {
        scalars[key] = unquoteYaml(rest);
      }
      i++;
      continue;
    }

    // Block list under `key:`
    i++;
    const strItems: string[] = [];
    const objItems: Array<Record<string, string>> = [];
    let isObjList = false;

    while (i < rawLines.length) {
      const childClean = stripInlineYamlComment(rawLines[i]!);
      const childTrim = childClean.trim();
      if (!childTrim || childTrim.startsWith('//')) {
        i++;
        continue;
      }
      const childIndent = childClean.length - childClean.trimStart().length;
      if (childIndent === 0) break;

      if (childTrim.startsWith('- ')) {
        const afterDash = childTrim.slice(2).trim();
        const kvMatch = /^([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(afterDash);
        if (kvMatch) {
          isObjList = true;
          const itemObj: Record<string, string> = {
            [kvMatch[1]!]: unquoteYaml(kvMatch[2] ?? ''),
          };
          const itemIndent = childIndent;
          i++;
          while (i < rawLines.length) {
            const propClean = stripInlineYamlComment(rawLines[i]!);
            const propTrim = propClean.trim();
            if (!propTrim || propTrim.startsWith('//')) {
              i++;
              continue;
            }
            const propIndent = propClean.length - propClean.trimStart().length;
            if (propIndent <= itemIndent) break;
            const propMatch = /^([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(propTrim);
            if (propMatch) {
              itemObj[propMatch[1]!] = unquoteYaml(propMatch[2] ?? '');
            }
            i++;
          }
          objItems.push(itemObj);
          continue;
        }
        strItems.push(unquoteYaml(afterDash));
        i++;
        continue;
      }
      i++;
    }

    if (isObjList) objectLists[key] = objItems;
    else stringLists[key] = strItems;
  }

  return { data: { scalars, stringLists, objectLists } };
}

// ── WQL pipeline / presentation normalizers ───────────────────────────────

function parseTargetsString(raw: string): ScalarOrParam[] {
  return raw
    .split(/[\s,]+/)
    .map((tok) => parseScalarOrParam(tok))
    .filter((v): v is ScalarOrParam => v !== undefined);
}

/**
 * Normalize a legacy pipeline query (`:segment{effort:x} | :max{metric:calc.e1rm} | :goal-rings{goal:"$g"}`)
 * into a clean WQL query string + extracted view/goal/targets when lossless.
 */
function normalizeSingleWqlForObject(rawWql: string): {
  query: string;
  sinkView?: QueryViewKind;
  sinkGoal?: ScalarOrParam;
  sinkTargets?: ScalarOrParam[];
  columns?: string[];
  sort?: QuerySortSpec[];
  limit?: number;
} {
  const trimmed = rawWql.trim();
  const parsed = parseQuery(trimmed);
  if (parsed.error) return { query: trimmed };

  if (isFindQuery(parsed) && parsed.pipes) {
    const columns = parsed.pipes.select?.map((s) => (s.unit ? `${s.col} in ${s.unit}` : s.col));
    const sort = parsed.pipes.order?.map((o) => ({ col: o.col, dir: o.dir }));
    const limit = parsed.pipes.limit;
    const stripped: ParsedFindQuery = { ...parsed, pipes: undefined };
    return {
      query: serialize(stripped),
      ...(columns?.length ? { columns } : {}),
      ...(sort?.length ? { sort } : {}),
      ...(limit !== undefined ? { limit } : {}),
    };
  }

  if (!isPipelineQuery(parsed)) {
    return { query: trimmed };
  }

  let sinkView: QueryViewKind | undefined;
  let sinkGoal: ScalarOrParam | undefined;
  let sinkTargets: ScalarOrParam[] | undefined;

  if (parsed.sink) {
    if (isDashboardWidgetType(parsed.sink.head)) {
      sinkView = parsed.sink.head;
    }
    for (const f of parsed.sink.filters) {
      if (f.key === 'goal' && f.values[0]) {
        const v = f.values[0];
        sinkGoal = v.param ? { param: v.param } : parseScalarOrParam(v.value);
      } else if (f.key === 'targets' && f.values[0]) {
        sinkTargets = parseTargetsString(f.values[0].value);
      }
    }
  }

  // Collapse `:segment{filters} [window] | :agg{metric:m, extraFilters} [by {...}] [.rollup(...)] [ | :chart{} ]`
  // into canonical `agg:m{filters, extraFilters} [by {...}] [.rollup(...)] [window]`!
  if (
    parsed.source.kind === 'query' &&
    parsed.source.query.family === 'find' &&
    parsed.source.query.target === 'segment' &&
    !parsed.source.query.join &&
    !parsed.source.query.groupBy?.length &&
    parsed.transforms.length === 1
  ) {
    const src = parsed.source.query;
    const tr = parsed.transforms[0]!;
    if (tr.metric || tr.agg === 'count') {
      const collapsed: ParsedAggregateQuery = {
        family: 'aggregate',
        raw: '',
        agg: tr.agg,
        metric: tr.metric || 'sessionLoad',
        ...(tr.metricParam ? { metricParam: tr.metricParam } : {}),
        filters: [...src.filters, ...tr.filters],
        groupBy: tr.groupBy,
        ...(tr.rollup ? { rollup: tr.rollup } : {}),
        ...(tr.displayUnit ?? src.displayUnit ? { displayUnit: tr.displayUnit ?? src.displayUnit } : {}),
        ...(tr.window ?? src.window ? { window: tr.window ?? src.window } : {}),
      };
      return {
        query: serialize(collapsed),
        ...(sinkView ? { sinkView } : {}),
        ...(sinkGoal !== undefined ? { sinkGoal } : {}),
        ...(sinkTargets?.length ? { sinkTargets } : {}),
      };
    }
  }

  // Collapse `:note{...} | :list{}` or `:session{...} | :table{}` (0 transforms, chart sink only)
  if (parsed.source.kind === 'query' && parsed.transforms.length === 0 && parsed.sink) {
    return {
      query: serialize(parsed.source.query),
      ...(sinkView ? { sinkView } : {}),
      ...(sinkGoal !== undefined ? { sinkGoal } : {}),
      ...(sinkTargets?.length ? { sinkTargets } : {}),
    };
  }

  // Multi-stage or @dataset pipeline: strip only the terminal chart sink so layout lives in YAML `view:`
  if (parsed.sink) {
    const withoutSink = serialize({ ...parsed, sink: undefined });
    return {
      query: withoutSink,
      ...(sinkView ? { sinkView } : {}),
      ...(sinkGoal !== undefined ? { sinkGoal } : {}),
      ...(sinkTargets?.length ? { sinkTargets } : {}),
    };
  }

  return { query: trimmed };
}

function applyLegacyFenceOptions(
  base: QueryBlockObject,
  options: ParseQueryBlockOptions,
): QueryBlockObject {
  const next: QueryBlockObject = { ...base };
  if (options.fenceTag) {
    const tag = options.fenceTag.trim().replace(/^`+/, '');
    const colonMatch = tag.match(/^(?:query|widget):(.*)$/i);
    const suffixText = colonMatch ? colonMatch[1]! : tag.toLowerCase() === 'query' ? '' : tag;
    if (suffixText !== '') {
      const spec = parseQueryWidgetSuffix(suffixText);
      if (spec.error) next.error = spec.error;
      if (spec.type) {
        if (isDashboardWidgetType(spec.type)) {
          next.view = spec.type;
        } else {
          next.rawViewType = spec.type;
        }
      }
      if (spec.spanFull) next.span = 'full';
      else if (spec.spanCols) next.span = spec.spanCols as 1 | 2 | 3 | 4;

      const extraAttrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(spec.attributes)) {
        if (k === 'goal' || k === 'param1') {
          const parsedGoal = parseScalarOrParam(v);
          if (parsedGoal !== undefined) next.goal = next.goal ?? parsedGoal;
          else extraAttrs[k] = v;
        } else if (k === 'targets') {
          const parsedTargets = parseTargetsString(v);
          if (parsedTargets.length > 0) next.targets = next.targets ?? parsedTargets;
          else extraAttrs[k] = v;
        } else if (k === 'comparepr') {
          next.comparePr = v === 'true';
        } else {
          extraAttrs[k] = v;
        }
      }
      if (Object.keys(extraAttrs).length > 0) {
        next.attributes = { ...(next.attributes ?? {}), ...extraAttrs };
      }
    }
  }
  if (!next.title && options.adjacentTitle) next.title = options.adjacentTitle;
  if (!next.description && options.adjacentDescription) next.description = options.adjacentDescription;
  return next;
}

// ── Public Parse / Serialize / Execute Bridge ─────────────────────────────

/**
 * Parse any ```query fence body (canonical YAML, 1-line WQL shorthand, or
 * legacy QueryDocument + fence-tag suffix) into a canonical `QueryBlockObject`.
 */
export function parseQueryBlock(
  rawBody: string,
  options: ParseQueryBlockOptions = {},
): QueryBlockObject {
  const trimmed = rawBody.trim();

  // 1. Canonical YAML ```query block
  if (isYamlQueryBlockBody(trimmed)) {
    const { data, error } = parseIndentedYamlMap(trimmed);
    const rawView = (data.scalars.view ?? data.scalars.type ?? '').toLowerCase();
    const view: QueryViewKind = isDashboardWidgetType(rawView) ? rawView : 'table';
    const obj: QueryBlockObject = {
      view,
      ...(rawView && !isDashboardWidgetType(rawView) ? { rawViewType: rawView } : {}),
      ...(error ? { error } : {}),
    };

    if (data.scalars.title) obj.title = data.scalars.title;
    const desc = data.scalars.description ?? data.scalars.question;
    if (desc) obj.description = desc;

    if (data.scalars.span) {
      const s = data.scalars.span.toLowerCase();
      if (s === 'full') obj.span = 'full';
      else {
        const n = Number(s);
        if (n >= 1 && n <= 4) obj.span = n as 1 | 2 | 3 | 4;
        else obj.error = obj.error ?? `span ${data.scalars.span} outside 1..4`;
      }
    }

    if (data.scalars.unit) obj.unit = data.scalars.unit;

    if (data.scalars.window) {
      const wRes = parseYamlWindow(data.scalars.window);
      if (wRes.error) obj.error = obj.error ?? wRes.error;
      else if (wRes.window) obj.window = wRes.window;
    }

    const groupByList = data.stringLists.groupBy ?? (data.scalars.groupBy ? splitFlowList(data.scalars.groupBy) : undefined);
    if (groupByList?.length) obj.groupBy = groupByList;

    if (data.scalars.goal !== undefined) {
      const g = parseScalarOrParam(data.scalars.goal);
      if (g !== undefined) obj.goal = g;
    }

    const targetStrings = data.stringLists.targets ?? (data.scalars.targets ? parseTargetsString(data.scalars.targets).map(formatScalarOrParam) : undefined);
    if (targetStrings?.length) {
      const parsedTargets = targetStrings.map(parseScalarOrParam).filter((v): v is ScalarOrParam => v !== undefined);
      if (parsedTargets.length) obj.targets = parsedTargets;
    }

    if (data.scalars.comparePr !== undefined) {
      obj.comparePr = data.scalars.comparePr.toLowerCase() === 'true';
    }

    const cols = data.stringLists.columns ?? (data.scalars.columns ? splitFlowList(data.scalars.columns) : undefined);
    if (cols?.length) obj.columns = cols;

    if (data.objectLists.sort) {
      obj.sort = data.objectLists.sort
        .filter((item) => Boolean(item.col))
        .map((item) => ({
          col: item.col!,
          dir: item.dir?.toLowerCase() === 'desc' ? 'desc' : 'asc',
        }));
    } else if (data.stringLists.sort) {
      obj.sort = data.stringLists.sort.map(parseSortItem).filter((s): s is QuerySortSpec => Boolean(s));
    } else if (data.scalars.sort) {
      const single = parseSortItem(data.scalars.sort);
      if (single) obj.sort = [single];
    }

    if (data.scalars.limit !== undefined) {
      const lim = Number(data.scalars.limit);
      if (!Number.isNaN(lim)) obj.limit = lim;
    }

    if (data.scalars.query !== undefined) {
      const norm = normalizeSingleWqlForObject(data.scalars.query);
      obj.query = norm.query;
      if (!data.scalars.view && !data.scalars.type && norm.sinkView) obj.view = norm.sinkView;
      if (obj.goal === undefined && norm.sinkGoal !== undefined) obj.goal = norm.sinkGoal;
      if (!obj.targets && norm.sinkTargets?.length) obj.targets = norm.sinkTargets;
    }

    if (data.objectLists.series?.length) {
      obj.series = data.objectLists.series.map((item, idx) => ({
        id: item.id || `s${idx + 1}`,
        ...(item.label ? { label: item.label } : {}),
        ...(item.query ? { query: normalizeSingleWqlForObject(item.query).query } : {}),
        ...(item.formula ? { formula: item.formula } : {}),
        ...(item.normalize ? { normalize: item.normalize } : {}),
        ...(item.unit ? { unit: item.unit } : {}),
        ...(item.visible === 'false' ? { visible: false } : {}),
      }));
    }

    return applyLegacyFenceOptions(obj, options);
  }

  // 2. Legacy multi-line QueryDocument (`defaults ...`, `a = ...`, `show ...`)
  const nonCommentLines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));

  if (nonCommentLines.length > 1 || (nonCommentLines[0] && /^(?:defaults\s+|show\s+|[A-Za-z_][\w-]*\s*=)/.test(nonCommentLines[0]))) {
    const docParsed = parseDocument(nonCommentLines.join('\n'));
    if (!docParsed.doc.degenerate && docParsed.doc.assignments.length > 0) {
      const shownSet = new Set(docParsed.doc.show);
      const sinkView = docParsed.doc.showChart && isDashboardWidgetType(docParsed.doc.showChart.head)
        ? docParsed.doc.showChart.head
        : undefined;
      const obj: QueryBlockObject = {
        view: sinkView ?? 'timeseries',
        ...(docParsed.doc.defaults?.window
          ? { window: docParsed.doc.defaults.window }
          : {}),
        ...(docParsed.doc.defaults?.groupBy?.length ? { groupBy: docParsed.doc.defaults.groupBy } : {}),
        series: docParsed.doc.assignments.map((a) => ({
          id: a.name,
          ...(a.kind === 'query' ? { query: a.queryText } : {}),
          ...(a.kind === 'formula' && a.formula
            ? {
                formula: a.formula.expression,
                ...(a.formula.normalize ? { normalize: a.formula.normalize } : {}),
                ...(a.formula.unit ? { unit: a.formula.unit } : {}),
              }
            : {}),
          ...(shownSet.size > 0 && !shownSet.has(a.name) ? { visible: false } : {}),
        })),
      };
      return applyLegacyFenceOptions(obj, options);
    }
  }

  // 3. 1-line bare WQL shorthand (or legacy 1-line body inside ```query:bar-2)
  const singleLine = nonCommentLines.join(' ');
  const norm = normalizeSingleWqlForObject(singleLine);
  const obj: QueryBlockObject = {
    view: norm.sinkView ?? 'table',
    query: norm.query,
    ...(norm.columns ? { columns: norm.columns } : {}),
    ...(norm.sort ? { sort: norm.sort } : {}),
    ...(norm.limit !== undefined ? { limit: norm.limit } : {}),
    ...(norm.sinkGoal !== undefined ? { goal: norm.sinkGoal } : {}),
    ...(norm.sinkTargets?.length ? { targets: norm.sinkTargets } : {}),
  };
  return applyLegacyFenceOptions(obj, options);
}

/**
 * True when `obj` can serialize as a zero-boilerplate 1-line WQL shorthand
 * inside ```query (e.g. `:session{result:<id>}`) without losing any layout metadata.
 */
export function isDefaultShorthandQueryBlock(obj: QueryBlockObject): boolean {
  const effectiveView = obj.rawViewType ?? obj.view;
  if (effectiveView !== 'table') return false;
  if (
    obj.title ||
    obj.description ||
    (obj.span !== undefined && obj.span !== 1) ||
    obj.unit ||
    obj.window ||
    obj.groupBy?.length ||
    obj.columns?.length ||
    obj.sort?.length ||
    obj.limit !== undefined ||
    obj.goal !== undefined ||
    obj.targets?.length ||
    obj.comparePr !== undefined ||
    (obj.attributes && Object.keys(obj.attributes).length > 0)
  ) {
    return false;
  }
  if (obj.series && obj.series.length > 0) {
    if (obj.series.length > 1) return false;
    const s = obj.series[0]!;
    if (s.label || s.formula || s.normalize || s.unit || s.visible === false || !s.query) return false;
    return true;
  }
  return Boolean(obj.query && !obj.query.includes('\n'));
}

/**
 * Serialize a `QueryBlockObject` into the inner content of a ```query fence:
 *   - Emits 1-line WQL shorthand when `isDefaultShorthandQueryBlock(obj)` holds;
 *   - Otherwise emits clean, deterministic 2-space YAML.
 */
export function serializeQueryBlock(obj: QueryBlockObject, opts: { forceYaml?: boolean } = {}): string {
  if (!opts.forceYaml && isDefaultShorthandQueryBlock(obj)) {
    return (obj.query ?? obj.series?.[0]?.query ?? '').trim();
  }

  const lines: string[] = [];
  if (obj.title) lines.push(`title: ${quoteYamlString(obj.title)}`);
  if (obj.description) lines.push(`description: ${quoteYamlString(obj.description)}`);
  lines.push(`view: ${quoteYamlString(obj.rawViewType ?? obj.view)}`);
  if (obj.span !== undefined && obj.span !== 1) {
    lines.push(`span: ${obj.span}`);
  }
  if (obj.unit) lines.push(`unit: ${quoteYamlString(obj.unit)}`);
  if (obj.window) lines.push(`window: ${quoteYamlString(formatYamlWindow(obj.window))}`);
  if (obj.groupBy?.length) {
    lines.push(`groupBy: [${obj.groupBy.map((g) => quoteYamlString(g)).join(', ')}]`);
  }
  if (obj.goal !== undefined) {
    lines.push(`goal: ${formatScalarOrParam(obj.goal)}`);
  }
  if (obj.targets?.length) {
    lines.push(`targets: [${obj.targets.map(formatScalarOrParam).join(', ')}]`);
  }
  if (obj.comparePr !== undefined) {
    lines.push(`comparePr: ${obj.comparePr ? 'true' : 'false'}`);
  }
  if (obj.columns?.length) {
    lines.push(`columns: [${obj.columns.map((c) => quoteYamlString(c)).join(', ')}]`);
  }
  if (obj.sort?.length) {
    lines.push(
      `sort: [${obj.sort.map((s) => quoteYamlString(s.dir === 'desc' ? `${s.col} desc` : `${s.col} asc`)).join(', ')}]`,
    );
  }
  if (obj.limit !== undefined) {
    lines.push(`limit: ${obj.limit}`);
  }

  const hasRichSeries =
    obj.series &&
    (obj.series.length > 1 ||
      obj.series.some((s) => Boolean(s.formula || s.label || s.normalize || s.unit || s.visible === false)));

  if (hasRichSeries && obj.series) {
    lines.push('series:');
    for (const s of obj.series) {
      lines.push(`  - id: ${quoteYamlString(s.id)}`);
      if (s.label) lines.push(`    label: ${quoteYamlString(s.label)}`);
      if (s.query) lines.push(`    query: ${quoteYamlString(s.query, { allowWqlBare: true })}`);
      if (s.formula) lines.push(`    formula: ${quoteYamlString(s.formula, { allowWqlBare: true })}`);
      if (s.normalize) lines.push(`    normalize: ${quoteYamlString(s.normalize)}`);
      if (s.unit) lines.push(`    unit: ${quoteYamlString(s.unit)}`);
      if (s.visible === false) lines.push('    visible: false');
    }
  } else {
    const singleQuery = obj.query ?? obj.series?.[0]?.query ?? '';
    lines.push(`query: ${quoteYamlString(singleQuery, { allowWqlBare: true })}`);
  }

  return lines.join('\n');
}

/** Serialize a full fenced ```query markdown block (opening fence + body + closing fence). */
export function serializeQueryBlockFence(obj: QueryBlockObject, opts: { forceYaml?: boolean } = {}): string {
  return `\`\`\`query\n${serializeQueryBlock(obj, opts)}\n\`\`\``;
}

/** Merge top-level `window`, `groupBy`, `unit`, `columns`, `sort`, and `limit` onto a single WQL query string. */
function applyTopLevelClausesToSingleQuery(rawQuery: string, obj: QueryBlockObject): string {
  const trimmed = rawQuery.trim();
  if (!trimmed) return '';
  const hasTopOverrides = Boolean(
    obj.window ||
      obj.groupBy?.length ||
      obj.unit ||
      obj.columns?.length ||
      obj.sort?.length ||
      obj.limit !== undefined,
  );
  if (!hasTopOverrides) return trimmed;

  const parsed = parseQuery(trimmed);
  if (parsed.error) return trimmed;

  if (parsed.family === 'aggregate') {
    const next: ParsedAggregateQuery = {
      ...parsed,
      ...(obj.groupBy?.length && parsed.groupBy.length === 0 ? { groupBy: obj.groupBy } : {}),
      ...(obj.window && !parsed.window ? { window: obj.window } : {}),
      ...(obj.unit && !parsed.displayUnit ? { displayUnit: obj.unit } : {}),
    };
    return serialize(next);
  }

  if (parsed.family === 'find') {
    const pipes = { ...(parsed.pipes ?? {}) };
    if (obj.columns?.length && !pipes.select) {
      pipes.select = obj.columns.map((c) => {
        const m = /^([\w.-]+)(?:\s+in\s+([\w/%]+))?$/i.exec(c.trim());
        return m ? { col: m[1]!, ...(m[2] ? { unit: m[2] } : {}) } : { col: c.trim() };
      });
    }
    if (obj.sort?.length && !pipes.order) {
      pipes.order = obj.sort.map((s) => ({ col: s.col, dir: s.dir }));
    }
    if (obj.limit !== undefined && pipes.limit === undefined) {
      pipes.limit = obj.limit;
    }
    const next: ParsedFindQuery = {
      ...parsed,
      ...(obj.groupBy?.length && !parsed.groupBy?.length ? { groupBy: obj.groupBy } : {}),
      ...(obj.window && !parsed.window ? { window: obj.window } : {}),
      ...(obj.unit && !parsed.displayUnit ? { displayUnit: obj.unit } : {}),
      ...(Object.keys(pipes).length > 0 ? { pipes } : {}),
    };
    return serialize(next);
  }

  if (parsed.family === 'pipeline') {
    const transforms = [...parsed.transforms];
    if (transforms.length > 0 && obj.groupBy?.length) {
      const lastIdx = transforms.length - 1;
      if (transforms[lastIdx]!.groupBy.length === 0) {
        transforms[lastIdx] = { ...transforms[lastIdx]!, groupBy: obj.groupBy };
      }
    }
    let source = parsed.source;
    if (obj.window && source.kind === 'query' && !source.query.window) {
      source = { kind: 'query', query: { ...source.query, window: obj.window } };
    }
    return serialize({ ...parsed, source, transforms });
  }

  return trimmed;
}

/**
 * Compile a `QueryBlockObject` into an executable WQL / `QueryDocument` text
 * consumed by `SharedQueryDocumentRunner` and `QueryService`.
 */
export function queryBlockToDocumentText(obj: QueryBlockObject): string {
  const hasMultiOrFormula =
    obj.series &&
    (obj.series.length > 1 || obj.series.some((s) => Boolean(s.formula || s.visible === false)));

  if (!hasMultiOrFormula) {
    const single = obj.query ?? obj.series?.[0]?.query ?? '';
    return applyTopLevelClausesToSingleQuery(single, obj);
  }

  const lines: string[] = [];
  if (obj.groupBy?.length || obj.window) {
    const parts: string[] = [];
    if (obj.groupBy?.length) parts.push(`by {${obj.groupBy.join(', ')}}`);
    if (obj.window) {
      const w = obj.window;
      parts.push(
        w.kind === 'relative'
          ? `last ${w.size}${w.unit}`
          : w.kind === 'param'
            ? `last $${w.param}${w.unit ? ` ${w.unit}` : ''}`
            : `from ${w.start}${w.end ? ` to ${w.end}` : ''}`,
      );
    }
    lines.push(`defaults ${parts.join(' ')}`);
  }

  const showIds: string[] = [];
  for (const s of obj.series ?? []) {
    if (s.visible !== false) showIds.push(s.id);
    if (s.formula) {
      const normPart = s.normalize ? ` (normalize ${s.normalize})` : '';
      const unitPart = s.unit ? ` -> ${s.unit}` : '';
      lines.push(`${s.id} = ${s.formula}${normPart}${unitPart}`);
    } else if (s.query) {
      lines.push(`${s.id} = ${s.query}`);
    }
  }

  if (showIds.length > 0) {
    lines.push(`show ${showIds.join(', ')}`);
  }

  return lines.join('\n');
}

/** Derive widget `attributes` map (`goal`, `targets`, `comparePr`, `label.<id>`) from `QueryBlockObject`. */
export function queryBlockAttributes(obj: QueryBlockObject): {
  attributes: Record<string, string>;
  attributeOrder: string[];
} {
  const attributes: Record<string, string> = { ...(obj.attributes ?? {}) };
  const attributeOrder: string[] = Object.keys(attributes);
  const setAttr = (k: string, v: string) => {
    if (!(k in attributes)) attributeOrder.push(k);
    attributes[k] = v;
  };
  if (obj.goal !== undefined) {
    setAttr('goal', formatScalarOrParam(obj.goal));
  }
  if (obj.targets?.length) {
    setAttr('targets', obj.targets.map(formatScalarOrParam).join(' '));
  }
  if (obj.comparePr !== undefined) {
    setAttr('comparePr', obj.comparePr ? 'true' : 'false');
  }
  if (obj.series) {
    for (const s of obj.series) {
      if (s.label) setAttr(`label.${s.id}`, s.label);
    }
  }
  if (!obj.series && obj.title) {
    // Title lives on widget.title; keep attributes minimal.
  }
  return { attributes, attributeOrder };
}

/** Collect all `$param` names referenced anywhere in a `QueryBlockObject` (queries, window, goal, targets). */
export function collectQueryBlockParams(obj: QueryBlockObject): string[] {
  const out = new Set<string>();
  const addFromText = (text: string | undefined) => {
    if (!text) return;
    const parsed = parseQuery(text);
    if (!parsed.error) {
      for (const m of text.matchAll(/\$([A-Za-z_][\w-]*)/g)) out.add(m[1]!);
      return;
    }
    for (const m of text.matchAll(/\$([A-Za-z_][\w-]*)/g)) out.add(m[1]!);
  };
  if (obj.window?.kind === 'param') out.add(obj.window.param);
  if (obj.goal && typeof obj.goal === 'object') out.add(obj.goal.param);
  for (const t of obj.targets ?? []) {
    if (typeof t === 'object') out.add(t.param);
  }
  addFromText(obj.query);
  for (const s of obj.series ?? []) {
    addFromText(s.query);
    addFromText(s.formula);
  }
  for (const v of Object.values(obj.attributes ?? {})) {
    addFromText(v);
  }
  return [...out];
}

export { DASHBOARD_WIDGET_TYPES };
export type { AnyParsedQuery, TagFilter };
