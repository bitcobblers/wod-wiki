'use client';

import clsx from 'clsx';
import { LayoutGroup, motion } from 'motion/react';
import React, { forwardRef, useId } from 'react';
import { Link } from '@/components/atoms/primitives/link';
import { useCloseNavigationDrawer } from '../../../../app/nav/NavigationDrawerContext';

export function Sidebar({ className, ...props }: React.ComponentPropsWithoutRef<'nav'>) {
  return <nav {...props} className={clsx(className, 'flex h-full min-h-0 flex-col')} />;
}

export function SidebarHeader({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        'flex flex-col border-b border-zinc-950/5 p-4 dark:border-white/5 [&>[data-slot=section]+[data-slot=section]]:mt-2.5',
      )}
    />
  );
}

export function SidebarBody({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        'l2-sidebar-body flex flex-1 flex-col overflow-y-auto p-4 [&>[data-slot=section]+[data-slot=section]]:mt-8',
      )}
    />
  );
}

export function SidebarFooter({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        'flex flex-col border-t border-zinc-950/5 p-4 dark:border-white/5 [&>[data-slot=section]+[data-slot=section]]:mt-2.5',
      )}
    />
  );
}

export function SidebarSection({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const id = useId();

  return (
    <LayoutGroup id={id}>
      <div {...props} data-slot="section" className={clsx(className, 'flex flex-col gap-0.5')} />
    </LayoutGroup>
  );
}

export function SidebarDivider({ className, ...props }: React.ComponentPropsWithoutRef<'hr'>) {
  return <hr {...props} className={clsx(className, 'my-4 border-t border-foreground/5 lg:-mx-4')} />;
}

export function SidebarSpacer({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div aria-hidden="true" {...props} className={clsx(className, 'mt-8 flex-1')} />;
}

export function SidebarHeading({ className, ...props }: React.ComponentPropsWithoutRef<'h3'>) {
  return (
    <h3 {...props} className={clsx(className, 'mb-1 px-2 text-xs/6 font-medium text-muted-foreground')} />
  );
}

type SidebarItemProps = {
  current?: boolean;
  className?: string;
  children?: React.ReactNode;
} & (
  | ({ href?: never } & Omit<React.ComponentPropsWithoutRef<'button'>, 'className'>)
  | ({ href: string } & Omit<React.ComponentPropsWithoutRef<'a'>, 'className' | 'href'>)
);

export const SidebarItem = forwardRef(function SidebarItem(
  { current, className, children, ...props }: SidebarItemProps,
  ref: React.ForwardedRef<HTMLAnchorElement | HTMLButtonElement>,
) {
  const closeDrawer = useCloseNavigationDrawer();
  const classes = clsx(
    'group flex min-h-11 sm:min-h-9 w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left text-base/6 font-medium text-foreground sm:py-2 sm:text-sm/5 transition-all duration-200',
    '[&>[data-slot=icon]]:size-6 [&>[data-slot=icon]]:shrink-0 [&>[data-slot=icon]]:text-muted-foreground sm:[&>[data-slot=icon]]:size-5 [&>[data-slot=icon]]:transition-colors',
    '[&>[data-slot=icon]:last-child]:ml-auto [&>[data-slot=icon]:last-child]:size-5 sm:[&>[data-slot=icon]:last-child]:size-4',
    '[&>[data-slot=avatar]]:-m-0.5 [&>[data-slot=avatar]]:size-7 sm:[&>[data-slot=avatar]]:size-6',
    'hover:bg-primary/10 hover:text-primary hover:[&>[data-slot=icon]]:text-primary',
    'active:bg-primary/15 active:scale-[0.98]',
    'data-[current]:bg-primary/10 data-[current]:text-primary data-[current]:[&>[data-slot=icon]]:text-primary font-bold',
  );

  const linkProps = props as { href: string } & Omit<React.ComponentPropsWithoutRef<'a'>, 'className' | 'href'>;
  const buttonProps = props as Omit<React.ComponentPropsWithoutRef<'button'>, 'className'>;

  return (
    <span className={clsx(className, 'relative')}>
      {current && (
        <motion.span
          layoutId="current-indicator"
          className="absolute inset-y-2 -left-4 w-1 rounded-full bg-primary shadow-[0_0_8px_rgba(129,140,248,0.5)]"
        />
      )}
      {typeof props.href === 'string' ? (
        <Link
          {...linkProps}
          onClick={(e) => {
            linkProps.onClick?.(e);
            if (!e.defaultPrevented) closeDrawer();
          }}
          className={classes}
          data-current={current ? 'true' : undefined}
          aria-current={current ? 'page' : undefined}
          ref={ref as React.ForwardedRef<HTMLAnchorElement>}
        >
          {children}
        </Link>
      ) : (
        <button
          type="button"
          {...buttonProps}
          className={clsx('cursor-default', classes)}
          data-current={current ? 'true' : undefined}
          aria-current={current ? 'page' : undefined}
          ref={ref as React.ForwardedRef<HTMLButtonElement>}
        >
          {children}
        </button>
      )}
    </span>
  );
});

export function SidebarLabel({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) {
  return <span {...props} className={clsx(className, 'truncate')} />;
}
