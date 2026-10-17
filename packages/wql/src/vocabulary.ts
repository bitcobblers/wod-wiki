/**
 * WQL vocabulary — the single owner of the WQL dictionary: aggregators,
 * comparison operators, metric families/aggregates, calc.* targets, tag
 * keys, dimensions, rollup periods, grains, sources, scopes, display units,
 * and structural keywords. Every surface that needs these words imports from
 * here (or from language.ts, which re-exports this module for editor
 * consumers) rather than hand-writing its own copy — issue #871.
 *
 * The calc registry's built-in calcs (@bitcobblers/wod-wiki-lang's calc seeds)
 * publish exactly the `calc.*` targets listed in WQL_CALC_TARGETS; keep the
 * two in sync. User-authored calcs extend this set at runtime.
 */

import { KNOWN_OUTPUT_TYPES } from '@bitcobblers/wod-wiki-core';

/** Canonical Metric Key families (CONTEXT.md §Analytics). */
export const WQL_METRIC_FAMILIES = ['reps', 'distance', 'resistance', 'elapsed', 'power', 'pace'] as const;
export type WqlMetricFamily = (typeof WQL_METRIC_FAMILIES)[number];

/** Tier-2 aggregate keys written to the Analytics Store. */
export const WQL_METRIC_AGGREGATES = ['totalVolume', 'totalDistance', 'tis', 'sessionLoad'] as const;
export type WqlMetricAggregate = (typeof WQL_METRIC_AGGREGATES)[number];

/** Aggregate head operators for the analytics grammar (agg:metric{filters}). */
export const WQL_AGGREGATORS = ['sum', 'avg', 'min', 'max', 'count', 'last', 'delta'] as const;
export type WqlAggregator = (typeof WQL_AGGREGATORS)[number];

/** Comparison operators for cross-store `where` joins (#800). */
export const WQL_COMPARISON_OPS = ['>', '>=', '<', '<=', '==', '!='] as const;
export type WqlComparisonOp = (typeof WQL_COMPARISON_OPS)[number];

/** Frontmatter typed-tag keys (CONTEXT.md § Tags) — values are dynamic,
 *  backed by the host's tags store (`by-type` index), not a static enum. */
export const WQL_TYPED_TAG_KEYS = ['domain', 'format', 'equipment', 'quality', 'intent'] as const;
export type WqlTypedTagKey = (typeof WQL_TYPED_TAG_KEYS)[number];

/** Tag keys the Query Service reads off a fact row (QueryService.factTagValue). */
export const WQL_TAG_KEYS = [
  ...WQL_TYPED_TAG_KEYS,
  'effort', 'discipline', 'intensity', 'grade', 'note', 'page', 'origin',
  'grain', 'metric', 'block', 'result', 'tags',
] as const;
export type WqlTagKey = (typeof WQL_TAG_KEYS)[number];

/** Content-plane keys — meaningful only on find:/rows:. On an aggregate
 *  they are a category error (a fact row has no note text or source);
 *  every other non-structural key is a candidate custom dimension. */
export const WQL_CONTENT_ONLY_KEYS = ['type', 'text', 'has', 'source', 'catalog'] as const;

/** Filter keys the effort registry can resolve (runFindEffort) — anything
 *  else on find:effort is ignored and reported as an advisory. */
export const WQL_EFFORT_FILTER_KEYS = ['effort', 'discipline', 'intensity', 'origin', 'text'] as const;

/** Virtual dimensions — time buckets and stream positions, not fact fields. */
export const WQL_VIRTUAL_DIMS = ['day', 'week', 'session', 'round'] as const;
export type WqlVirtualDim = (typeof WQL_VIRTUAL_DIMS)[number];

/**
 * Canonical `calc.*` targets. The single source of truth for the set of
 * calculation metric keys: source for the composer/CM6 typeahead (#871) and
 * the dashboard's known-vs-proposed gate (model.ts). Must
 * match the keys the calc engine registers in
 * @bitcobblers/wod-wiki-lang seeds (`calc.e1rm`, `calc.metMinutes`,
 * `calc.acwr`, `calc.monotony`, `calc.strain`, `calc.ctl`, `calc.atl`,
 * `calc.tsb`, etc.). NOTE: `calc.pmc` (composite {ctl, atl, tsb} series) is
 * deliberately absent — the store calc model publishes one scalar key per
 * definition, so PMC ships as the three loads (#905); a composite stays
 * 'proposed' until a dedicated series widget lands.
 */
export const WQL_CALC_TARGETS = [
  'calc.metMinutes',
  'calc.acwr',
  'calc.monotony',
  'calc.strain',
  'calc.e1rm',
  'calc.ctl',
  'calc.atl',
  'calc.tsb',
  // Wellness + capture metrics (seeds in seeds.ts): soreness/sleep/hrv are
  // user-captured passthroughs; readiness is their composite; mvcBw is
  // hang/%BW; ef is running pace ÷ HR; adherence is sessions ÷ planned;
  // pct1rm is the Epley-inverse intensity; sends count climbing sends.
  'calc.soreness',
  'calc.sleep',
  'calc.hrv',
  'calc.readiness',
  'calc.mvcBw',
  'calc.ef',
  'calc.adherence',
  'calc.pct1rm',
  'calc.sends',
] as const;
export type WqlCalcTarget = (typeof WQL_CALC_TARGETS)[number];

export const WQL_INTENSITY_TIERS = ['low', 'moderate', 'high'] as const;
export type WqlIntensityTier = (typeof WQL_INTENSITY_TIERS)[number];

/** Unified store grains (ticket 003): 'summary' | 'event'. The legacy
 *  'segment' grain was renamed to 'event' (ticket 002); 'rollup' is retired —
 *  rollups are computed at read time via the .rollup suffix, never stored. */
export const WQL_GRAINS = ['summary', 'event'] as const;
export type WqlGrain = (typeof WQL_GRAINS)[number];

/** Content-discovery query targets (find:<target>). */
export const WQL_FIND_TARGETS = ['note', 'block', 'effort', 'session', 'segment', 'event'] as const;
export type WqlFindTarget = (typeof WQL_FIND_TARGETS)[number];

/** Canonical source filter values: the allowed storage locations (the
 *  former `collections` spelling is retired — renamed to feeds; storage
 *  identities keep their `collection:` prefixes). Seed corpus locations
 *  joined the note plane: prebuilt dashboards, the effort library and the
 *  equipment library. */
export const WQL_SOURCE_VALUES = ['journal', 'feeds', 'guides', 'playground', 'dashboards', 'efforts', 'equipment'] as const;
export type WqlSourceValue = (typeof WQL_SOURCE_VALUES)[number];

/** Colon source heads — the unprefixed `:<head>` names. Find targets map
 *  1:1 to the content planes; journal/feed(s)/catalog(s)/playground are
 *  source-scoped note heads (they parse to target 'note' plus an injected
 *  `source:` filter). */
export const WQL_SOURCE_HEADS = [
  'note', 'block', 'effort', 'session', 'segment', 'event',
  'journal', 'feed', 'feeds', 'catalog', 'catalogs', 'playground',
  'dashboard',
] as const;
export type WqlSourceHead = (typeof WQL_SOURCE_HEADS)[number];

/** Storage scope a source-scoped note head binds (undefined = plain target). */
export const WQL_SOURCE_HEAD_SCOPES: Readonly<Record<string, WqlSourceValue>> = {
  journal: 'journal',
  feed: 'feeds',
  feeds: 'feeds',
  catalog: 'feeds',
  catalogs: 'feeds',
  playground: 'playground',
};

/** Type-alias note heads — `:<head>` parses to target 'note' plus an injected
 *  `type:` filter (no storage scope, so the head never narrows by source).
 *  `:dashboard` is the canonical member: dashboards are notes typed
 *  'dashboard', findable with ordinary note tags/text/frontmatter filters. */
export const WQL_TYPE_HEADS: Readonly<Record<string, string>> = {
  dashboard: 'dashboard',
};

/** Former generic `:note` default scope — now EMPTY: the generic note head
 *  is the inclusive note plane (every row). Kept exported (empty) so the
 *  serializer and host surfaces keep a single name for "the default scope",
 *  which no longer narrows anything. */
export const WQL_NOTE_DEFAULT_SOURCES: readonly WqlSourceValue[] = [];

/** Colon function heads — the unprefixed `:<fn>{metric:…}` aggregate stage. */
export const WQL_FUNCTION_HEADS = WQL_AGGREGATORS;
export type WqlFunctionHead = WqlAggregator;

/** Colon chart heads — terminal pipeline sinks (`:timeseries`, `:bar`, …). */
export const WQL_CHART_HEADS = ['timeseries', 'bar', 'table', 'donut', 'toplist', 'value'] as const;
export type WqlChartHead = (typeof WQL_CHART_HEADS)[number];

/** Standard datasets the host registers per page/run before children
 *  evaluate (`@session` active session, `@today` civil-day telemetry+notes). */
export const WQL_STANDARD_DATASETS = ['@session', '@today'] as const;
export type WqlStandardDataset = (typeof WQL_STANDARD_DATASETS)[number];


/** Result planes — `rows:<plane>` narrows raw output-statement rows by the
 *  unified store's promoted `outputType` column. The STORE vocabulary is
 *  open (core KNOWN_OUTPUT_TYPES, ticket 002: unknowns are stored and
 *  returned); the QUERY surface is a closed enum at parse (prototype C7) —
 *  reopening toward a registry is a later, separate decision. Custom types
 *  stay addressable programmatically via hand-built ASTs. */
export const WQL_RESULT_PLANES = KNOWN_OUTPUT_TYPES;
export type WqlResultPlane = (typeof WQL_RESULT_PLANES)[number];

/** Content-specific filter keys (beyond the analytics tag keys). */
export const WQL_CONTENT_FILTER_KEYS = ['type', 'text', 'has', 'source', 'catalog', ...WQL_TAG_KEYS] as const;
export type WqlContentFilterKey = (typeof WQL_CONTENT_FILTER_KEYS)[number];

/**
 * Composer source planes (issue #838, decision #836): the single `source`
 * head slot that pivots the query kind. Content sources compile the `find:`
 * skeleton; `metrics` compiles the aggregate skeleton. `efforts` compiles
 * `find:effort` against the effort registry (origin/intensity/discipline
 * vocab from types.ts). The `results` plane is
 * deliberately absent — it needs new grammar/engine semantics and is
 * deferred to its own ticket.
 */
export const WQL_SOURCES = ['note', 'block', 'effort', 'session', 'segment', 'event'] as const;
export type WqlSource = (typeof WQL_SOURCES)[number];

/** Rollup periods the aggregate grammar accepts (wql.ts: N > 1, unit d|w). */
export const WQL_ROLLUP_PERIODS = ['2w', '4w'] as const;
export type WqlRollupPeriod = (typeof WQL_ROLLUP_PERIODS)[number];

/** Display units the app can render (analytics unit preference, kg/lb). The
 *  `in <unit>` directive accepts any word; these are the canonical options. */
export const WQL_DISPLAY_UNITS = ['kg', 'lb'] as const;
export type WqlDisplayUnit = (typeof WQL_DISPLAY_UNITS)[number];

/** All WQL keywords */
export const WQL_KEYWORDS = [
  'find',
  'rows',
  'where',
  'group',
  'by',
  'order',
  'limit',
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'last',
  'delta',
] as const;
export type WqlKeyword = (typeof WQL_KEYWORDS)[number];
