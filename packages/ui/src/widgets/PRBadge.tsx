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
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 dark:bg-amber-900/30 text-amber-500 dark:text-amber-400 border border-amber-500/40 dark:border-amber-400/40 shadow-xs',
        className,
      )}
    >
      <Trophy size={13} className="text-amber-500 dark:text-amber-400 shrink-0" />
      <span>PR!</span>
      {label && <span className="font-medium text-foreground/80">{label}</span>}
      {formattedDelta && (
        <span className="font-mono text-[11px] text-amber-400 dark:text-amber-300 font-semibold">
          ({formattedDelta})
        </span>
      )}
    </span>
  );
}
