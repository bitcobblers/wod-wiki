/**
 * Shared widget type vocabulary and legacy ```query:<type>[-<N>|-full] fence
 * suffix parser. Kept free of `queryBlockCodec` / `dashboard/model` imports so
 * both modules can depend on it without a cycle.
 */

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

  const attributes: Record<string, string> = {};
  const attributeOrder: string[] = [];
  const trimmedSuffix = suffix.trim();
  const headEnd = trimmedSuffix.search(/\s/);
  const head = headEnd === -1 ? trimmedSuffix : trimmedSuffix.slice(0, headEnd);
  const attrTail = headEnd === -1 ? '' : trimmedSuffix.slice(headEnd);
  const attrPattern = /([a-zA-Z][a-zA-Z0-9_-]*)=("([^"]*)"|\S+)/g;
  for (const match of attrTail.matchAll(attrPattern)) {
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
    return { type: rest, spanCols, spanFull, attributes, attributeOrder, error: `malformed widget suffix "${suffix}"` };
  }
  if (spanCols != null && (spanCols < 1 || spanCols > DASHBOARD_GRID_MAX_COLS)) {
    return { type: rest, spanCols, spanFull, attributes, attributeOrder, error: `span ${spanCols} outside 1..${DASHBOARD_GRID_MAX_COLS}` };
  }
  return { type: rest, spanCols, spanFull, attributes, attributeOrder };
}
