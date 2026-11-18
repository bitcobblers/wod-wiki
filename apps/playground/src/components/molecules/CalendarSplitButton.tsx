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
import type { INavActivation, INavAction } from '@/nav/navTypes';

export interface CalendarSplitButtonProps {
  primary: INavActivation;
  selectedDate: Date | null;
  onDateSelect: (date: Date | null) => void;
  entryDates?: Set<string>;
  size?: 'sm' | 'default';
  className?: string;
  onAction?: (action: INavAction, activation: INavActivation) => void;
}

function fireAction(
  activation: INavActivation,
  onAction?: CalendarSplitButtonProps['onAction'],
): void {
  if (onAction) {
    onAction(activation.action, activation);
    return;
  }
  if (activation.action.type === 'call') {
    activation.action.handler();
  }
}

export const CalendarSplitButton: React.FC<CalendarSplitButtonProps> = ({
  primary,
  selectedDate,
  onDateSelect,
  entryDates,
  size = 'default',
  className,
  onAction,
}) => {
  const [open, setOpen] = useState(false);
  const PrimaryIcon = primary.icon;
  const padding = size === 'sm' ? 'px-2.5 py-1.5' : 'px-3 py-2';
  const iconPadding = size === 'sm' ? 'px-2 py-1.5' : 'px-2.5 py-2';
  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const dateLabel = selectedDate ? formatDateShort(selectedDate) : 'Date';

  return (
    <div
      className={cn(
        'inline-flex items-stretch rounded-lg overflow-hidden border border-border/70',
        'bg-muted text-muted-foreground shadow-sm hover:shadow-md transition-shadow font-medium',
        textSize,
        className,
      )}
    >
      <button
        type="button"
        title={primary.label}
        onClick={() => fireAction(primary, onAction)}
        className={cn(
          'flex items-center gap-2 transition-colors hover:bg-accent hover:text-accent-foreground',
          padding,
        )}
      >
        {PrimaryIcon && <PrimaryIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span>{primary.label}</span>
      </button>

      <div className="w-px bg-border/60 self-stretch" />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Select date (${dateLabel})`}
          title={`Select date — ${dateLabel}`}
          className={cn(
            'flex h-auto rounded-none border-0 bg-transparent items-center gap-1.5 transition-colors hover:bg-accent hover:text-accent-foreground',
            iconPadding,
            selectedDate && 'text-primary',
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          {selectedDate && <span className="leading-none">{dateLabel}</span>}
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
    </div>
  );
};
