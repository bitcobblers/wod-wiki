import React, { useState, useEffect } from 'react';
import { Plus, Copy, Calendar, Loader2 } from 'lucide-react';
import { Button } from '@/components/atoms/primitives/button';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuItem,
} from '@/components/atoms/primitives/dropdown-menu';
import { CalendarCard } from '@/components/atoms/CalendarCard';
import { cn } from '@/lib/utils';
import { isJournalEntry } from '@/types/notebook';
import type { IContentProvider } from '@/types/content-provider';

export interface WorkoutActionButtonProps {
    /** Primary action (creating or cloning). Receives the target date. */
    onAction: (date: Date) => void | Promise<void>;
    /** Optional content provider for entry highlights in calendar */
    provider?: IContentProvider;
    /** 'create' (Plus icon) or 'clone' (Copy icon) */
    mode?: 'create' | 'clone';
    /** Label for the main button */
    label?: string;
    /** Button variant ('default', 'outline', 'ghost') */
    variant?: 'default' | 'outline' | 'ghost';
    /** Additional class names */
    className?: string;
    /** Tooltip or title for the main button */
    title?: string;
    /** Optional secondary actions (e.g. Import) */
    secondaryActions?: {
        label: string;
        icon: React.ReactNode;
        onClick: () => void;
    }[];
}

/**
 * WorkoutActionButton
 * 
 * A reusable split button:
 * [ (Icon) Label ] | [ (Calendar Icon) ]
 * 
 * Main button triggers onAction for today.
 * Dropdown trigger opens a calendar to pick a specific date.
 */
export const WorkoutActionButton: React.FC<WorkoutActionButtonProps> = ({
    onAction,
    provider,
    mode = 'create',
    label,
    variant = 'outline',
    className,
    title,
    secondaryActions = [],
}) => {
    const [open, setOpen] = useState(false);
    const [entryDates, setEntryDates] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);

    const Icon = mode === 'create' ? Plus : Copy;
    const defaultLabel = mode === 'create' ? 'New' : 'Clone';
    const effectiveLabel = label || defaultLabel;
    const effectiveTitle = title || (mode === 'create' ? 'Create for today' : 'Clone to today');

    // Load entry dates when dropdown opens to show highlights in calendar
    useEffect(() => {
        if (!open || !provider) return;

        const loadEntryDates = async () => {
            setLoading(true);
            try {
                const entries = await provider.getEntries();
                const dates = new Set(
                    entries
                        .filter(isJournalEntry)
                        .map(e => new Date(e.targetDate).toISOString().split('T')[0])
                );
                setEntryDates(dates);
            } catch {
                // Best-effort highlight loading; calendar simply shows no highlights.
            } finally {
                setLoading(false);
            }
        };

        loadEntryDates();
    }, [open, provider]);

    const handleMainAction = (e: React.MouseEvent) => {
        e.stopPropagation();
        onAction(new Date());
    };

    const handleDateSelect = (date: Date) => {
        // Set to noon to avoid timezone edge cases
        date.setHours(12, 0, 0, 0);
        onAction(date);
        setOpen(false);
    };

    return (
        <div className={cn("flex items-center -space-x-px", className)} onClick={(e) => e.stopPropagation()}>
            <Button
                variant={variant}
                size="sm"
                onClick={handleMainAction}
                className={cn(
                    "rounded-r-none gap-2 px-3 h-11 font-semibold whitespace-nowrap z-10",
                    variant === 'default' ? "border-r border-primary-foreground/20" : "border-r-0"
                )}
                title={effectiveTitle}
            >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{effectiveLabel}</span>
            </Button>

            <DropdownMenu open={open} onOpenChange={setOpen}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant={variant}
                        size="sm"
                        className={cn(
                            "rounded-l-none px-2 h-11 transition-all",
                            variant === 'ghost' ? "border-l hover:bg-accent" : "border-l"
                        )}
                        title="Pick a date"
                    >
                        <Calendar className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto p-0" onClick={(e) => e.stopPropagation()}>
                    <div className="p-3">
                        <DropdownMenuLabel className="flex items-center gap-2 px-1 py-1 text-xs uppercase tracking-wider text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {mode === 'create' ? 'Create on Date' : 'Clone to Date'}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className="my-2" />
                        {loading ? (
                            <div className="flex items-center justify-center py-10 w-[240px]">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <CalendarCard
                                onDateSelect={handleDateSelect}
                                entryDates={entryDates}
                                className="p-0"
                            />
                        )}
                    </div>

                    {secondaryActions.length > 0 && (
                        <>
                            <DropdownMenuSeparator />
                            <div className="p-1">
                                {secondaryActions.map((action, idx) => (
                                    <DropdownMenuItem
                                        key={idx}
                                        onClick={() => {
                                            setOpen(false);
                                            action.onClick();
                                        }}
                                        className="gap-2 text-sm"
                                    >
                                        <div className="text-muted-foreground group-hover:text-foreground">
                                            {action.icon}
                                        </div>
                                        {action.label}
                                    </DropdownMenuItem>
                                ))}
                            </div>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
};
