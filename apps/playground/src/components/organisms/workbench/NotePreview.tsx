import React from 'react';
import { DocumentItem } from '@/components/Editor/utils/documentStructure';
import { Dumbbell, Edit2, Play, Save } from 'lucide-react';
import { Button } from '@/components/atoms/primitives/button';
import { usePanelSize } from '@/panels/panel-system/PanelSizeContext';
import { cn } from '@/lib/utils';
import type { HistoryEntry } from '@/types/history';
import type { IContentProvider } from '@/types/content-provider';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { CloneDateDropdown } from '@/components/molecules/CloneDateDropdown';

export interface NotePreviewProps {
    /** The workout entry to preview */
    entry?: HistoryEntry;

    /** Manual document structure items (for TrackPanel workout selector) */
    items?: DocumentItem[];

    /** Currently active block ID (for sync highlighting in items mode) */
    activeBlockId?: string;

    /** Highlighted block ID (from hover) */
    highlightedBlockId?: string | null;

    /** Callback when a block is clicked (items mode) */
    onBlockClick?: (item: DocumentItem) => void;

    /** Callback when a block is hovered (items mode) */
    onBlockHover?: (blockId: string | null) => void;

    /** Action to start a specific workout block */
    onStartWorkout?: (blockId: string) => void;

    /** Action to add a block to today's plan (Template +) */
    onAddToPlan?: (blockId: string) => void;

    /** Action to clone the entire entry (receives optional target date) */
    onClone?: (targetDate?: number) => void;

    /** Action to edit the note */
    onEdit?: () => void;

    /** Action to delete the note (only if no data) */
    onDelete?: () => void;

    /** Title of the note (optional - defaults to entry.title) */
    title?: string;

    /** Whether to auto-scroll to the active block */
    autoScroll?: boolean;
    /** Provider for history/persistence (needed for workout block "Add to Plan") */
    provider?: IContentProvider;
}

/**
 * Items-based rendering for TrackPanel workout selector.
 * Renders DocumentItem[] as a clickable card list.
 */
const ItemsRenderer: React.FC<{
    items: DocumentItem[];
    activeBlockId?: string;
    onBlockClick?: (item: DocumentItem) => void;
    onBlockHover?: (blockId: string | null) => void;
    onStartWorkout?: (blockId: string) => void;
}> = ({ items, activeBlockId, onBlockClick, onBlockHover, onStartWorkout }) => (
    <div className="flex flex-col">
        {items.map((item) => {
            const isWorkout = item.type !== 'header' && item.type !== 'paragraph';
            const isActive = item.id === activeBlockId;
            return (
                <div
                    key={item.id}
                    className={cn(
                        "group px-4 py-2 cursor-pointer transition-colors border-b border-border/50",
                        "hover:bg-accent/50",
                        isActive && "bg-accent border-l-2 border-l-primary",
                        isWorkout && "font-mono text-sm",
                        item.type === 'header' && "font-semibold",
                        item.type === 'paragraph' && "text-muted-foreground text-sm"
                    )}
                    onClick={() => onBlockClick?.(item)}
                    onMouseEnter={() => onBlockHover?.(item.id)}
                    onMouseLeave={() => onBlockHover?.(null)}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            {isWorkout && (
                                <>
                                    <Dumbbell className="h-3.5 w-3.5 text-primary shrink-0" />
                                    <span className="truncate">{item.content.split('\n')[0]}</span>
                                </>
                            )}
                            {item.type === 'paragraph' && (
                                <span className="line-clamp-2">{item.content}</span>
                            )}
                            {item.type === 'header' && (
                                <span className="text-base truncate">{item.content.replace(/^#+\s*/, '')}</span>
                            )}
                        </div>

                        {isWorkout && onStartWorkout && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onStartWorkout(item.id);
                                }}
                                className="ml-2 size-6 rounded flex items-center justify-center text-primary hover:bg-primary/10 transition-all opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                                title={item.type === 'log' ? 'Log entry' : 'Start workout'}
                            >
                                {/* #891/#894: log items get the Log affordance (save icon);
                                    the log-mode runtime lands behind IRuntime separately. */}
                                {item.type === 'log' ? (
                                    <Save className="size-3.5" />
                                ) : (
                                    <Play className="size-3.5 fill-current" />
                                )}
                            </button>
                        )}
                    </div>
                </div>
            );
        })}
    </div>
);

export const NotePreview: React.FC<NotePreviewProps> = ({
    entry,
    items,
    activeBlockId,
    onBlockClick,
    onBlockHover,
    onStartWorkout,
    onAddToPlan,
    onClone,
    onEdit,
    title,
    autoScroll,
    provider,
}) => {
    const { isCompact: mobile } = usePanelSize();

    const displayTitle = title || entry?.title || 'Preview';

    // Items mode: render clickable card list (used by TrackPanel)
    if (items && !entry) {
        return (
            <ItemsRenderer
                items={items}
                activeBlockId={activeBlockId}
                onBlockClick={onBlockClick}
                onBlockHover={onBlockHover}
                onStartWorkout={onStartWorkout}
            />
        );
    }

    // Entry mode: render section-based preview (used by HistoryPage)
    return (
        <div className={cn("h-full bg-background flex flex-col overflow-hidden", !mobile && "border-l border-border")}>
            <div className={cn("flex-1 flex flex-col gap-4 overflow-hidden", mobile ? "p-4" : "p-6")}>
                {/* Header matching AnalyzePanel visual style */}
                <div className="flex items-center gap-3 text-foreground flex-shrink-0 justify-between">
                    <div className="flex items-center gap-3 truncate">
                        <Dumbbell className="h-6 w-6" />
                        <h2 className="text-xl font-semibold truncate">
                            {displayTitle}
                        </h2>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {onClone && (
                            <CloneDateDropdown
                                onClone={(targetDate) => onClone(targetDate)}
                                provider={provider}
                                variant="button"
                                showLabel={true}
                                label="Clone"
                            />
                        )}
                        {onEdit && (
                            <Button variant="outline" size="sm" onClick={onEdit} className="gap-2">
                                <Edit2 className="h-4 w-4" />
                                Edit Note
                            </Button>
                        )}
                    </div>
                </div>

                {/* Section-based document rendering */}
                <div className="flex-1 min-h-0">
                    {entry ? (
                        <NoteEditor
                            noteId={entry.id}
                            value={entry.rawContent}
                            onChange={() => {}}
                            onStartWorkout={onStartWorkout ? (block) => onStartWorkout(block.id) : undefined}
                            onAddToPlan={onAddToPlan ? (block) => onAddToPlan(block.id) : undefined}
                            showLineNumbers={!mobile}
                            readonly={true}
                            className="h-full"
                            scrollToSectionId={autoScroll ? activeBlockId : undefined}
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <p className="text-sm text-muted-foreground italic">
                                No session selected
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

