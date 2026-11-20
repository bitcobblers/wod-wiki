/**
 * QueryPalette — Concept A unified Split-Pill token pills for the composer's
 * collapsed bar and Zone Scope Map cards.
 *
 * The main button and optional remove button live inside ONE unified pill
 * border container separated by a hairline divider (no floating orphaned ×).
 */
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { ClauseIcon } from './ClauseIcon';
import type { QueryClause } from './queryClauses';
import { CLEAR_ONLY_TYPES, getClauseMeta } from './queryClauses';

export interface TokenSlotPillProps {
  clause: QueryClause;
  isActive?: boolean;
  isCaretMatch?: boolean;
  invalid?: boolean;
  invalidReason?: string;
  onClick?: () => void;
  onRemove?: () => void;
  compact?: boolean;
  placeholderOverride?: string;
}

export function TokenSlotPill({
  clause,
  isActive,
  isCaretMatch = false,
  invalid = false,
  invalidReason,
  onClick,
  onRemove,
  compact = false,
  placeholderOverride,
}: TokenSlotPillProps) {
  const meta = getClauseMeta(clause.type);
  const hasValue = Boolean(clause.value && clause.value.trim());
  const removeLabel = CLEAR_ONLY_TYPES[clause.type] ? `Clear ${meta.label}` : `Remove ${meta.label}`;
  const displayTitle = invalid ? invalidReason : meta.description || meta.label;

  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-stretch overflow-hidden rounded-full border transition-colors',
        invalid
          ? isActive
            ? 'border-amber-700 bg-amber-700 text-white dark:border-amber-400 dark:bg-amber-400 dark:text-zinc-950'
            : 'border-amber-500/70 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-200'
          : isActive
            ? 'border-primary bg-primary text-primary-foreground shadow-xs'
            : isCaretMatch
              ? 'border-primary bg-primary/15 text-primary'
              : hasValue
                ? 'border-border bg-muted/70 text-foreground hover:border-foreground/35'
                : 'border-dashed border-border bg-muted/40 text-muted-foreground hover:border-foreground/35',
      )}
    >
      <button
        type="button"
        data-testid={`token-slot-${clause.type}`}
        onClick={onClick}
        aria-pressed={isActive || undefined}
        aria-invalid={invalid || undefined}
        title={displayTitle}
        className={cn(
          'inline-flex min-w-0 items-center gap-1.5 font-mono transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          'min-h-11 sm:min-h-7',
          compact ? 'px-2.5 py-0.5 text-[11.5px]' : 'px-2.5 py-1 text-xs',
          isActive && 'text-primary-foreground',
        )}
      >
        {invalid ? (
          <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />
        ) : (
          <ClauseIcon
            type={clause.type}
            className={cn(isActive ? 'text-primary-foreground/90' : 'opacity-75')}
          />
        )}
        <span
          className={cn(
            'font-sans text-[11px] font-medium whitespace-nowrap',
            isActive ? 'text-primary-foreground/90' : 'text-muted-foreground',
          )}
        >
          {meta.label}:
        </span>
        <span data-testid={`token-slot-value-${clause.type}`} className={cn('min-w-0 truncate max-w-44 font-semibold', !hasValue && 'italic font-normal')}>
          {hasValue ? clause.value : placeholderOverride || meta.placeholder}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          data-testid={`token-slot-remove-${clause.type}`}
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className={cn(
            'inline-flex items-center justify-center border-l transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            'min-h-11 min-w-11 sm:min-h-7 sm:min-w-7 px-1.5',
            invalid
              ? isActive
                ? 'border-white/30 hover:bg-white/15'
                : 'border-amber-500/40 hover:bg-amber-200/50 dark:hover:bg-amber-900/40'
              : isActive
                ? 'border-primary-foreground/25 text-primary-foreground hover:bg-primary-foreground/15'
                : 'border-border text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
          )}
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      )}
    </span>
  );
}
