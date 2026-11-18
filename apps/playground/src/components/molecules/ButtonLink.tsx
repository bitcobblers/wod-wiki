import * as React from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Button, type ButtonSize, type ButtonVariant } from '@bitcobblers/wod-wiki-ui/primitives'
import { cn } from '@/lib/utils'

type ButtonLinkIcon = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

export interface ButtonLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  to?: string
  icon?: ButtonLinkIcon
  trailingIcon?: ButtonLinkIcon
  fullWidth?: boolean
}

function getIconSize(size: ButtonLinkProps['size']): string {
  return size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'
}

export const ButtonLink = React.memo(React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ className, variant, size, to, icon: Icon, trailingIcon: TrailingIcon, fullWidth = false, children, ...props }, ref) => {
    const iconSize = getIconSize(size)
    const content = (
      <>
        {Icon && <Icon className={iconSize} aria-hidden />}
        <span className="truncate flex gap-1">{children}</span>
        {TrailingIcon && <TrailingIcon className={cn(iconSize, 'ml-auto')} aria-hidden />}
      </>
    )

    const classes = cn(
      'gap-2 no-underline [&_svg]:pointer-events-none [&_svg]:shrink-0',
      fullWidth && 'w-full justify-start',
      className,
    )

    if (to) {
      return (
        <Button
          variant={variant}
          size={size}
          className={classes}
          render={<RouterLink to={to} ref={ref} {...props} />}
        >
          {content}
        </Button>
      )
    }

    return (
      <Button
        variant={variant}
        size={size}
        className={classes}
        render={<a ref={ref} {...props} />}
      >
        {content}
      </Button>
    )
  },
))
ButtonLink.displayName = 'ButtonLink'
