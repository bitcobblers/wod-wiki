import { describe, expect, it } from 'vitest';
import { composeMulUnit } from '../../../src/analytics/calc/units';
import { DIM_ZERO } from '../../../src/analytics/calc/dimensions';

describe('composeMulUnit dimensionless results', () => {
  it('preserves the authored unit when only one operand supplies it', () => {
    expect(composeMulUnit('kg', DIM_ZERO, undefined, DIM_ZERO, DIM_ZERO)).toBe('kg');
  });

  it('does not retain a unit when opposing dimensions cancel', () => {
    expect(composeMulUnit('m/s', [1, 0, -1, 0, 0], 'sec/km', [-1, 0, 1, 0, 0], DIM_ZERO)).toBeUndefined();
  });

  it('preserves a named dimensionless unit when both dimensions are zero', () => {
    expect(composeMulUnit('MET', DIM_ZERO, 'AU', DIM_ZERO, DIM_ZERO)).toBe('MET');
  });
});
