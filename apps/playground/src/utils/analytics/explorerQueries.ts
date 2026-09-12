import { parseQuery, serialize, type AnyParsedQuery, type QueryResult, type TagFilter } from '@bitcobblers/wod-wiki-engine';

export interface ExampleQuery {
  query: string;
  label: string;
  question: string;
}

/** Example queries adapted to the real analytics vocabulary shipped in the store.
 *  Keys come from resolveCanonicalMetricKey / summary facts: totalVolume, tis,
 *  sessionLoad, totalReps. Tag keys are the ones QueryService can filter on. */
export const EXAMPLE_QUERIES: ExampleQuery[] = [
  {
    query: 'sum:totalVolume{discipline:strength} by {week}.rollup(1w)',
    label: 'Weekly strength volume',
    question: 'Is strength volume rising?',
  },
  {
    query: 'avg:tis{effort:thruster} by {week}.rollup(1w)',
    label: 'Thruster time-in-motion',
    question: 'Is time-in-motion improving?',
  },
  {
    query: 'sum:totalReps{discipline:strength} by {effort}',
    label: 'Reps by lift',
    question: 'Where do the reps go?',
  },
  {
    query: 'last:sessionLoad{note:benchmark} by {session}',
    label: 'Benchmark loads',
    question: 'Is session load dropping?',
  },
  {
    query: 'sum:sessionLoad{} by {intensity}.rollup(1w)',
    label: 'Polarized weekly load',
    question: 'Is my intensity 80/20?',
  },
  {
    query: 'avg:calc.acwr{}.rollup(1d)',
    label: 'Injury risk (ACWR)',
    question: 'Am I spiking my workload?',
  },
  {
    query: 'count:totalReps{tags:mobility} by {week}.rollup(1w)',
    label: 'Mobility habit',
    question: 'Did I do mobility work?',
  },
  {
    query: 'avg:tis{} by {round}',
    label: 'TIS by round',
    question: 'Where does the pace fall apart?',
  },
  {
    query: 'sum:totalVolume{} by {effort}',
    label: 'Volume by lift',
    question: 'Where does the volume go?',
  },
  {
    query: 'find:note{tags:pr,source:journal}',
    label: 'Find PR notes',
    question: 'Which notes are tagged PR?',
  },
  {
    query: 'find:note{type:wod,source:journal} last 8w',
    label: 'Recent workouts',
    question: 'What workouts did I do recently?',
  },
  {
    query: 'find:note{source:collections}',
    label: 'Library workouts',
    question: 'What workouts are in the library?',
  },
  {
    query: 'find:block{text:fran,source:all}',
    label: 'Find Fran everywhere',
    question: 'Which blocks mention Fran?',
  },
];

/** Re-serialize a parsed WQL query back to the canonical string form — the
 * engine's C6 total serializer (fixed-point on canonical text). */
export function serializeQuery(parsed: AnyParsedQuery): string {
  return serialize(parsed);
}

/** Add or replace a tag filter on a WQL query string. Errored queries are left unchanged. */
export function addFilterToQuery(query: string, key: string, value: string): string {
  const parsed = parseQuery(query) as AnyParsedQuery;
  if (parsed.error) return query;

  const existingIndex = parsed.filters.findIndex((f) => f.key === key);
  const filter: TagFilter = { key, negate: false, values: [{ value, wildcard: false }] };
  if (existingIndex >= 0) {
    parsed.filters[existingIndex] = filter;
  } else {
    parsed.filters.push(filter);
  }
  return serializeQuery(parsed);
}

/** Shape decision for chart rendering — mirrors useChartShape so it can be tested synchronously. */
export type QueryChartShape =
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'scalar'; value: number }
  | { kind: 'timeseries' }
  | { kind: 'bars' };

export function getQueryChartShape(query: string | undefined, result: QueryResult | undefined): QueryChartShape {
  if (!query || query.trim().length === 0) return { kind: 'empty' };
  if (!result) return { kind: 'empty' };
  if (result.parsed.error) return { kind: 'error', message: result.parsed.error };
  if (result.series.length === 0) return { kind: 'empty' };
  if (result.series.length === 1 && result.series[0].points.length === 1) {
    return { kind: 'scalar', value: result.series[0].points[0].value };
  }
  return result.series.some((s) => s.points.length > 1) ? { kind: 'timeseries' } : { kind: 'bars' };
}
