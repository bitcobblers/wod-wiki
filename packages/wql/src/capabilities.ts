import {
  WQL_CALC_TARGETS,
  WQL_CONTENT_ONLY_KEYS,
  WQL_EFFORT_FILTER_KEYS,
  WQL_METRIC_AGGREGATES,
  WQL_METRIC_FAMILIES,
  WQL_TAG_KEYS,
  WQL_TYPED_TAG_KEYS,
} from './vocabulary';

/**
 * Grouping dimensions the content consumer (stream entryGrouping) applies on
 * top of find results: the note/block/effort/session executors return flat
 * results and the view groups them, ordered and multi-dim. The find tables
 * (segment/event) group inside the executor over selected columns instead.
 */
export const CONTENT_GROUPING_DIMENSIONS = ['date', 'day', 'week', 'month', 'year', 'discipline', 'origin', 'source', 'notebook', 'kind', 'type', 'tag'] as const;

/** Clause types that never name a data field. `metric` is NOT structural:
 *  as a filter key it selects fact rows by their metric (metric:reps); the
 *  guided `metric` clause meaning "measure" is an aggregate-head concern. */
const STRUCTURAL_TYPES: Record<string, true> = { time: true, groupby: true, rollup: true, unit: true, where: true, agg: true };
const FACT_KEYS = WQL_TAG_KEYS.filter(key => key !== 'metric');
/** Table facts filter by real row keys. `tags` is excluded: the table
 *  executor resolves note tags against an empty map, so a tags: filter would
 *  silently match nothing. */
const TABLE_KEYS = WQL_TAG_KEYS.filter(key => key !== 'tags');
const AGGREGATE_TYPES: ReadonlySet<string> = new Set([
  ...FACT_KEYS.map(key => key === 'tags' ? 'tag' : key),
  'time', 'groupby', 'rollup', 'unit', 'where', 'agg', 'metric',
]);
const TARGET_TYPES: Readonly<Record<string, ReadonlySet<string>>> = {
  // The notebook plane IS the note plane (its executor delegates), so both
  // advertise the same member-criteria keys — container criteria (tags:,
  // effort:, typed tags, text:) narrow notebook results, never ignored.
  notebook: new Set(['text', 'notebook', 'tag', 'effort', ...WQL_TYPED_TAG_KEYS, 'type', 'page', 'source', 'note', 'time', 'groupby', 'where']),
  note: new Set(['text', 'notebook', 'tag', 'effort', ...WQL_TYPED_TAG_KEYS, 'type', 'page', 'source', 'note', 'time', 'groupby', 'where']),
  block: new Set(['text', 'notebook', 'tag', 'effort', 'type', 'source', 'note', 'time', 'groupby', 'where']),
  effort: new Set([...WQL_EFFORT_FILTER_KEYS, 'groupby']),
  session: new Set(['result', 'block', 'note', 'plane', 'time', 'groupby']),
  segment: new Set([...TABLE_KEYS, 'time', 'groupby', 'unit']),
  event: new Set([...TABLE_KEYS, 'time', 'groupby', 'unit']),
  // Container planes (ticket 08). `:notebook{}` delegates to the note plane
  // (see the notebook entry above); `:page{}` lists the page placements;
  // `:tag{}` the tags (results are notes); `:equipment{}` the equipment
  // notes. The tag plane's `contributes:` filter matches what a tag
  // contributes — never offered as a `tags:` label filter. These executors
  // return flat rows (no `by {}` grouping), so groupby stays unadvertised.
  page: new Set(['page', 'notebook', 'text', 'note', 'time']),
  tag: new Set(['tag', 'type', 'text', 'contributes', 'time']),
  equipment: new Set(['equipment', 'tags', 'text', 'notebook', 'time']),
};
/** Empty fallback keeps the exported ReadonlySet contract for unknown targets. */
const EMPTY_TYPES: ReadonlySet<string> = new Set();
/** Executor-exact aggregate filter keys. `metric` here is the fact-row
 *  metric filter (`agg:sum{metric:reps}` selects those rows) — the guided
 *  `metric` clause is the measure head, a different slot. `tags` is the AST
 *  key of the canonical `tag` clause. */
const AGGREGATE_KEYS: readonly string[] = WQL_TAG_KEYS;
const TARGET_KEYS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(TARGET_TYPES).map(([target, types]) => [
    target,
    [...types].filter(type => !STRUCTURAL_TYPES[type]).map(type => type === 'tag' ? 'tags' : type),
  ]),
);
/** `round` resolves through custom fact dimensions; absent rows group under
 *  the UNASSIGNED sentinel, matching the open dimension policy. */
const AGGREGATE_DIMENSIONS = ['day', 'week', 'session', 'round', ...WQL_TAG_KEYS];
const TABLE_DIMENSIONS = ['date', 'effort', 'discipline', ...WQL_METRIC_FAMILIES, ...WQL_METRIC_AGGREGATES, ...WQL_CALC_TARGETS];

/** Guided clause types, including structural clauses honored by their consumers. */
export function allowedFilterTypesForTarget(target: string, family: 'find' | 'aggregate'): ReadonlySet<string> {
  return family === 'aggregate' ? AGGREGATE_TYPES : TARGET_TYPES[target] ?? EMPTY_TYPES;
}

/** Suggested filter keys. Fact-backed queries also accept custom dimension keys. */
export function wqlFilterKeys(target: string, family: 'find' | 'aggregate'): readonly string[] {
  return family === 'aggregate' ? AGGREGATE_KEYS : TARGET_KEYS[target] ?? [];
}

/** Content grouping is applied by the stream consumer; table grouping reads
 *  selected columns. Effort/session have no executor grouping but their views
 *  group content (the effort view profile groups by discipline). */
export function wqlGroupingDimensions(target: string, family: 'find' | 'aggregate'): readonly string[] {
  if (family === 'aggregate') return AGGREGATE_DIMENSIONS;
  if (target === 'segment' || target === 'event') return TABLE_DIMENSIONS;
  return CONTENT_GROUPING_DIMENSIONS;
}

/** Fact dimensions are open, but content-only fields and plane have no fact meaning. */
export function supportsWqlFilterKey(target: string, family: 'find' | 'aggregate', rawKey: string): boolean {
  const key = rawKey === 'tag' ? 'tags' : rawKey;
  if (family === 'aggregate' || target === 'segment' || target === 'event') {
    return !(WQL_CONTENT_ONLY_KEYS as readonly string[]).includes(key)
      && key !== 'plane'
      && !(family === 'find' && key === 'tags');
  }
  return wqlFilterKeys(target, family).includes(key);
}
