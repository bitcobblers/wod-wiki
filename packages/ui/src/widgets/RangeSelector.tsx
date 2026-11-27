"use client";

import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from '@ui-sdk/react/segmented-control';
import { useState } from 'react';
import { cn } from '../utils/cn';

export type AnalyticsRangeWeeks = 4 | 8 | 16;
export type AnalyticsRangeValue = AnalyticsRangeWeeks | 'all';

export interface RangeSelectorProps<T extends number | 'all' = number> {
  weeks?: T;
  onWeeksChange?: (weeks: T) => void;
  /** Include an unbounded 'All' segment alongside 4w / 8w / 16w (WW-149). */
  allowAll?: boolean;
  className?: string;
}

export function RangeSelector<T extends number | 'all' = number>({
  weeks: weeksProp,
  onWeeksChange,
  allowAll = false,
  className,
}: RangeSelectorProps<T>) {
  const [internalWeeks, setInternalWeeks] = useState<number | 'all'>(16);
  const currentWeeks = weeksProp ?? internalWeeks;

  const handleSelect = (next: string | null) => {
    if (!next) return;
    const parsed: number | 'all' = next === 'all' ? 'all' : Number(next);
    if (onWeeksChange) {
      onWeeksChange(parsed as T);
    } else {
      setInternalWeeks(parsed);
    }
  };

  const options: ReadonlyArray<number | 'all'> = allowAll ? [4, 8, 16, 'all'] : [4, 8, 16];

  return (
    <SegmentedControl
      aria-label="Analytics range"
      value={String(currentWeeks)}
      onValueChange={handleSelect}
      className={cn('inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1', className)}
    >
      <SegmentedControlIndicator />
      {options.map((w) => (
        <SegmentedControlItem
          key={w}
          value={String(w)}
          className="min-h-11 min-w-11 px-3 py-2 text-xs rounded-md transition-colors flex items-center justify-center font-medium text-muted-foreground hover:text-foreground data-checked:bg-primary data-checked:text-primary-foreground"
        >
          {w === 'all' ? 'All' : `${w}w`}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
