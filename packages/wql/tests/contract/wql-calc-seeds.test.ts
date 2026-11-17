/**
 * Cross-package contract test: @bitcobblers/wod-wiki-wql ↔ @bitcobblers/wod-wiki-lang
 *
 * Verifies alignment between WQL calculation targets (WQL_CALC_TARGETS)
 * and @bitcobblers/wod-wiki-lang's calculation engine seeds (BUILTIN_CALCS + STORE_CALCS).
 *
 * Requirements:
 * 1. Every calc.* output key registered in @bitcobblers/wod-wiki-lang calculation seeds
 *    must be present in WQL_CALC_TARGETS.
 * 2. WQL_CALC_TARGETS must accurately reflect all supported calc.* metrics.
 */

import { describe, it, expect } from 'vitest';
import { WQL_CALC_TARGETS, type WqlCalcTarget } from '@bitcobblers/wod-wiki-wql';
import { BUILTIN_CALCS, STORE_CALCS } from '@bitcobblers/wod-wiki-lang';

describe('contract: WQL calculation targets ↔ @bitcobblers/wod-wiki-lang calculation seeds', () => {
  it('aligns WQL_CALC_TARGETS with all calc.* outputs in BUILTIN_CALCS and STORE_CALCS', () => {
    const allDefs = [...BUILTIN_CALCS, ...STORE_CALCS];

    // Extract all output keys and emitTypes starting with 'calc.'
    const registeredCalcKeys = allDefs
      .flatMap((def) => [def.output?.key, def.output?.emitType])
      .filter((key): key is string => Boolean(key && key.startsWith('calc.')));

    const uniqueRegistered = Array.from(new Set(registeredCalcKeys)).sort();
    const vocabularyCalcTargets = [...WQL_CALC_TARGETS].sort();

    // 1. Every engine-registered calc.* key must be in WQL_CALC_TARGETS
    for (const key of uniqueRegistered) {
      expect(
        WQL_CALC_TARGETS as readonly string[],
        `Expected WQL_CALC_TARGETS to contain engine seed "${key}"`,
      ).toContain(key);
    }

    // 2. Parity check: all targets in vocabulary match unique registered seeds
    expect(vocabularyCalcTargets).toEqual(uniqueRegistered);
  });

  it('declares valid calc.* target format for all WQL_CALC_TARGETS', () => {
    expect(WQL_CALC_TARGETS.length).toBeGreaterThan(0);
    for (const target of WQL_CALC_TARGETS) {
      expect(target).toMatch(/^calc\.[a-zA-Z0-9]+$/);
      expect(typeof target).toBe('string');
    }
  });

  it('matches expected canonical calc targets inventory', () => {
    const expectedTargets: WqlCalcTarget[] = [
      'calc.metMinutes',
      'calc.acwr',
      'calc.monotony',
      'calc.strain',
      'calc.e1rm',
      'calc.ctl',
      'calc.atl',
      'calc.tsb',
      'calc.soreness',
      'calc.sleep',
      'calc.hrv',
      'calc.readiness',
      'calc.mvcBw',
      'calc.ef',
      'calc.adherence',
      'calc.pct1rm',
      'calc.sends',
    ];

    expect([...WQL_CALC_TARGETS].sort()).toEqual([...expectedTargets].sort());
  });
});
