import { ReactNode, useMemo } from 'react';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';

export interface WqlEmptyStateProps {
  result?: QueryResult | undefined;
  className?: string;
  actions?: ReactNode;
  /** Optional message shown when `result` has non-empty series yet the caller could not render them. */
  fallbackMessage?: string;
}

export function WqlEmptyState({ result, className, actions, fallbackMessage }: WqlEmptyStateProps) {
  const message = useMemo(() => {
    if (!result) return 'Loading…';
    if (result.parsed.error) return `Query error: ${result.parsed.error}`;
    if (result.series.length === 0) return 'No data for this range.';
    return fallbackMessage ?? null;
  }, [result, fallbackMessage]);

  if (message === null && !actions) return null;

  return (
    <div className={`h-full flex flex-col items-center justify-center text-sm text-muted-foreground px-4 text-center ${className ?? ''}`}>
      {message && <div>{message}</div>}
      {actions && <div className="mt-3">{actions}</div>}
    </div>
  );
}
