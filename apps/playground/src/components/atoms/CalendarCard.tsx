import React, { useEffect, useState } from 'react';
import {
  Calendar,
  CalendarDay,
  CalendarGrid,
  CalendarHeading,
  CalendarNext,
  CalendarPrevious,
  CalendarWeekday,
  CalendarWeekdays,
  CalendarWeeks,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { cn } from '@/lib/utils';

export interface CalendarCardProps {
  selectedDate?: Date | null;
  onDateSelect: (date: Date, isMultiSelect?: boolean) => void;
  entryDates?: Set<string>;
  disabled?: boolean;
  className?: string;
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toMonthKey(date: Date): `${number}-${string}` {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const CalendarCard: React.FC<CalendarCardProps> = ({
  selectedDate,
  onDateSelect,
  entryDates = new Set(),
  disabled = false,
  className,
}) => {
  const [month, setMonth] = useState<string>(() =>
    toMonthKey(selectedDate || new Date()),
  );

  useEffect(() => {
    if (selectedDate) {
      setMonth(toMonthKey(selectedDate));
    }
  }, [selectedDate]);

  const selectedKey = selectedDate ? toDateKey(selectedDate) : null;

  return (
    <div
      className={cn('select-none px-2 py-2', disabled && 'opacity-60 cursor-not-allowed', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <Calendar
        value={selectedKey}
        month={month as `${number}-${string}`}
        onMonthChange={(nextMonth) => setMonth(nextMonth)}
        weekStartsOn={1}
        disabled={disabled}
        onValueChange={(nextValue, details) => {
          if (typeof nextValue === 'string') {
            const ev = details.event as MouseEvent | KeyboardEvent | undefined;
            onDateSelect(parseIsoDateLocal(nextValue), Boolean(ev?.ctrlKey || ev?.metaKey));
          }
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <CalendarPrevious
            data-variant="ghost"
            className="h-7 w-7 p-0 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
          />
          <CalendarHeading className="text-sm font-medium text-foreground" />
          <CalendarNext
            data-variant="ghost"
            className="h-7 w-7 p-0 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
          />
        </div>

        <CalendarGrid>
          <CalendarWeekdays>
            {(index) => (
              <CalendarWeekday
                index={index}
                className="text-center text-[10px] text-muted-foreground font-medium py-0.5 w-8"
              />
            )}
          </CalendarWeekdays>
          <CalendarWeeks>
            {(cell) => {
              const hasEntry = entryDates.has(cell.date);
              const isSelected = cell.date === selectedKey;
              return (
                <CalendarDay
                  value={cell.date}
                  className={cn(
                    'relative w-8 h-8 rounded text-xs transition-colors',
                    hasEntry && !isSelected && 'bg-accent/50 font-semibold text-accent-foreground',
                  )}
                >
                  <span>{Number(cell.date.slice(8, 10))}</span>
                  {hasEntry && !isSelected && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                  )}
                </CalendarDay>
              );
            }}
          </CalendarWeeks>
        </CalendarGrid>
      </Calendar>
    </div>
  );
};
