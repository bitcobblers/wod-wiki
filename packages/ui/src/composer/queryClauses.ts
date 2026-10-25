/**
 * The WqlComposer pill vocabulary — types, metadata, and option lists.
 * Compilation and restore live in `./queryAst` (ticket 013): composer state
 * is the C6 AST; strings are produced only through the engine serializer.
 *
 * Canonical structure (work item 3): a query has a `kind` (find documents vs
 * measure numbers), a singular `target` (colon `<target>` head), and an optional
 * `source` storage scope (`Where stored` — WQL_SOURCE_VALUES; all sources =
 * no source filter). Filter capability sets mirror what the QueryService
 * executors actually apply — parser acceptance alone never advertises a
 * clause (`has:` parses but no executor applies it, so it is not offered).
 *
 * Static option lists live here; dynamic typeahead data sources live in
 * ./suggestionSources (issue #831). All vocab is sourced from the canonical
 * modules (@bitcobblers/wod-wiki-wql) — never hardcoded in the composer (decision #824).
 *
 * Supports freeform token slots, placeholder guidance, and keyboard navigation.
 */

import { composerRegistry } from './ComposerRegistry';
import {
  allowedFilterTypesForTarget,
  CONTENT_GROUPING_DIMENSIONS,
  WQL_AGGREGATORS,
  WQL_CALC_TARGETS,
  WQL_DISPLAY_UNITS,
  WQL_FIND_TARGETS,
  WQL_METRIC_AGGREGATES,
  WQL_METRIC_FAMILIES,
  WQL_RESULT_PLANES,
  WQL_SOURCE_VALUES,
  WQL_TAG_KEYS,
  WQL_VIRTUAL_DIMS,
} from '@bitcobblers/wod-wiki-wql';

export { allowedFilterTypesForTarget, CONTENT_GROUPING_DIMENSIONS };

export type ClauseType =
  | 'kind'
  | 'target'
  | 'source'
  | 'text'
  | 'catalog'
  | 'notebook'
  | 'tag'
  | 'effort'
  | 'domain'
  | 'format'
  | 'equipment'
  | 'quality'
  | 'intent'
  | 'discipline'
  | 'intensity'
  | 'origin'
  | 'type'
  | 'time'
  | 'where'
  | 'agg'
  | 'metric'
  | 'groupby'
  | 'rollup'
  | 'unit'
  | 'result'
  | 'block'
  | 'note'
  | 'page'
  | 'plane'
  | 'pipes';

export interface QueryClause {
  id: string;
  /** Built-in ClauseType or a custom slot type id from the ComposerRegistry. */
  type: string;
  label: string;
  value: string;
  inputType?: 'radio' | 'freetext' | 'select';
  placeholder?: string;
  icon?: string;
  prefix?: string;
  /** Index into the parsed AST's global filters array (ast.filters[filterIndex])
   *  — identifies one specific filter occurrence; editing one occurrence must
   *  never merge or rewrite another. */
  filterIndex?: number;
  /** True when this filter occurrence is negated (`!key:value`). */
  negate?: boolean;
}

// ── Canonical kind / target / scope options ────────────────────────────────

/** Query shape: `find` compiles the colon `<target>` skeleton (`:note{…}`),
 *  `aggregate` compiles `agg:metric{filters} by {dims}` and exposes agg/metric. */
export const KIND_OPTIONS = [
  { value: 'find', label: 'Find', description: 'Find things: notes, blocks, efforts, sessions, tables' },
  { value: 'aggregate', label: 'Measure', description: 'Measure numbers: aggregate a metric by dimensions' },
];

/** Singular find targets — the colon `<target>` head (C7 closed enum). */
export const TARGET_OPTIONS = WQL_FIND_TARGETS.map((t) => ({
  value: t,
  label: t.charAt(0).toUpperCase() + t.slice(1),
  description: {
    note: 'Find notes across journal, notebooks and playground',
    block: 'Find fenced workout/dashboard regions',
    effort: 'Find registered movements and benchmarks',
    session: 'Find completed workout sessions',
    segment: 'Cross-workout segment table',
    event: 'Telemetry events table',
  }[t],
}));

/** Storage scopes — the `source:` filter values (`Where stored`). All
 *  sources means no source filter at all.
 *
 *  The `feeds` value here is a CONTAINER scope (the notes a feed publishes),
 *  not the feed-source vocabulary: it selects the notes, not the sources.
 *  Renaming it to the source sense belongs to the contract ticket, not here. */
export const SOURCE_OPTIONS = WQL_SOURCE_VALUES.map((s) => ({
  value: s,
  label: s.charAt(0).toUpperCase() + s.slice(1),
  description: ({
    journal: 'Daily journal notes',
    feeds: 'Notebook notes',
    guides: 'Static guide pages',
    playground: 'Playground scratch pages',
    dashboards: 'Dashboard notes',
    efforts: 'Exercise library notes',
    equipment: 'Equipment library notes',
  } as Record<string, string>)[s],
}));

/** Output-statement planes for `plane:` on `:session` (executor narrows
 *  events by the promoted `outputType` column). */
export const PLANE_OPTIONS = WQL_RESULT_PLANES.map((v) => ({ value: v, label: v }));


// ── Options & Data Sources ──────────────────────────────────────────────────

export const TIME_OPTIONS = [
  { value: 'last 1d', label: 'Past 24 hours' },
  { value: 'last 1w', label: 'Past week' },
  { value: 'last 2w', label: 'Past 2 weeks' },
  { value: 'last 4w', label: 'Past month' },
  { value: 'last 12w', label: 'Past quarter' },
  { value: 'last 52w', label: 'Past year' },
  { value: 'all', label: 'All time' },
];

/** Aggregate head vocab — canonical homes (decision #824). */
export const AGG_OPTIONS = WQL_AGGREGATORS.map((v) => ({ value: v, label: v }));
/** Multi-unit bucket widths — parse accepts any `N>1` + d|w (single-unit
 *  day/week grouping is `by {day}`/`by {week}`, never `.rollup(1w)`); the
 *  list is common suggestions, typed widths are parser-validated. */
export const ROLLUP_OPTIONS = [
  { value: '2d', label: '2 days' },
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
  { value: '2w', label: '2 weeks' },
  { value: '4w', label: '4 weeks' },
  { value: '12w', label: '12 weeks' },
  { value: '26w', label: '26 weeks' },
  { value: '52w', label: '52 weeks' },
];
export const GROUPBY_OPTIONS = [...WQL_VIRTUAL_DIMS, ...WQL_TAG_KEYS].map((v) => ({ value: v, label: v }));
export const METRIC_OPTIONS = [...WQL_METRIC_AGGREGATES, ...WQL_METRIC_FAMILIES, ...WQL_CALC_TARGETS]
  .map((v) => ({ value: v, label: v }));
export const UNIT_OPTIONS = WQL_DISPLAY_UNITS.map((v) => ({ value: v, label: v }));

/**
 * Where-join editor vocab — the same source of truth the analytics composer
 * completes against (src/parser/wql-language.ts, aggregators from the AST
 * contract in services/analytics/query/wql.ts). Issue #831.
 */
export const WHERE_AGGREGATORS: readonly string[] = WQL_AGGREGATORS;
export const WHERE_METRICS: readonly string[] = [...WQL_METRIC_AGGREGATES, ...WQL_METRIC_FAMILIES, ...WQL_CALC_TARGETS];

// ── Metadata ────────────────────────────────────────────────────────────────

export interface ClauseMeta {
  label: string;
  inputType: 'radio' | 'freetext' | 'select';
  placeholder: string;
  placeholderText: string;
  icon: string;
  description: string;
  prefix?: string;
  required?: boolean;
}

/** Structural pills seeded onto every query (queryAst seeding) — they clear
 *  back to an empty value instead of being removed. */
export const CLEAR_ONLY_TYPES: Record<string, true> = { source: true, time: true };

export const CLAUSE_META: Record<ClauseType, ClauseMeta> = {
  kind:      { label: 'Kind',       inputType: 'radio',    placeholder: 'find, measure…',              placeholderText: 'Find | Measure',         icon: '🧭', description: 'Find things or measure numbers' },
  target:    { label: 'Find',       inputType: 'select',   placeholder: 'note, block, effort…',        placeholderText: ': [target]',             icon: '🎯', description: 'What to find — singular', prefix: ':' },
  source:    { label: 'Where stored', inputType: 'select', placeholder: 'journal, notebooks…',      placeholderText: 'source: [scope]',        icon: '🌐', description: 'Storage scope — all sources means no scope', prefix: 'source:' },
  text:      { label: 'Contains',   inputType: 'freetext', placeholder: 'Text query...',              placeholderText: 'text: [query]',           icon: '🔍', description: 'Raw text substring search', prefix: 'text:' },
  catalog:   { label: 'Catalog',    inputType: 'select',   placeholder: 'crossfit-games, hyrox...',    placeholderText: 'catalog: [directory-id]', icon: '📓', description: 'Filter by catalog directory id, e.g. crossfit-games', prefix: 'catalog:' },
  notebook:  { label: 'Notebook',   inputType: 'select',   placeholder: 'Pick notebook...',           placeholderText: 'notebook: [id]',         icon: '📓', description: 'Filter by canonical notebook container id, e.g. notebook/journal, notebook/playground, notebook/guides', prefix: 'notebook:' },
  tag:       { label: 'Tag',        inputType: 'select',   placeholder: 'Pick tag...',                placeholderText: 'tags: [tag]',            icon: '🏷', description: 'Filter by note/workout tags', prefix: 'tags:' },
  effort:    { label: 'Effort',     inputType: 'select',   placeholder: 'Pick effort...',             placeholderText: 'effort: [movement]',     icon: '💪', description: 'Filter by movement/workout', prefix: 'effort:' },
  domain:    { label: 'Domain',     inputType: 'select',   placeholder: 'crossfit, parkour, swimming…',placeholderText: 'domain: [discipline]',   icon: '🌐', description: 'Filter by sport/training domain', prefix: 'domain:' },
  format:    { label: 'Format',     inputType: 'select',   placeholder: 'for-time, amrap, emom…',      placeholderText: 'format: [shape]',        icon: '⏱', description: 'Filter by session time structure', prefix: 'format:' },
  equipment: { label: 'Equipment',  inputType: 'select',   placeholder: 'kettlebell, barbell…',        placeholderText: 'equipment: [gear]',      icon: '🏋', description: 'Filter by required gear', prefix: 'equipment:' },
  quality:   { label: 'Quality',    inputType: 'select',   placeholder: 'strength, conditioning…',     placeholderText: 'quality: [stimulus]',    icon: '⚡', description: 'Filter by physical stimulus', prefix: 'quality:' },
  intent:    { label: 'Intent',     inputType: 'select',   placeholder: 'benchmark, competition…',     placeholderText: 'intent: [tier]',         icon: '🎯', description: 'Filter by protocol status', prefix: 'intent:' },
  discipline:{ label: 'Discipline', inputType: 'select',   placeholder: 'Pick discipline...',         placeholderText: 'discipline: [name]',     icon: '⚙', description: 'Filter by domain discipline', prefix: 'discipline:' },
  intensity: { label: 'Intensity',  inputType: 'select',   placeholder: 'low, moderate, high…',       placeholderText: 'intensity: [tier]',      icon: '🔥', description: 'Effort intensity tier', prefix: 'intensity:' },
  origin:    { label: 'Origin',     inputType: 'select',   placeholder: 'bundled, user…',             placeholderText: 'origin: [registry]',     icon: '🔖', description: 'Effort registry origin', prefix: 'origin:' },
  type:      { label: 'Block Type', inputType: 'select',   placeholder: 'wod, dashboard...',          placeholderText: 'type: [wod|heading]',    icon: '📦', description: 'Fenced block type', prefix: 'type:' },
  time:      { label: 'Time Window',inputType: 'select',   placeholder: 'Time range',                 placeholderText: 'last: [time range]',      icon: '⏱', description: 'Date window (last Nw/Nd)', prefix: 'last:' },
  where:     { label: 'Metric Join',inputType: 'freetext', placeholder: 'sum:totalVolume{} > 5000',    placeholderText: 'where: [metric join]',   icon: '📊', description: 'Cross-store analytics join', prefix: 'where:' },
  agg:       { label: 'Aggregate',  inputType: 'select',   placeholder: 'sum, avg…',                  placeholderText: 'agg: [sum|avg|…]',        icon: '∑', description: 'Aggregation function' },
  metric:    { label: 'Metric',     inputType: 'select',   placeholder: 'totalVolume, reps…',         placeholderText: 'metric: [key]',           icon: '📈', description: 'Canonical metric key to aggregate' },
  groupby:   { label: 'Group By',   inputType: 'select',   placeholder: 'week, effort…',              placeholderText: 'by: [dim]',               icon: '🗂', description: 'Group results by dimension' },
  rollup:    { label: 'Rollup',     inputType: 'select',   placeholder: '2w, 4w, 12w…',               placeholderText: 'rollup: [period]',        icon: '🗓', description: 'Multi-unit bucket period (by {week}/by {day} for 1-unit)' },
  unit:      { label: 'Unit',       inputType: 'select',   placeholder: 'kg, lb, km…',                placeholderText: 'in: [unit]',              icon: '📏', description: 'Display unit directive' },
  result:    { label: 'Session',    inputType: 'freetext', placeholder: 'result id…',                  placeholderText: 'result: [id]',            icon: '🏁', description: 'Scope to one workout session', prefix: 'result:' },
  block:     { label: 'Block',      inputType: 'freetext', placeholder: 'block content id…',           placeholderText: 'block: [contentId]',      icon: '🧱', description: 'Scope to all versions of a block', prefix: 'block:' },
  note:      { label: 'Note',       inputType: 'freetext', placeholder: 'note id…',                    placeholderText: 'note: [id]',              icon: '📓', description: 'Scope to one note', prefix: 'note:' },
  page:      { label: 'Page',       inputType: 'select',   placeholder: 'true, false…',                placeholderText: 'page: [true|false]',      icon: '📄', description: 'Notes that are (or are not) pages', prefix: 'page:' },
  plane:     { label: 'Output Plane',inputType: 'select',   placeholder: 'segment, load, event…',       placeholderText: 'plane: [type]',           icon: '📋', description: 'Output-statement plane on :session', prefix: 'plane:' },
  pipes:     { label: 'Pipes',      inputType: 'freetext', placeholder: '| order by date | limit 10',  placeholderText: '| select | order | limit', icon: '⇥', description: 'Presentation pipes — select/order/limit/offset' },
};

const CUSTOM_FALLBACK_ICON = '\u{1F9E9}';

/**
 * Metadata lookup for pills, popovers, and menus: built-in clauses come from
 * CLAUSE_META; custom slot types resolve through the ComposerRegistry;
 * anything else gets a generic fallback so a stale clause still renders.
 */
export function getClauseMeta(type: string): ClauseMeta {
  const builtin = (CLAUSE_META as Record<string, ClauseMeta>)[type];
  if (builtin) return builtin;
  const custom = composerRegistry.getSlot(type);
  if (custom) {
    return {
      label: custom.label,
      inputType: 'freetext',
      placeholder: custom.placeholder,
      placeholderText: custom.placeholderText,
      icon: custom.icon,
      description: custom.description ?? '',
    };
  }
  return {
    label: type,
    inputType: 'freetext',
    placeholder: `${type}...`,
    placeholderText: `${type}: [value]`,
    icon: CUSTOM_FALLBACK_ICON,
    description: '',
  };
}
