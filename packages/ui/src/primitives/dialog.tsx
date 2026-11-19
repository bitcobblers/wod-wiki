import { renderElement, type PartProps } from '@ui-sdk/react/primitive';
import type * as React from 'react';
import { cn } from '../utils/cn';

export function DialogHeader({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }): React.JSX.Element | null {
  return renderElement(
    'div',
    {
      ...props,
      'data-slot': 'dialog-header',
      className: cn('flex flex-col space-y-1.5 text-left', className),
    },
    render,
  );
}

export function DialogFooter({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }): React.JSX.Element | null {
  return renderElement(
    'div',
    {
      ...props,
      'data-slot': 'dialog-footer',
      className: cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className),
    },
    render,
  );
}
