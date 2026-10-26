/**
 * Factory for a fully-seeded composed calculation stack: lookup registry
 * with the four built-in adapters, calculation registry with the built-in
 * suite statically validated, and the engine ready to join an
 * AnalyticsEngine processor chain.
 */

import type { TagIndex } from '@bitcobblers/wod-wiki-core';
import type { IEffortResolver } from '../../effort-registry/types';
import { CalcEngine } from './engine';
import { LookupRegistry } from './lookup';
import { CalculationRegistry } from './registry';
import { BUILTIN_CALCS } from './seeds';
import { createDisciplinesTable, createEffortTable, createProfileTable, createRpeLabelsTable, IProfileSource } from './tables';
import { CalculationDefinition } from './types';
import { compilePropertySummaryCalcs, type PropertyRuleInput } from './shakeOutQueue';

export interface CalcStackOptions {
  effortResolver: IEffortResolver;
  userProfile?: IProfileSource;
  /** Extra/override calcs (dialect, user) registered after the built-ins. */
  calcs?: CalculationDefinition[];
  /**
   * The tag catalogue. A function a tag carries runs where that tag applies.
   */
  tags?: TagIndex;
  /** Tags active for the whole run, whatever the segments say. */
  activeTags?: readonly string[];
  /** Property Note metric/summary rules active for this run or block. */
  propertySources?: readonly PropertyRuleInput[];
}

export interface CalcStack {
  lookups: LookupRegistry;
  registry: CalculationRegistry;
}

export function createCalcStack(options: CalcStackOptions): CalcStack {
  const lookups = new LookupRegistry();
  lookups.register(createEffortTable(options.effortResolver));
  lookups.register(createRpeLabelsTable());
  lookups.register(createProfileTable(options.userProfile));
  lookups.register(createDisciplinesTable());

  const registry = new CalculationRegistry(lookups);
  for (const def of BUILTIN_CALCS) registry.register(def);
  for (const def of options.calcs ?? []) registry.register(def);
  if (options.propertySources && options.propertySources.length > 0) {
    for (const def of compilePropertySummaryCalcs(options.propertySources)) {
      registry.register(def);
    }
  }
  return { lookups, registry };
}

export function createCalcEngine(dialect: string, options: CalcStackOptions): CalcEngine {
  const stack = createCalcStack(options);
  return new CalcEngine(stack.registry, {
    dialect,
    lookups: stack.lookups,
    userProfile: options.userProfile,
    tags: options.tags,
    activeTags: options.activeTags,
    propertySources: options.propertySources,
  });
}
