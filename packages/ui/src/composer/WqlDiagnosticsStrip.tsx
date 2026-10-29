import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../utils/cn';
import { isAggregateQuery, isFindQuery, isPipelineQuery, wqlGroupingDimensions } from '@bitcobblers/wod-wiki-wql';
import { summarizeAggregate, summarizeFind, summarizePipeline, type WqlDiagnostics } from './diagnostics';
import type { WqlStageCounts } from './useWqlStageCounts';

export interface WqlDiagnosticsStripProps {
  diagnostics: WqlDiagnostics;
  offendingLabel?: string;
  stages?: WqlStageCounts;
  /** Hide the AST summary chips (target/scope/time or agg/metric/by…) —
   *  header contexts where the pills right below already show that state. */
  hideSummary?: boolean;
  /** 'card' (default) renders the rounded, bordered bubble. 'header' renders
   *  a flat header section separated from the composer by an accent line. */
  variant?: 'card' | 'header';
  actions?: ReactNode;
  className?: string;
}

function SummaryChip({ label, value, testId, warnTitle }: { label: string; value: string; testId: string; warnTitle?: string }) {
  const legacyTestId = testId.startsWith('diag-') ? testId.replace('diag-', 'wql-') : testId;
  return (
    <span data-testid={testId} title={warnTitle} className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="opacity-60">{label}:</span>
      <span data-testid={legacyTestId} className={cn('font-semibold', warnTitle && 'text-signal-caution underline decoration-wavy underline-offset-2')}>{value}</span>
    </span>
  );
}

export function WqlDiagnosticsStrip({
  diagnostics,
  offendingLabel,
  stages,
  hideSummary = false,
  variant = 'card',
  actions,
  className,
}: WqlDiagnosticsStripProps) {
  const { valid, ast, error } = diagnostics;
  const header = variant === 'header';
  const advisories = ast.advisories ?? [];
  const supportedDims = new Set(isPipelineQuery(ast) ? [] : wqlGroupingDimensions(ast.family === 'find' ? ast.target : '', ast.family));
  const unsupportedDims = isPipelineQuery(ast) ? [] : (ast.groupBy ?? []).filter(dim => !supportedDims.has(dim));
  const warning = valid && (advisories.length > 0 || unsupportedDims.length > 0);
  const warningMessage = advisories[0] ?? `Unsupported grouping: ${unsupportedDims.join(', ')}`;

  return (
    <div
      data-testid="wql-diagnostics-strip"
      aria-live="polite"
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3 py-1.5 text-xs font-mono transition-colors',
        header
          ? valid
            ? 'border-b border-border/60 bg-muted/20 text-muted-foreground'
            : 'border-b border-destructive/40 bg-destructive/5 text-destructive'
          : cn(
              'rounded-lg border',
              valid
                ? 'bg-muted/30 border-border text-muted-foreground'
                : 'bg-destructive/5 border-destructive/30 text-destructive',
            ),
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5 font-medium" data-testid="wql-validity-badge" data-valid={valid} data-warning={warning || undefined} role={valid ? 'status' : 'alert'} aria-live="polite">
          {valid ? (
            warning ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-signal-caution shrink-0" />
                <span className="text-signal-caution">Warning</span>
                <span className="opacity-80">{warningMessage}</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-signal-positive shrink-0" />
                <span className="text-signal-positive">Valid</span>
              </>
            )
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
              <span>Invalid</span>
              <span>
                {offendingLabel ? `${offendingLabel}: ` : ''}
                {error || 'Syntax error'}
              </span>
            </>
          )}
        </div>

        {!hideSummary && valid && isFindQuery(ast) && (
          <div className="flex flex-wrap items-center gap-x-3 text-[11px] opacity-80 border-l border-border/50 pl-3">
            {(() => {
              const summary = summarizeFind(ast);
              return (
                <>
                  <SummaryChip label="target" value={summary.target} testId="diag-summary-target" />
                  <SummaryChip label="scope" value={summary.scope} testId="diag-summary-scope" />
                  {summary.timeWindow && (
                    <SummaryChip label="time" value={summary.timeWindow} testId="diag-summary-time" />
                  )}
                  {summary.groupBy && (
                    <SummaryChip
                      label="by"
                      value={summary.groupBy}
                      testId="diag-summary-groupby"
                      warnTitle={unsupportedDims.length > 0 ? `Unsupported grouping: ${unsupportedDims.join(', ')}` : undefined}
                    />
                  )}
                  {summary.hasJoin && (
                    <span data-testid="diag-summary-join" className="text-primary font-semibold">
                      +join
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {!hideSummary && valid && isAggregateQuery(ast) && (
          <div className="flex flex-wrap items-center gap-x-3 text-[11px] opacity-80 border-l border-border/50 pl-3">
            {(() => {
              const summary = summarizeAggregate(ast);
              return (
                <>
                  <SummaryChip label="agg" value={summary.agg} testId="diag-summary-agg" />
                  {summary.metric && (
                    <SummaryChip label="metric" value={summary.metric} testId="diag-summary-metric" />
                  )}
                  {summary.groupBy && (
                    <SummaryChip
                      label="by"
                      value={summary.groupBy}
                      testId="diag-summary-groupby"
                      warnTitle={unsupportedDims.length > 0 ? `Unsupported grouping: ${unsupportedDims.join(', ')}` : undefined}
                    />
                  )}
                  {summary.rollup && (
                    <SummaryChip label="every" value={summary.rollup} testId="diag-summary-rollup" />
                  )}
                  {summary.unit && (
                    <SummaryChip label="as" value={summary.unit} testId="diag-summary-unit" />
                  )}
                </>
              );
            })()}
          </div>
        )}

        {!hideSummary && valid && isPipelineQuery(ast) && (
          <div className="flex flex-wrap items-center gap-x-3 text-[11px] opacity-80 border-l border-border/50 pl-3">
            {(() => {
              const summary = summarizePipeline(ast);
              return (
                <>
                  <SummaryChip label="source" value={summary.source} testId="diag-summary-source" />
                  {summary.functions.map((fn, i) => (
                    <SummaryChip key={i} label={`fn ${i + 1}`} value={fn} testId={`diag-summary-fn-${i + 1}`} />
                  ))}
                  {summary.sink && (
                    <SummaryChip label="sink" value={summary.sink} testId="diag-summary-sink" />
                  )}
                  {summary.timeWindow && (
                    <SummaryChip label="time" value={summary.timeWindow} testId="diag-summary-time" />
                  )}
                </>
              );
            })()}
          </div>
        )}

        {valid && stages && (
          <div
            data-testid="diag-stage-counts"
            className="text-[11px] font-semibold text-primary border-l border-border/50 pl-3"
          >
            {stages.kind === 'find' ? (
              <span>{stages.matched} matched of {stages.selected}</span>
            ) : (
              <span>
                {stages.selected} selected → {stages.aggregated} aggregated ({stages.groups} series)
              </span>
            )}
          </div>
        )}
      </div>

      {actions && <div className="flex items-center gap-1.5 ml-auto">{actions}</div>}
    </div>
  );
}
