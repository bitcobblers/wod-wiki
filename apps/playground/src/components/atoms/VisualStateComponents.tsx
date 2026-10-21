import React, { useState, useEffect, useMemo } from 'react';
import { IOutputStatement } from '@bitcobblers/wod-wiki-engine';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { cn } from '@/lib/utils';
import { Clock, CheckCircle2, ListTree, Timer, Table2 } from 'lucide-react';
import { useTimerElapsed, useRoundDisplay, useScriptRuntime, useNextPreview } from '@/hooks/useRuntimeTimer';
import type { IScriptRuntime, IRuntimeBlock, MetricVisibility } from '@/hooks/useRuntimeTimer';
import { formatTimeMMSS } from '../../lib/formatTime';
import { MetricSourceRow } from '@/components/molecules/MetricSourceRow';
import { presentThemedGroup } from '@/components/metrics/presentation';
import { MetricContainer } from '@bitcobblers/wod-wiki-engine';
import { VisibilityBadge } from './VisibilityBadge';
import { useDebugMode } from '@/contexts/DebugModeContext';
import { BlockDebugDialog } from '@/components/organisms/track/BlockDebugDialog';

// ============================================================================
// History View
// ============================================================================

export const HistorySummaryView: React.FC<{
    outputs: IOutputStatement[];
}> = ({ outputs }) => {
    // Filter for completed items (usually blocks/segments)
    const completedItems = outputs.filter(o => o.outputType === 'segment');

    const totalDurationMs = completedItems.reduce((acc, curr) => {
        return acc + ((curr.getMetric(MetricType.Elapsed)?.value as number) ?? 0);
    }, 0);

    const formatDuration = (ms: number) => {
        const seconds = Math.floor(ms / 1000);
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Completed</span>
                </div>
                <span className="font-mono font-medium">{completedItems.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Total Time</span>
                </div>
                <span className="font-mono font-medium">{formatDuration(totalDurationMs)}</span>
            </div>
        </div>
    );
};

// ============================================================================
// Stack View
// ============================================================================

const StackBlockItem: React.FC<{
    block: IRuntimeBlock;
    isLeaf: boolean;
    isRoot?: boolean;
    debug?: boolean;
}> = ({ block, isLeaf, debug: debugProp }) => {
    // Consume debug context directly as fallback if prop not passed
    const { isDebugMode } = useDebugMode();
    const debug = debugProp ?? isDebugMode;
    const runtime = useScriptRuntime();
    const { elapsed, isRunning, timeSpans } = useTimerElapsed(block.key.toString());
    // Subscribe to round state for dynamic round label (updates reactively as rounds advance)
    const roundDisplay = useRoundDisplay(block);
    const [displayRows, setDisplayRows] = useState<MetricContainer[]>([]);
    const [promoteRows, setPromoteRows] = useState<MetricContainer[]>([]);
    const [privateRows, setPrivateRows] = useState<MetricContainer[]>([]);
    const [debugDialogOpen, setDebugDialogOpen] = useState(false);

    // Subscribe to metrics memory by visibility tier
    useEffect(() => {
        const updateRows = () => {
            // Display tier — always collected
            const displayLocs = block.getMetricMemoryByVisibility('display');
            setDisplayRows(displayLocs.map(loc => loc.metrics));

            if (debug) {
                // Promote & private tiers — only in debug mode
                const promoteLocs = block.getMetricMemoryByVisibility('promote');
                setPromoteRows(promoteLocs.map(loc => loc.metrics));

                const privateLocs = block.getMetricMemoryByVisibility('private');
                setPrivateRows(privateLocs.map(loc => loc.metrics));
            }
        };

        updateRows();

        // Subscribe to all metrics memory locations for reactivity
        const allLocs = debug
            ? [
                ...block.getMetricMemoryByVisibility('display'),
                ...block.getMetricMemoryByVisibility('promote'),
                ...block.getMetricMemoryByVisibility('private'),
            ]
            : block.getMetricMemoryByVisibility('display');

        const unsubscribes = allLocs.map(loc =>
            loc.subscribe(() => updateRows())
        );

        return () => unsubscribes.forEach(unsub => unsub());
    }, [block, debug]);

    // Only show timer if there are active or completed time spans (it's a time tracker)
    const hasTime = timeSpans.length > 0;

    /** Render a visibility-tagged section of metrics rows */
    const renderFragmentSection = (
        rows: MetricContainer[],
        visibility: MetricVisibility,
        showBadge: boolean,
        isLeaf: boolean
    ) => {
        if (rows.length === 0) return null;
        return (
            <div className="flex flex-col gap-0.5">
                {showBadge && <VisibilityBadge visibility={visibility} />}
                {rows.map((row, rowIdx) => (
                    <MetricSourceRow
                        key={`${visibility}-${rowIdx}`}
                        metrics={row}
                        size={isLeaf ? "normal" : "compact"}
                        isLeaf={isLeaf}
                    />
                ))}
            </div>
        );
    };

    // Counts-first labels: a round level reads "Round 2 / 3", every other
    // level keeps its plain label (session root always block.label).
    const isRoundLevel = !isLeaf && roundDisplay != null;

    // Leaf metric chips — prototype .mt-chip: small mono chips tinted by the
    // metric hue (themed presentation tokens carry the metric-* classes).
    // Tokens repeating the leaf label (e.g. the effort naming the exercise)
    // are dropped when the label is already shown as the card title.
    const leafChips = useMemo(() => {
        const tokens = displayRows.flatMap(row =>
            presentThemedGroup([...row], 'runtime-badge').filter(t => t.visible)
        );
        const label = block.label?.trim();
        return label ? tokens.filter(t => t.label.trim() !== label) : tokens;
    }, [displayRows, block.label]);

    // Debug inspect button — available on every block
    const inspectButton = debug && (
        <button
            onClick={() => setDebugDialogOpen(true)}
            className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Inspect block"
        >
            <Table2 className="h-4 w-4" />
        </button>
    );

    return (
        <div
            className={cn(
                "relative w-full",
                isLeaf ? "animate-in fade-in slide-in-from-left-1 duration-300" : ""
            )}
        >
            <div className={cn(
                "rounded-md border text-sm transition-all",
                isLeaf
                    ? "bg-card shadow-sm border-primary/40 ring-1 ring-primary/15"
                    : "bg-muted/40 border-transparent text-muted-foreground hover:bg-muted/50 hover:border-border/50"
            )}>
                {isLeaf ? (
                    /* Active leaf card — prototype .stk-leaf: bold label on top,
                       metric chips + live timer chip in one wrapping row below. */
                    <div className="p-3">
                        <div className="flex items-center gap-2 min-w-0">
                            {block.label && (
                                <span className="text-[13.5px] font-bold tracking-tight text-foreground leading-tight">
                                    {block.label}
                                </span>
                            )}
                            {block.blockType && debug && (
                                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-primary/5 text-primary/70 font-bold tracking-wider">
                                    {block.blockType}
                                </span>
                            )}
                            {inspectButton}
                        </div>

                        <div className="flex items-center flex-wrap gap-1.5 mt-1.5 min-w-0">
                            {leafChips.map((token, idx) => token.renderKind === 'comment' ? (
                                <span key={idx} className="text-[11.5px] italic text-muted-foreground select-text" title={token.tooltip}>
                                    {token.label}
                                </span>
                            ) : (
                                <span
                                    key={idx}
                                    className={cn(
                                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11.5px] font-bold tabular-nums cursor-help transition-colors",
                                        token.colorClasses
                                    )}
                                    title={token.tooltip}
                                >
                                    {token.icon && <span className="text-[11px] leading-none">{token.icon}</span>}
                                    {token.label}
                                </span>
                            ))}

                            {hasTime && (
                                <div className={cn(
                                    "ml-auto flex items-center gap-1.5 px-2 py-1 rounded-md font-mono text-[11.5px] font-bold tabular-nums shrink-0",
                                    isRunning
                                        ? "bg-primary/10 text-primary animate-pulse"
                                        : "bg-muted text-muted-foreground"
                                )}>
                                    <Timer className="h-3 w-3" />
                                    {formatTimeMMSS(elapsed)}
                                </div>
                            )}
                        </div>

                        {/* Block key — debug only */}
                        {debug && (
                            <div className="text-[10px] font-mono text-muted-foreground/60 truncate max-w-[200px] mt-1">
                                {block.key.toString()}
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {/* Ledger row — prototype .stk-row: muted label, count/time
                            right-aligned in mono so numbers read first. */}
                        <div className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="text-xs font-medium tracking-tight text-muted-foreground/80 truncate">
                                {isRoundLevel ? 'Round' : block.label}
                            </span>

                            {isRoundLevel && roundDisplay ? (
                                <span className="font-mono text-[15px] font-bold tracking-tight text-foreground tabular-nums shrink-0 leading-none">
                                    {roundDisplay.current}
                                    {roundDisplay.total !== undefined && (
                                        <span className="text-[11px] font-medium text-muted-foreground"> / {roundDisplay.total}</span>
                                    )}
                                </span>
                            ) : hasTime ? (
                                <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold tabular-nums text-foreground shrink-0">
                                    <Timer className="h-3 w-3" />
                                    {formatTimeMMSS(elapsed)}
                                </span>
                            ) : null}
                            {inspectButton}
                        </div>

                        {/* Fragment rows — non-leaf blocks only (leaf metrics are chips in the card) */}
                        {displayRows.length > 0 && (
                            <div className="flex flex-col gap-1 px-3 pb-2">
                                {renderFragmentSection(displayRows, 'display', debug, isLeaf)}
                            </div>
                        )}
                    </>
                )}

                {/* Debug tiers — promote & private (always below header) */}
                {debug && (promoteRows.length > 0 || privateRows.length > 0) && (
                    <div className="flex flex-col gap-1 px-3 pb-2">
                        {renderFragmentSection(promoteRows, 'promote', true, isLeaf)}
                        {renderFragmentSection(privateRows, 'private', true, isLeaf)}
                    </div>
                )}
            </div>

            {/* Debug dialog */}
            {debug && (
                <BlockDebugDialog
                    open={debugDialogOpen}
                    onOpenChange={setDebugDialogOpen}
                    block={block}
                    runtime={runtime}
                />
            )}
        </div>
    );
};

/**
 * Determine which completed segment outputs should appear as history
 * underneath a given visible block in the RuntimeStackView.
 *
 * Each output is assigned to the closest visible ancestor still on the
 * stack. This ensures that when intermediate blocks are popped, deeper
 * descendant outputs "bubble up" and remain visible rather than being
 * orphaned.
 *
 * @param outputs     All output statements
 * @param blockIndex  Index of the visible block (0 = root)
 * @param totalVisible Total number of blocks currently visible
 */
export function getOutputsForHistoryBlock(
    outputs: IOutputStatement[],
    blockIndex: number,
    totalVisible: number
): IOutputStatement[] {
    return outputs.filter(o => {
        if (o.outputType !== 'segment') return false;
        // The output's parent was at depth stackLevel - 1. If that parent is
        // no longer on the stack, the closest visible ancestor is the deepest
        // block still visible (totalVisible - 1).
        const closestAncestorDepth = Math.min(o.stackLevel - 1, totalVisible - 1);
        return blockIndex === closestAncestorDepth;
    });
}

export const RuntimeStackView: React.FC<{
    runtime: IScriptRuntime;
    outputs: IOutputStatement[];
    debug?: boolean;
}> = ({ runtime, outputs, debug = false }) => {
    const blocks = runtime.stack.blocks; // Stack is usually Leaf -> Root. We want Root (Top) -> Leaf (Bottom).

    if (blocks.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-muted-foreground border-2 border-dashed rounded-lg bg-muted/10">
                <ListTree className="h-8 w-8 mb-2 opacity-20" />
                <span className="text-sm">No Active Blocks</span>
            </div>
        );
    }

    // Helper to render history summary for a specific block
    const renderHistorySummary = (blockIndex: number, totalVisible: number) => {
        const levelOutputs = getOutputsForHistoryBlock(outputs, blockIndex, totalVisible);

        if (levelOutputs.length === 0) return null;

        const totalDuration = levelOutputs.reduce((acc, curr) => acc + ((curr.getMetric(MetricType.Elapsed)?.value as number) ?? 0), 0);
        const formatDuration = (ms: number) => {
            const seconds = Math.floor(ms / 1000);
            const m = Math.floor(seconds / 60);
            const s = seconds % 60;
            return `${m}:${s.toString().padStart(2, '0')}`;
        };

        return (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-1 pl-2.5 border-l-2 border-border/85 ml-3 my-0.5">
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                <span className="font-semibold text-foreground">{levelOutputs.length} completed</span>
                <span className="w-px h-2.5 bg-border/70" />
                <Clock className="h-3 w-3 shrink-0" />
                <span className="font-mono font-semibold tabular-nums text-metric-time">{formatDuration(totalDuration)}</span>
            </div>
        );
    };

    // Correct Order: Root (Top) -> Leaf (Bottom)
    // Assuming runtime.stack.blocks is [Leaf, Parent, Root] (Stack order)
    // We reverse it to get [Root, Parent, Leaf]
    const visibleBlocks = [...blocks].reverse();

    return (
        <div className="flex flex-col gap-0.5 relative">
            {visibleBlocks.map((block, index) => {
                const isLeaf = index === visibleBlocks.length - 1; // Last item is the active leaf

                return (
                    <React.Fragment key={block.key.toString()}>
                        {/* Block Card */}
                        <StackBlockItem
                            block={block}
                            isLeaf={isLeaf}
                            debug={debug}
                        />

                        {/* Interleaved History: Children of this block */}
                        {renderHistorySummary(index, visibleBlocks.length)}
                    </React.Fragment>
                );
            })}
        </div>
    );
};

// ============================================================================
// Lookahead View
// ============================================================================

export const LookaheadView: React.FC<{
    runtime: IScriptRuntime;
}> = () => {
    const preview = useNextPreview();

    if (!preview) {
        return (
            <div className="flex items-center gap-3 text-sm p-3 border border-dashed rounded-lg text-muted-foreground bg-muted/10">
                <CheckCircle2 className="h-4 w-4" />
                <span className="italic">End of section</span>
            </div>
        );
    }

    return (
        <div className="rounded-[10px] border border-dashed border-border/90 bg-muted/30 p-2.5 transition-all">
            {/* Next child metrics — rendered like a workout block card */}
            <MetricSourceRow
                metrics={preview.metrics}
                size="compact"
                isLeaf={false}
            />
        </div>
    );
};
