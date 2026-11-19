/**
 * BlockDebugDialog — Debug inspection dialog for runtime blocks.
 *
 * Shows three tabs:
 *   1. Code Statements — source statements for this block rendered with MetricSourceRow
 *   2. Behaviors — list of attached behavior classes
 *   3. Memory — all active memory locations rendered with MetricSourceRow
 *
 * Opened via the table icon button on each StackBlockItem when debug mode is on.
 */

import React, { useMemo, useState } from 'react';
import {
    Dialog,
    DialogBackdrop,
    DialogContent,
    DialogHeader,
    DialogTitle,
    Tabs,
    TabsList,
    TabsPanel,
    TabsTab,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { cn } from '@/lib/utils';
import type { IRuntimeBlock, IScriptRuntime } from '@/hooks/useRuntimeTimer';
import type { ICodeStatement } from '@bitcobblers/wod-wiki-engine';
import { MetricSourceRow } from '@/components/molecules/MetricSourceRow'

export interface BlockDebugDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    block: IRuntimeBlock;
    runtime: IScriptRuntime;
}

const TAB_NAMES = ['Statements', 'Behaviors', 'Memory'] as const;

export const BlockDebugDialog: React.FC<BlockDebugDialogProps> = ({
    open,
    onOpenChange,
    block,
    runtime,
}) => {
    const [activeTab, setActiveTab] = useState<string>('Statements');

    const codeStatements = useMemo((): ICodeStatement[] => {
        if (!runtime.script || !block.sourceIds.length) return [];
        return runtime.script.getIds(block.sourceIds);
    }, [runtime.script, block.sourceIds]);

    const behaviorNames = useMemo(() => {
        return block.behaviors.map(b => b.constructor.name);
    }, [block.behaviors]);

    const memoryLocations = useMemo(() => {
        return block.getAllMemory();
    }, [block]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogBackdrop />
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>
                        <span className="flex items-center gap-2">
                            <span>{block.label}</span>
                            {block.blockType && (
                                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary/70 font-bold tracking-wider">
                                    {block.blockType}
                                </span>
                            )}
                        </span>
                    </DialogTitle>
                    <div className="text-[10px] font-mono text-muted-foreground">
                        Key: {block.key.toString()}
                    </div>
                </DialogHeader>

                <Tabs
                    value={activeTab}
                    onValueChange={(next) => {
                        if (next) setActiveTab(next);
                    }}
                    className="flex flex-col flex-1 min-h-0"
                >
                    <TabsList aria-label="Block debug views" className="flex border-b border-border gap-0">
                        {TAB_NAMES.map((name) => (
                            <TabsTab
                                key={name}
                                value={name}
                                className={cn(
                                    'px-4 py-2 text-sm font-medium transition-colors outline-none border-b-2 -mb-px text-muted-foreground hover:text-foreground hover:border-border data-selected:border-primary data-selected:text-foreground border-transparent',
                                )}
                            >
                                {name}
                            </TabsTab>
                        ))}
                    </TabsList>

                    <div className="flex-1 min-h-0 overflow-y-auto mt-2">
                        <TabsPanel value="Statements">
                            <StatementsTab statements={codeStatements} />
                        </TabsPanel>

                        <TabsPanel value="Behaviors">
                            <BehaviorsTab names={behaviorNames} />
                        </TabsPanel>

                        <TabsPanel value="Memory">
                            <MemoryTab block={block} locations={memoryLocations} />
                        </TabsPanel>
                    </div>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};

// ──────────────────────────────────────────────────────────────
// Tab: Code Statements — renders using the metrics grid (MetricSourceRow)
// ──────────────────────────────────────────────────────────────

const StatementsTab: React.FC<{ statements: ICodeStatement[] }> = ({ statements }) => {
    if (statements.length === 0) {
        return <EmptyState text="No source statements" />;
    }

    return (
        <div className="border border-border rounded-md overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[60px_1fr] text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
                <div className="px-3 py-1.5">ID</div>
                <div className="px-3 py-1.5">Fragments</div>
            </div>
            {/* Rows */}
            {statements.map((stmt) => (
                <div
                    key={stmt.id}
                    className="grid grid-cols-[60px_1fr] items-center border-b border-border/50 last:border-b-0 hover:bg-muted/20 transition-colors"
                >
                    <div className="px-3 py-1.5 text-xs font-mono text-muted-foreground tabular-nums">
                        {stmt.id}
                    </div>
                    <div className="py-0.5">
                        <MetricSourceRow
                            metrics={stmt.metrics}
                            size="compact"
                        />
                    </div>
                </div>
            ))}
        </div>
    );
};

// ──────────────────────────────────────────────────────────────
// Tab: Behaviors
// ──────────────────────────────────────────────────────────────

const BehaviorsTab: React.FC<{ names: string[] }> = ({ names }) => {
    if (names.length === 0) {
        return <EmptyState text="No behaviors attached" />;
    }

    return (
        <div className="border border-border rounded-md overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[40px_1fr] text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
                <div className="px-3 py-1.5">#</div>
                <div className="px-3 py-1.5">Behavior</div>
            </div>
            {/* Rows */}
            {names.map((name, i) => (
                <div
                    key={i}
                    className="grid grid-cols-[40px_1fr] items-center border-b border-border/50 last:border-b-0 hover:bg-muted/20 transition-colors"
                >
                    <div className="px-3 py-1.5 text-xs font-mono text-muted-foreground tabular-nums">
                        {i + 1}
                    </div>
                    <div className="px-3 py-1.5 text-sm font-mono">
                        {name}
                    </div>
                </div>
            ))}
        </div>
    );
};

// ──────────────────────────────────────────────────────────────
// Tab: Memory — renders using the metrics grid (MetricSourceRow)
// ──────────────────────────────────────────────────────────────

const MemoryTab: React.FC<{ block: IRuntimeBlock; locations: ReturnType<IRuntimeBlock['getAllMemory']> }> = ({ locations }) => {
    if (locations.length === 0) {
        return <EmptyState text="No memory locations" />;
    }

    return (
        <div className="border border-border rounded-md overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[120px_1fr] text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
                <div className="px-3 py-1.5">Tag</div>
                <div className="px-3 py-1.5">Fragments</div>
            </div>
            {/* Rows */}
            {locations.map((loc, i) => (
                <div
                    key={`${loc.tag}-${i}`}
                    className="grid grid-cols-[120px_1fr] items-center border-b border-border/50 last:border-b-0 hover:bg-muted/20 transition-colors"
                >
                    <div className="px-3 py-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {loc.tag}
                        </span>
                    </div>
                    <div className="py-0.5">
                        <MetricSourceRow
                            metrics={loc.metrics}
                            size="compact"
                        />
                    </div>
                </div>
            ))}
        </div>
    );
};

// ──────────────────────────────────────────────────────────────
// Shared empty state
// ──────────────────────────────────────────────────────────────

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
    <div className="flex items-center justify-center py-8 text-sm text-muted-foreground italic">
        {text}
    </div>
);
