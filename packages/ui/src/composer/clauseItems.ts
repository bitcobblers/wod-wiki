/**
 * clauseItems — shared option resolution for clause value editors (the
 * composer's inline editor and the standalone ClausePopover). One searchable
 * vocabulary for every list (work item 4): static and suggestion-backed
 * options filter by typed text, known selected values survive refreshed
 * suggestion sources, and the exact typed value is a real selectable action
 * at index `filteredItems.length` (deduplicated against visible matches).
 * Typed values are commit-gated per slot: closed static vocab rejects
 * unknown values; time/rollup accept any parser-valid relative period /
 * multi-unit bucket width; metric/unit stay open (grammar accepts any word).
 */
import { STATIC_OPTIONS, MULTI_VALUE_TYPES } from './clauseVocab';
import { useSuggestions } from './useSuggestions';
import { getClauseMeta, type QueryClause } from './queryClauses';
import { parseQuery } from '@bitcobblers/wod-wiki-wql';

export interface ClauseItemsResult {
  isMulti: boolean;
  selectedValues: string[];
  /** All options (selected values preserved), unfiltered. */
  items: { value: string; label: string }[];
  /** Options after the typed filter; the exact typed value (when
   *  committable) is selectable at index `filteredItems.length`. */
  filteredItems: { value: string; label: string }[];
  /** The typed filter text, trimmed — a verbatim value when the slot is open. */
  typedValue: string;
  canCommitTyped: boolean;
  loading: boolean;
  /** True when the slot accepts typed values not present in the list (#831). */
  openSlot: boolean;
  /** Every list is searchable (work item 4): typing always filters. */
  hasFilterInput: boolean;
  /** Empty-state copy for the current filter; null when the list has rows. */
  emptyText: string | null;
}

/** Relative periods (`last <n><d|w>`), multi-unit bucket widths
 *  (`.rollup(<n><d|w>)`, n>1) and grouping dimensions (`by {dim}` — custom
 *  dims are grammar-open) accept any parser-valid value, not only the
 *  preset lists. Shape-checked first, then confirmed through parseQuery so
 *  validity can never drift from the grammar. */
function parserValidValue(type: string, value: string): boolean {
  const v = value.trim();
  if (type === 'time') {
    if (v.toLowerCase() === 'all') return true;
    if (!/^last\s+\d+[dw]$/i.test(v)) return false;
    const probe = parseQuery(`:note ${v}`);
    return !probe.error && probe.family === 'find' && probe.window?.kind === 'relative';
  }
  if (type === 'rollup') {
    if (!/^\d+[dw]$/i.test(v)) return false;
    const probe = parseQuery(`sum:tis{}.rollup(${v})`);
    return !probe.error && probe.family === 'aggregate' && probe.rollup !== undefined;
  }
  if (type === 'groupby') {
    if (!/^[a-zA-Z][\w-]*$/.test(v)) return false;
    const probe = parseQuery(`sum:tis{} by {${v}}`);
    return !probe.error && probe.family === 'aggregate' && (probe.groupBy?.includes(v));
  }
  return true;
}

export function useClauseItems(
  clause: QueryClause | undefined,
  filterQuery: string,
  options?: { dropSelected?: boolean; supportedValues?: readonly string[] },
): ClauseItemsResult {
  const type = clause?.type ?? '';
  const { items: dynamicItems, loading, binding } = useSuggestions(type);
  const staticItems = STATIC_OPTIONS[type];
  // Dynamic tag keys (app-registered custom types) OR their values like the
  // builtin tags — every suggestion-backed field toggles in place; only
  // binding-less structural/freetext fields stay single-select.
  const isMulti = type in MULTI_VALUE_TYPES || !!binding;
  const selectedValues = clause?.value
    ? clause.value.split('|').map((v) => v.trim()).filter(Boolean)
    : [];

  // Root-supplied consumer-accurate list (e.g. content card-grouping
  // dimensions): authoritative AND closed — binding/static are ignored and
  // no typed exact-value action is offered; unsupported existing values stay
  // Advanced-editable, never silently replaced.
  const supplied = options?.supportedValues !== undefined;
  const rawItems: { value: string; label: string }[] = supplied
    ? options!.supportedValues!.map((v) => ({ value: v, label: v }))
    : binding
      ? dynamicItems.map((s) => ({ value: s.value, label: s.label ?? s.value }))
      : (staticItems ?? dynamicItems.map((s) => ({ value: s.value, label: s.label ?? s.value })));

  // Wildcard alignment: when every selected value carries the `*` flag,
  // base suggestions are compared/toggled in wildcard form so existing
  // selections stay checked and never duplicate; mixed flags keep the exact
  // stored forms (per-value semantics). Typed exact values stay committable.
  const allWildcard = selectedValues.length > 0 && selectedValues.every((v) => v.endsWith('*'));
  const baseItems = allWildcard
    ? rawItems.map((i) => (i.value.endsWith('*') ? i : { ...i, value: `${i.value}*` }))
    : rawItems;

  // Selected known values survive refreshed sources (work item 4): a value
  // missing from a vocab-backed list is merged back so it stays visible and
  // toggleable. Pure freetext slots (no vocab, no binding) keep no rows.
  const present = new Set(baseItems.map((i) => i.value.toLowerCase()));
  const missing = (supplied || staticItems || binding) && !options?.dropSelected
    ? selectedValues.filter((v) => !present.has(v.toLowerCase())).map((v) => ({ value: v, label: v }))
    : [];
  const items = missing.length ? [...baseItems, ...missing] : baseItems;

  const query = filterQuery.trim().toLowerCase();
  const filteredItems = query
    ? items.filter(
        (item) =>
          item.value.toLowerCase().includes(query) ||
          item.label.toLowerCase().includes(query),
      )
    : items;

  // Open slots accept typed values: suggestion-backed fields honor the
  // binding's openness; closed static vocab rejects unknown values — except
  // metric/unit (grammar-open words) and time/rollup (parser-validated).
  // Supplied lists are consumer-accurate and always closed.
  const openSlot = supplied
    ? false
    : !staticItems || binding
      ? (binding?.open ?? true)
      : type === 'metric' || type === 'unit' || type === 'time' || type === 'rollup';

  // Visible commit affordance for typed free text (#854), deduplicated
  // against the full list so an exact match never hides a valid action.
  const typedValue = filterQuery.trim();
  const parserOk = parserValidValue(type, typedValue);
  const canCommitTyped =
    typedValue.length > 0 &&
    openSlot &&
    parserOk &&
    !items.some((item) => item.value.toLowerCase() === typedValue.toLowerCase());

  let emptyText: string | null = null;
  if (filteredItems.length === 0 && !canCommitTyped) {
    if (loading) emptyText = 'Loading…';
    else if (items.length === 0) emptyText = binding?.emptyText ?? 'Nothing here yet';
    else if (!query) emptyText = 'No options';
    else if (!openSlot) emptyText = 'No matches — no such option';
    else if (!parserOk) emptyText = `No matches — not a valid ${getClauseMeta(type).label.toLowerCase()} value`;
    else emptyText = 'No matches';
  }

  return {
    isMulti,
    selectedValues,
    items,
    filteredItems,
    typedValue,
    canCommitTyped,
    loading,
    openSlot,
    hasFilterInput: true,
    emptyText,
  };
}
