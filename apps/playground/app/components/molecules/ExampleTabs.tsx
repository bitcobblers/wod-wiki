import React from 'react';
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { cn } from '@/lib/utils';

export interface ExampleTab {
  label: string;
  anchor?: boolean;
  badge?: string;
}

interface ExampleTabsProps {
  examples: Array<ExampleTab>;
  activeIndex: number;
  onSelect: (index: number) => void;
}

export const ExampleTabs: React.FC<ExampleTabsProps> = ({
  examples,
  activeIndex,
  onSelect,
}) => {
  if (examples.length === 0) return null;

  return (
    <div className="mt-6 rounded-2xl border border-border/70 bg-card/80 backdrop-blur-sm">
      <SegmentedControl
        aria-label="Workout examples"
        value={String(activeIndex)}
        onValueChange={(next) => {
          if (next !== null) onSelect(Number(next));
        }}
        className="flex flex-wrap items-center gap-2 px-3 py-3 border-0 bg-transparent p-0"
      >
        <SegmentedControlIndicator />
        {examples.map((example, index) => {
          const selected = index === activeIndex;
          const isAnchor = example.anchor === true && !selected;
          const showBadge = Boolean(example.badge) && isAnchor;
          return (
            <SegmentedControlItem
              key={`${example.label}-${index}`}
              value={String(index)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'relative rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] transition-all active:scale-95',
                selected
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                  : isAnchor
                    ? 'border border-brand bg-brand/5 text-brand-deep hover:bg-brand/10 dark:text-brand-light'
                    : 'border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {example.label}
              {showBadge ? (
                <span className="ml-2 inline-block rounded-pill bg-brand px-1.5 py-0.5 align-middle text-[8px] font-black leading-none tracking-[0.12em] text-background">
                  {example.badge}
                </span>
              ) : null}
            </SegmentedControlItem>
          );
        })}
      </SegmentedControl>
    </div>
  );
};
