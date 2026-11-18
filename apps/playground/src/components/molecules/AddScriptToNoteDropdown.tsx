import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Calendar, FilePlus, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { planPath } from '@/lib/routes';
import { toShortId } from '@/lib/idUtils';
import { isJournalEntry } from '@/types/notebook';
import {
    Popover,
    PopoverContent,
    PopoverTitle,
    PopoverTrigger,
    Separator,
} from '@bitcobblers/wod-wiki-ui/primitives';
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

        void loadEntries();
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
            void navigate(planPath(toShortId(noteId)));
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
            void navigate(planPath(toShortId(newEntry.id)));
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
        <div onClick={(e) => e.stopPropagation()}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    aria-label="Add to Plan"
                    title="Add to Plan..."
                    className={cn(
                        'flex h-auto items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-medium transition-colors shadow-sm',
                        'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/50',
                        className,
                    )}
                >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    <span>Plan</span>
                </PopoverTrigger>
                <PopoverContent
                    align="end"
                    side="top"
                    sideOffset={6}
                    className="w-[520px] p-2"
                    onClick={(e) => e.stopPropagation()}
                >
                    <PopoverTitle className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold">
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        Add to Plan
                    </PopoverTitle>
                    <Separator className="my-1" />

                    {loading ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="flex">
                            <div className="w-[260px] flex-shrink-0 border-r border-border/50">
                                <CalendarCard
                                    selectedDate={selectedDate}
                                    onDateSelect={handleDateSelect}
                                    entryDates={entryDates}
                                />
                            </div>

                            <div className="flex-1 min-w-0 flex flex-col">
                                <div className="flex items-center gap-2 text-xs px-2 py-1.5 font-semibold">
                                    <Calendar className={cn('h-3 w-3', isToday ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                                    <span>{dateLabel}</span>
                                    <span className="text-muted-foreground font-normal">
                                        ({notesForDate.length} {notesForDate.length === 1 ? 'note' : 'notes'})
                                    </span>
                                </div>

                                <div className="-mx-1 my-1 h-px bg-muted" />

                                <div className="flex-1 max-h-48 overflow-y-auto custom-scrollbar space-y-0.5 p-1">
                                    {notesForDate.map((note) => (
                                        <button
                                            key={note.id}
                                            type="button"
                                            onClick={() => void handleAddToNote(note.id)}
                                            className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left hover:bg-muted transition-colors"
                                        >
                                            <div className="flex items-center gap-2 w-full">
                                                <Calendar className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                                                <span className="font-medium truncate flex-1 text-sm">{note.title}</span>
                                            </div>
                                        </button>
                                    ))}
                                    {notesForDate.length === 0 && (
                                        <div className="px-3 py-4 text-xs text-muted-foreground text-center italic">
                                            No notes on this date
                                        </div>
                                    )}
                                </div>

                                <div className="-mx-1 my-1 h-px bg-muted" />

                                <button
                                    type="button"
                                    onClick={() => void handleCreateNewNote()}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-primary font-medium hover:bg-muted transition-colors"
                                >
                                    <FilePlus className="h-4 w-4" aria-hidden="true" />
                                    <span>New Note for {dateLabel}</span>
                                </button>
                            </div>
                        </div>
                    )}
                </PopoverContent>
            </Popover>
        </div>
    );
};
