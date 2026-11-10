import {
  parseQuery,
  serialize,
  isFindQuery,
  isPipelineQuery,
  WQL_AGGREGATORS,
  WQL_NOTE_DEFAULT_SOURCES,
  type Aggregator,
  type ParsedAggregateQuery,
  type ParsedFindQuery,
  type AnyParsedQuery,
  type TagFilter,
} from '@bitcobblers/wod-wiki-wql';
import { composerRegistry } from './ComposerRegistry';
import { CLAUSE_META, getClauseMeta, allowedFilterTypesForTarget, type QueryClause } from './queryClauses';
import { getSuggestionBinding } from './suggestionSources';

export interface QueryDraft {
  wql: string;
  ast: AnyParsedQuery;
  valid: boolean;
  error?: string;
}

const KEY_TYPE: Record<string, string> = { tags: 'tag' };
const TYPE_KEY: Record<string, string> = { tag: 'tags' };

function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, item]) => !['raw', 'advisories', 'error', 'head'].includes(key) && item !== undefined && !(key === 'groupBy' && Array.isArray(item) && item.length === 0))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, semantic(item)]));
  }
  return value;
}

export function isLosslessQuery(ast: AnyParsedQuery): boolean {
  if (ast.error) return false;
  const restored = parseQuery(serialize(ast));
  return !restored.error && JSON.stringify(semantic(ast)) === JSON.stringify(semantic(restored));
}

function snapshot(wql: string, error?: string): QueryDraft {
  const parsed = parseQuery(wql);
  const ast = error ? { ...parsed, raw: wql, error } : parsed;
  return { wql, ast, valid: !ast.error, error: ast.error };
}

function emit(ast: AnyParsedQuery): QueryDraft {
  const text = serialize(ast);
  const result = snapshot(text);
  return result.valid && !isLosslessQuery(ast)
    ? snapshot(text, 'This value cannot be represented losslessly in WQL.')
    : result;
}

function clause(type: string, value: string, extra?: Partial<QueryClause>): QueryClause {
  return { id: `c-${type}`, type, ...getClauseMeta(type), value, ...extra };
}

function windowText(ast: ParsedFindQuery | ParsedAggregateQuery): string {
  const window = ast.window;
  if (!window) return 'all';
  if (window.kind === 'relative') return `last ${window.size}${window.unit}`;
  if (window.kind === 'param') return `last $${window.param}${window.unit ? ` ${window.unit}` : ''}`;
  return `from ${window.start}${window.end ? ` to ${window.end}` : ''}`;
}

/**
 * Normalize a simple 2-stage `:segment{...} | :agg{metric:...} [by {...}]`
 * pipeline (no sink, no source join/groupBy/pipes) into its equivalent
 * `ParsedAggregateQuery` so UI builders can inspect and edit structured pills.
 */
export function normalizeSimplePipelineToAggregate(ast: AnyParsedQuery): ParsedAggregateQuery | null {
  if (!isPipelineQuery(ast) || ast.error || ast.sink || ast.transforms.length !== 1) return null;
  if (ast.source.kind !== 'query' || ast.source.query.family !== 'find') return null;
  const src = ast.source.query;
  if (!['segment', 'event'].includes(src.target) || src.join || src.pipes || (src.groupBy?.length ?? 0) > 0) {
    return null;
  }
  const fn = ast.transforms[0]!;
  return {
    family: 'aggregate',
    raw: ast.raw,
    agg: fn.agg,
    metric: fn.metric,
    ...(fn.metricParam ? { metricParam: fn.metricParam } : {}),
    filters: [...src.filters, ...fn.filters],
    groupBy: fn.groupBy ?? [],
    rollup: fn.rollup,
    window: fn.window ?? src.window,
    displayUnit: fn.displayUnit ?? src.displayUnit,
  };
}

export function astToPills(ast: AnyParsedQuery): QueryClause[] | null {
  // Pipelines keep their raw text editable in the composer; structured pills
  // cannot represent stage order without flattening it away.
  if (isPipelineQuery(ast) || ast.error || !isLosslessQuery(ast)) return null;
  if (ast.filters.some((filter) => filter.values.some((value) => value.value.includes('|') || (!value.wildcard && value.value.endsWith('*'))))) return null;
  const pills = [clause('kind', ast.family)];
  if (ast.family === 'find') pills.push(clause('target', ast.target));
  else pills.push(clause('agg', ast.agg), clause('metric', ast.metricParam ? `$${ast.metricParam}` : ast.metric));
  if (ast.window || allowedFilterTypesForTarget(ast.family === 'find' ? ast.target : '', ast.family).has('time')) pills.push(clause('time', windowText(ast)));
  ast.filters.forEach((filter, filterIndex) => {
    if (filter.kind === 'spreadParam' && filter.param) {
      pills.push(clause('scope', `$${filter.param}`, {
        id: `c-filter-${filterIndex}`,
        filterIndex,
        negate: false,
      }));
      return;
    }
    const value = filter.values.map((item) => `${item.value}${item.wildcard ? '*' : ''}`).join('|');
    const custom = composerRegistry.getAllSlots().find((slot) => {
      if (!slot.parseValue) return false;
      const parsed = slot.parseValue(value);
      return parsed !== undefined && slot.wqlGenerator(parsed) === filterText(filter);
    });
    const type = custom?.type ?? KEY_TYPE[filter.key] ?? filter.key;
    pills.push(clause(type, value, {
      id: `c-filter-${filterIndex}`, filterIndex, negate: filter.negate,
    }));
  });
  if (ast.groupBy?.length) pills.push(clause('groupby', ast.groupBy.join('|')));
  if (ast.family === 'aggregate' && ast.rollup) pills.push(clause('rollup', `${ast.rollup.size}${ast.rollup.unit}`));
  if (ast.displayUnit) pills.push(clause('unit', ast.displayUnit));
  const serialized = serialize(ast);
  if (ast.join) pills.push(clause('where', serialized.split(' where ')[1]?.split(' | ')[0] ?? ''));
  if (ast.family === 'find' && ast.pipes) pills.push(clause('pipes', serialized.split(' | ').slice(1).join(' | ')));
  return pills;
}

export function wqlToPills(wql: string): QueryClause[] | null {
  return astToPills(parseQuery(wql));
}

function filterText(filter: TagFilter): string {
  return serialize({ family: 'find', raw: '', target: 'note', sourceScope: [...WQL_NOTE_DEFAULT_SOURCES], filters: [filter] }).replace(/^[^{]*\{/, '').replace(/\}$/, '');
}

function parsedFilter(type: string, value: string, negate: boolean): TagFilter | undefined {
  if (type === 'scope') {
    const paramToken = value.startsWith('$') ? value : `$${value}`;
    if (!/^\$[A-Za-z_][\w-]*$/.test(paramToken)) return undefined;
    const parsed = parseQuery(`:note{${paramToken}}`);
    return !parsed.error && isFindQuery(parsed) ? parsed.filters[0] : undefined;
  }
  const custom = composerRegistry.getSlot(type);
  if (custom) {
    const typed = custom.parseValue ? custom.parseValue(value) : value;
    if (typed === undefined || custom.validate?.(typed)) return undefined;
    const parsed = parseQuery(`:note{${custom.wqlGenerator(typed)}}`);
    return parsed.error || !isFindQuery(parsed) ? undefined : parsed.filters[0];
  }
  const key = TYPE_KEY[type] ?? type;
  const values = value.split('|').map((part) => {
    const wildcard = part.endsWith('*');
    const cleanPart = wildcard ? part.slice(0, -1) : part;
    const paramMatch = !wildcard && /^\$([A-Za-z_][\w-]*)$/.exec(cleanPart);
    return paramMatch
      ? { value: cleanPart, wildcard: false, param: paramMatch[1] }
      : { value: cleanPart, wildcard };
  });
  const filter: TagFilter = { key, negate, values };
  const parsed = parseQuery(`:note{${filterText(filter)}}`);
  return !parsed.error && isFindQuery(parsed) && parsed.filters.length === 1 && JSON.stringify(semantic(parsed.filters[0])) === JSON.stringify(semantic(filter)) ? parsed.filters[0] : undefined;
}

export function editQueryClause(query: string, edited: QueryClause, value: string | null): QueryDraft {
  const current = snapshot(query);
  if (!current.valid) return current;
  const ast = current.ast;
  if (isPipelineQuery(ast)) return snapshot(query, 'Pipelines are edited as WQL text — structured pills cannot change a stage without flattening it.');
  if (!isLosslessQuery(ast)) return snapshot(query, 'This query requires Edit WQL to preserve every clause.');
  const clean = value?.trim() ?? '';
  if (edited.type === 'kind' || edited.type === 'target') return pivotQuery(query, edited.type, clean).draft;
  if (edited.filterIndex !== undefined || !['time', 'agg', 'metric', 'groupby', 'rollup', 'unit', 'where', 'pipes'].includes(edited.type)) {
    const filter = clean && !(edited.type === 'source' && clean === 'all') ? parsedFilter(edited.type, clean, edited.negate ?? false) : undefined;
    if (clean && !filter && !(edited.type === 'source' && clean === 'all')) return snapshot(query, `Invalid ${getClauseMeta(edited.type).label} value`);
    const filters = [...ast.filters];
    if (edited.filterIndex !== undefined) {
      if (!filters[edited.filterIndex]) return current;
      if (filter) filters[edited.filterIndex] = filter;
      else filters.splice(edited.filterIndex, 1);
    } else if (filter) filters.push(filter);
    return emit({ ...ast, filters });
  }
  if (edited.type === 'time') {
    if (!clean || clean === 'all') return emit({ ...ast, window: undefined });
    const parsed = parseQuery(`:note ${/^(last|from)\b/.test(clean) ? clean : `last ${clean}`}`);
    if (parsed.error || !isFindQuery(parsed) || !parsed.window) return snapshot(query, parsed.error ?? 'Invalid time window');
    return emit({ ...ast, window: parsed.window });
  }
  if (edited.type === 'groupby') return emit({ ...ast, groupBy: [...new Set(clean.split('|').filter(Boolean))] });
  if (edited.type === 'unit') return emit({ ...ast, displayUnit: clean || undefined });
  if (edited.type === 'agg' && ast.family === 'aggregate') {
    if (!(WQL_AGGREGATORS as readonly string[]).includes(clean)) {
      return snapshot(query, `Invalid aggregator "${clean}"`);
    }
    return emit({ ...ast, agg: clean as Aggregator });
  }
  if (edited.type === 'metric' && ast.family === 'aggregate') {
    if (!clean) return snapshot(query, 'Metric cannot be empty');
    const paramMatch = /^\$([A-Za-z_][\w-]*)$/.exec(clean);
    return emit({
      ...ast,
      metric: clean,
      metricParam: paramMatch ? paramMatch[1] : undefined,
    });
  }
  if (edited.type === 'rollup' && ast.family === 'aggregate') {
    if (!clean) return emit({ ...ast, rollup: undefined });
    const parsed = parseQuery(`sum:tis{} by {week}.rollup(${clean})`);
    if (parsed.error || parsed.family !== 'aggregate' || !parsed.rollup) return snapshot(query, parsed.error ?? 'Invalid bucket width');
    return emit({ ...ast, rollup: parsed.rollup });
  }
  if (edited.type === 'where') {
    if (!clean) return emit({ ...ast, join: undefined });
    if (ast.family === 'find') {
      const parsedJoin = parseQuery(`:note where ${clean}`);
      if (parsedJoin.error || !isFindQuery(parsedJoin) || !parsedJoin.join) {
        return snapshot(query, parsedJoin.error ?? 'Invalid metric join');
      }
      return emit({ ...ast, join: parsedJoin.join });
    }
    const parsedJoin = parseQuery(`sum:tis{} where ${clean}`);
    if (parsedJoin.error || parsedJoin.family !== 'aggregate' || !parsedJoin.join) {
      return snapshot(query, parsedJoin.error ?? 'Invalid content join');
    }
    return emit({ ...ast, join: parsedJoin.join });
  }
  if (edited.type === 'pipes' && ast.family === 'find') {
    if (!clean) return emit({ ...ast, pipes: undefined });
    const parsedPipes = parseQuery(`:note | ${clean}`);
    if (parsedPipes.error || !isFindQuery(parsedPipes) || !parsedPipes.pipes) {
      return snapshot(query, parsedPipes.error ?? 'Invalid presentation pipes');
    }
    return emit({ ...ast, pipes: parsedPipes.pipes });
  }
  return current;
}

/**
 * Bind a `$token` parameter into a WQL query expression via pure AST mutation
 * (replaces brittle regex brace surgery).
 */
export function bindTokenParamIntoWql(query: string, tokenName: string): string {
  const trimmed = query.trim();
  const ast = parseQuery(trimmed);
  if (ast.error) return query;

  const makeFilter = (): TagFilter =>
    tokenName === 'scope'
      ? {
          kind: 'spreadParam',
          param: 'scope',
          key: '$scope',
          negate: false,
          values: [{ value: '$scope', wildcard: false, param: 'scope' }],
        }
      : {
          key: tokenName,
          negate: false,
          values: [{ value: `$${tokenName}`, wildcard: false, param: tokenName }],
        };

  const upsertFilters = (filters: readonly TagFilter[]): TagFilter[] => {
    const next = [...filters];
    const filter = makeFilter();
    const idx = next.findIndex((f) =>
      tokenName === 'scope'
        ? f.kind === 'spreadParam' && f.param === 'scope'
        : f.key === tokenName && !f.negate,
    );
    if (idx >= 0) next[idx] = filter;
    else next.push(filter);
    return next;
  };

  if (isPipelineQuery(ast)) {
    if (ast.source.kind !== 'query') return query;
    return serialize({
      ...ast,
      source: {
        kind: 'query',
        query: { ...ast.source.query, filters: upsertFilters(ast.source.query.filters) },
      },
    });
  }

  return serialize({ ...ast, filters: upsertFilters(ast.filters) });
}

export function pivotQuery(query: string, type: 'kind' | 'target', value: string): { draft: QueryDraft; removed: string[] } {
  const current = snapshot(query);
  const ast = current.ast;
  if (!current.valid) return { draft: current, removed: [] };
  if (isPipelineQuery(ast)) return { draft: snapshot(query, 'Pipelines are pivoted as WQL text — stage order cannot survive a structured pivot.'), removed: [] };
  const family = type === 'kind' ? value : 'find';
  const target = type === 'target' ? value : ast.family === 'find' ? ast.target : 'note';
  const allowed = allowedFilterTypesForTarget(target, family === 'aggregate' ? 'aggregate' : 'find');
  const removed: string[] = [];
  const filters = ast.filters.filter((filter) => {
    if (filter.kind === 'spreadParam') return true;
    const dynamicFact = (family === 'aggregate' || target === 'segment' || target === 'event') && !(filter.key in CLAUSE_META) && Boolean(getSuggestionBinding(filter.key));
    const keep = allowed.has(KEY_TYPE[filter.key] ?? filter.key) || dynamicFact || Boolean(composerRegistry.getSlot(filter.key));
    if (!keep) removed.push(filterText(filter));
    return keep;
  });
  if (family === ast.family && (ast.family !== 'find' || target === ast.target)) return { draft: current, removed: [] };
  const window = allowed.has('time') ? ast.window : undefined;
  const groupBy = allowed.has('groupby') ? ast.groupBy : undefined;
  const displayUnit = allowed.has('unit') ? ast.displayUnit : undefined;
  if (ast.displayUnit && !displayUnit) removed.push('Unit');
  if (ast.window && !window) removed.push('Time window');
  if (ast.groupBy?.length && !groupBy) removed.push('Group By');
  const join = family === 'find' && ast.family === 'find' && allowed.has('where') ? ast.join : undefined;
  if (ast.join && !join) removed.push('Join');
  if (family === 'aggregate') {
    if (ast.family === 'find' && ast.pipes) removed.push('Presentation pipes');
    return { draft: emit({ family: 'aggregate', raw: '', agg: 'sum', metric: 'tis', filters, window, groupBy: groupBy ?? [], displayUnit }), removed };
  }
  if (ast.family === 'aggregate') {
    removed.push(`Measure ${ast.agg}:${ast.metric}`);
    if (ast.rollup) removed.push('Bucket width');
  }
  return { draft: emit({ family: 'find', raw: '', target, filters, window, groupBy, displayUnit, pipes: ast.family === 'find' ? ast.pipes : undefined, join }), removed };
}

export function resolveQueryDraft(query: string, pendingText = ''): QueryDraft {
  if (!pendingText.trim()) return snapshot(query);
  const text = pendingText.trim();
  const complete = parseQuery(pendingText);
  if (!complete.error || /^(find|sum|avg|min|max|count|last|first|p\d+):/.test(text) || /^[\w-]+:[^{]*\{/.test(text) || /^[:@|]/.test(text)) return snapshot(pendingText);
  const base = snapshot(query);
  if (!base.valid) return snapshot(pendingText);
  if (isPipelineQuery(base.ast)) return snapshot(pendingText);
  if (!isLosslessQuery(base.ast)) return snapshot(query, 'Use Edit WQL for this query.');
  if (/^(last|from)\b/.test(text)) {
    const window = parseQuery(`:note ${text}`);
    if (window.error || !isFindQuery(window) || !window.window) return snapshot(pendingText, window.error ?? 'Invalid time window');
    return emit({ ...base.ast, window: window.window });
  }
  if (/^\$[A-Za-z_][\w-]*$/.test(text)) {
    const paramName = text.slice(1);
    const filters = [...base.ast.filters];
    const filter: TagFilter = {
      kind: 'spreadParam',
      param: paramName,
      key: text,
      negate: false,
      values: [{ value: text, wildcard: false, param: paramName }],
    };
    const index = filters.findIndex((existing) => existing.kind === 'spreadParam' && existing.param === paramName);
    if (index < 0) filters.push(filter);
    else filters[index] = filter;
    return emit({ ...base.ast, filters });
  }
  if (/^!?[\w-]+:/.test(text)) {
    const parsed = parseQuery(`:note{${text}}`);
    if (parsed.error || !isFindQuery(parsed) || !parsed.filters.length) return snapshot(pendingText, parsed.error ?? 'Invalid filter');
    const filters = [...base.ast.filters];
    for (const filter of parsed.filters) {
      const index = filters.findIndex((existing) => existing.key === filter.key);
      if (index < 0) filters.push(filter);
      else filters[index] = filter;
    }
    return emit({ ...base.ast, filters });
  }
  if (/[{}]/.test(text)) return snapshot(pendingText);
  const terms = text.startsWith('"') ? text.slice(1).replace(/"$/, '') : pendingText;
  if (!terms) return base;
  const filters = [...base.ast.filters];
  const filter: TagFilter = { key: 'text', negate: false, values: [{ value: terms, wildcard: false }] };
  const index = filters.findIndex((existing) => existing.key === 'text' && !existing.negate);
  if (index < 0) filters.push(filter);
  else filters[index] = filter;
  return emit({ ...base.ast, filters });
}
