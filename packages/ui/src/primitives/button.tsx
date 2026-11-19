"use client";

import {
  Button as UiButton,
  type ButtonActionDetails,
  type ButtonOptions,
  type ButtonState,
} from '@ui-sdk/react/button';
import type { PartProps } from '@ui-sdk/react/primitive';
import type * as React from 'react';
import { cn } from '../utils/cn';

export type ButtonVariant =
  | 'default'
  | 'solid'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'link';

export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

export function buttonVariants({
  variant = 'default',
  size = 'default',
  className,
}: ButtonStyleOptions = {}): string {
  return cn(
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50',
    (variant === 'default' || variant === 'solid') &&
      'bg-primary text-primary-foreground border border-primary hover:bg-primary/90',
    variant === 'destructive' &&
      'bg-destructive text-destructive-foreground border border-destructive hover:bg-destructive/90',
    variant === 'outline' &&
      'border border-field-border bg-card text-foreground hover:bg-muted',
    variant === 'secondary' &&
      'border border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
    variant === 'ghost' &&
      'border border-transparent bg-transparent text-foreground hover:bg-muted',
    variant === 'link' &&
      'border border-transparent bg-transparent text-primary underline-offset-4 hover:underline',
    size === 'default' && 'h-10 px-4 py-2',
    size === 'sm' && 'h-9 px-3 text-xs',
    size === 'lg' && 'h-11 px-8',
    size === 'icon' && 'h-11 w-11 min-h-11 min-w-11 p-0',
    className,
  );
}

export type ButtonProps = Omit<PartProps<'button', ButtonState>, 'type' | 'onClick'> &
  ButtonOptions & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    onClick?: (event: React.MouseEvent<HTMLElement>, details: ButtonActionDetails) => unknown;
  };

function mapDataVariant(variant: ButtonVariant): string | undefined {
  if (variant === 'default' || variant === 'solid') return 'solid';
  if (variant === 'outline') return undefined;
  return variant;
}

export function Button({
  variant = 'default',
  size = 'default',
  className,
  ...props
}: ButtonProps): React.JSX.Element | null {
  const dataVariant = mapDataVariant(variant);
  const dataSize = size === 'default' ? undefined : size;
  const resolvedClassName =
    typeof className === 'function'
      ? (state: ButtonState) => buttonVariants({ variant, size, className: className(state) })
      : buttonVariants({ variant, size, className });

  return (
    <UiButton
      data-variant={dataVariant}
      data-size={dataSize}
      className={resolvedClassName}
      {...props}
    />
  );
}

export type { ButtonActionDetails, ButtonOptions, ButtonState };
