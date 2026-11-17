import { describe, expect, it } from 'vitest';
import { convertDisplay, getUnitFamily, resolveOutputUnit } from '../src/units';
import { convertViaCatalog } from '@bitcobblers/wod-wiki-core';

describe('wql unit policy (ticket 13)', () => {
  describe('getUnitFamily — display dimension probe', () => {
    it('identifies dimensions through the catalog', () => {
      expect(getUnitFamily('kg')).toBe('mass');
      expect(getUnitFamily('lb')).toBe('mass');
      expect(getUnitFamily('m')).toBe('distance');
      expect(getUnitFamily('km')).toBe('distance');
      expect(getUnitFamily('min/km')).toBe('pace');
      expect(getUnitFamily('reps')).toBe('count');
    });

    it('returns undefined for unknown units', () => {
      expect(getUnitFamily('furlongs')).toBeUndefined();
      expect(getUnitFamily(undefined)).toBeUndefined();
    });
  });

  describe('convertViaCatalog — strict arithmetic conversion', () => {
    it('converts kg to lb and back with the fixed factor', () => {
      expect(convertViaCatalog(100, 'kg', 'lb')).toBeCloseTo(100 / 0.45359237, 6);
      expect(convertViaCatalog(100, 'lb', 'kg')).toBeCloseTo(45.359237, 6);
    });

    it('converts m to km and back', () => {
      expect(convertViaCatalog(5000, 'm', 'km')).toBe(5);
      expect(convertViaCatalog(5, 'km', 'm')).toBe(5000);
    });

    it('throws on unknown units and cross-dimension conversions', () => {
      expect(() => convertViaCatalog(10, 'reps', 'kg')).toThrow();
      expect(() => convertViaCatalog(10, 'furlongs', 'm')).toThrow();
    });
  });

  describe('convertDisplay — UI display seam', () => {
    it('passes unknown and cross-dimension values through unchanged', () => {
      expect(convertDisplay(10, 'reps', 'kg')).toBe(10);
      expect(convertDisplay(10, 'furlongs', 'm')).toBe(10);
      expect(convertDisplay(10, 'kg', 'kg')).toBe(10);
    });
  });

  describe('resolveOutputUnit — system defaults, no first-record fallback', () => {
    it('applies the system default for the observations dimension', () => {
      expect(resolveOutputUnit([{ unit: 'km' }], {})).toEqual({ unit: 'm', convert: true });
      expect(resolveOutputUnit([{ unit: 'lb' }], {})).toEqual({ unit: 'kg', convert: true });
      expect(resolveOutputUnit([{ unit: 'min' }], {})).toEqual({ unit: 's', convert: true });
      expect(resolveOutputUnit([{ unit: 'kcal' }], {})).toEqual({ unit: 'cal', convert: true });
      expect(resolveOutputUnit([{ unit: 'km/h' }], {})).toEqual({ unit: 'm/s', convert: true });
      expect(resolveOutputUnit([{ unit: 'min/km' }], {})).toEqual({ unit: 'min/km', convert: true });
    });

    it('lets an explicit dimension-compatible directive win', () => {
      expect(resolveOutputUnit([{ unit: 'km' }], { directive: 'km' })).toEqual({ unit: 'km', convert: true });
      expect(resolveOutputUnit([{ unit: 'm' }], { directive: 'mi' })).toEqual({ unit: 'mi', convert: true });
    });

    it('errors on an incompatible directive and on unknown units', () => {
      const mismatched = resolveOutputUnit([{ unit: 'min' }], { directive: 'kg' });
      expect(mismatched.error).toBeDefined();
      expect(mismatched.unit).toBeUndefined();
      const unknown = resolveOutputUnit([{ unit: 'hectares' }], {});
      expect(unknown.error).toContain('hectares');
      const unknownDirective = resolveOutputUnit([{ unit: 'kg' }], { directive: 'stones' });
      expect(unknownDirective.error).toContain('stones');
    });

    it('keeps unitless observations unitless (no reinterpretation)', () => {
      expect(resolveOutputUnit([{ }], {})).toEqual({ unit: undefined, convert: false });
    });

    it('no longer applies the kg/lb widget preference tier', () => {
      // Ticket 13: the host preference is retired from the default chain;
      // the system default applies.
      expect(resolveOutputUnit([{ unit: 'lb' }], { preferred: 'kg' })).toEqual({ unit: 'kg', convert: true });
      expect(resolveOutputUnit([{ unit: 'm' }], { preferred: 'kg' })).toEqual({ unit: 'm', convert: true });
    });
  });
});
