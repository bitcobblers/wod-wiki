import { Trophy } from 'lucide-react';
import { cn } from '../utils/cn';

export interface PRBadgeProps {
  isPR?: boolean;
  label?: string;
  improvement?: number;
  unit?: string;
  className?: string;
}

export function PRBadge({
  isPR = true,
  label,
  improvement,
  unit,
  className,
}: PRBadgeProps) {
  if (!isPR) return null;

  const formattedDelta =
    improvement !== undefined
      ? `${improvement > 0 ? '+' : ''}${improvement}${unit ? ` ${unit}` : ''}`
      : null;

  return (
    <span
      data-testid="pr-badge"
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-400/40 shadow-xs',
        className,
      )}
    >
      <Trophy size={13} className="text-amber-700 dark:text-amber-300 shrink-0" aria-hidden="true" />
      <span>PR!</span>
      {label && <span className="font-medium text-amber-950 dark:text-amber-100">{label}</span>}
      {formattedDelta && (
        <span className="font-mono text-[11px] text-amber-800 dark:text-amber-200 font-semibold">
          ({formattedDelta})
        </span>
      )}
    </span>
  );
}
