import { describe, expect, it } from 'vitest';
import {
  SYSTEM_DEFAULT_OUTPUT_UNIT,
  UNIT_CATALOG,
  UnitConversionError,
  convertViaCatalog,
  dimensionKeyOf,
  lookupUnit,
} from '../src/units/catalog';

describe('unit catalog — recognition', () => {
  it('recognizes required distance families and aliases', () => {
    for (const spelling of ['m', 'km', 'cm', 'mm', 'ft', 'in', 'yd', 'mi', 'miles', 'Mile']) {
      expect(lookupUnit(spelling)?.dimension, spelling).toBe('distance');
    }
    expect(lookupUnit('miles')!.canonical).toBe('mi');
  });

  it('recognizes mass, duration, count, and energy families', () => {
    expect(lookupUnit('lbs')!.canonical).toBe('lb');
    expect(lookupUnit('kg')!.dimension).toBe('mass');
    expect(lookupUnit('g')!.dimension).toBe('mass');
    expect(lookupUnit('sec')!.canonical).toBe('s');
    expect(lookupUnit('min')!.dimension).toBe('duration');
    expect(lookupUnit('hr')!.canonical).toBe('h');
    expect(lookupUnit('ms')!.dimension).toBe('duration');
    expect(lookupUnit('reps')!.canonical).toBe('rep');
    expect(lookupUnit('count')!.dimension).toBe('count');
    expect(lookupUnit('kcal')!.dimension).toBe('energy');
    expect(lookupUnit('cal')!.dimension).toBe('energy');
  });

  it('recognizes registered compounds', () => {
    expect(lookupUnit('m/s')!.dimension).toBe('speed');
    expect(lookupUnit('km/h')!.dimension).toBe('speed');
    expect(lookupUnit('min/km')!.dimension).toBe('pace');
    expect(lookupUnit('min/mi')!.dimension).toBe('pace');
  });

  it('percent is a ratio scale with 100% = 1', () => {
    expect(lookupUnit('%')!.dimension).toBe('ratio');
    expect(convertViaCatalog(100, '%', 'ratio')).toBe(1);
  });

  it('an unrecognized unit is unknown — never silently accepted', () => {
    expect(lookupUnit('furlongs')).toBeUndefined();
    expect(dimensionKeyOf('furlongs')).toBeUndefined();
  });
});

describe('unit catalog — conversion', () => {
  it('uses the agreed fixed factors', () => {
    expect(convertViaCatalog(1, 'lb', 'kg')).toBeCloseTo(0.45359237, 10);
    expect(convertViaCatalog(1, 'mi', 'm')).toBe(1609.344);
    expect(convertViaCatalog(1, 'min', 's')).toBe(60);
    expect(convertViaCatalog(1, 'km', 'm')).toBe(1000);
  });

  it('converts within compound dimensions through component scale factors', () => {
    expect(convertViaCatalog(10, 'km/h', 'm/s')).toBeCloseTo(10 / 3.6, 10);
    expect(convertViaCatalog(3, 'm/s', 'km/h')).toBeCloseTo(10.8, 10);
    expect(convertViaCatalog(1, 'min/mi', 'min/km')).toBeCloseTo(1000 / 1609.344, 10);
  });

  it('errors on unknown units and cross-dimension conversions', () => {
    expect(() => convertViaCatalog(1, 'furlongs', 'm')).toThrow(UnitConversionError);
    expect(() => convertViaCatalog(1, 'm', 'kg')).toThrow(UnitConversionError);
    try {
      convertViaCatalog(1, 'm', 'kg');
    } catch (e) {
      expect((e as UnitConversionError).code).toBe('dimension-mismatch');
    }
    try {
      convertViaCatalog(1, 'furlongs', 'm');
    } catch (e) {
      expect((e as UnitConversionError).code).toBe('unknown-unit');
    }
  });
});

describe('system default output units (arithmetic contract §5)', () => {
  it('carries the agreed defaults per result dimension', () => {
    expect(SYSTEM_DEFAULT_OUTPUT_UNIT).toEqual({
      mass: 'kg',
      distance: 'm',
      duration: 's',
      count: 'count',
      'count-rate': 'count/s',
      energy: 'cal',
      speed: 'm/s',
      pace: 'min/km',
      ratio: undefined,
    });
  });

  it('every default is itself a recognized canonical unit of its dimension', () => {
    for (const [dimension, unit] of Object.entries(SYSTEM_DEFAULT_OUTPUT_UNIT)) {
      if (unit === undefined) continue;
      expect(lookupUnit(unit)?.canonical, `${dimension} default`).toBe(unit);
      expect(dimensionKeyOf(unit)).toBe(dimension);
    }
  });

  it('the catalog covers the recognition spellings families require', () => {
    const spellings = UNIT_CATALOG.flatMap((u) => [u.canonical, ...(u.aliases ?? [])]);
    for (const required of ['m', 'km', 'cm', 'mm', 'ft', 'in', 'yd', 'mi', 'kg', 'g', 'lb', 'ms', 's', 'min', 'h', 'rep', 'reps', 'count', 'cal', 'kcal']) {
      expect(spellings).toContain(required);
    }
  });
});
