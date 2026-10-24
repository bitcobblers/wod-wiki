import assert from 'node:assert';
import { buttonVariants } from '../apps/playground/src/components/atoms/primitives/button';

// Assert-based check for touch target sizing baseline (44x44px minimum)
const iconClasses = buttonVariants({ size: 'icon' });
assert.ok(iconClasses.includes('min-h-11'), 'Expected min-h-11 in icon button variants');
assert.ok(iconClasses.includes('min-w-11'), 'Expected min-w-11 in icon button variants');
