import React, { useState } from 'react';
import { CalendarDays, CheckCircle2 } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { formatDateShort } from '@/lib/dateFormat';
import { cn } from '@/lib/utils';
import { CalendarCard } from '@/components/atoms/CalendarCard';

export interface JournalImportToolbarProps {
  selectedDate?: Date | null;
  onImportToday: () => Promise<void>;
  onDateSelect: (date: Date) => Promise<void>;
  entryDates?: Set<string>;
  isLoading?: boolean;
  className?: string;
}

export const JournalImportToolbar: React.FC<JournalImportToolbarProps> = ({
  selectedDate,
  onImportToday,
  onDateSelect,
  entryDates,
  isLoading = false,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleImportToday = async () => {
    setImporting(true);
    try {
      await onImportToday();
    } finally {
      setImporting(false);
    }
  };

  const handleDateSelect = async (date: Date) => {
    setImporting(true);
    setOpen(false);
    try {
      await onDateSelect(date);
    } finally {
      setImporting(false);
    }
  };

  const dateLabel = selectedDate ? formatDateShort(selectedDate) : 'Date';
  const isDisabled = isLoading || importing;

  return (
    <div
      className={cn(
        'inline-flex items-stretch rounded-lg overflow-hidden border border-border/70',
        'bg-muted text-muted-foreground shadow-sm hover:shadow-md transition-shadow font-medium text-xs',
        className,
      )}
    >
      <button
        type="button"
        title="Import to today's journal"
        onClick={() => void handleImportToday()}
        disabled={isDisabled}
        className={cn(
          'flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent hover:text-accent-foreground',
          isDisabled && 'opacity-60 cursor-not-allowed',
        )}
      >
        {importing ? (
          <span className="inline-block animate-spin">⏳</span>
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span>Import Today</span>
      </button>

      <div className="w-px bg-border/60 self-stretch" />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={isDisabled}
          aria-label="Plan for future date"
          title="Select a date to plan for the future"
          className={cn(
            'flex h-auto rounded-none border-0 bg-transparent items-center gap-1.5 px-2.5 py-2 transition-colors hover:bg-accent hover:text-accent-foreground',
            selectedDate && 'text-primary',
            isDisabled && 'opacity-60 cursor-not-allowed',
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          {selectedDate && <span className="leading-none text-xs">{dateLabel}</span>}
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} aria-label="Plan date" className="p-0 w-auto">
          <CalendarCard
            selectedDate={selectedDate || null}
            onDateSelect={(d) => void handleDateSelect(d)}
            entryDates={entryDates}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};
