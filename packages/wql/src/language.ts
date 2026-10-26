/**
 * WQL language support — CodeMirror highlighting + autocomplete over the
 * Lezer grammar (grammar/wql.grammar).
 *
 * The completion vocabulary is the analytics dictionary:
 *   - aggregators from the AST contract (WQL_AGGREGATORS)
 *   - Canonical Metric Keys (CONTEXT.md §Analytics): base families, Tier-2
 *     aggregates, and `<effortSlug>.<family>` for every known effort
 *   - Tag keys read off fact rows by the Query Service, with value
 *     vocabularies for discipline (canonical EFFORT_DISCIPLINES), intensity,
 *     and grain; effort values come from the EffortResolver
 *   - virtual dimensions day | week | session | round
 */

import { LRLanguage, LanguageSupport, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { autocompletion, CompletionContext, CompletionResult, Completion, snippetCompletion, startCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser } from "./grammar/wql.parser";
import type { IFieldCatalog } from "./catalog";
import { EFFORT_DISCIPLINES } from "./disciplines";
import { wqlFilterKeys, wqlGroupingDimensions } from "./capabilities";
import {
  WQL_AGGREGATORS,
  WQL_CHART_HEADS,
  WQL_METRIC_FAMILIES,
  WQL_METRIC_AGGREGATES,
  WQL_CALC_TARGETS,
  WQL_INTENSITY_TIERS,
  WQL_GRAINS,
  WQL_ROLLUP_PERIODS,
  WQL_SOURCE_HEADS,
  WQL_NOTE_HEAD_ALIASES,
  WQL_SOURCE_HEAD_SCOPES,
  WQL_TYPE_HEADS,
  WQL_SOURCE_VALUES,
  WQL_STANDARD_DATASETS,
  WQL_FIND_TARGETS,
  WQL_FUNCTION_HEADS,
  WQL_DISPLAY_UNITS,
} from "./vocabulary";

// The vocabulary tables live in ./vocabulary (no editor deps); re-export
// so existing importers of language keep working.
export {
  WQL_METRIC_FAMILIES,
  WQL_METRIC_AGGREGATES,
  WQL_TAG_KEYS,
  WQL_VIRTUAL_DIMS,
  WQL_CALC_TARGETS,
  WQL_FIND_TARGETS,
  WQL_RESULT_PLANES,
  WQL_SOURCE_VALUES,
  WQL_CONTENT_FILTER_KEYS,
  WQL_AGGREGATORS,
  WQL_COMPARISON_OPS,
  WQL_ROLLUP_PERIODS,
} from "./vocabulary";

// ── Highlighting ───────────────────────────────────────────────────

export const wqlLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      styleTags({
        // Rule styles color stray punctuation; the Word tokens inside carry
        // the visible styling (unstyled children reset the parent class) —
        // so parents with punctuation children (Head spans `:journal`) are
        // NOT styled directly, or highlightTree merges the word into the
        // parent span.
        "Aggregator/Word": t.keyword,
        "Metric/Word": t.variableName,
        // Direct Word child of Head = the colon head name (`:sum`, `:journal`).
        "Head/Word": t.keyword,
        DatasetReference: t.keyword,
        "DatasetReference/Word": t.keyword,
        At: t.punctuation,
        TagKey: t.propertyName,
        "TagKey/Word": t.propertyName,
        TagValue: t.string,
        "TagValue/Value/Word": t.string,
        "TagValue/Word": t.string,
        Negate: t.operator,
        Star: t.operator,
        Dimension: t.attributeName,
        "Dimension/Word": t.attributeName,
        By: t.keyword,
        RollupDot: t.keyword,
        Int: t.number,
        "Rollup/Word": t.unit,
        braceOpen: t.bracket,
        braceClose: t.bracket,
        parenOpen: t.bracket,
        parenClose: t.bracket,
        colon: t.punctuation,
        comma: t.punctuation,
        pipe: t.punctuation,
        dot: t.punctuation,
      })
    ]
  }),
  languageData: {
    closeBrackets: { brackets: ["{", "("] },
  }
});

// ── Completion ─────────────────────────────────────────────────────

export interface WqlCompletionOptions {
  /**
   * Effort slugs for `{effort:…}` values and `<effortSlug>.<family>` metric
   * keys — feed from the EffortResolver:
   * `() => resolver.list().map(e => e.slug)`.
   */
  effortNames?: () => readonly string[];
  /**
   * Dynamic values for the frontmatter typed-tag filters (`{domain:…}`,
   * `{format:…}`, `{equipment:…}`, `{quality:…}`, `{intent:…}`) — fed from
   * the tags store's `by-type` index:
   * `async key => (await storage.getAllFromIndex('tags', 'by-type', key)).map(t => t.label)`.
   * Absent or empty results fall through to catalog discovery.
   */
  tagTypeValues?: (key: string) => Promise<readonly string[]> | readonly string[];
  /**
   * Host-supplied values for a filter key (e.g. the composer's suggestion
   * feeds). Non-empty results win over the static vocabularies below.
   */
  values?: (key: string) => Promise<readonly Completion[]>;
  /**
   * Injected field catalog (ticket 15): discovered typed variants join the
   * static metric vocabulary, and categorical values back filter-value
   * suggestions for discovered fields. Bounded prefix lookups only — the
   * catalog never scans event/result history.
   */
  catalog?: IFieldCatalog;
}

function options(labels: readonly (string | Completion)[]): Completion[] {
  return labels.map((label) => (typeof label === 'string' ? { label } : label));
}

/**
 * Lexical cursor scan — quote- and brace-aware. Primary slot detection is
 * lexical because the suffix/pipe/window grammar lives outside the Lezer
 * tree, and quoted phrases / OR pipes inside braces must never be mistaken
 * for structural boundaries.
 */
interface WqlScan { depth: number; quoted: boolean; pipeFrom: number; lastBrace: number; fragStart: number; }

function scanContext(doc: string, pos: number): WqlScan {
  let depth = 0, quoted = false, pipeFrom = -1, lastBrace = -1, fragStart = 0;
  for (let i = 0; i < pos; i++) {
    const ch = doc[i];
    if (quoted) { if (ch === '"') quoted = false; continue; }
    if (ch === '"') { quoted = true; continue; }
    if (ch === '{') { depth++; lastBrace = i; fragStart = i + 1; }
    else if (ch === '}') { depth = Math.max(0, depth - 1); fragStart = i + 1; }
    else if (ch === ',' && depth > 0) fragStart = i + 1;
    else if (ch === '|' && depth === 0) { pipeFrom = i + 1; fragStart = i + 1; }
  }
  return { depth, quoted, pipeFrom, lastBrace, fragStart };
}

function maskQuotes(text: string): string {
  let out = '';
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') { quoted = !quoted; out += ' '; }
    else out += quoted ? ' ' : ch;
  }
  return out;
}

function unquotedColonIndex(text: string): number {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) return i;
  }
  return -1;
}

/** Keys/dims already present in the open brace group, before the current fragment. */
function usedEntries(doc: string, groupStart: number, fragStart: number): Set<string> {
  const text = maskQuotes(doc.slice(groupStart + 1, fragStart));
  const used = new Set<string>();
  for (const entry of text.split(',')) {
    const m = /!?\s*([A-Za-z][\w-]*)/.exec(entry);
    if (m) used.add(m[1]);
  }
  return used;
}

function valueOf(c: Completion): string {
  return typeof c.apply === 'string' ? c.apply : c.label;
}

/** Whitespace values insert quoted — never inside already-quoted replacements. */
function quoteApply(c: Completion): Completion {
  const value = valueOf(c);
  if (!/\s/.test(value)) return c;
  return {
    ...c,
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      const text = view.state.sliceDoc(Math.max(0, from - 1), from) === '"' ? value : `"${value}"`;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.complete' });
    },
  };
}

/** Host values first (rank-boosted so CM sort keeps vault order), static
 *  canonical vocabulary after; case-insensitive dedup by value — labels are
 *  display-only and never count as a second value. */
function mergeValues(host: readonly Completion[], statics: readonly Completion[]): Completion[] {
  const seen = new Set<string>();
  const out: Completion[] = [];
  host.forEach((c, i) => {
    const k = valueOf(c).toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(quoteApply({ ...c, boost: Math.max(-99, Math.min(99, 80 - i)) }));
  });
  for (const c of statics) {
    const k = valueOf(c).toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(quoteApply(c));
  }
  return out;
}

/** Prefix-first, case-insensitive substring narrowing. */
function narrow(options: readonly Completion[], typed: string): Completion[] {
  const q = typed.toLowerCase();
  if (!q) return [...options];
  const prefix: Completion[] = [];
  const rest: Completion[] = [];
  for (const o of options) {
    const label = o.label.toLowerCase();
    if (label.startsWith(q)) prefix.push(o);
    else if (label.includes(q)) rest.push(o);
  }
  return [...prefix, ...rest];
}

/** Ranked result; empty matches close the popup (free text stays as written). */
function finish(_context: CompletionContext, from: number, options: readonly Completion[], typed: string): CompletionResult | null {
  const ranked = narrow(options, typed);
  if (!ranked.length) return null;
  return {
    from,
    options: ranked.map((o, i) => (o.boost === undefined ? { ...o, boost: Math.max(-99, 50 - i) } : o)),
    filter: false,
  };
}

/**
 * Accepting a head aggregator or a filter key also writes its separator and
 * reopens the list, so the next slot (metric/target, filter value) is
 * offered immediately — typing becomes picking.
 */
function chained(list: readonly Completion[], suffix: string): Completion[] {
  return list.map((c) => ({
    ...c,
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      const text = typeof c.apply === 'string' ? c.apply : c.label;
      // An apply that already ends in its own separator (`.rollup(`, `last `)
      // is authoritative — chaining must not double it.
      const selfTerminated = /\W$/.test(text);
      const present = view.state.sliceDoc(to, to + suffix.length) === suffix;
      const insert = selfTerminated || present ? text : text + suffix;
      view.dispatch({
        changes: { from, to: to + (selfTerminated && present ? suffix.length : 0), insert },
        selection: { anchor: from + insert.length },
        userEvent: 'input.complete',
      });
      startCompletion(view);
    },
  }));
}

/** Colon head vocabulary — canonical sources, functions, charts, datasets. */
const HEAD_OPTIONS: Completion[] = [
  ...WQL_FUNCTION_HEADS.map((label) => ({ label, detail: 'function head', type: 'keyword' as const })),
  ...WQL_SOURCE_HEADS.map((label) => ({ label, detail: 'source head', type: 'keyword' as const })),
  ...WQL_CHART_HEADS.map((label) => ({ label, detail: 'chart head', type: 'class' as const })),
  ...WQL_STANDARD_DATASETS.map((label) => ({ label, detail: 'page dataset', type: 'class' as const })),
];

/** Insertion for a head option: `:name{` at query start, `name{` when the
 *  leading colon is already typed; datasets insert bare. */
function headApply(o: Completion, colonTyped: boolean): Completion {
  if (o.label.startsWith('@')) return { ...o, apply: o.label };
  return { ...o, apply: `${colonTyped ? '' : ':'}${o.label}{` };
}

/** Legacy `agg:` heads still parse (retained numerical syntax); the retired
 *  find/rows dispatch keywords are no longer offered. */
const LEGACY_HEAD_OPTIONS: Completion[] = WQL_AGGREGATORS.map((label) => ({ label, type: 'keyword' as const }));

/** Sortable/selectable columns the executors actually read (QueryService). */
const NOTE_COLUMNS: readonly string[] = ['title', 'date', 'createdAt', 'type', 'sourceId', 'notebookId'];
const BLOCK_COLUMNS: readonly string[] = ['noteTitle', 'dataType', 'position', 'createdAt', 'noteId', 'sourceId'];
const EFFORT_COLUMNS: readonly string[] = ['slug', 'label', 'registrySource'];
const SESSION_COLUMNS: readonly string[] = ['duration', 'startTime', 'origin'];
const TABLE_COLUMNS: readonly string[] = [
  'date', 'effort', 'discipline', 'note', 'grade', 'intensity',
  ...WQL_METRIC_FAMILIES, ...WQL_METRIC_AGGREGATES,
];
/** Columns that accept an `in kg|lb` display unit. */
const UNIT_COLUMNS: ReadonlySet<string> = new Set(['distance', 'resistance', 'totalVolume', 'totalDistance']);
const DIR_OPTIONS: Completion[] = [
  { label: 'asc', detail: 'sort ascending', type: 'keyword' },
  { label: 'desc', detail: 'sort descending', type: 'keyword' },
];
const UNIT_OPTIONS: Completion[] = WQL_DISPLAY_UNITS.map((label) => ({ label, detail: 'display unit', type: 'constant' }));

type Family = 'find' | 'aggregate';
interface Head { family: Family; target?: string }

/** `find:`/rows: dispatch keywords are retired — a legacy `word:` head is
 * always the retained aggregate surface; the metric slot resolves below. */
function resolveHead(_agg: string, _typedTarget: string): Head {
  return { family: 'aggregate' };
}

/** A colon head: function → aggregate family; source head → its content
 *  plane (scoped aliases resolve to 'note'); chart → sink params. */
function resolveColonHead(name: string): Head {
  const n = name.toLowerCase();
  if ((WQL_FUNCTION_HEADS as readonly string[]).includes(n)) return { family: 'aggregate' };
  if ((WQL_CHART_HEADS as readonly string[]).includes(n)) return { family: 'find' };
  const headTarget = (head: string): string => {
    if ((WQL_NOTE_HEAD_ALIASES as readonly string[]).includes(head)) return 'note';
    const scoped = (WQL_SOURCE_HEAD_SCOPES as Readonly<Record<string, string>>)[head]
      || (WQL_TYPE_HEADS as Readonly<Record<string, string>>)[head];
    return scoped ? 'note' : head;
  };
  if ((WQL_SOURCE_HEADS as readonly string[]).includes(n)) {
    return { family: 'find', target: headTarget(n) };
  }
  const partial = n ? WQL_SOURCE_HEADS.filter((t) => t.startsWith(n)) : [];
  const targets = [...new Set(partial.map(headTarget))];
  if (targets.length === 1) {
    return { family: 'find', target: targets[0]! };
  }
  return { family: 'find' }; // partial or unknown — union key suggestions
}

const FIND_KEY_UNION: readonly string[] = [
  ...new Set(WQL_FIND_TARGETS.flatMap((t) => [...wqlFilterKeys(t, 'find')])),
];

function filterKeysFor(head: Head): readonly string[] {
  return head.family === 'find'
    ? (head.target ? wqlFilterKeys(head.target, 'find') : FIND_KEY_UNION)
    : wqlFilterKeys('', 'aggregate');
}

function pipeColumns(target: string | undefined): readonly string[] {
  switch (target) {
    case 'note': return NOTE_COLUMNS;
    case 'block': return BLOCK_COLUMNS;
    case 'effort': return EFFORT_COLUMNS;
    case 'session': return SESSION_COLUMNS;
    default: return TABLE_COLUMNS; // segment/event/rows table output
  }
}

/** Parser advisories: select is ignored for these targets, order for sessions. */
const SELECT_IGNORED: ReadonlySet<string> = new Set(['note', 'block', 'effort', 'session']);

export function wqlCompletionSource(options_: WqlCompletionOptions = {}) {
  const { effortNames, tagTypeValues, catalog, values: hostValues } = options_;

  /** Discovered typed variants for the typed metric word — bounded lookup. */
  const catalogMetricOptions = async (typed: string): Promise<Completion[]> => {
    if (!catalog) return [];
    const entries = await catalog.listByPrefix(typed, 20);
    return entries.map((entry) => ({
      label: entry.path,
      detail: [entry.kind, ...entry.units].filter(Boolean).join(' · '),
      type: 'variable',
      apply: entry.path,
    }));
  };

  /** Categorical values for a discovered field key (original spellings). */
  const catalogValueOptions = async (key: string, typed: string): Promise<Completion[]> => {
    if (!catalog) return [];
    const values = await catalog.listValues(key, typed, 20);
    return values.map((v) => ({ label: v.value, type: 'constant' }));
  };

  const metricOptions = (): Completion[] => {
    const efforts = effortNames?.() ?? [];
    return [
      ...options(WQL_METRIC_AGGREGATES).map((c) => ({ ...c, type: 'constant' })),
      ...options(WQL_METRIC_FAMILIES).map((c) => ({ ...c, type: 'variable' })),
      ...options(efforts.flatMap((slug) => WQL_METRIC_FAMILIES.map((family) => `${slug}.${family}`)))
        .map((c) => ({ ...c, type: 'variable' })),
      ...options(WQL_CALC_TARGETS).map((c) => ({ ...c, type: 'namespace' })),
      snippetCompletion('calc.${target}', { label: 'calc.', detail: 'calculated target', type: 'namespace' }),
    ];
  };

  /** Static canonical value vocabulary per key (null → free-form/catalog). */
  const staticValueOptions = (key: string): Completion[] | Promise<Completion[]> | null => {
    switch (key) {
      case 'effort': return options(effortNames?.() ?? []);
      case 'discipline': return options(EFFORT_DISCIPLINES);
      case 'intensity': return options(WQL_INTENSITY_TIERS);
      case 'grain': return options(WQL_GRAINS);
      case 'metric': return metricOptions();
      case 'source': return options(WQL_SOURCE_VALUES);
      case 'domain':
      case 'format':
      case 'equipment':
      case 'quality':
      case 'intent': {
        if (!tagTypeValues) return null;
        return Promise.resolve(tagTypeValues(key)).then((values) => options(values));
      }
      default: return null; // note/page/block/result/tags/origin — free-form or host-fed
    }
  };

  /** Filter value slot: host vault values first, static canonical after,
   *  case-insensitive dedup; falls through to catalog discovery, then to a
   *  plain close (free text stays as written). */
  const valueSlot = (
    key: string,
    context: CompletionContext,
    from: number,
    typed: string,
  ): CompletionResult | Promise<CompletionResult | null> | null => {
    const emit = (host: readonly Completion[], statics: readonly Completion[] | null): CompletionResult | Promise<CompletionResult | null> | null => {
      const merged = mergeValues(host, statics ?? []);
      if (merged.length) return finish(context, from, merged, typed);
      if (catalog) {
        return catalogValueOptions(key, typed).then((found) => finish(context, from, found, typed));
      }
      return finish(context, from, [], typed);
    };
    const statics = staticValueOptions(key);
    if (!hostValues) {
      return statics instanceof Promise ? statics.then((s) => emit([], s)) : emit([], statics);
    }
    const host = hostValues(key);
    if (statics instanceof Promise) return Promise.all([Promise.resolve(host), statics]).then(([h, s]) => emit(h, s));
    return Promise.resolve(host).then((h) => emit(h, statics));
  };

  /** Discovered typed variants join the static metric vocabulary (ticket 15). */
  const metricHeadSlot = (context: CompletionContext, from: number, typed: string): CompletionResult | Promise<CompletionResult | null> | null => {
    if (!catalog) return finish(context, from, metricOptions(), typed);
    return catalogMetricOptions(typed).then((extra) => finish(context, from, [...metricOptions(), ...extra], typed));
  };

  /** Inside braces: `by {…}` dims use target-aware grouping; filter braces
   *  use target-aware keys (excluding keys already present), `!` reopens the
   *  same list as an exclude, and `key:` values merge host + canonical. */
  const braceSlot = (
    context: CompletionContext,
    doc: string,
    scan: WqlScan,
    from: number,
    typed: string,
    head: Head,
  ): CompletionResult | Promise<CompletionResult | null> | null => {
    if (/\bby\s*$/.test(maskQuotes(doc.slice(0, scan.lastBrace)))) {
      const dims = wqlGroupingDimensions(head.target ?? '', head.family);
      const used = usedEntries(doc, scan.lastBrace, scan.fragStart);
      const avail = [...dims].filter((d) => !used.has(d));
      if (!avail.length) return finish(context, from, [], typed);
      return finish(
        context,
        from,
        chained(avail.map((d) => ({ label: d, type: 'atom' as const, detail: 'grouping dimension' })), ', '),
        typed,
      );
    }
    const frag = doc.slice(scan.fragStart, context.pos);
    const colon = unquotedColonIndex(frag);
    if (colon >= 0) {
      const key = frag.slice(0, colon).replace(/^!/, '').trim();
      return valueSlot(key, context, from, typed);
    }
    const keyWord = context.matchBefore(/[\w-]*/)!;
    const exclude = frag.trimStart().startsWith('!');
    const used = usedEntries(doc, scan.lastBrace, scan.fragStart);
    const avail = filterKeysFor(head).filter((k) => !used.has(k));
    const opts = chained(
      avail.map((k) => ({ label: k, type: 'property' as const, ...(exclude ? { detail: `exclude ${k} values` } : {}) })),
      ':',
    );
    return finish(context, keyWord.from, opts, typed);
  };

  /** After a complete head: rollup periods, group dims, `last <n>d|w`,
   *  `from DATE [to DATE]`, or the structural suffix keywords. */
  const suffixSlot = (context: CompletionContext, doc: string, scan: WqlScan, from: number, typed: string, head: Head, headEnd: number): CompletionResult | null => {
    const tail = doc.slice(headEnd, context.pos);
    if (/\.rollup\([^)]*$/.test(tail)) {
      // find ignores .rollup (parser advises) — only aggregate heads get periods.
      return head.family === 'aggregate'
        ? finish(context, from, options(WQL_ROLLUP_PERIODS).map((c) => ({ ...c, type: 'constant' as const })), typed)
        : finish(context, from, [], typed);
    }
    if (/\bby\s*\{[^}]*$/.test(tail)) return braceSlot(context, doc, scan, from, typed, head) as CompletionResult | null;
    if (/\s+last\s+$/i.test(tail)) {
      return finish(context, context.pos, [
        { label: '4w', detail: 'relative window', type: 'constant' },
        { label: '8w', detail: 'relative window', type: 'constant' },
        { label: '7d', detail: 'relative window', type: 'constant' },
        { label: '30d', detail: 'relative window', type: 'constant' },
      ], '');
    }
    const lastUnit = /\s+last\s+(\d+)([dw]?)$/i.exec(tail);
    if (lastUnit) {
      if (lastUnit[2]) return null; // window already unit-complete
      return finish(context, context.pos, [
        { label: 'd', detail: 'days', type: 'constant' },
        { label: 'w', detail: 'weeks', type: 'constant' },
      ], '');
    }
    if (/\s+from\s+$/i.test(tail)) {
      return finish(context, context.pos, [{ label: '2026-01-01', apply: '2026-01-01 ', detail: 'start date (YYYY-MM-DD)', type: 'constant' }], '');
    }
    if (/\s+from\s+\d{4}-\d{2}-\d{2}\s+$/i.test(tail)) {
      return finish(context, context.pos, [{ label: 'to', apply: 'to ', detail: 'end date', type: 'keyword' }], '');
    }
    if (/\s+to\s+$/i.test(tail)) {
      return finish(context, context.pos, [{ label: '2026-03-31', detail: 'end date (YYYY-MM-DD)', type: 'constant' }], '');
    }
    // Parser singletons (the wqlSuffix conflict rules): a second `by`/`.rollup`/
    // window clause (last and from share the one window slot) is a Duplicate-
    // clause parse error — stop offering it once a complete one is present.
    const hasBy = /\bby\s*\{[^{}]*\}/.test(tail);
    const hasRollup = /\.rollup\([^()]*\)/.test(tail);
    const hasWindow = /\s+last\s+\d+[dw]\b/i.test(tail)
      || /\s+from\s+\d{4}-\d{2}-\d{2}(?:\s+to\s+\d{4}-\d{2}-\d{2})?\b/i.test(tail);
    const dims = wqlGroupingDimensions(head.target ?? '', head.family);
    const keywords: Completion[] = [
      ...(hasBy ? [] : [{ label: 'by {}', apply: 'by ', detail: dims.length ? 'group by dimensions' : `advisory: no grouping dimensions for find:${head.target}`, type: 'keyword' }]),
      ...(head.family === 'aggregate' && !hasRollup
        ? [{ label: '.rollup()', apply: '.rollup(', detail: 'bucket period', type: 'keyword' as const }]
        : []),
      ...(hasWindow ? [] : [
        { label: 'last', apply: 'last ', detail: 'relative window: last <n>d|w', type: 'keyword' },
        { label: 'from', apply: 'from ', detail: 'date range: from YYYY-MM-DD [to YYYY-MM-DD]', type: 'keyword' },
      ]),
      ...(head.family === 'find' ? [{ label: '|', apply: '| ', detail: 'presentation pipes: order by / select / limit', type: 'keyword' as const }] : []),
    ];
    return finish(context, from, chained(keywords, ' '), typed);
  };

  /** Presentation pipe zone (`| …`): clause keywords, then per-target
   *  columns, asc/desc, `in <unit>`, numeric limit placeholder. */
  const pipeSlot = (context: CompletionContext, doc: string, scan: WqlScan, from: number, typed: string, head: Head): CompletionResult | null => {
    const text = doc.slice(scan.pipeFrom, context.pos);
    const orderM = /^\s*order\b/i.exec(text);
    if (orderM) {
      const rest = text.slice(orderM[0].length);
      const byM = /^\s*by\b/i.exec(rest);
      if (!byM) return finish(context, from, [{ label: 'by', apply: 'by ', type: 'keyword' }], typed);
      const last = rest.slice(byM[0].length).split(',').pop() ?? '';
      const words = last.trim().split(/\s+/).filter(Boolean);
      const columns = pipeColumns(head.target).map((c) => ({ label: c, type: 'property' as const }));
      if (!words.length) return finish(context, from, columns, '');
      if (/\s$/.test(last)) return finish(context, context.pos, DIR_OPTIONS, '');
      if (words.length >= 2) {
        if (/^(asc|desc)$/i.test(words[1])) return null;
        return finish(context, from, DIR_OPTIONS, typed);
      }
      return finish(context, from, columns, last.trim());
    }
    const selectM = /^\s*select\b/i.exec(text);
    if (selectM) {
      const last = text.slice(selectM[0].length).split(',').pop() ?? '';
      const words = last.trim().split(/\s+/).filter(Boolean);
      if (!words.length) return finish(context, from, pipeColumns(head.target).map((c) => ({ label: c, type: 'property' as const })), '');
      if (/\s$/.test(last)) {
        return UNIT_COLUMNS.has(words[0].toLowerCase())
          ? finish(context, context.pos, UNIT_OPTIONS, '')
          : finish(context, from, [], typed);
      }
      if (words.length >= 2) {
        const second = words[1].toLowerCase();
        if (second === 'in') return words[2] ? finish(context, from, UNIT_OPTIONS, words[2]) : finish(context, context.pos, UNIT_OPTIONS, '');
        if ('in'.startsWith(second)) return finish(context, context.pos, UNIT_OPTIONS, '');
        return null; // `col in unit` complete
      }
      return finish(context, from, pipeColumns(head.target).map((c) => ({ label: c, type: 'property' as const })), words[0]);
    }
    if (/^\s*(limit|offset)\b/i.test(text)) return null; // free numeric
    // Composer parity: the limit keyword inserts a numeric placeholder.
    const limitSnippet = snippetCompletion('limit ${10}', { label: 'limit', detail: 'cap result rows', type: 'keyword' });
    const kw: Completion[] = [
      { label: 'order by', apply: 'order by ', detail: head.target === 'session' ? 'advisory: order ignored for sessions' : 'sort rows', type: 'keyword' },
      { label: 'select', apply: 'select ', detail: SELECT_IGNORED.has(head.target ?? '') ? `advisory: select ignored for find:${head.target}` : 'choose columns', type: 'keyword' },
    ];
    return finish(context, from, [...chained(kw, ' '), limitSnippet], typed);
  };

  function inner(context: CompletionContext, replaceSelection = false): CompletionResult | Promise<CompletionResult | null> | null {
    const doc = context.state.doc.toString();
    const pos = context.pos;
    const word = context.matchBefore(/[\w.*-]*/) ?? { from: pos, to: pos, text: '' };
    // Structural characters open the next slot immediately, no keystroke needed.
    const opens = word.from === word.to && pos > 0 && /[{,:|(!"@]/.test(doc[pos - 1]);
    if (word.from === word.to && !context.explicit && !opens) return null;

    const scan = scanContext(doc, pos);
    if (scan.quoted && scan.depth === 0) return null; // free text inside a phrase

    // Selected-token replacement lists every slot alternative unfiltered.
    const typed = replaceSelection ? '' : word.text;

    // Colon heads (`:note{…}`, `:sum{metric:…}`) and the legacy word-colon head.
    const colonHeadM = /^[ \t]*:[ \t]*([A-Za-z][\w-]*)/.exec(doc);
    const headM = colonHeadM ?? /^[ \t]*([A-Za-z]+)[ \t]*:[ \t]*([A-Za-z0-9_.-]*)/.exec(doc);
    const head = colonHeadM
      ? resolveColonHead(colonHeadM[1]!)
      : headM ? resolveHead(headM[1]!, headM[2]!) : { family: 'aggregate' as const };

    if (scan.pipeFrom >= 0 && scan.depth === 0) return pipeSlot(context, doc, scan, word.from, typed, head);
    if (scan.depth > 0) return braceSlot(context, doc, scan, word.from, typed, head);

    // A '@' before the typed word means a dataset reference — offer only
    // datasets ('@to' must not surface 'toplist').
    const datasetTyped = word.from > 0 && doc[word.from - 1] === '@';
    const headPool = datasetTyped ? HEAD_OPTIONS.filter((o) => o.label.startsWith('@')) : HEAD_OPTIONS;
    const headTyped = datasetTyped ? '@' + typed : typed;

    const headFrom = datasetTyped ? word.from - 1 : word.from;

    if (!headM) return finish(context, headFrom, headPool.map((o) => headApply(o, false)), headTyped);

    if (colonHeadM) {
      // Before/inside the head word after ':': offer every head.
      if (pos <= colonHeadM[0].length) {
        return finish(context, headFrom, headPool.map((o) => headApply(o, true)), headTyped);
      }
      return suffixSlot(context, doc, scan, word.from, typed, head, colonHeadM[0].length);
    }

    const colonIdx = headM[0].indexOf(':');
    if (pos <= colonIdx) return finish(context, word.from, chained(LEGACY_HEAD_OPTIONS, ':'), typed);
    if (pos <= headM[0].length) {
      // Head target/metric slot: `last` the aggregator vs `last` the window
      // is disambiguated here — before/inside the head word it is the
      // aggregator; after the complete head it is a suffix (below). The
      // retired find:/rows: dispatch keywords offer nothing here.
      return metricHeadSlot(context, word.from, typed);
    }
    return suffixSlot(context, doc, scan, word.from, typed, head, headM[0].length);
  }

  /** A non-empty selection means "replace this token": offer every option for
   *  the slot (unfiltered) over the selected range. */
  function source(context: CompletionContext): CompletionResult | Promise<CompletionResult | null> | null {
    const selection = context.state.selection.main;
    if (selection.empty) return inner(context);
    // Evaluate at the selection end so the slot resolved is the selected token's.
    const result = inner(new CompletionContext(context.state, selection.to, true), true);
    const widen = (r: CompletionResult | null) => r && { ...r, from: selection.from, to: selection.to, filter: false, validFor: undefined };
    return result instanceof Promise ? result.then(widen) : widen(result);
  }

  return source;
}

export function wqlCompletion(options?: WqlCompletionOptions): Extension {
  return autocompletion({ override: [wqlCompletionSource(options)] });
}

// ── Language support ───────────────────────────────────────────────

/**
 * Query-field colors, mapped onto the app's theme tokens so
 * the field follows light/dark mode: aggregator + structural keywords take
 * the primary hue, the metric takes accent, tag keys secondary, values
 * success-green, dimensions warning-ochre.
 */
export const wqlHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'hsl(var(--primary))' },
  { tag: t.variableName, color: 'hsl(var(--accent-foreground))', fontWeight: '600' },
  { tag: t.propertyName, color: 'hsl(var(--secondary-foreground))' },
  { tag: t.string, color: 'hsl(var(--success))' },
  { tag: t.attributeName, color: 'hsl(var(--warning))' },
  { tag: t.number, color: 'hsl(var(--primary))' },
  { tag: t.unit, color: 'hsl(var(--muted-foreground))' },
  { tag: t.operator, color: 'hsl(var(--destructive))' },
  { tag: [t.bracket, t.punctuation], color: 'hsl(var(--muted-foreground))' },
]);

export function wql(completionOptions?: WqlCompletionOptions) {
  return new LanguageSupport(wqlLanguage, [
    wqlCompletion(completionOptions),
    syntaxHighlighting(wqlHighlightStyle),
  ]);
}
