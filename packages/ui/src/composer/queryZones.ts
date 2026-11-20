import {
  isAggregateQuery,
  isFindQuery,
  isPipelineQuery,
  parseQuery,
  supportsWqlFilterKey,
  type AnyParsedQuery,
} from '@bitcobblers/wod-wiki-wql';
import { composerRegistry } from './ComposerRegistry';
import { getClauseMeta, type QueryClause } from './queryClauses';

export type QueryZone = 'what' | 'where' | 'when' | 'group';

export const ZONE_ORDER: readonly QueryZone[] = ['what', 'where', 'when', 'group'];

export const ZONE_META: Record<QueryZone, { label: string; hint: string }> = {
  what: { label: 'WHAT', hint: 'Target or metric' },
  where: { label: 'WHERE', hint: 'Filters & scope' },
  when: { label: 'WHEN', hint: 'Date window' },
  group: { label: 'GROUP', hint: 'Buckets & units' },
};

export interface EnrichedQueryClause extends QueryClause {
  zone: QueryZone;
  invalid?: boolean;
  invalidReason?: string;
}

export interface ImplicitSlot {
  type: 'time' | 'groupby';
  zone: 'when' | 'group';
  label: string;
  placeholder: string;
}

export interface ScopeZoneModel {
  zone: QueryZone;
  label: string;
  hint: string;
  clauses: EnrichedQueryClause[];
  implicitSlots: ImplicitSlot[];
}

export interface AddableFilterOption {
  type: string;
  label: string;
  description: string;
  prefix: string;
}

export interface AddableFilterGroup {
  group: string;
  items: AddableFilterOption[];
}

const WHAT_TYPES = new Set(['kind', 'target', 'agg', 'metric']);
const GROUP_TYPES = new Set(['groupby', 'rollup', 'unit', 'where', 'pipes']);

/** Map a composer clause type onto its canonical WQL grammar zone. */
export function getClauseZone(type: string): QueryZone {
  if (WHAT_TYPES.has(type)) return 'what';
  if (type === 'time') return 'when';
  if (GROUP_TYPES.has(type)) return 'group';
  return 'where';
}

const FILTER_TYPE_TO_KEY: Record<string, string> = { tag: 'tags' };

/** Check whether a filter pill is honored by the current query target. */
export function getClauseSupportError(
  clause: QueryClause,
  ast: AnyParsedQuery,
): string | undefined {
  if (clause.filterIndex === undefined || isPipelineQuery(ast)) return undefined;
  if (clause.type === 'scope' || clause.value.startsWith('$') || composerRegistry.getSlot(clause.type)) {
    return undefined;
  }
  const key = FILTER_TYPE_TO_KEY[clause.type] ?? clause.type;
  const target = isFindQuery(ast) ? ast.target : '';
  if (supportsWqlFilterKey(target, ast.family, key)) return undefined;
  const targetLabel = isFindQuery(ast) ? `:${ast.target}` : 'aggregate';
  return `Filter "${key}" is ignored on ${targetLabel} queries`;
}

/** Group visible composer pills into WHAT / WHERE / WHEN / GROUP zones with explicit implicit slots. */
export function buildScopeZones(
  pills: readonly QueryClause[],
  ast: AnyParsedQuery,
  allowed: ReadonlySet<string>,
  hiddenTypes: ReadonlySet<string>,
): ScopeZoneModel[] {
  const buckets: Record<QueryZone, EnrichedQueryClause[]> = {
    what: [],
    where: [],
    when: [],
    group: [],
  };

  for (const pill of pills) {
    if (hiddenTypes.has(pill.type)) continue;
    const zone = getClauseZone(pill.type);
    const invalidReason = getClauseSupportError(pill, ast);
    buckets[zone].push({
      ...pill,
      zone,
      invalid: Boolean(invalidReason),
      invalidReason,
    });
  }

  const hasTime = buckets.when.length > 0;
  const hasGroup = buckets.group.some((c) => c.type === 'groupby');

  return ZONE_ORDER.map((zone) => {
    const implicitSlots: ImplicitSlot[] = [];
    if (zone === 'when' && !hasTime && allowed.has('time') && !hiddenTypes.has('time')) {
      implicitSlots.push({
        type: 'time',
        zone: 'when',
        label: 'Window',
        placeholder: 'Any time',
      });
    }
    if (zone === 'group' && !hasGroup && allowed.has('groupby') && !hiddenTypes.has('groupby')) {
      implicitSlots.push({
        type: 'groupby',
        zone: 'group',
        label: 'Group by',
        placeholder: 'No grouping',
      });
    }
    return {
      zone,
      label: ZONE_META[zone].label,
      hint: ZONE_META[zone].hint,
      clauses: buckets[zone],
      implicitSlots,
    };
  });
}

const SCOPE_CATALOG_TYPES = new Set(['source', 'notebook', 'tag', 'feed', 'subscribed', 'page', 'scope']);
const SHAPE_CATALOG_TYPES = new Set(['time', 'groupby', 'rollup', 'unit', 'where', 'pipes']);

/** Group allowed clause types into <=4-item scannable categories for the + Filter catalog. */
export function buildAddableFilterGroups(
  candidateTypes: readonly string[],
  search: string,
  customSlotTypes: ReadonlySet<string> = new Set(),
): AddableFilterGroup[] {
  const needle = search.trim().toLowerCase();
  const buckets: Record<string, AddableFilterOption[]> = {
    Scope: [],
    Training: [],
    Shape: [],
    Custom: [],
  };

  for (const type of candidateTypes) {
    if (WHAT_TYPES.has(type)) continue;
    const meta = getClauseMeta(type);
    if (
      needle &&
      !type.toLowerCase().includes(needle) &&
      !meta.label.toLowerCase().includes(needle) &&
      !meta.description.toLowerCase().includes(needle)
    ) {
      continue;
    }
    const item: AddableFilterOption = {
      type,
      label: meta.label,
      description: meta.description,
      prefix: meta.prefix ?? `${type}:`,
    };
    if (customSlotTypes.has(type)) buckets.Custom.push(item);
    else if (SCOPE_CATALOG_TYPES.has(type)) buckets.Scope.push(item);
    else if (SHAPE_CATALOG_TYPES.has(type)) buckets.Shape.push(item);
    else buckets.Training.push(item);
  }

  return (['Scope', 'Training', 'Shape', 'Custom'] as const)
    .map((group) => ({ group, items: buckets[group] }))
    .filter((g) => g.items.length > 0);
}

const TARGET_PLURAL: Record<string, string> = {
  note: 'Notes',
  block: 'Blocks',
  effort: 'Efforts',
  session: 'Sessions',
  segment: 'Segments',
  event: 'Events',
  notebook: 'Notebooks',
  page: 'Pages',
  tag: 'Tags',
  equipment: 'Equipment',
  feed: 'Feeds',
};

function formatWindowSummary(wqlWindow: { kind: string; size?: number; unit?: string; param?: string; start?: string; end?: string }): string {
  if (wqlWindow.kind === 'relative' && wqlWindow.size && wqlWindow.unit) {
    return `Last ${wqlWindow.size}${wqlWindow.unit}`;
  }
  if (wqlWindow.kind === 'param' && wqlWindow.param) {
    return `Last $${wqlWindow.param}`;
  }
  if (wqlWindow.start) {
    return wqlWindow.end ? `${wqlWindow.start} – ${wqlWindow.end}` : `From ${wqlWindow.start}`;
  }
  return '';
}

/** Format a WQL expression into a concise, gym-floor-readable summary for the mobile dock. */
export function formatHumanQuerySummary(wql: string, fallback = 'Filter or search…'): string {
  const trimmed = wql.trim();
  if (!trimmed) return fallback;
  const ast = parseQuery(trimmed);
  if (ast.error) return trimmed;
  if (isPipelineQuery(ast)) {
    const src =
      ast.source.kind === 'dataset'
        ? `@${ast.source.name}`
        : isFindQuery(ast.source.query)
          ? `:${ast.source.query.target}`
          : `${ast.source.query.agg}:${ast.source.query.metric}`;
    return `${src} pipeline`;
  }

  const parts: string[] = [];
  if (isAggregateQuery(ast)) {
    parts.push(`${ast.agg.toUpperCase()} ${ast.metricParam ? `$${ast.metricParam}` : ast.metric}`);
  } else if (isFindQuery(ast)) {
    const nb = ast.filters.find((f) => (f.key === 'notebook' || f.key === 'source') && !f.negate);
    const nbVal = nb?.values.map((v) => (v.wildcard && !v.value ? 'All notebooks' : `${v.value}${v.wildcard ? '*' : ''}`)).join(' | ');
    parts.push(nbVal ? (nbVal === 'All notebooks' ? nbVal : nbVal.charAt(0).toUpperCase() + nbVal.slice(1)) : (TARGET_PLURAL[ast.target] ?? ast.target));
  }

  const shownFilters = ast.filters
    .filter((f) => isAggregateQuery(ast) || (f.key !== 'notebook' && f.key !== 'source'))
    .slice(0, 2);
  for (const f of shownFilters) {
    const vals = f.values.map((v) => (v.wildcard && !v.value ? '*' : `${v.value}${v.wildcard ? '*' : ''}`)).join('|');
    parts.push(`${f.negate ? 'not ' : ''}${f.key === 'text' ? `"${vals}"` : vals}`);
  }
  if (ast.filters.length > shownFilters.length + (isFindQuery(ast) && ast.filters.some((f) => f.key === 'notebook' || f.key === 'source') ? 1 : 0)) {
    parts.push(`+${ast.filters.length - shownFilters.length} more`);
  }

  if (ast.window) {
    const win = formatWindowSummary(ast.window);
    if (win) parts.push(win);
  }
  if (ast.groupBy?.length) {
    parts.push(`By ${ast.groupBy.join(', ')}`);
  }
  return parts.join(' · ') || trimmed;
}
