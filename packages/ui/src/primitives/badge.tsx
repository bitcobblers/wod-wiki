import { renderElement, type PartProps } from '@ui-sdk/react/primitive';
import type * as React from 'react';
import { cn } from '../utils/cn';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export interface BadgeStyleOptions {
  variant?: BadgeVariant;
  className?: string;
}

export function badgeVariants({
  variant = 'default',
  className,
}: BadgeStyleOptions = {}): string {
  return cn(
    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
    variant === 'default' && 'border-transparent bg-primary text-primary-foreground',
    variant === 'secondary' && 'border-transparent bg-secondary text-secondary-foreground',
    variant === 'destructive' && 'border-transparent bg-destructive text-destructive-foreground',
    variant === 'outline' && 'border-border text-foreground',
    className,
  );
}

export interface BadgeProps extends Omit<PartProps<'div'>, 'className'> {
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({
  variant = 'default',
  className,
  render,
  ...props
}: BadgeProps): React.JSX.Element | null {
  return renderElement(
    'div',
    {
      ...props,
      'data-slot': 'badge',
      'data-variant': variant,
      className: badgeVariants({ variant, className }),
    },
    render,
  );
}
