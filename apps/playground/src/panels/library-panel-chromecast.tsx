/**
 * ReceiverLibraryPanel — receiver-side notebook listing shown while the cast
 * session has nothing workout-shaped to display (idle, or a preview with no
 * blocks). Entries arrive from the sender via `rpc-library-state`; selecting
 * one sends `open-notebook` so the browser routes there, where the existing
 * block-selection / timer flow takes over.
 */

import React from 'react';
import type { RpcLibraryState } from '@/services/cast/rpc/RpcMessages';

export interface ReceiverLibraryPanelProps {
    library: RpcLibraryState | null;
    /** Send the `open-notebook` event to the browser. */
    onOpenNotebook: (href: string) => void;
    /** Spatial-navigation focus prop factory from `useSpatialNavigation`. */
    getFocusProps?: (id: string) => Record<string, unknown>;
}

export const ReceiverLibraryPanel: React.FC<ReceiverLibraryPanelProps> = ({
    library,
    onOpenNotebook,
    getFocusProps,
}) => {
    if (!library || library.entries.length === 0) {
        return (
            <div className="h-screen w-screen bg-black flex flex-col items-center justify-center text-white/60 font-mono uppercase tracking-[0.5em]">
                <div className="animate-pulse">Wod.Wiki // Pick a workout to begin</div>
            </div>
        );
    }

    return (
        <div data-nav-root="true" className="h-screen w-screen bg-black text-white overflow-y-auto px-16 py-12">
            <h1 className="text-4xl font-bold tracking-tight mb-10 uppercase font-mono text-white/80">Library</h1>
            <div className="flex flex-col gap-5 max-w-5xl">
                {library.entries.map((entry, index) => (
                    <button
                        key={entry.notebookId}
                        type="button"
                        {...(getFocusProps ? getFocusProps(`library-${index}`) : {})}
                        onClick={() => onOpenNotebook(entry.href)}
                        className="text-left w-full px-10 py-8 rounded-2xl bg-zinc-900 border-2 border-zinc-800 text-3xl font-semibold text-white transition-colors"
                    >
                        {entry.title}
                        <span className="text-xl text-zinc-400 ml-6 font-normal font-mono">
                            {entry.itemCount}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
};
