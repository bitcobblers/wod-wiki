import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { TEST_IDS } from '@/lib/testIds';

export interface ScrubberOption {
  id: string;
  label: string;
  sublabel?: string;
  value: string;
}

export interface TokenScrubberProps {
  label: string;
  ariaLabel?: string;
  options: readonly ScrubberOption[];
  selectedValue: string;
  onSelect: (option: ScrubberOption) => void;
  compact?: boolean;
  testId?: string;
  optionTestIdPrefix?: string;
}

/**
 * Fixed-height (`50cqh`) vertical snap scrubber for bounded numeric & timer dials.
 * Commits strictly on intentional item click rather than ambient scroll events.
 */
export const TokenScrubber: React.FC<TokenScrubberProps> = ({
  label,
  ariaLabel,
  options,
  selectedValue,
  onSelect,
  compact = false,
  testId = TEST_IDS.EDITOR_INSPECTOR_SCRUBBER,
  optionTestIdPrefix,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const selected = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!selected) return;
    const targetTop = selected.offsetTop - (el.clientHeight - selected.offsetHeight) / 2;
    el.scrollTop = Math.max(0, targetTop);
  }, [selectedValue, options.length]);

  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1" data-testid={testId}>
      <span className="text-xs font-semibold text-muted-foreground px-0.5 truncate">{label}</span>
      <div
        className={cn(
          'relative rounded-md border border-border bg-popover overflow-hidden',
          compact ? 'h-[144px]' : 'h-[172px]',
        )}
        style={{ containerType: 'size' }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1.5 top-1/2 -translate-y-1/2 h-11 rounded-[6px] bg-primary/10 border border-primary/40 z-[1]"
        />
        <div
          ref={scrollerRef}
          role="listbox"
          aria-label={ariaLabel ?? label}
          className="relative z-[2] h-full overflow-y-auto snap-y snap-mandatory overscroll-contain flex flex-col"
          style={{ paddingBlock: 'calc(50cqh - 22px)' }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === selectedValue;
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-testid={optionTestIdPrefix ? `${optionTestIdPrefix}-${opt.id}` : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(opt)}
                className={cn(
                  'shrink-0 h-11 snap-center w-full px-3 flex items-center justify-center gap-1.5 font-mono tabular-nums text-sm transition-colors cursor-pointer',
                  isSelected
                    ? 'font-bold text-primary'
                    : 'font-medium text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="truncate">{opt.label}</span>
                {opt.sublabel && (
                  <span className="text-xs text-muted-foreground">{opt.sublabel}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
