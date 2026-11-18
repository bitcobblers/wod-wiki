import React, { forwardRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';

export const Link = forwardRef<HTMLAnchorElement, { href: string } & React.ComponentPropsWithoutRef<'a'>>(
  function Link({ href, ...props }, ref) {
    return <RouterLink {...props} to={href} ref={ref} />;
  },
);
