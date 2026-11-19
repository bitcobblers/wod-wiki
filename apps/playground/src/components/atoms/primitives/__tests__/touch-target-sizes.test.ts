import { describe, it, expect } from 'vitest';
import { buttonVariants } from '@bitcobblers/wod-wiki-ui/primitives';

describe('touch target sizes', () => {
  it('enforces touch target sizing baseline (44x44px minimum) on icon buttons', () => {
    const iconClasses = buttonVariants({ size: 'icon' });
    expect(iconClasses).toContain('min-h-11');
    expect(iconClasses).toContain('min-w-11');
  });
});
