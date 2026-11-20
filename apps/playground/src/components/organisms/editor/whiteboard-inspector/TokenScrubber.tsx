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
 * Auto-commits when scroll-snap settles (`scrollsnapchange`, or debounced scroll
 * midpoint fallback), on keyboard ArrowUp/ArrowDown, and on direct option click,
 * while suppressing commits during programmatic `selectedValue` sync.
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
  const suppressSnapUntilRef = useRef(0);
  const optionsRef = useRef(options);
  const selectedValueRef = useRef(selectedValue);
  const onSelectRef = useRef(onSelect);
  optionsRef.current = options;
  selectedValueRef.current = selectedValue;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const selected = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!selected) return;
    const targetTop = Math.max(0, selected.offsetTop - (el.clientHeight - selected.offsetHeight) / 2);
    suppressSnapUntilRef.current = Date.now() + 180;
    el.scrollTop = targetTop;
  }, [selectedValue, options.length]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const commitByValue = (nextValue: string | undefined) => {
      if (!nextValue || Date.now() < suppressSnapUntilRef.current) return;
      if (nextValue === selectedValueRef.current) return;
      const matched = optionsRef.current.find((opt) => opt.value === nextValue);
      if (matched) onSelectRef.current(matched);
    };

    const supportsSnapChange =
      typeof HTMLElement !== 'undefined' && 'onscrollsnapchange' in HTMLElement.prototype;

    if (supportsSnapChange) {
      const onSnapChange = (event: Event) => {
        const target = (event as Event & { snapTargetBlock?: HTMLElement | null }).snapTargetBlock;
        commitByValue(target?.dataset?.optionValue);
      };
      el.addEventListener('scrollsnapchange', onSnapChange);
      return () => el.removeEventListener('scrollsnapchange', onSnapChange);
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const findClosestOption = (): string | undefined => {
      if (el.clientHeight <= 0) return undefined;
      const midY = el.scrollTop + el.clientHeight / 2;
      let bestVal: string | undefined;
      let bestDist = Infinity;
      const items = el.querySelectorAll<HTMLElement>('[data-option-value]');
      items.forEach((item) => {
        const itemMid = item.offsetTop + item.offsetHeight / 2;
        const dist = Math.abs(itemMid - midY);
        if (dist < bestDist) {
          bestDist = dist;
          bestVal = item.dataset.optionValue;
        }
      });
      return bestVal;
    };

    const onScroll = () => {
      if (Date.now() < suppressSnapUntilRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        commitByValue(findClosestOption());
      }, 140);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (options.length === 0) return;
    event.preventDefault();
    const curIdx = options.findIndex((o) => o.value === selectedValue);
    const baseIdx = curIdx >= 0 ? curIdx : 0;
    const nextIdx = Math.max(0, Math.min(options.length - 1, baseIdx + (event.key === 'ArrowDown' ? 1 : -1)));
    const nextOpt = options[nextIdx];
    if (nextOpt && nextOpt.value !== selectedValue) {
      onSelect(nextOpt);
    }
  };

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
          tabIndex={0}
          aria-label={ariaLabel ?? label}
          onKeyDown={handleKeyDown}
          className="relative z-[2] h-full overflow-y-auto snap-y snap-mandatory overscroll-contain flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
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
                data-option-value={opt.value}
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
