"use client";

import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from '@ui-sdk/react/segmented-control';
import { useState } from 'react';
import { cn } from '../utils/cn';

export type AnalyticsRangeWeeks = 4 | 8 | 16;

export interface RangeSelectorProps {
  weeks?: number;
  onWeeksChange?: (weeks: number) => void;
  className?: string;
}

export function RangeSelector({ weeks: weeksProp, onWeeksChange, className }: RangeSelectorProps) {
  const [internalWeeks, setInternalWeeks] = useState<number>(16);
  const currentWeeks = weeksProp ?? internalWeeks;

  const handleSelect = (next: string | null) => {
    if (!next) return;
    const parsed = Number(next);
    if (onWeeksChange) {
      onWeeksChange(parsed);
    } else {
      setInternalWeeks(parsed);
    }
  };

  return (
    <SegmentedControl
      aria-label="Analytics range"
      value={String(currentWeeks)}
      onValueChange={handleSelect}
      className={cn('inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1', className)}
    >
      <SegmentedControlIndicator />
      {[4, 8, 16].map((w) => (
        <SegmentedControlItem
          key={w}
          value={String(w)}
          className="min-h-11 min-w-11 px-3 py-2 text-xs rounded-md transition-colors flex items-center justify-center font-medium text-muted-foreground hover:text-foreground data-checked:bg-primary data-checked:text-primary-foreground"
        >
          {w}w
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
