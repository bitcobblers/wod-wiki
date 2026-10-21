import React from 'react';
import { useScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { RuntimeStackView, LookaheadView } from '@/components/atoms/VisualStateComponents';
import { useOutputStatements } from '@bitcobblers/wod-wiki-engine';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/atoms/primitives/card';
import { useDebugMode } from '@/contexts/DebugModeContext';
import { usePanelSize } from '@/panels/panel-system/PanelSizeContext';
import { cn } from '@/lib/utils';

export const VisualStatePanel: React.FC = () => {
    const runtime = useScriptRuntime();
    const { outputs } = useOutputStatements(runtime);
    const { isDebugMode } = useDebugMode();
    const { isCompact } = usePanelSize();

    if (!runtime) return null;

    return (
        <div className={cn(
            "h-full flex flex-col overflow-hidden bg-slate-50/50 dark:bg-slate-900/50",
            isCompact ? "gap-2 p-2" : "gap-4 p-4"
        )}>
            {/* 1. Active Stack Context (with Interleaved History) — scrolls
                internally so a long stack can never spill over the pinned
                Up Next card below in bounded panels. */}
            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
                <RuntimeStackView runtime={runtime} outputs={outputs} debug={isDebugMode} />
            </div>

            {/* 3. Up Next */}
            <Card className="shrink-0 bg-muted/30 border-dashed">
                <CardHeader className={cn(isCompact ? "p-2 pb-0" : "p-3 pb-0")}>
                    <CardTitle className={cn(
                        "font-mono font-semibold text-muted-foreground uppercase tracking-[0.14em]",
                        isCompact ? "text-[10px]" : "text-[11px]"
                    )}>
                        Up Next
                    </CardTitle>
                </CardHeader>
                <CardContent className={cn(isCompact ? "p-2" : "p-3")}>
                    <LookaheadView runtime={runtime} />
                </CardContent>
            </Card>
        </div>
    );
};

