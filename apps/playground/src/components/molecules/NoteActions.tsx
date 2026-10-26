import React from 'react';
import { Lock } from 'lucide-react';
import { HistoryRecord } from '../../types/history';
import { cn } from '../../lib/utils';
import { CloneDateDropdown } from '@/components/molecules/CloneDateDropdown';
import type { IContentProvider } from '@/types/content-provider';

interface NoteActionsProps {
    entry: HistoryRecord | null;
    onClone: (targetDate?: number) => void;
    className?: string;
    showLabel?: boolean;
    variant?: 'default' | 'primary';
    /** Content provider for calendar date hints */
    provider?: IContentProvider;
}

export const NoteActions: React.FC<NoteActionsProps> = ({
    entry,
    onClone,
    className,
    showLabel,
    variant = 'default',
    provider,
}) => {
    if (!entry) return null;

    const isClosed = entry.type === 'note' && isPastDate(entry.targetDate);

    return (
        <div className={cn("flex items-center gap-2", className)}>
            {isClosed && (
                <div className="flex items-center gap-2 mr-2 px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded text-xs font-medium">
                    <Lock className="h-3 w-3" />
                    <span>Closed</span>
                </div>
            )}

            <CloneDateDropdown
                onClone={(targetDate) => onClone(targetDate)}
                provider={provider}
                variant={showLabel ? 'button' : 'icon'}
                showLabel={!!showLabel}
                label="Clone"
                title="Clone to date..."
                className={cn(
                    variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
                    className
                )}
            />
        </div>
    );
};

// Helper to check if a date is in the past (yesterday or earlier)
function isPastDate(timestamp: number): boolean {
    const date = new Date(timestamp);
    const now = new Date();

    // Reset time part to compare purely by date
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const n = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return d < n;
}
