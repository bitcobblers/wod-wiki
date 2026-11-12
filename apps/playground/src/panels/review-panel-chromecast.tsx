/**
 * review-panel-chromecast.tsx — Chromecast receiver review panel.
 *
 * Intentionally separate from `ReviewGrid`: the receiver is a 10-foot TV
 * surface that needs large cards, D-pad navigation, and no inline editing.
 * It still consumes the shared summary payload (`reviewData.rows` and
 * `analyticsSummary.projections`) so the data contract stays aligned even
 * though the presentation stays TV-specific.
 *
 * Extracted from receiver-rpc.tsx ReceiverReviewPanel.
 */

import React from 'react';
import type { WorkbenchDisplayState } from '@/services/cast/rpc/RpcMessages';
import type { FocusProps } from '@/hooks/useSpatialNavigation';
import { cn } from '@/lib/utils';
import {
    Timer,
    CheckCircle2,
    BarChart3,
    X,
} from 'lucide-react';

interface ProjectionLike {
    name: string;
    value: number;
    unit: string;
    metricType?: string;
}

/**
 * Aggregate projections by metricType, summing values.
 *
 * Projections that share a metricType (e.g. per-exercise volume cards) are
 * merged into a single session-level card so the TV grid stays compact
 * (design limit: ≤6 cards visible, 2-column layout).
 *
 * Projections without a metricType are kept as-is (treated as unique).
 */
/**
 * @internal Exported for unit testing only.
 */
export function aggregateProjections(projections: ProjectionLike[]): ProjectionLike[] {
    const grouped = new Map<string, ProjectionLike[]>();
    const ungrouped: ProjectionLike[] = [];

    for (const proj of projections) {
        const type = proj.metricType?.toString().toLowerCase();
        if (type) {
            if (!grouped.has(type)) grouped.set(type, []);
            grouped.get(type)!.push(proj);
        } else {
            ungrouped.push(proj);
        }
    }

    const aggregated: ProjectionLike[] = [];

    for (const [type, items] of grouped.entries()) {
        const totalValue = items.reduce((sum, p) => sum + p.value, 0);
        // Use the most common unit; fallback to the first item's unit.
        const unitCounts = new Map<string, number>();
        for (const item of items) {
            unitCounts.set(item.unit, (unitCounts.get(item.unit) ?? 0) + 1);
        }
        let bestUnit = items[0].unit;
        let bestCount = 0;
        for (const [unit, count] of unitCounts.entries()) {
            if (count > bestCount) {
                bestCount = count;
                bestUnit = unit;
            }
        }
        aggregated.push({
            name: aggregatedName(type, items[0].name),
            value: totalValue,
            unit: bestUnit,
            metricType: type,
        });
    }

    // Preserve original order: interleave ungrouped projections in their
    // original positions relative to aggregated groups.
    const result: ProjectionLike[] = [];
    const seenTypes = new Set<string>();
    for (const proj of projections) {
        const type = proj.metricType?.toString().toLowerCase();
        if (!type) {
            result.push(proj);
        } else if (!seenTypes.has(type)) {
            seenTypes.add(type);
            const agg = aggregated.find(a => a.metricType === type);
            if (agg) result.push(agg);
        }
    }

    return result;
}

/**
 * @internal Exported for unit testing only.
 */
export function aggregatedName(metricType: string, fallback: string): string {
    switch (metricType) {
        case 'volume': return 'Total Volume';
        case 'rep':
        case 'reps':
        case 'repetitions': return 'Total Reps'; // 'repetitions' kept for legacy rows
        case 'distance': return 'Total Distance';
        case 'work': return 'Total Energy';
        case 'load': return 'Total Load';
        case 'elapsed': return 'Total Time';
        case 'duration': return 'Total Duration';
        default: return fallback;
    }
}

export const ReceiverReviewPanel: React.FC<{
    reviewData: NonNullable<WorkbenchDisplayState['reviewData']>;
    analyticsSummary?: WorkbenchDisplayState['analyticsSummary'];
    /** Called when user selects the dismiss button (D-Pad Select or click). */
    onDismiss?: () => void;
    /** Spatial navigation registration — pass from useSpatialNavigation. */
    getFocusProps?: (id: string) => FocusProps;
}> = ({ reviewData, analyticsSummary, onDismiss, getFocusProps }) => {
    // Prefer analytics summary if available, otherwise fall back to simple rows
    const rawProjections = analyticsSummary?.projections ?? [];
    const projections = rawProjections.length > 0 ? aggregateProjections(rawProjections) : [];
    const totalDurationMs = analyticsSummary?.totalDurationMs ?? reviewData?.totalDurationMs ?? 0;
    const completedSegments = analyticsSummary?.completedSegments ?? reviewData?.completedSegments ?? 0;

    // Format total duration
    const formatDuration = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    };

    return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-8 p-12 bg-background">
            {/* Header */}
            <div className="flex flex-col items-center gap-3">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
                <h1 className="text-4xl font-bold text-foreground">Workout Complete</h1>
            </div>

            {/* Analytics Summary View */}
            {projections.length > 0 ? (
                <div className="w-full max-w-2xl flex flex-col gap-4">
                    {/* Total Duration Card */}
                    <div className="bg-card/50 border border-border/60 rounded-xl p-6 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Timer className="h-6 w-6 text-primary" />
                            <div className="flex flex-col">
                                <span className="text-sm text-muted-foreground">Total Duration</span>
                                <span className="text-3xl font-bold text-foreground font-mono">
                                    {formatDuration(totalDurationMs)}
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground/60">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="text-xs font-mono uppercase tracking-wider">
                                {completedSegments} segments
                            </span>
                        </div>
                    </div>

                    {/* Projection Results Grid */}
                    <div className="grid grid-cols-2 gap-3 w-full">
                        {projections.map((proj, index) => {
                            return (
                                <div
                                    key={index}
                                    className={cn(
                                        "flex flex-col items-center gap-3 p-5 rounded-xl border transition-all",
                                        "bg-card/50 border-border/60 hover:bg-card/80"
                                    )}
                                >
                                    {/* Metric Value */}
                                    <div className="flex flex-col items-center gap-1">
                                        <span className="text-2xl font-bold text-foreground font-mono">
                                            {proj.value.toLocaleString()}
                                            <span className="text-sm font-medium text-muted-foreground ml-1">
                                                {proj.unit}
                                            </span>
                                        </span>
                                    </div>

                                    {/* Metric Name */}
                                    <span className="text-sm font-medium text-muted-foreground text-center">
                                        {proj.name}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                // Fallback to simple rows if no projections available
                <div className="w-full max-w-md flex flex-col gap-2">
                    {reviewData?.rows.map((row, i) => (
                        <div
                            key={i}
                            className={cn(
                                "flex items-center justify-between rounded-lg px-5 py-3 text-base",
                                i === 0
                                    ? "bg-primary/10 border border-primary/30 font-bold"
                                    : "bg-card/40 border border-border/40"
                            )}
                        >
                            <span className="text-muted-foreground">{row.label}</span>
                            <span className="font-mono font-semibold text-foreground">{row.value}</span>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-center gap-2 text-muted-foreground/50">
                <BarChart3 className="h-4 w-4" />
                <span className="text-xs font-mono uppercase tracking-widest">
                    {completedSegments} segments completed
                </span>
            </div>

            {/* Dismiss button — D-Pad focusable, returns receiver to waiting state */}
            <div className="flex flex-col items-center gap-2">
                <button
                    {...(getFocusProps ? getFocusProps('btn-dismiss') : {})}
                    onClick={onDismiss}
                    className={cn(
                        "flex items-center gap-3 px-8 py-4 rounded-xl",
                        "border border-primary/30 bg-primary/10 text-primary",
                        "text-lg font-semibold tracking-wide",
                        "transition-all duration-150",
                        "hover:bg-primary/20 hover:border-primary/50",
                        "focus:outline-none",
                        // D-Pad focus ring — visible at 10 ft on TV
                        "data-[nav-focused=true]:bg-primary data-[nav-focused=true]:text-primary-foreground",
                        "data-[nav-focused=true]:ring-4 data-[nav-focused=true]:ring-primary/60",
                        "data-[nav-focused=true]:scale-105",
                    )}
                >
                    <X className="h-5 w-5" />
                    Dismiss
                </button>
                {/* D-pad hint — reminds TV viewers how to trigger the button */}
                <span className="text-xs text-muted-foreground/30 font-mono uppercase tracking-widest">
                    ⊙ Select
                </span>
            </div>
        </div>
    );
};
