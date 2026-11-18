'use client';

import clsx from 'clsx';
import { LayoutGroup, motion } from 'motion/react';
import React, { forwardRef, useId } from 'react';
import { TouchTarget } from '@/components/atoms/primitives/touch-target';
import { Link } from '@/components/atoms/primitives/link';

export function Navbar({ className, ...props }: React.ComponentPropsWithoutRef<'nav'>) {
  return <nav {...props} className={clsx(className, 'flex flex-1 items-center gap-2 sm:gap-4 py-2.5 min-w-0')} />;
}

export function NavbarDivider({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div aria-hidden="true" {...props} className={clsx(className, 'h-6 w-px bg-muted/60 dark:bg-white/10')} />;
}

export function NavbarSection({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const id = useId();

  return (
    <LayoutGroup id={id}>
      <div {...props} className={clsx(className, 'flex items-center gap-1 sm:gap-3 shrink-0')} />
    </LayoutGroup>
  );
}

export function NavbarSpacer({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div aria-hidden="true" {...props} className={clsx(className, '-ml-4 flex-1')} />;
}

type NavbarItemProps = {
  current?: boolean;
  className?: string;
  children?: React.ReactNode;
} & (
  | ({ href?: never } & Omit<React.ComponentPropsWithoutRef<'button'>, 'className'>)
  | ({ href: string } & Omit<React.ComponentPropsWithoutRef<typeof Link>, 'className'>)
);

export const NavbarItem = forwardRef(function NavbarItem(
  { current, className, children, ...props }: NavbarItemProps,
  ref: React.ForwardedRef<HTMLAnchorElement | HTMLButtonElement>,
) {
  const classes = clsx(
    'group relative flex min-w-0 min-h-11 min-w-11 items-center justify-center gap-3 rounded-lg p-2 text-left text-base/6 font-medium text-foreground sm:text-sm/5 sm:justify-start',
    '[&>[data-slot=icon]]:size-6 [&>[data-slot=icon]]:shrink-0 [&>[data-slot=icon]]:fill-muted-foreground sm:[&>[data-slot=icon]]:size-5',
    '[&>*:not(:nth-child(2)):last-child[data-slot=icon]]:ml-auto [&>*:not(:nth-child(2)):last-child[data-slot=icon]]:size-5 sm:[&>*:not(:nth-child(2)):last-child[data-slot=icon]]:size-4',
    '[&>[data-slot=avatar]]:-m-0.5 [&>[data-slot=avatar]]:size-7 [&>[data-slot=avatar]]:[--avatar-radius:theme(borderRadius.md)] sm:[&>[data-slot=avatar]]:size-6',
    'hover:bg-muted/50 hover:[&>[data-slot=icon]]:fill-foreground',
    'active:bg-muted/50 active:[&>[data-slot=icon]]:fill-foreground',
    'dark:hover:bg-white/5 dark:hover:[&>[data-slot=icon]]:fill-foreground',
    'dark:active:bg-white/5 dark:active:[&>[data-slot=icon]]:fill-foreground',
  );

  const linkProps = props as { href: string } & Omit<React.ComponentPropsWithoutRef<typeof Link>, 'className'>;
  const buttonProps = props as Omit<React.ComponentPropsWithoutRef<'button'>, 'className'>;

  return (
    <span className={clsx(className, 'relative')}>
      {current && (
        <motion.span
          layoutId="current-indicator"
          className="absolute inset-x-2 -bottom-2.5 h-0.5 rounded-full bg-foreground"
        />
      )}
      {typeof props.href === 'string' ? (
        <Link
          {...linkProps}
          className={classes}
          data-current={current ? 'true' : undefined}
          aria-current={current ? 'page' : undefined}
          ref={ref as React.ForwardedRef<HTMLAnchorElement>}
        >
          <TouchTarget>{children}</TouchTarget>
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
          <TouchTarget>{children}</TouchTarget>
        </button>
      )}
    </span>
  );
});

export function NavbarLabel({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) {
  return <span {...props} className={clsx(className, 'truncate')} />;
}
