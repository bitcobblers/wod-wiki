/**
 * Analytics gallery manifest — the typed card array the curated sections
 * render from (wayfinder map: analytics-widget-gallery, ticket 003/008).
 *
 * Coverage is enforced mechanically by `test/galleryManifest.test.ts`:
 * every DASHBOARD_WIDGET_TYPE, all 7 aggregators, all rollup periods, all
 * four journals, and the units axis (≥1 `preferredUnit` card) must appear
 * here. The human-readable mirror lives in
 * `docs/wayfinder/analytics-widget-gallery/assets/003-gallery-architecture-and-coverage-manifest.md`.
 *
 * Card dispatch follows the real Dashboard Note contract: `body` is one
 * Query Document body (decision 22 — no positional split), the declared
 * `widgetType` rides the fence-tag suffix (parseQueryWidgetSuffix), and
 * WidgetChart renders the parsed type + params.
 */
import type { JournalKey } from './journals';

export type GallerySection =
  | 'auto'
  | 'value'
  | 'timeseries'
  | 'bar'
  | 'donut'
  | 'toplist'
  | 'stacked-bar'
  | 'goal-rings'
  | 'zone-distribution'
  | 'table'
  | 'rows'
  | 'find'
  | 'edge';

export type PreferredUnit = 'kg' | 'lb';

export interface GalleryCardDef {
  section: GallerySection;
  /** Declared widget type (fence-tag value); 'auto' renders via useChartShape. */
  widgetType: string;
  title: string;
  /** Coaching question — Dashboard Note anatomy, shown under the title. */
  question: string;
  journal: JournalKey;
  query: string;
  /** Positional params after the `/` in the block body (goal target, zone split). */
  params?: string[];
  /** Executor-level display unit; conversion is family-scoped (kg↔lb, m↔km). */
  preferredUnit?: PreferredUnit;
  /** True for queries that are expected to produce a parse error. */
  expectError?: boolean;
  /** True for cards simulating an in-flight / loading query. */
  simulateLoading?: boolean;
}

export const SECTION_ORDER: GallerySection[] = [
  'auto',
  'value',
  'timeseries',
  'bar',
  'donut',
  'toplist',
  'stacked-bar',
  'goal-rings',
  'zone-distribution',
  'table',
  'rows',
  'find',
  'edge',
];

export const SECTION_META: Record<GallerySection, { title: string; blurb: string }> = {
  auto: {
    title: 'Auto Inference',
    blurb:
      'No declared type — useChartShape picks the widget from the result shape alone (scalar → value, multi-point → timeseries, else bars). Auto cannot produce a stacked-bar; that is why declared types exist.',
  },
  value: {
    title: 'Value',
    blurb: 'Scalar aggregators: avg, min, max, last, delta, sum — plus the kg/lb unit pair.',
  },
  timeseries: {
    title: 'Timeseries',
    blurb: 'Time-bucketed series: unrolled, by {day}, by {week}, and the calc.* weekly line.',
  },
  bar: {
    title: 'Bar',
    blurb: 'Single-bucket group-bys by tag dimension.',
  },
  donut: {
    title: 'Donut',
    blurb: 'Share of a whole across a dimension.',
  },
  toplist: {
    title: 'Top List',
    blurb: 'Rankings — grade groups and the 18-session note dimension, limit 6.',
  },
  'stacked-bar': {
    title: 'Stacked Bar',
    blurb: 'Intensity tiers over weekly rollups — climb is the only 3-tier journal.',
  },
  'goal-rings': {
    title: 'Goal Rings',
    blurb: 'Last point vs a target param (the / positional body param).',
  },
  'zone-distribution': {
    title: 'Zone Distribution',
    blurb: 'Actual vs zone targets — the 70/20/10 polarized split as body params.',
  },
  table: {
    title: 'Table',
    blurb: 'WqlTable renders whatever shape the query returns: grouped rows or time buckets.',
  },
  rows: {
    title: 'Rows & Find',
    blurb:
      'The non-aggregate query families. rows:{scope} returns raw output-statement runs (RowsTable) — the drill-down behind the aggregates; :{target} does content discovery over notes, the derived block index, and the bundled effort registry.',
  },
  find: {
    title: 'Find',
    blurb:
      'Content discovery: :note over journal notes, :block over the derived block index (rawContent = note title), :effort over the bundled effort registry.',
  },
  edge: {
    title: 'Edge States',
    blurb:
      'Empty results, malformed WQL parse errors, and in-flight query states produced live through the round trip — never from static fixtures.',
  },
};

export const GALLERY_CARDS: GalleryCardDef[] = [
  // ── Auto Inference — WQL decides alone ────────────────────────────────
  { section: 'auto', widgetType: 'auto', title: 'Average TIS', question: 'How hard?', journal: 'crossfit', query: 'avg:tis{}' },
  { section: 'auto', widgetType: 'auto', title: 'Session load by effort', question: 'Which move dominates?', journal: 'crossfit', query: 'sum:sessionLoad{} by {effort}' },
  { section: 'auto', widgetType: 'auto', title: 'Weekly strain', question: 'Is load accumulating?', journal: 'crossfit', query: 'sum:calc.strain{} by {week}' },
  { section: 'auto', widgetType: 'auto', title: 'Load by intensity over time', question: 'Polarized training?', journal: 'climb', query: 'sum:sessionLoad{} by {intensity, week}' },

  // ── Value — scalar aggregators + units pair ───────────────────────────
  { section: 'value', widgetType: 'value', title: 'Average sleep', question: 'Restored?', journal: 'wellness', query: 'avg:sleep{}' },
  { section: 'value', widgetType: 'value', title: 'Easiest session', question: 'The floor?', journal: 'crossfit', query: 'min:tis{}' },
  { section: 'value', widgetType: 'value', title: 'Hardest session', question: 'The ceiling?', journal: 'crossfit', query: 'max:tis{}' },
  { section: 'value', widgetType: 'value', title: 'Latest tonnage', question: 'Where am I now?', journal: 'crossfit', query: 'last:totalVolume{}' },
  { section: 'value', widgetType: 'value', title: 'Session load trend', question: 'Rising or falling?', journal: 'endurance', query: 'delta:sessionLoad{}' },
  { section: 'value', widgetType: 'value', title: 'Total ACWR', question: 'Overreaching?', journal: 'crossfit', query: 'sum:calc.acwr{}' },
  { section: 'value', widgetType: 'value', title: 'Total tonnage', question: 'How much iron? (renders lb — first source unit)', journal: 'crossfit', query: 'sum:totalVolume{}' },
  { section: 'value', widgetType: 'value', title: 'Total tonnage (kg)', question: 'Same query, preferred unit kg', journal: 'crossfit', query: 'sum:totalVolume{}', preferredUnit: 'kg' },

  // ── Timeseries ────────────────────────────────────────────────────────
  { section: 'timeseries', widgetType: 'timeseries', title: 'Weekly tonnage', question: 'Rising?', journal: 'crossfit', query: 'sum:totalVolume{} by {week}' },
  { section: 'timeseries', widgetType: 'timeseries', title: 'Daily distance', question: 'Consistent?', journal: 'endurance', query: 'sum:distance{} by {day}' },
  { section: 'timeseries', widgetType: 'timeseries', title: 'Weekly strain', question: 'Accumulating?', journal: 'crossfit', query: 'sum:calc.strain{} by {week}' },

  // ── Bar ───────────────────────────────────────────────────────────────
  { section: 'bar', widgetType: 'bar', title: 'Volume by effort', question: 'Which move?', journal: 'crossfit', query: 'sum:totalVolume{} by {effort}' },
  { section: 'bar', widgetType: 'bar', title: 'Distance by discipline', question: 'Where do the miles go?', journal: 'endurance', query: 'sum:distance{} by {discipline}' },

  // ── Donut ─────────────────────────────────────────────────────────────
  { section: 'donut', widgetType: 'donut', title: 'Volume by effort', question: 'Which move dominates the whole?', journal: 'crossfit', query: 'sum:totalVolume{} by {effort}' },
  { section: 'donut', widgetType: 'donut', title: 'Load by intensity', question: 'How polarized is the share?', journal: 'climb', query: 'sum:tis{} by {intensity}' },

  // ── Top List ──────────────────────────────────────────────────────────
  { section: 'toplist', widgetType: 'toplist', title: 'Sends by grade', question: 'Which grade sends most?', journal: 'climb', query: 'count:calc.sends{} by {grade}' },
  { section: 'toplist', widgetType: 'toplist', title: 'Volume by session', question: 'Which session was biggest?', journal: 'crossfit', query: 'sum:totalVolume{} by {note}' },

  // ── Stacked Bar ───────────────────────────────────────────────────────
  { section: 'stacked-bar', widgetType: 'stacked-bar', title: 'Load by intensity', question: 'Polarized?', journal: 'climb', query: 'sum:tis{} by {intensity, week}' },

  // ── Goal Rings — target rides the / param ─────────────────────────────
  { section: 'goal-rings', widgetType: 'goal-rings', title: 'Sends vs target', question: 'Hit 10 sends?', journal: 'climb', query: 'sum:calc.sends{}', params: ['10'] },
  { section: 'goal-rings', widgetType: 'goal-rings', title: 'Sleep vs 8h', question: 'Resting enough?', journal: 'wellness', query: 'avg:sleep{}', params: ['8'] },

  // ── Zone Distribution — zone targets ride the / params ────────────────
  { section: 'zone-distribution', widgetType: 'zone-distribution', title: 'Load distribution', question: 'Polarized 70/20/10?', journal: 'climb', query: 'sum:tis{} by {intensity, week}', params: ['70', '20', '10'] },

  // ── Table ─────────────────────────────────────────────────────────────
  { section: 'table', widgetType: 'table', title: 'Load by effort', question: 'The breakdown, as rows', journal: 'crossfit', query: 'sum:sessionLoad{} by {effort}' },
  { section: 'table', widgetType: 'table', title: 'Weekly tonnage', question: 'The trend, as rows', journal: 'crossfit', query: 'sum:totalVolume{} by {week}' },

  // ── Rows — raw statement runs through the real RowsTable ──────────────
  { section: 'rows', widgetType: 'rows', title: 'Fran session statements', question: 'The summary facts behind Fran\'s first bar in Weekly tonnage', journal: 'crossfit', query: ':session{result:res-fran-w0}' },
  { section: 'rows', widgetType: 'rows', title: 'Segment plane — Fran round 5', question: 'Only segment-grain statements, via the plane:segment filter', journal: 'crossfit', query: ':session{result:res-fran-w5, plane:segment}' },
  { section: 'rows', widgetType: 'rows', title: 'Boulder session statements', question: 'The send rows feeding Sends by grade', journal: 'climb', query: ':session{result:res-boulder-w4}' },
  { section: 'rows', widgetType: 'rows', title: 'Wellness day statements', question: 'A user-authored wellness note, note-scoped', journal: 'wellness', query: ':session{note:note-well-2026-06-03}' },

  // ── Find — content discovery over the content plane ───────────────────
  { section: 'find', widgetType: 'find', title: 'Notes by tag', question: 'Which notes are benchmarks?', journal: 'crossfit', query: ':note{tags:benchmark}' },
  { section: 'find', widgetType: 'find', title: 'Blocks by text', question: 'Which workouts contain thrusters?', journal: 'crossfit', query: ':block{text:thrusters}' },
  { section: 'find', widgetType: 'find', title: 'Efforts by intensity', question: 'Which efforts are high tier?', journal: 'crossfit', query: ':effort{intensity:high}' },

  // ── Edge States — empty, error, and loading states live ───────────────
  { section: 'edge', widgetType: 'value', title: 'Empty aggregate', question: 'No data for filter — WqlEmptyState renders live with stages telemetry', journal: 'crossfit', query: 'sum:totalVolume{effort:nonexistent}' },
  { section: 'edge', widgetType: 'auto', title: 'Malformed query (auto)', question: 'Syntax error (all engine validation is parse-time) — useChartShape error branch renders live', journal: 'crossfit', query: 'sum:totalVolume by', expectError: true },
  { section: 'edge', widgetType: 'value', title: 'In-flight query (loading)', question: 'Async query in flight — natural suspense via WqlEmptyState', journal: 'crossfit', query: 'sum:totalVolume{}', simulateLoading: true },
  { section: 'edge', widgetType: 'rows', title: 'Empty rows plane', question: 'No workout runs match the filter — RowsTable empty state', journal: 'crossfit', query: ':session{result:nonexistent}' },
  { section: 'edge', widgetType: 'find', title: 'Empty find plane', question: 'No content matches the filter — FindResultList empty state', journal: 'crossfit', query: ':note{tags:nonexistent}' },
];


export function cardsForSection(section: GallerySection): GalleryCardDef[] {
  return GALLERY_CARDS.filter((card) => card.section === section);
}

/** One-line block body: query plus `/`-separated positional params. */
export function cardBody(def: GalleryCardDef): string {
  return def.params?.length ? [def.query, ...def.params].join(' / ') : def.query;
}
