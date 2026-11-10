/**
 * useEffortsQueryState — Efforts page URL state adapter.
 *
 * Reads and edits the text/origin/discipline filters of the WQL query state
 * managed by `useEffortsComposerState` — AST reads via `parseQuery`, string
 * writes via the engine serializer (wayfinder ticket 013).
 */

import { useMemo, useCallback } from 'react';
import { parseQuery, serialize } from '@bitcobblers/wod-wiki-engine';
import type { EffortRegistrySource } from '@bitcobblers/wod-wiki-lang';
import { useEffortsComposerState } from './useEffortsComposerState';

export interface EffortsQueryState {
  text: string;
  origin: EffortRegistrySource | 'all';
  discipline: string;
}

/** First non-negated value of a filter key — '' when absent or unparseable. */
function filterValue(query: string, key: string): string {
  const parsed = parseQuery(query);
  if (parsed.error || parsed.family === 'pipeline') return '';
  const f = parsed.filters.find((flt) => flt.key === key && !flt.negate);
  return f?.values.map((v) => v.value).join('|') ?? '';
}

/** Set (or clear, when empty) one filter key, keeping every other clause. */
function withFilter(query: string, key: string, value: string): string {
  const parsed = parseQuery(query);
  if (parsed.error || parsed.family === 'pipeline') return query; // never destroy unparseable state
  const filters = parsed.filters.filter((f) => f.key !== key);
  const trimmed = value.trim();
  if (trimmed) filters.push({ key, negate: false, values: [{ value: trimmed, wildcard: false }] });
  return serialize({ ...parsed, filters });
}

export function useEffortsQueryState() {
  const { query, setQuery } = useEffortsComposerState();

  const text = useMemo(() => filterValue(query, 'text'), [query]);
  const origin = useMemo(
    () => (filterValue(query, 'origin') as EffortRegistrySource | 'all') || 'all',
    [query],
  );
  const discipline = useMemo(() => filterValue(query, 'discipline'), [query]);

  const setText = useCallback(
    (newText: string) => setQuery(withFilter(query, 'text', newText)),
    [query, setQuery],
  );
  const setOrigin = useCallback(
    (newOrigin: EffortRegistrySource | 'all') =>
      setQuery(withFilter(query, 'origin', newOrigin === 'all' ? '' : newOrigin)),
    [query, setQuery],
  );
  const setDiscipline = useCallback(
    (newDiscipline: string) => setQuery(withFilter(query, 'discipline', newDiscipline)),
    [query, setQuery],
  );

  return { text, setText, origin, setOrigin, discipline, setDiscipline };
}
