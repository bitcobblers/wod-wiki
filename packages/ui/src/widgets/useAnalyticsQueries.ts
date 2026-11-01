import { useEffect, useState } from 'react';
import { parseQuery, SharedQueryDocumentRunner, type QueryResult } from '@bitcobblers/wod-wiki-wql';
import type { QueryExecutor } from '../contracts/query';
import { createExecutorDocumentHost, outputToRunResult } from './chartData';
const DAY = 86_400_000;
const WEEK = 7 * DAY;

export interface AnalyticsQueryDef {
  key: string;
  query: string;
}

export interface AnalyticsQueriesState {
  results: Record<string, QueryResult>;
  loading: boolean;
}

export function useAnalyticsQueries(
  queries: AnalyticsQueryDef[],
  weeks: number,
  executor?: QueryExecutor,
  refreshKey = 0,
  preferredUnit?: string,
  onEnsureRollupFacts?: () => Promise<void>,
): AnalyticsQueriesState {
  const [results, setResults] = useState<Record<string, QueryResult>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!executor) {
        if (!cancelled) setLoading(false);
        return;
      }

      const now = Date.now();
      const rangeStart = now - weeks * WEEK;
      // Ticket 19 cutover: widget queries evaluate through the shared
      // document runner — family dispatch (aggregate/find/rows/pipeline),
      // AST-driven rollup-ensure, and one captured context per query run.
      const host = createExecutorDocumentHost(executor, {
        rangeStart,
        rangeEnd: now,
        preferredUnit,
        rollupEnsure: onEnsureRollupFacts,
      });
      const runner = new SharedQueryDocumentRunner(host);
      try {
        const settled = await Promise.all(
          queries.map(async (q) => {
            const res = await runner.run(q.query);
            const out = res.outputs[0];
            const error = out?.error ?? res.diagnostics[0];
            const parsed = parseQuery(q.query);
            const result = out
              ? outputToRunResult(parsed, { ...out, ...(error ? { error } : {}) })
              : outputToRunResult(parsed, { name: q.key, kind: 'aggregate', error });
            return [q.key, result] as const;
          }),
        );
        if (!cancelled) setResults(Object.fromEntries(settled));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [queries, weeks, executor, refreshKey, preferredUnit, onEnsureRollupFacts]);

  return { results, loading };
}
