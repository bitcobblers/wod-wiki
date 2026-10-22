/**
 * WQL Library Search — a shared WqlComposer driving :note find queries over
 * the ACTIVE database through the app's IndexedDB-wired queryService.
 *
 * The composer resolves the draft synchronously (query/onQueryChange); Run
 * (or Enter) submits the valid draft. Invalid drafts surface the shared
 * diagnostics strip; a failed execution shows an error message instead of
 * an empty list.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  isFindQuery,
  parseQuery,
  type FindQueryResult,
} from '@bitcobblers/wod-wiki-engine';
import { WqlComposer } from '@bitcobblers/wod-wiki-ui';
import { queryService } from '@/services/queryService';
import { formatDateMedium } from '@/lib/dateFormat';
import { useDatabase } from '../database/DatabaseContext';

const SEED_QUERY = ':note{}';

export function WqlLibrarySearchPage() {
  const { dataVersion } = useDatabase();
  const [draft, setDraft] = useState(SEED_QUERY);
  const [result, setResult] = useState<FindQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async (wql: string) => {
    const parsed = parseQuery(wql);
    if (parsed.error || !isFindQuery(parsed)) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await queryService.runFind(parsed));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  // First paint runs the seed query so the page never opens blank. It re-runs
  // when the active database's content changes (the seed import lands, or the
  // user switches databases) — otherwise the result would stay empty.
  useEffect(() => { void run(SEED_QUERY); }, [run, dataVersion]);

  const draftParsed = parseQuery(draft);
  const notFind = !draftParsed.error && !isFindQuery(draftParsed);

  return (
    <div className="max-w-3xl space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground">WQL Library Search</h2>
        <p className="text-xs text-muted-foreground">
          Find notes in the active database. Enter or Run submits the composed query.
        </p>
      </div>

      <WqlComposer
        initialQuery={SEED_QUERY}
        query={draft}
        onQueryChange={setDraft}
        onSubmit={(wql) => void run(wql)}
        actionLabel="Run"
        placeholder=":note{tags:strength}"
      />

      {notFind && (
        <p className="text-xs text-muted-foreground" data-testid="library-search-not-find">
          This page runs find queries only — try <code className="font-mono">:note{'{…}'}</code>.
        </p>
      )}

      {error && (
        <div
          className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          data-testid="library-search-error"
          role="alert"
        >
          Query failed: {error}
        </div>
      )}

      <div className="rounded border border-border bg-card" data-testid="library-search-results">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {running ? 'Running…' : `${result?.notes.length ?? 0} note${result?.notes.length === 1 ? '' : 's'}`}
          </span>
          {result && (
            <span className="font-mono text-[10px] text-muted-foreground" data-testid="library-search-stages">
              selected {result.stages.selected} → matched {result.stages.matched}
            </span>
          )}
        </div>
        {result && result.notes.length === 0 && !error && (
          <p className="px-3 py-4 text-sm text-muted-foreground" data-testid="library-search-empty">
            No notes match this query in the active database.
          </p>
        )}
        <ul>
          {result?.notes.map((note) => (
            <li
              key={note.id}
              className="flex flex-wrap items-baseline gap-x-2 border-b border-border/50 px-3 py-2 last:border-b-0"
              data-testid="library-search-row"
            >
              <span className="text-sm font-medium text-primary">{note.title}</span>
              <span className="text-xs text-muted-foreground" data-testid="library-search-row-date">
                {formatDateMedium(new Date(note.date ?? note.createdAt))}
              </span>
              {note.tags && note.tags.length > 0 && (
                <span className="flex flex-wrap gap-1" data-testid="library-search-row-tags">
                  {note.tags.map((tag) => (
                    <span key={tag} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
