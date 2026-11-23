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
      className={cn(
        'select-none w-full min-w-[196px] py-0.5',
        disabled && 'opacity-60 cursor-not-allowed',
        className,
      )}
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
        className="flex flex-col items-stretch gap-1.5 w-full p-0 border-0 rounded-none bg-transparent shadow-none text-foreground"
      >
        <div className="flex items-center justify-between gap-1.5 px-1 pt-1 pb-0.5">
          <CalendarHeading className="m-0 truncate text-left text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground" />
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                const now = new Date();
                setMonth(toMonthKey(now));
                onDateSelect(now, false);
              }}
              className="h-6 rounded-lg border-0 bg-transparent px-[7px] text-[11px] font-semibold leading-none text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none"
            >
              Today
            </button>
            <CalendarPrevious
              data-variant="ghost"
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-[15px] leading-none text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            />
            <CalendarNext
              data-variant="ghost"
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-[15px] leading-none text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            />
          </div>
        </div>

        <CalendarGrid className="w-full table-fixed border-separate border-spacing-x-0.5 border-spacing-y-[3px]">
          <CalendarWeekdays>
            {(index) => (
              <CalendarWeekday
                index={index}
                className="h-6 w-auto border-b border-border/40 p-0 pb-1 text-center align-middle text-[10px] font-semibold tracking-[0.05em] text-muted-foreground/80"
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
                  data-has-entry={hasEntry ? 'true' : undefined}
                  className={cn(
                    'relative h-8 w-auto rounded-lg border-0 bg-transparent p-0 text-center align-middle text-[12.5px] font-medium tabular-nums text-muted-foreground no-underline transition-colors',
                    '[&:hover:not([data-outside]):not([data-disabled]):not([data-selected])]:bg-muted/60 [&:hover:not([data-outside]):not([data-disabled]):not([data-selected])]:text-foreground',
                    'data-[outside]:text-muted-foreground/35',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                    'data-[today]:no-underline',
                    hasEntry &&
                      !isSelected &&
                      '[&:not([data-outside])]:font-bold [&:not([data-outside])]:text-foreground',
                    !isSelected &&
                      'data-[today]:bg-primary/12 data-[today]:font-bold data-[today]:text-primary',
                    isSelected && 'bg-primary font-bold text-primary-foreground',
                  )}
                >
                  <span>{Number(cell.date.slice(8, 10))}</span>
                  {hasEntry && !isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-[3px] left-1/2 -translate-x-1/2 size-1 rounded-full bg-primary"
                    />
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
