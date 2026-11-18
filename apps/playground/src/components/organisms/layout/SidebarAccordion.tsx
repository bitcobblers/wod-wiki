import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
import clsx from 'clsx';
import React from 'react';

interface SidebarAccordionProps {
  title: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  children: React.ReactNode;
  count?: number;
  className?: string;
  sticky?: boolean;
  trailing?: React.ReactNode;
  bodyClassName?: string;
  buttonClassName?: string;
}

const STICKY_HEADER = 'sticky top-0 z-10 bg-card';

export function SidebarAccordion({
  title,
  defaultOpen = false,
  collapsible = true,
  children,
  count,
  className,
  sticky,
  trailing,
  bodyClassName,
  buttonClassName,
}: SidebarAccordionProps) {
  if (!collapsible) {
    return (
      <div className={className}>
        <div className={clsx('group flex w-full items-center gap-1 px-2 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80', sticky && STICKY_HEADER)}>
          <div className="size-4 shrink-0" />
          <span>{title}</span>
          {count !== undefined && (
            <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-border/50 text-[9px] font-black tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        <div className={clsx('flex flex-col gap-0.5')}>
          {children}
        </div>
      </div>
    );
  }

  const button = (
    <CollapsibleTrigger
      className={clsx(
        'group flex h-auto border-0 bg-transparent rounded-none items-center gap-1 px-2 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80 hover:text-primary transition-colors',
        trailing ? 'min-w-0 flex-1' : 'w-full',
        buttonClassName,
        sticky && !trailing && STICKY_HEADER,
      )}
    >
      <ChevronRightIcon className="size-4 shrink-0 fill-muted-foreground/50 transition-transform duration-300 group-data-[open]:rotate-90 group-hover:fill-primary" aria-hidden="true" />
      <span>{title}</span>
      {count !== undefined && (
        <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-border/50 text-[9px] font-black tabular-nums text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
          {count}
        </span>
      )}
    </CollapsibleTrigger>
  );

  return (
    <Collapsible defaultOpen={defaultOpen} className={className}>
      {trailing ? (
        <div className={clsx('flex w-full items-center bg-card', sticky && STICKY_HEADER)}>
          {button}
          {trailing}
        </div>
      ) : (
        button
      )}
      <CollapsiblePanel className={clsx('flex flex-col gap-0.5', bodyClassName)}>
        {children}
      </CollapsiblePanel>
    </Collapsible>
  );
}
