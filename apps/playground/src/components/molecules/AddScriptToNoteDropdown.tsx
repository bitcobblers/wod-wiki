import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Calendar, FilePlus, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { planPath } from '@/lib/routes';
import { toShortId } from '@/lib/idUtils';
import { isJournalEntry } from '@/types/notebook';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from '@/components/atoms/primitives/dropdown-menu';
import { CalendarCard } from '@/components/atoms/CalendarCard';
import type { ScriptBlock } from '@/components/Editor/types';
import type { IContentProvider } from '@/types/content-provider';
import type { HistoryRecord } from '@/types/history';
import { cn } from '@/lib/utils';
import { formatDateWeekdayShort } from '@/lib/dateFormat';

interface AddScriptToNoteDropdownProps {
    scriptBlock: ScriptBlock;
    provider?: IContentProvider;
    /** ID of the note this workout block originates from (for link tracking) */
    sourceNoteId?: string;
    onAddSuccess?: (noteId: string) => void;
    className?: string;
}

function toDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isSameDay(d1: Date, d2: Date): boolean {
    return d1.getFullYear() === d2.getFullYear()
        && d1.getMonth() === d2.getMonth()
        && d1.getDate() === d2.getDate();
}

export const AddScriptToNoteDropdown: React.FC<AddScriptToNoteDropdownProps> = ({
    scriptBlock,
    provider,
    sourceNoteId,
    onAddSuccess,
    className,
}) => {
    const [allEntries, setAllEntries] = useState<HistoryRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
    const navigate = useNavigate();

    // Fetch all entries when dropdown opens
    useEffect(() => {
        if (!open || !provider) return;

        const loadEntries = async () => {
            setLoading(true);
            try {
                const entries = await provider.getRecords();
                setAllEntries(entries);
            } catch (err) {
                console.error('Failed to load entries:', err);
            } finally {
                setLoading(false);
            }
        };

        loadEntries();
    }, [open, provider]);

    // Compute entry dates for calendar highlighting
    const entryDates = useMemo(() => {
        return new Set(
            allEntries
                .filter(isJournalEntry)
                .map(e => toDateKey(new Date(e.targetDate)))
        );
    }, [allEntries]);

    // Filter notes for the selected date
    const notesForDate = useMemo(() => {
        return allEntries.filter(e => {
            if (!isJournalEntry(e)) return false;
            return isSameDay(new Date(e.targetDate), selectedDate);
        }).sort((a, b) => a.targetDate - b.targetDate);
    }, [allEntries, selectedDate]);

    const handleDateSelect = (date: Date) => {
        setSelectedDate(date);
    };

    const handleAddToNote = async (noteId: string) => {
        if (!provider) return;

        try {
            const note = await provider.getRecord(noteId);
            if (!note) return;

            const fenceTag = scriptBlock.sport
                ? `${scriptBlock.dialect || 'time'}:${scriptBlock.sport}`
                : scriptBlock.dialect || 'time';
            const blockText = `\n\n\`\`\`${fenceTag}\n${scriptBlock.content.trim()}\n\`\`\``;
            const newContent = note.rawContent.trim() + blockText;

            await provider.updateRecord(noteId, { rawContent: newContent });
            onAddSuccess?.(noteId);
            setOpen(false);

            // Navigate to the note in plan mode
            navigate(planPath(toShortId(noteId)));
        } catch (err) {
            console.error('Failed to add block to note:', err);
        }
    };

    const handleCreateNewNote = async () => {
        if (!provider) return;

        try {
            // Use selected date at noon for targetDate
            const targetDate = new Date(selectedDate);
            targetDate.setHours(12, 0, 0, 0);

            const fenceTag = scriptBlock.sport
                ? `${scriptBlock.dialect || 'time'}:${scriptBlock.sport}`
                : scriptBlock.dialect || 'time';
            const blockText = `\`\`\`${fenceTag}\n${scriptBlock.content.trim()}\n\`\`\``;
            const newEntry = await provider.saveRecord({
                title: 'New Workout',
                rawContent: `# New Workout\n\n${blockText}`,
                targetDate: targetDate.getTime(),
                tags: [],
                notes: '',
                sourceId: sourceNoteId,
            });

            onAddSuccess?.(newEntry.id);
            setOpen(false);

            // Navigate to the new note in plan mode
            navigate(planPath(toShortId(newEntry.id)));
        } catch (err) {
            console.error('Failed to create new note from block:', err);
        }
    };

    if (!provider) return null;

    const isToday = isSameDay(selectedDate, new Date());
    const dateLabel = isToday
        ? 'Today'
        : formatDateWeekdayShort(selectedDate);

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                    }}
                    className={cn(
                        'flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-medium transition-colors shadow-sm',
                        'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/50',
                        className
                    )}
                    title="Add to Plan..."
                >
                    <Plus className="h-3 w-3" />
                    <span>Plan</span>
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-[520px]" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuLabel className="flex items-center gap-2">
                    <Plus className="h-3.5 w-3.5" />
                    Add to Plan
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {loading ? (
                    <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="flex">
                        {/* Left: Calendar Date Picker */}
                        <div className="w-[260px] flex-shrink-0 border-r border-border/50">
                            <CalendarCard
                                selectedDate={selectedDate}
                                onDateSelect={handleDateSelect}
                                entryDates={entryDates}
                            />
                        </div>

                        {/* Right: Target notes for selected date */}
                        <div className="flex-1 min-w-0 flex flex-col">
                            {/* Date header */}
                            <div className="flex items-center gap-2 text-xs px-2 py-1.5 font-semibold">
                                <Calendar className={cn("h-3 w-3", isToday ? "text-primary" : "text-muted-foreground")} />
                                <span>{dateLabel}</span>
                                <span className="text-muted-foreground font-normal">
                                    ({notesForDate.length} {notesForDate.length === 1 ? 'note' : 'notes'})
                                </span>
                            </div>

                            <div className="-mx-1 my-1 h-px bg-muted" />

                            {/* Notes for selected date */}
                            <div className="flex-1 max-h-48 overflow-y-auto custom-scrollbar">
                                {notesForDate.map(note => (
                                    <DropdownMenuItem
                                        key={note.id}
                                        onClick={() => handleAddToNote(note.id)}
                                        className="flex flex-col items-start gap-0.5 py-2"
                                    >
                                        <div className="flex items-center gap-2 w-full">
                                            <Calendar className="h-3 w-3 text-muted-foreground" />
                                            <span className="font-medium truncate flex-1 text-sm">{note.title}</span>
                                        </div>
                                    </DropdownMenuItem>
                                ))}
                                {notesForDate.length === 0 && (
                                    <div className="px-3 py-4 text-xs text-muted-foreground text-center italic">
                                        No notes on this date
                                    </div>
                                )}
                            </div>

                            <div className="-mx-1 my-1 h-px bg-muted" />

                            {/* Create new note for the selected date */}
                            <DropdownMenuItem onClick={handleCreateNewNote} className="gap-2 text-primary font-medium">
                                <FilePlus className="h-4 w-4" />
                                <span>New Note for {dateLabel}</span>
                            </DropdownMenuItem>
                        </div>
                    </div>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
