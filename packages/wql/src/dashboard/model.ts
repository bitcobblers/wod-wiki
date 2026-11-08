/**
 * Dashboard Note model (#898 map, format locked in #899).
 *
 * A dashboard is a markdown note: frontmatter marks it (`dashboard: true`) and
 * declares top-level controls as `dashboard.*` dot-keys; the body composes
 * ```query[:<type>][-<N>|-full] blocks whose title/question associate from the
 * markdown heading/paragraph directly above each block. Queries reference
 * tokens as `$name`, substituted as raw text at execution time. A block body
 * body is a Query Document (decision 22); presentation params ride the
 * fence tag as `key=value` attributes.
 *
 * This module is pure — no React, no editor, no query service — so the editor
 * extensions, the inline block renderer, and the dashboard route all share it.
 */

import { WQL_CALC_TARGETS } from '../vocabulary';

// ── Widget types ───────────────────────────────────────────────────────────

export const DASHBOARD_WIDGET_TYPES = [
  'table',
  'list',
  'value',
  'timeseries',
  'bar',
  'donut',
  'toplist',
  'stacked-bar',
  'goal-rings',
  'zone-distribution',
] as const;
export type DashboardWidgetType = (typeof DASHBOARD_WIDGET_TYPES)[number];

export function isDashboardWidgetType(type: string): type is DashboardWidgetType {
  return (DASHBOARD_WIDGET_TYPES as readonly string[]).includes(type);
}

/** The widget type a block renders as: a bare ```query fence defaults to `table`. */
export function resolveWidgetType(type: string | undefined): string {
  return type == null || type === '' ? 'table' : type;
}

/** Shared badge messages — the editor, inline renderer, and route all word these identically. */
export function unknownWidgetTypeMessage(type: string): string {
  return `unknown widget type "${type}"`;
}

export function unknownTokensMessage(missing: readonly string[]): string {
  return `unknown token${missing.length > 1 ? 's' : ''}: ${missing.map((m) => `$${m}`).join(', ')}`;
}

/** Types whose renderer is planned for future maps (none remaining in #901). */
export const PLANNED_WIDGET_TYPES: readonly string[] = [];

// The known calc.* metric set IS the canonical vocabulary (WQL_CALC_TARGETS,
// kept in sync with the calc engine's registered outputs — #871). No
// hand-synced duplicate here; proposed/unknown calc.* keys render as the
// labeled placeholder badge via isProposedMetric (#901).
const KNOWN_CALC_METRICS: ReadonlySet<string> = new Set(WQL_CALC_TARGETS);

/**
 * True when a metric is a proposed calculation not yet landed in the engine
 * (e.g. `calc.readiness`, `calc.mvcBw`, `calc.hrv`). Renderers show a labeled
 * placeholder badge (#901).
 */
export function isProposedMetric(metricKey: string | undefined): boolean {
  if (!metricKey) return false;
  if (!metricKey.startsWith('calc.')) return false;
  return !KNOWN_CALC_METRICS.has(metricKey);
}

// ── Fence-tag suffix parse ─────────────────────────────────────────────────

export const DASHBOARD_GRID_MAX_COLS = 4;

export interface QueryWidgetSuffix {
  /** Raw widget type from the tag, lowercased; '' for a bare ```query fence. */
  type: string;
  /** Grid column span 1..4 (`-N`). */
  spanCols?: number;
  /** Full-row flag (`-full`). Mutually exclusive with spanCols. */
  spanFull?: boolean;
  /** Presentation attributes: `key=value` tokens after the type/span
   *  (decision 22 — positional params ride the fence tag, not the body). */
  attributes: Record<string, string>;
  /** Attribute order for stable re-serialization. */
  attributeOrder: string[];
  /** Set when the suffix is malformed (the type is still reported raw). */
  error?: string;
}

/**
 * Parse the suffix after `query:` in a fence tag — `<type>`, `<type>-<N>` or
 * `<type>-full`. Unknown types parse fine (renderers badge them); structural
 * problems (empty type, bad span, `-N-full` combo) set `error`.
 */
export function parseQueryWidgetSuffix(suffix: string): QueryWidgetSuffix {
  if (suffix === '') {
    return { type: '', attributes: {}, attributeOrder: [], error: 'missing widget type after "query:"' };
  }

  // Attributes: `key=value` pairs after the type/span token (a quoted value
  // may contain spaces). The head token carries type + span; everything
  // after the first whitespace is attribute tail.
  const attributes: Record<string, string> = {};
  const attributeOrder: string[] = [];
  const trimmedSuffix = suffix.trim();
  const headEnd = trimmedSuffix.search(/\s/);
  const head = headEnd === -1 ? trimmedSuffix : trimmedSuffix.slice(0, headEnd);
  const attrTail = headEnd === -1 ? '' : trimmedSuffix.slice(headEnd);
  const attrPattern = /([a-zA-Z][a-zA-Z0-9_-]*)=("([^"]*)"|\S+)/g;
  let consumed = 0;
  for (const match of attrTail.matchAll(attrPattern)) {
    consumed += match[0].length;
    const key = match[1]!.toLowerCase();
    const value = match[3] !== undefined ? match[3] : match[2]!;
    if (key in attributes) {
      return { type: head, attributes, attributeOrder, error: `duplicate attribute "${key}"` };
    }
    attributes[key] = value;
    attributeOrder.push(key);
  }
  const leftover = attrTail.replace(attrPattern, '').trim();
  if (leftover !== '') {
    return { type: head, attributes, attributeOrder, error: `malformed attribute "${leftover.split(/\s+/)[0]}"` };
  }
  void consumed;

  let rest = head.toLowerCase();
  let spanCols: number | undefined;
  let spanFull: boolean | undefined;

  if (rest.endsWith('-full')) {
    spanFull = true;
    rest = rest.slice(0, -'-full'.length);
  } else {
    const spanMatch = rest.match(/-(\d+)$/);
    if (spanMatch) {
      spanCols = Number(spanMatch[1]);
      rest = rest.slice(0, -spanMatch[0].length);
    }
  }

  if (rest === '' || !/^[a-z][a-z0-9-]*$/.test(rest)) {
    return { type: rest, spanCols, spanFull, attributes, attributeOrder, error: `malformed widget type "${suffix}"` };
  }
  if (/-(\d+|full)$/.test(rest)) {
    // A second trailing modifier (e.g. `bar-2-full`, `bar-full-2`) — span and
    // full are mutually exclusive. Kebab hyphens inside the type are fine.
    return { type: rest, spanCols, spanFull, attributes, attributeOrder, error: `malformed widget suffix "${suffix}"` };
  }
  if (spanCols != null && (spanCols < 1 || spanCols > DASHBOARD_GRID_MAX_COLS)) {
    return { type: rest, spanCols, spanFull, attributes, attributeOrder, error: `span ${spanCols} outside 1..${DASHBOARD_GRID_MAX_COLS}` };
  }
  return { type: rest, spanCols, spanFull, attributes, attributeOrder };
}

// ── Frontmatter tokens ─────────────────────────────────────────────────────

/** Frontmatter meta shape. */
export type DashboardMeta = Record<string, string | number | string[]>;

const TOKEN_PREFIX = 'dashboard.';

export interface DashboardToken {
  /** Token name without the `dashboard.` prefix (referenced as `$name`). */
  name: string;
  /** Scalar → single entry; block list → entries in declared order. */
  values: string[];
  /** List tokens render as segmented controls; scalars as inputs. */
  isList: boolean;
}

/** True when the note's frontmatter marks it as a dashboard (`dashboard: true`). */
export function isDashboardMeta(meta: DashboardMeta): boolean {
  return meta['dashboard'] === 'true' || meta['dashboard'] === true as unknown as string;
}

/** Extract `dashboard.*` dot-keys as tokens, in frontmatter declaration order. */
export function extractDashboardTokens(meta: DashboardMeta): DashboardToken[] {
  const tokens: DashboardToken[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (!key.startsWith(TOKEN_PREFIX) || key === TOKEN_PREFIX) continue;
    const name = key.slice(TOKEN_PREFIX.length);
    if (name === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) tokens.push({ name, values: value.map(String), isList: true });
    } else {
      tokens.push({ name, values: [String(value)], isList: false });
    }
  }
  return tokens;
}

/** Default value per token: the scalar, or the first list entry (its control default). */
export function defaultTokenValues(tokens: readonly DashboardToken[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const token of tokens) values[token.name] = token.values[0];
  return values;
}

/**
 * Write a control change back into frontmatter meta (decision #899-6): a list
 * token reorders so the chosen value becomes the first entry (the default);
 * a scalar token's value is replaced. Returns a NEW meta object — serialize
 * with `serializeFrontmatter` and patch the note's frontmatter section.
 */
export function setDashboardTokenValue(
  meta: DashboardMeta,
  name: string,
  value: string,
): DashboardMeta {
  const key = `${TOKEN_PREFIX}${name}`;
  const current = meta[key];
  const next: DashboardMeta = { ...meta };
  if (Array.isArray(current)) {
    if (!current.includes(value)) return meta; // controls only offer declared values
    next[key] = [value, ...current.filter((v) => v !== value)];
  } else if (current != null) {
    next[key] = typeof current === 'number' && !isNaN(Number(value)) ? Number(value) : value;
  } else {
    next[key] = value;
  }
  return next;
}

// ── Token substitution ─────────────────────────────────────────────────────

const TOKEN_REF_RE = /\$([A-Za-z_][\w-]*)/g;

/**
 * Substitute `$name` references with token values — raw text replacement at
 * execution time (decision #899-6). Unknown references stay literal and are
 * reported in `missing` (renderers badge them; never silent).
 */
export function substituteTokens(
  query: string,
  values: Record<string, string>,
): { query: string; missing: string[] } {
  const missing = new Set<string>();
  const substituted = query.replace(TOKEN_REF_RE, (raw, name: string) => {
    const value = values[name];
    if (value == null) {
      missing.add(name);
      return raw;
    }
    return value;
  });
  return { query: substituted, missing: [...missing] };
}

/** Token names a query references, in order of first appearance. */
export function referencedTokens(query: string): string[] {
  const names = new Set<string>();
  for (const match of query.matchAll(TOKEN_REF_RE)) names.add(match[1]);
  return [...names];
}

// ── Widget body ────────────────────────────────────────────────────────────

// ── Dashboard document ─────────────────────────────────────────────────────

/** Structural input for the builder — satisfied by EditorSection + doc text. */
export interface DashboardSectionInput {
  /** Section type ('query', 'markdown', 'frontmatter', …). */
  type: string;
  /** Markdown subtype ('heading', 'paragraph', …) for markdown sections. */
  subtype?: string;
  /** Raw inner content of the section. */
  content: string;
  /** Widget type suffix parsed from the fence tag (query sections). */
  widgetType?: string;
  /** Grid column span parsed from the fence tag (query sections). */
  spanCols?: number;
  /** Full-row flag parsed from the fence tag (query sections). */
  spanFull?: boolean;
  /** Malformed fence-suffix reason — carried so route mode badges it too. */
  widgetError?: string;
  /** Fence-tag presentation attributes (decision 22). */
  attributes?: Record<string, string>;
  attributeOrder?: string[];
}

export interface DashboardWidget {
  /** Stable key within the document (section index). */
  key: string;
  /** Raw widget type ('' → default `table` in dashboard composition). */
  type: string;
  spanCols?: number;
  spanFull?: boolean;
  /** Full fenced body — a Query Document (decision 22), comment lines
   *  stripped, surrounding whitespace trimmed, line structure preserved. */
  body: string;
  /** Malformed fence-suffix reason — renderers badge instead of executing. */
  widgetError?: string;
  /** Fence-tag presentation attributes (decision 22) — positional params
   *  ride the tag, never the body. */
  attributes: Record<string, string>;
  attributeOrder: string[];
  /** Title from the markdown heading directly above (or above the question). */
  title?: string;
  /** Coaching question from the paragraph directly above the block. */
  question?: string;
}

export interface DashboardDocument {
  isDashboard: boolean;
  /** Note title from frontmatter. */
  title?: string;
  tokens: DashboardToken[];
  widgets: DashboardWidget[];
}

/** First line of a heading section's content, without the leading #'s. */
function headingText(content: string): string | undefined {
  const line = content.split('\n', 1)[0].replace(/^#{1,6}\s*/, '').trim();
  return line === '' ? undefined : line;
}

/** Paragraph content collapsed to one line. */
function paragraphText(content: string): string | undefined {
  const text = content.replace(/\s*\n\s*/g, ' ').trim();
  return text === '' ? undefined : text;
}

/**
 * Build the dashboard document from ordered sections + frontmatter meta.
 *
 * Title/question association (decision #899-4) is strictly adjacency-based:
 * a paragraph directly above the block is its question; a heading directly
 * above that paragraph — or directly above the block — is its title. Anything
 * else leaves the widget untitled (renderers fall back to the query text).
 */
export function buildDashboardDocument(
  sections: readonly DashboardSectionInput[],
  meta: DashboardMeta,
): DashboardDocument {
  const widgets: DashboardWidget[] = [];

  sections.forEach((section, i) => {
    if (section.type !== 'query') return;

    // Decision 22: the widget body is the FULL fenced content — a multi-line
    // Query Document. Comment lines are stripped; line structure is kept so
    // documents survive round-trips byte-for-byte.
    const body = section.content
      .split('\n')
      .filter((l) => { const s = l.trim(); return s !== '' && !s.startsWith('#'); })
      .map((l) => l.trim())
      .join('\n');

    let title: string | undefined;
    let question: string | undefined;
    const above = sections[i - 1];
    if (above?.type === 'markdown' && above.subtype === 'paragraph') {
      question = paragraphText(above.content);
      const heading = sections[i - 2];
      if (heading?.type === 'markdown' && heading.subtype === 'heading') {
        title = headingText(heading.content);
      }
    } else if (above?.type === 'markdown' && above.subtype === 'heading') {
      title = headingText(above.content);
    }

    widgets.push({
      key: `w${widgets.length}`,
      type: section.widgetType ?? '',
      spanCols: section.spanCols,
      spanFull: section.spanFull,
      widgetError: section.widgetError,
      body,
      attributes: section.attributes ?? {},
      attributeOrder: section.attributeOrder ?? [],
      title,
      question,
    });
  });

  const titleMeta = meta['title'];
  return {
    isDashboard: isDashboardMeta(meta),
    title: typeof titleMeta === 'string' && titleMeta !== '' ? titleMeta : undefined,
    tokens: extractDashboardTokens(meta),
    widgets,
  };
}
