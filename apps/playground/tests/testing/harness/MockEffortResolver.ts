import {
  type IEffort,
  type IEffortResolver,
  type EffortResolverOptions,
  type EffortResolutionOptions,
  type ResolvedEffort,
  type EffortResolvedFrom,
  DEFAULT_RESOLVER_OPTIONS,
} from '@bitcobblers/wod-wiki-lang';

/**
 * Mock Effort Resolver — Deterministic Test Harness
 *
 * Lightweight IEffortResolver implementation backed by an in-memory Map.
 * Injectable into AnalyticsContext for deterministic processor tests.
 *
 * @example
 * ```typescript
 * const resolver = new MockEffortResolver()
 *   .withEfforts(commonFixtureSet)
 *   .withOptions({ defaultMet: 4.0 });
 *
 * const effort = resolver.resolveBySlug('rowing');
 * const fuzzy = resolver.resolveFuzzy('rwo', { threshold: 2 });
 * ```
 */
export class MockEffortResolver implements IEffortResolver {
  private efforts = new Map<string, IEffort>();
  private options: Required<EffortResolverOptions>;

  constructor(options?: EffortResolverOptions) {
    this.options = {
      defaultMet: options?.defaultMet ?? DEFAULT_RESOLVER_OPTIONS.defaultMet,
      defaultThreshold: options?.defaultThreshold ?? DEFAULT_RESOLVER_OPTIONS.defaultThreshold,
    };
  }

  /** Seed with effort fixtures */
  withEfforts(efforts: readonly IEffort[]): this {
    for (const effort of efforts) {
      this.efforts.set(effort.slug, effort);
    }
    return this;
  }

  /** Set a specific effort by slug */
  withEffort(effort: IEffort): this {
    this.efforts.set(effort.slug, effort);
    return this;
  }

  /** Override resolver options */
  withOptions(options: EffortResolverOptions): this {
    this.options = {
      defaultMet: options.defaultMet ?? this.options.defaultMet,
      defaultThreshold: options.defaultThreshold ?? this.options.defaultThreshold,
    };
    return this;
  }

  /** Clear all efforts */
  clear(): this {
    this.efforts.clear();
    return this;
  }

  resolveBySlug(slug: string): IEffort | null {
    return this.efforts.get(slug) ?? null;
  }

  resolveByAlias(label: string): IEffort | null {
    const normalized = label.toLowerCase().trim();
    for (const effort of this.efforts.values()) {
      if (effort.label.toLowerCase().trim() === normalized) return effort;
      for (const alias of effort.aliases) {
        if (alias.toLowerCase().trim() === normalized) return effort;
      }
    }
    return null;
  }

  resolveFuzzy(label: string, options?: { threshold?: number }): IEffort {
    const threshold = options?.threshold ?? this.options.defaultThreshold;
    const normalized = label.toLowerCase().trim();

    // Exact match first
    const exact = this.resolveByAlias(label);
    if (exact) return exact;

    // Simple char-difference fuzzy for mock (deterministic, no Levenshtein dep)
    let best: { effort: IEffort; distance: number } | null = null;

    for (const effort of this.efforts.values()) {
      for (const candidate of [effort.label, ...effort.aliases]) {
        const distance = this.quickDistance(normalized, candidate.toLowerCase().trim());
        if (distance <= threshold) {
          if (!best || distance < best.distance) {
            best = { effort, distance };
          }
        }
      }
    }

    return best?.effort ?? this.createSynthetic(label);
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
    return Array.from(this.efforts.values());
  }

  private materialize(
    definition: IEffort,
    modifiers: Record<string, string>,
    seen: Set<string>,
  ): ResolvedEffort {
    if (seen.has(definition.slug)) {
      throw new Error(`MockEffortResolver: circular effort derivation detected at "${definition.slug}"`);
    }
    seen.add(definition.slug);

    const parent = definition.derivation?.parentSlug
      ? this.efforts.get(definition.derivation.parentSlug) ?? null
      : null;
    const parentResolved = parent ? this.materialize(parent, modifiers, seen) : null;

    let met = parentResolved?.met ?? definition.baseAttributes.met;
    for (const [key, coefficient] of Object.entries(definition.derivation?.coefficients ?? {})) {
      if (this.shouldApplyCoefficient(key, modifiers)) met *= coefficient;
    }

    const hardMet = definition.derivation?.hardOverrides?.met;
    if (typeof hardMet === 'number' && Number.isFinite(hardMet)) met = hardMet;

    const discipline = definition.baseAttributes.discipline ?? parentResolved?.discipline;
    const disciplineFactor = this.resolveDisciplineFactor(definition, parentResolved);
    const resolvedFrom: EffortResolvedFrom = definition.registrySource === 'user'
      ? 'user'
      : definition.registrySource === 'bundled'
        ? 'bundled'
        : 'default';

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
      registrySource: effort.registrySource,
      resolvedFrom,
      isEstimated: effort.registrySource === 'synthetic-unresolved',
    };
  }

  private shouldApplyCoefficient(key: string, modifiers: Record<string, string>): boolean {
    if (key === 'met' || key === '*') return true;
    for (const [modifierKey, modifierValue] of Object.entries(modifiers)) {
      if (key === modifierKey || key === modifierValue || key === `${modifierKey}:${modifierValue}` || key === `${modifierKey}=${modifierValue}`) {
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
    switch (discipline?.toLowerCase()) {
      case 'strength':
      case 'resistance':
        return 1.2;
      case 'yoga':
        return 0.9;
      default:
        return 1.0;
    }
  }

  /** Create a synthetic effort for unmatched labels */
  createSynthetic(label: string): IEffort {
    const slug = label.toLowerCase().trim().replace(/\s+/g, '-');
    return {
      id: `synthetic-mock-${slug}`,
      slug,
      label: label.toLowerCase().trim(),
      aliases: [label.toLowerCase().trim()],
      baseAttributes: {
        met: this.options.defaultMet,
        discipline: undefined,
        intensityTier: undefined,
      },
      registrySource: 'synthetic-unresolved',
    };
  }

  /** Quick deterministic distance — enough for test mocks */
  private quickDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Length-difference fast path
    const lenDiff = Math.abs(a.length - b.length);
    if (lenDiff > this.options.defaultThreshold) return lenDiff;

    // Simplified: count mismatched chars up to min length
    let mismatches = lenDiff;
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
      if (a[i] !== b[i]) mismatches++;
    }
    return mismatches;
  }
}
