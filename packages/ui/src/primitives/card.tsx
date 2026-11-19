import { renderElement, type PartProps } from '@ui-sdk/react/primitive';
import type * as React from 'react';
import { cn } from '../utils/cn';

export function Card({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }): React.JSX.Element | null {
  return renderElement(
    'div',
    {
      ...props,
      'data-slot': 'card',
      className: cn('rounded-lg border border-border bg-card text-card-foreground shadow-sm', className),
    },
    render,
  );
}

export function CardHeader({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }): React.JSX.Element | null {
  return renderElement(
    'div',
    {
      ...props,
      'data-slot': 'card-header',
      className: cn('flex flex-col space-y-1.5 p-6', className),
    },
    render,
  );
}

export function CardTitle({
  className,
  render,
  ...props
}: Omit<PartProps<'h3'>, 'className'> & { className?: string }): React.JSX.Element | null {
  return renderElement(
    'h3',
    {
      ...props,
      'data-slot': 'card-title',
      className: cn('text-2xl font-semibold leading-none tracking-tight', className),
    },
    render,
  );
}

export function CardDescription({
  className,
  render,
  ...props
}: Omit<PartProps<'p'>, 'className'> & { className?: string }): React.JSX.Element | null {
  return renderElement(
    'p',
    {
      ...props,
      'data-slot': 'card-description',
      className: cn('text-sm text-muted-foreground', className),
    },
    render,
  );
}

export function CardContent({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }): React.JSX.Element | null {
  return renderElement(
    'div',
    {
      ...props,
      'data-slot': 'card-content',
      className: cn('p-6 pt-0', className),
    },
    render,
  );
}

export function CardFooter({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }): React.JSX.Element | null {
  return renderElement(
    'div',
    {
      ...props,
      'data-slot': 'card-footer',
      className: cn('flex items-center p-6 pt-0', className),
    },
    render,
  );
}
