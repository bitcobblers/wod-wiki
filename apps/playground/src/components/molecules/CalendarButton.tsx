import React, { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/lib/dateFormat';
import { CalendarCard } from '@/components/atoms/CalendarCard';

export interface CalendarButtonProps {
  selectedDate: Date | null;
  onDateSelect: (date: Date | null) => void;
  entryDates?: Set<string>;
  size?: 'sm' | 'default';
  disabled?: boolean;
  className?: string;
}

export const CalendarButton: React.FC<CalendarButtonProps> = ({
  selectedDate,
  onDateSelect,
  entryDates,
  size = 'default',
  disabled = false,
  className,
}) => {
  const [open, setOpen] = useState(false);

  const padding = size === 'sm' ? 'px-2 py-1.5' : 'px-2.5 py-2';
  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const dateLabel = selectedDate ? formatDateShort(selectedDate) : null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        aria-label={dateLabel ? `Selected date ${dateLabel}` : 'Select date'}
        title={dateLabel ? `Selected: ${dateLabel}` : 'Select date'}
        className={cn(
          'inline-flex h-auto items-center gap-1.5 rounded-lg border border-border/70',
          'bg-muted text-muted-foreground shadow-sm hover:shadow-md transition-shadow font-medium',
          'hover:bg-accent hover:text-accent-foreground transition-colors',
          'disabled:opacity-60 disabled:pointer-events-none',
          textSize,
          padding,
          selectedDate && 'text-primary',
          className,
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
        {dateLabel && <span className="leading-none">{dateLabel}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} aria-label="Choose date" className="p-0 w-auto">
        <CalendarCard
          selectedDate={selectedDate}
          onDateSelect={(date) => {
            onDateSelect(date);
            setOpen(false);
          }}
          entryDates={entryDates}
        />
      </PopoverContent>
    </Popover>
  );
};
