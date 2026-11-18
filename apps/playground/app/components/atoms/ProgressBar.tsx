import { useEffect, useRef, useState } from 'react';
import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { cn } from '@/lib/utils';

export interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  className?: string;
}

export function ProgressBar({ value, max, label, className }: ProgressBarProps) {
  const safeMax = Math.max(1, max);
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const prevRef = useRef(clamped);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (clamped > prevRef.current) {
      setPulsing(true);
      const t = setTimeout(() => setPulsing(false), 200);
      prevRef.current = clamped;
      return () => clearTimeout(t);
    }
    prevRef.current = clamped;
  }, [clamped]);

  return (
    <Progress
      value={clamped}
      max={safeMax}
      aria-label={label ? undefined : 'Progress'}
      className={cn('w-full min-w-0 gap-1.5', className)}
    >
      {label ? (
        <span className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-deep dark:text-brand-light">
          <ProgressLabel className="font-semibold text-brand-deep dark:text-brand-light">
            {label}
          </ProgressLabel>
          <span className="tabular-nums text-muted-foreground">
            {clamped}/{safeMax}
          </span>
        </span>
      ) : null}
      <ProgressTrack
        render={<span />}
        className="block h-2 w-full overflow-hidden rounded-pill bg-brand/10"
      >
        <ProgressIndicator
          className={cn(
            'h-full rounded-pill transition-[width] duration-500 ease-out',
            pulsing ? 'bg-brand-deep' : 'bg-brand',
          )}
        />
      </ProgressTrack>
    </Progress>
  );
}
