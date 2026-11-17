/**
 * Effort Resolver — Analytics Boundary
 *
 * Implements IEffortResolver with exact and fuzzy alias matching.
 * Creates synthetic unresolved efforts for unmatched labels.
 */

import { v7 as uuidv7 } from 'uuid';
import { disciplineFactorFor } from './disciplines';
import type {
  IEffort,
  IEffortRegistry,
  IEffortResolver,
  EffortResolverOptions,
  EffortResolutionOptions,
  ResolvedEffort,
  EffortResolvedFrom,
} from './types';
import { DEFAULT_RESOLVER_OPTIONS } from './types';
import { findBestFuzzyMatch, normalizeForFuzzy } from './fuzzyMatch';

function normalizeSlug(label: string): string {
  return normalizeForFuzzy(label).replace(/\s+/g, '-');
}

export class EffortResolver implements IEffortResolver {
  private readonly options: Required<EffortResolverOptions>;

  constructor(
    private readonly registry: IEffortRegistry,
    options?: EffortResolverOptions,
  ) {
    this.options = {
      defaultMet: options?.defaultMet ?? DEFAULT_RESOLVER_OPTIONS.defaultMet,
      defaultThreshold:
        options?.defaultThreshold ?? DEFAULT_RESOLVER_OPTIONS.defaultThreshold,
    };
  }

  resolveBySlug(slug: string): IEffort | null {
    return this.registry.resolve(slug);
  }

  resolveByAlias(label: string): IEffort | null {
    const normalized = normalizeForFuzzy(label);
    for (const effort of this.registry.list()) {
      if (normalizeForFuzzy(effort.label) === normalized) return effort;
      for (const alias of effort.aliases) {
        if (normalizeForFuzzy(alias) === normalized) return effort;
      }
    }
    return null;
  }

  resolveFuzzy(
    label: string,
    options?: { threshold?: number },
  ): IEffort {
    const threshold = options?.threshold ?? this.options.defaultThreshold;
    const normalized = normalizeForFuzzy(label);

    // 1. Exact alias/slug match (distance 0)
    const exact = this.resolveByAlias(label);
    if (exact) return exact;

    // 2. Fuzzy alias matching
    const candidates: { alias: string; effort: IEffort }[] = [];
    for (const effort of this.registry.list()) {
      for (const alias of [effort.label, ...effort.aliases]) {
        candidates.push({ alias, effort });
      }
    }

    const best = findBestFuzzyMatch(
      normalized,
      candidates.map((c) => c.alias),
      threshold,
    );

    if (best) {
      const matched = candidates.find(
        (c) => normalizeForFuzzy(c.alias) === normalizeForFuzzy(best.target),
      );
      if (matched) {
        return matched.effort;
      }
    }

    // 3. Synthetic fallback
    return this.createSyntheticEffort(label);
  }

  resolveEffort(label: string, options?: EffortResolutionOptions): ResolvedEffort {
    const effort = this.resolveBySlug(label)
      ?? this.resolveByAlias(label)
      ?? this.resolveFuzzy(label, { threshold: options?.threshold });
    return this.resolveDefinition(effort, options);
  }

  resolveDefinition(effort: IEffort, options?: EffortResolutionOptions): ResolvedEffort {
    return this.materialize(effort, options?.modifiers ?? {}, new Set<string>());
  }

  list(): readonly IEffort[] {
    return this.registry.list();
  }

  private materialize(
    definition: IEffort,
    modifiers: Record<string, string>,
    seen: Set<string>,
  ): ResolvedEffort {
    if (seen.has(definition.slug)) {
      throw new Error(`EffortResolver: circular effort derivation detected at "${definition.slug}"`);
    }
    seen.add(definition.slug);

    const parent = definition.derivation?.parentSlug
      ? this.registry.resolve(definition.derivation.parentSlug)
      : null;
    const parentResolved = parent ? this.materialize(parent, modifiers, seen) : null;

    let met = parentResolved?.met ?? definition.baseAttributes.met;
    const coefficients = definition.derivation?.coefficients ?? {};
    for (const [key, coefficient] of Object.entries(coefficients)) {
      if (this.shouldApplyCoefficient(key, modifiers)) {
        met *= coefficient;
      }
    }

    const hardMet = definition.derivation?.hardOverrides?.met;
    if (typeof hardMet === 'number' && Number.isFinite(hardMet)) {
      met = hardMet;
    }

    const discipline = definition.baseAttributes.discipline ?? parentResolved?.discipline;
    const disciplineFactor = this.resolveDisciplineFactor(definition, parentResolved);
    const registrySource = definition.registrySource;
    const resolvedFrom: EffortResolvedFrom = registrySource === 'user'
      ? 'user'
      : registrySource === 'bundled'
        ? 'bundled'
        : 'default';
    const isEstimated = registrySource === 'synthetic-unresolved';

    const effort: IEffort = {
      ...definition,
      baseAttributes: {
        ...definition.baseAttributes,
        met,
        discipline,
        disciplineFactor,
        intensityTier: definition.baseAttributes.intensityTier ?? parentResolved?.intensityTier,
      },
    };

    return {
      effort,
      definition,
      slug: effort.slug,
      label: effort.label,
      met,
      baseAttributes: effort.baseAttributes,
      discipline,
      disciplineFactor,
      intensityTier: effort.baseAttributes.intensityTier,
      modifiers: { ...modifiers },
      registrySource,
      resolvedFrom,
      isEstimated,
    };
  }

  private shouldApplyCoefficient(key: string, modifiers: Record<string, string>): boolean {
    if (key === 'met' || key === '*') return true;
    for (const [modifierKey, modifierValue] of Object.entries(modifiers)) {
      if (
        key === modifierKey ||
        key === modifierValue ||
        key === `${modifierKey}:${modifierValue}` ||
        key === `${modifierKey}=${modifierValue}`
      ) {
        return true;
      }
    }
    return false;
  }

  private resolveDisciplineFactor(definition: IEffort, parent?: ResolvedEffort | null): number {
    const hardOverride = definition.derivation?.hardOverrides?.disciplineFactor;
    if (typeof hardOverride === 'number' && Number.isFinite(hardOverride)) return hardOverride;

    const explicit = definition.baseAttributes.disciplineFactor;
    if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;

    const discipline = definition.baseAttributes.discipline ?? parent?.discipline;
    if (!discipline && parent) return parent.disciplineFactor;

    return disciplineFactorFor(discipline);
  }

  /**
   * Create a synthetic unresolved effort for analytics continuity.
   * Not persisted to the registry.
   */
  private createSyntheticEffort(label: string): IEffort {
    const normalizedLabel = normalizeForFuzzy(label);
    const slug = normalizeSlug(label);
    return {
      id: `synthetic-${uuidv7()}`,
      slug,
      label: normalizedLabel,
      aliases: [normalizedLabel],
      baseAttributes: {
        met: this.options.defaultMet,
        discipline: undefined,
        intensityTier: undefined,
      },
      registrySource: 'synthetic-unresolved',
    };
  }
}
