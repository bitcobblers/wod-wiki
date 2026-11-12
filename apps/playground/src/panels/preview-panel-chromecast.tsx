/**
 * preview-panel-chromecast.tsx — Chromecast receiver preview panel.
 * Shown when a note is loaded but no runtime is active.
 * Displays the workout title and block list for the user to browse.
 *
 * Extracted from receiver-rpc.tsx ReceiverPreviewPanel.
 */

import React from 'react';
import type { WorkbenchDisplayState } from '@/services/cast/rpc/RpcMessages';
import type { FocusProps } from '@/hooks/useSpatialNavigation';
import {
    Clock,
    Dumbbell,
    Play,
} from 'lucide-react';

export const ReceiverPreviewPanel: React.FC<{
    previewData: NonNullable<WorkbenchDisplayState['previewData']>;
    getFocusProps?: (id: string) => FocusProps;
    /** Called when user selects a workout block (click or D-Pad Select). */
    onBlockSelect?: (blockId: string, index: number) => void;
}> = ({ previewData, getFocusProps, onBlockSelect }) => {
    return (
        <div className="h-full w-full flex flex-col items-center bg-background overflow-hidden">
            {/* Header — logo + title (fixed, does not scroll) */}
            <div className="shrink-0 flex flex-col items-center gap-3 pt-12 pb-6 px-12">
                <div className="flex items-center gap-3">
                    <Dumbbell className="h-8 w-8 text-primary" />
                    <span className="text-2xl font-bold tracking-tight text-foreground">Wod.Wiki</span>
                </div>
                <div className="text-center">
                    <h1 className="text-4xl font-bold text-foreground leading-tight">
                        {previewData.title}
                    </h1>
                    <p className="mt-2 text-muted-foreground text-lg">Select a workout to begin</p>
                </div>
            </div>

            {/* Workout list — scrollable when content overflows */}
            <div className="flex-1 min-h-0 w-full max-w-2xl overflow-y-auto px-12">
                {previewData.blocks.length > 0 && (
                    <div className="flex flex-col gap-3 pb-4">
                        {previewData.blocks.map((block, index) => (
                            <div
                                key={block.id}
                                {...(getFocusProps ? getFocusProps(`preview-block-${index}`) : {})}
                                onClick={() => onBlockSelect?.(block.id, index)}
                                className="tv-focusable flex flex-col rounded-lg border border-border/60 bg-card/50 px-5 py-4 transition-all cursor-pointer hover:border-primary/40 hover:bg-card/80"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <Play className="h-4 w-4 text-muted-foreground shrink-0" />
                                        <span className="font-medium text-foreground truncate">
                                            {block.title}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 ml-3">
                                        {block.timerHint && (
                                            <span className="flex items-center gap-1 text-xs font-mono text-primary/80 bg-primary/10 px-2 py-0.5 rounded">
                                                <Clock className="h-3 w-3" />
                                                {block.timerHint}
                                            </span>
                                        )}
                                        {block.dialect === 'log' && (
                                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded">
                                                {block.dialect}
                                            </span>
                                        )}
                                        {block.statementCount > 0 && (
                                            <span className="text-xs text-muted-foreground">
                                                {block.statementCount} steps
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {block.contentPreview && (
                                    <pre className="mt-2 text-xs text-muted-foreground/70 font-mono leading-relaxed whitespace-pre-wrap line-clamp-3 pl-6">
                                        {block.contentPreview}
                                    </pre>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer — status text (fixed, does not scroll) */}
            <div className="shrink-0 pb-8 px-12">
                <p className="text-xs text-muted-foreground/40 font-mono uppercase tracking-widest">
                    Ready
                </p>
            </div>
        </div>
    );
};
