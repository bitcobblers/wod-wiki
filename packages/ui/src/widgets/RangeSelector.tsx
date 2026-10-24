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

  const handleSelect = (w: number) => {
    if (onWeeksChange) {
      onWeeksChange(w);
    } else {
      setInternalWeeks(w);
    }
  };

  // ponytail: fixed min-h-11 min-w-11 hit area satisfies mobile touch baseline; add responsive compact prop when dense desktop tables request it.
  return (
    <div className={cn('inline-flex items-center gap-1.5 rounded-lg border border-border bg-card p-1', className)}>
      {[4, 8, 16].map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => handleSelect(w)}
          className={cn(
            'min-h-11 min-w-11 px-3 py-2 text-xs rounded-md transition-colors flex items-center justify-center font-medium',
            currentWeeks === w
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          {w}w
        </button>
      ))}
    </div>
  );
}
