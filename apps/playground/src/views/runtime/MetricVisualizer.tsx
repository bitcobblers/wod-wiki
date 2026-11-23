import React, { useMemo } from 'react';
import { IMetric } from '@bitcobblers/wod-wiki-engine';
import { presentThemedGroup } from '@/components/metrics/presentation';
import { cn } from '../../lib/utils';
import { VisualizerSize, VisualizerFilter } from '@bitcobblers/wod-wiki-engine';
import type { ParseError } from './types';

export interface MetricVisualizerProps {
  /** Array of metric to visualize, grouped by type */
  metrics: IMetric[];

  /** Optional error state to display instead of metrics */
  error?: ParseError | null;

  /** Optional className for container styling */
  className?: string;

  /** Display size variant @default 'normal' */
  size?: VisualizerSize;

  /** Optional filter configuration */
  filter?: VisualizerFilter;
}

/**
 * MetricVisualizer component displays parsed code metrics grouped by type
 * with color-coded visualization and icons.
 */
export const MetricVisualizer = React.memo<MetricVisualizerProps>(({
  metrics,
  error,
  className = '',
  size = 'normal',
  filter,
}) => {

  // Filter metrics logic
  const visibleFragments = useMemo(() => {
    if (!filter) return metrics;

    return metrics.filter(metric => {
      // 1. Check Name Overrides (Highest Priority)
      // Value can be string or object, so we convert to string safely for key lookup
      const valueKey = String(metric.value || '').toLowerCase();
      // Also check type as name for things like 'ellapsed-time' if strictly named that way in data
      // For now assume value or metricType might be used as key? 
      // User said: "overrides by name by specific metric type 'rep' 'ellapsed-time'"
      // Assuming 'ellapsed-time' is a value or specific type? 
      // Let's check both value and type against nameOverrides for flexibility.

      const typeKey = metric.type.toLowerCase();

      if (filter.nameOverrides) {
        if (valueKey in filter.nameOverrides) {
          return filter.nameOverrides[valueKey];
        }
        // Special case: if the user considers the type name as the "name" for overrides
        if (typeKey in filter.nameOverrides) {
          return filter.nameOverrides[typeKey];
        }
      }

      // 2. Check Type Overrides
      if (filter.typeOverrides && typeKey in filter.typeOverrides) {
        return filter.typeOverrides[typeKey];
      }

      // 3. Check Allowed Origins
      if (filter.allowedOrigins) {
        // If allowedOrigins is defined, metrics MUST have a matching origin.
        // If metric has NO origin, we assume 'parser' (default).
        return filter.allowedOrigins.includes(metric.origin || 'parser');
      }

      return true;
    });
  }, [metrics, filter]);

  // Error state takes precedence
  if (error) {
    return (
      <div className={`border border-destructive/50 rounded-lg p-4 bg-destructive/10 ${className}`}>
        <div className="flex items-start gap-2">
          <span className="text-destructive font-bold text-lg">⚠️</span>
          <div className="flex-1">
            <div className="font-semibold text-destructive mb-1">Parse Error</div>
            <div className="text-destructive/90 text-sm">{error.message}</div>
            {(error.line !== undefined || error.column !== undefined) && (
              <div className="text-destructive/80 text-xs mt-2">
                {error.line !== undefined && <span>Line {error.line}</span>}
                {error.line !== undefined && error.column !== undefined && <span>, </span>}
                {error.column !== undefined && <span>Column {error.column}</span>}
              </div>
            )}
            {error.excerpt && (
              <pre className="mt-2 p-2 bg-background border border-destructive/20 rounded text-xs overflow-x-auto text-foreground">
                {error.excerpt}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!visibleFragments || visibleFragments.length === 0) {
    return (
      <div className={`border border-border rounded-lg p-4 bg-muted/20 text-center text-muted-foreground text-sm ${className}`}>
        No metrics to display
      </div>
    );
  }

  const styles = {
    compact: {
      padding: 'px-1 py-0',
      text: 'text-[10px] leading-tight',
      icon: 'text-xs'
    },
    normal: {
      padding: 'px-2 py-0.5',
      text: 'text-sm',
      icon: 'text-base leading-none'
    },
    focused: {
      padding: 'px-2.5 py-1',
      text: 'text-base',
      icon: 'text-lg leading-none'
    }
  };

  const currentStyle = styles[size];

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {presentThemedGroup(visibleFragments, 'runtime-badge')
        .filter(token => token.visible)
        .map((token, index) => {
          if (token.renderKind === 'comment') {
            return (
              <span
                key={index}
                className={cn(
                  'italic text-muted-foreground select-text',
                  currentStyle.text
                )}
                title={`COMMENT: ${token.label}`}
                data-metric-type="comment"
              >
                {token.label}
              </span>
            );
          }

          return (
            <span
              key={index}
              className={cn(
                `inline-flex items-center gap-1 rounded font-mono border ${token.colorClasses} bg-opacity-60 shadow-sm cursor-help transition-colors hover:bg-opacity-80`,
                currentStyle.padding,
                currentStyle.text
              )}
              title={token.tooltip}
              aria-label={token.columnLabel ? `${token.columnLabel}: ${token.label}` : token.label}
            >
              {token.icon && <span className={currentStyle.icon}>{token.icon}</span>}
              <span>{token.label}</span>
            </span>
          );
        })}
    </div>
  );
});

MetricVisualizer.displayName = 'MetricVisualizer';


