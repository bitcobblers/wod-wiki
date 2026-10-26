/**
 * wqlEdits — app-side structural WQL edits over the engine's parse/serialize
 * surface: parse to the AST, mutate the one targeted field, emit through the
 * serializer. Kind/target pivots and occurrence-level filter edits live in
 * the shared composer (resolveQueryDraft/editQueryClause); this module keeps
 * only the stream host's scope/time/filter-clear helpers and the explorer's
 * metric edit.
 *
 * Every edit is total: unparseable input is returned unchanged, so a
 * transient invalid draft is never destroyed by a structural edit.
 */
import {
  parseQuery,
  serialize,
  isAggregateQuery,
  isFindQuery,
  type AnyParsedQuery,
} from '@bitcobblers/wod-wiki-engine';
import { editQueryClause } from '@bitcobblers/wod-wiki-ui';

/** Content targets that carry a Where-stored storage scope. */
const SCOPED_TARGETS = new Set(['note', 'block']);

/** The query's Where-stored scope (the single non-negated `source:` filter
 *  value) or null when the query is all-sources, not a scoped content find,
 *  or carries anything the scope picker cannot represent (multi-value or
 *  negated scope). Type filters are separate from scope and never infer
 *  one. The composer's radio/heading state for the storage scope. */
export function scopeOfQuery(query: string): string | null {
  const parsed = parseQuery(query);
  if (parsed.error || !isFindQuery(parsed) || !SCOPED_TARGETS.has(parsed.target)) return null;
  const sf = parsed.filters.find((f) => f.key === 'source' && !f.negate);
  if (!sf || sf.values.length !== 1 || sf.values[0].value === 'all') return null;
  return sf.values[0].value;
}

/** Set or clear the Where-stored scope (`source:` filter) on a scoped
 *  content find. A targeted occurrence edit through the shared
 *  `editQueryClause`: the FIRST actual source occurrence is replaced (or
 *  spliced when clearing) in place; sibling filters, window, grouping, pipes
 *  and join survive, and queries needing Edit WQL are returned unchanged.
 *  Notebooks is the canonical `source:notebooks` storage scope — never
 *  `source:page` + `type:note` (storage identities keep their `notebook:`
 *  prefixes). Other targets/kinds are returned
 *  unchanged: scope is not a target pivot. */
export function setScopeFilter(query: string, scope: string | null): string {
  const parsed = parseQuery(query);
  if (parsed.error || !isFindQuery(parsed) || !SCOPED_TARGETS.has(parsed.target)) return query;
  const index = parsed.filters.findIndex((f) => f.key === 'source' && !f.negate);
  return editQueryClause(
    query,
    {
      id: 'stream-scope',
      type: 'source',
      label: 'Where stored',
      value: scopeOfQuery(query) ?? 'all',
      ...(index >= 0 ? { filterIndex: index } : {}),
    },
    scope?.trim() || 'all',
  ).wql;
}

/** Set the aggregate metric on an aggregate (metrics-plane) query. Find
 *  queries are returned unchanged — pivoting onto the metrics plane is a
 *  kind pivot owned by the shared composer's pivot flow (with its
 *  incompatibility prompt), never a silent side effect of a metric pick. */
export function setMetricQuery(query: string, metric: string): string {
  const parsed = parseQuery(query);
  if (parsed.error || !isAggregateQuery(parsed)) return query;
  return serialize({ ...parsed, metric });
}

/** Drop the time-selection window. */
export function withoutWindow(query: string): string {
  const parsed = parseQuery(query);
  if (parsed.error) return query;
  return serialize({ ...parsed, window: undefined } as AnyParsedQuery);
}

/** Point the query's grouping at one dimension (View ▸ Arrange-cards-by
 *  write-through: the WQL line, URL and grid follow the dialog). Replaces
 *  any existing `by {}`; unparseable input is returned unchanged — the
 *  caller falls back to the per-route view setting. */
export function withGroupBy(query: string, dimension: string): string {
  const parsed = parseQuery(query);
  if (parsed.error) return query;
  return serialize({ ...parsed, groupBy: [dimension] });
}
