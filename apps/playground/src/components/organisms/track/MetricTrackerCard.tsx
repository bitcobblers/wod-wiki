import React from 'react';
import { useLiveSessionTelemetry, type LiveSummaryMetric } from '@/hooks/useRuntimeTimer';
import { Sigma } from 'lucide-react';
import { cn } from '@/lib/utils';
import { computeColumnLabel, formatDurationSmart } from '@bitcobblers/wod-wiki-engine';
import { getMetricColorClasses, getMetricIcon } from '@/views/runtime/metricColorMap';

export interface MetricTrackerCardProps {
    className?: string;
    /** Direct typed summary metrics (used by stateless Cast receiver frames). */
    summariesOverride?: readonly LiveSummaryMetric[];
    /** Fixture/test seam for static entries without a live runtime. */
    entriesOverride?: Array<{ label: string; value: unknown; unit?: string; metricType?: string }>;
}

/** Time-like metric types whose numeric values represent milliseconds. */
const TIME_LIKE_TYPES: Record<string, true> = {
    duration: true,
    time: true,
    elapsed: true,
    total: true,
    spans: true,
};

/** Format a tracker value based on inferred metric type and unit. */
export function formatTrackerValue(value: unknown, type: string, unit?: string): string {
    if (value === undefined || value === null) return '—';
    if (typeof value === 'string') return value;
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);

    // Time-like values: assume milliseconds if no explicit time unit
    if (TIME_LIKE_TYPES[type]) {
        const timeUnit = unit?.toLowerCase();
        if (timeUnit === 'sec' || timeUnit === 's') {
            return formatDurationSmart(value * 1000);
        }
        if (timeUnit === 'min' || timeUnit === 'm') {
            return formatDurationSmart(value * 60 * 1000);
        }
        if (timeUnit === 'h' || timeUnit === 'hr') {
            return formatDurationSmart(value * 60 * 60 * 1000);
        }
        return formatDurationSmart(value);
    }

    // Standard numeric formatting
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(1);
}

/**
 * MetricTrackerCard - Renders typed live Summary Metrics as compact bubbles.
 * Collapses to 0px when no summaries exist so narrow/short screens lose zero
 * vertical space.
 */
export const MetricTrackerCard: React.FC<MetricTrackerCardProps> = ({
    className,
    summariesOverride,
    entriesOverride,
}) => {
    const liveTelemetry = useLiveSessionTelemetry();

    const items: Array<{ key: string; label: string; value: unknown; unit?: string; metricType: string }> =
        summariesOverride
            ? summariesOverride.map((s) => ({
                key: s.key,
                label: s.label,
                value: s.value,
                unit: s.unit || undefined,
                metricType: String(s.metricType || 'metric'),
            }))
            : entriesOverride
                ? entriesOverride.map((entry) => ({
                    key: entry.label,
                    label: computeColumnLabel(entry.label),
                    value: entry.value,
                    unit: entry.unit || undefined,
                    metricType: entry.metricType ?? 'metric',
                }))
                : liveTelemetry.summaries.map((s) => ({
                    key: s.key,
                    label: s.label,
                    value: s.value,
                    unit: s.unit || undefined,
                    metricType: String(s.metricType || 'metric'),
                }));

    if (items.length === 0) {
        return null;
    }

    return (
        <div className={cn("flex min-h-11 flex-shrink-0 flex-wrap items-center justify-center gap-2 overflow-hidden px-4 py-1", className)}>
            {items.map((item) => {
                const colorClasses = getMetricColorClasses(item.metricType);
                const icon = getMetricIcon(item.metricType);
                const formattedValue = formatTrackerValue(item.value, item.metricType, item.unit);

                return (
                    <div
                        key={`bubble-${item.key}`}
                        className={cn(
                            "flex flex-col items-center backdrop-blur-md border rounded-xl px-3 py-1.5 shadow-sm ring-1 ring-black/5 dark:ring-white/5 group transition-colors",
                            colorClasses
                        )}
                    >
                        <div className="flex items-center gap-1.5 opacity-70">
                            {icon && (
                                <span className="text-[10px] leading-none" aria-hidden="true">{icon}</span>
                            )}
                            <span className="text-[8px] font-black uppercase tracking-tighter group-hover:opacity-100 transition-opacity">
                                {item.label}
                            </span>
                        </div>
                        <div className="flex items-baseline gap-0.5">
                            <span className="text-sm font-black tabular-nums tracking-tight">
                                {formattedValue}
                            </span>
                            {item.unit && !TIME_LIKE_TYPES[item.metricType] && (
                                <span className="text-[9px] font-bold opacity-60 uppercase">{item.unit}</span>
                            )}
                        </div>
                    </div>
                );
            })}

            <div className="self-center bg-primary/10 border border-primary/20 rounded-full p-1.5 shadow-inner opacity-40 hover:opacity-100 transition-opacity cursor-help" title="Session Aggregates">
                <Sigma className="h-3 w-3 text-primary" />
            </div>
        </div>
    );
};
