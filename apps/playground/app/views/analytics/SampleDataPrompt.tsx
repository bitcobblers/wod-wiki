import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import { WqlEmptyState } from '@bitcobblers/wod-wiki-ui';
import { hasSampleData, loadSampleData, purgeSampleData } from '@/services/analytics/sample';
import type { QueryResult } from '@bitcobblers/wod-wiki-engine';

export interface SampleDataPromptDeps {
  hasSampleData?: typeof hasSampleData;
  loadSampleData?: typeof loadSampleData;
  purgeSampleData?: typeof purgeSampleData;
}

export interface SampleDataPromptProps {
  result?: QueryResult;
  onChanged?: () => void | Promise<void>;
  /** 'inline' keeps the prompt inside a chart-sized area; 'card' renders a full-width empty-state card; 'banner' renders only the sample-data banner (or nothing if no sample data). */
  layout?: 'inline' | 'card' | 'banner';
  refreshKey?: number | string;
  deps?: SampleDataPromptDeps;
}

export function SampleDataPrompt({ result, onChanged, layout = 'inline', refreshKey, deps }: SampleDataPromptProps) {
  const checkSampleData = deps?.hasSampleData ?? hasSampleData;
  const runLoadSampleData = deps?.loadSampleData ?? loadSampleData;
  const runPurgeSampleData = deps?.purgeSampleData ?? purgeSampleData;
  const [loaded, setLoaded] = useState<boolean | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    setLoaded(await checkSampleData());
    setDismissed(false);
  }, [checkSampleData]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const handleLoad = async () => {
    if (pending) return;
    setPending(true);
    try {
      await runLoadSampleData();
      await refresh();
      await onChanged?.();
    } finally {
      setPending(false);
    }
  };

  const handlePurge = async () => {
    if (pending) return;
    setPending(true);
    try {
      await runPurgeSampleData();
      await refresh();
      await onChanged?.();
    } finally {
      setPending(false);
    }
  };

  const banner = (
    <div className="flex items-center justify-center gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-foreground">
      <span>Sample data loaded</span>
      <button
        type="button"
        onClick={() => { void handlePurge(); }}
        disabled={pending}
        aria-busy={pending}
        className="font-medium text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Purging sample data…' : 'Purge sample data'}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        disabled={pending}
        className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );

  if (layout === 'banner') {
    return loaded && !dismissed ? banner : null;
  }

  const loadPrompt = (
    <div className="text-center">
      <p className="text-xs text-muted-foreground mb-2">
        Facts appear when you log or run workouts.
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => { void handleLoad(); }}
          disabled={pending}
          aria-busy={pending}
          data-testid="sample-data-load-button"
          className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          <span>{pending ? 'Loading sample data…' : 'Preview with sample data'}</span>
        </button>
        <Link
          to="/collections"
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          Log your first workout
        </Link>
      </div>
    </div>
  );

  const inner = loaded ? (dismissed ? null : banner) : loadPrompt;

  if (layout === 'card') {
    return (
      <div className="bg-card border border-border rounded-lg p-6 flex flex-col items-center justify-center text-sm text-muted-foreground">
        {result !== undefined && <WqlEmptyState result={result} />}
        {loaded !== undefined && inner && <div className="mt-3">{inner}</div>}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center">
      {result !== undefined && <WqlEmptyState result={result} />}
      {loaded !== undefined && inner && <div className="mt-3">{inner}</div>}
    </div>
  );
}
