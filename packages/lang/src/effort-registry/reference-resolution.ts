/**
 * Shared exact reference resolver — the single door for authored-label →
 * canonical effort/equipment resolution used by the parser, editor preview,
 * runtime enrichment, and seed/local indexing.
 *
 * Precedence (accepted proposal): explicit JSON ref > exact equipment word
 * prefix + remaining effort (both must resolve uniquely) > whole-label exact
 * (slug/alias) > note defaults (empty-movement fill only) > effort-definition
 * equipment. Fuzzy matching never produces a canonical reference here —
 * unknown/ambiguous/invalid values retain the authored source and carry a
 * visible diagnostic instead of falling back.
 *
 * The index is built once per catalog (hydration), never per statement.
 */

import type {
  ICodeStatement,
  IMetric,
  ReferenceDiagnostic,
  ReferenceMatchKind,
  ReferenceRef,
} from '@bitcobblers/wod-wiki-core';
import { getReferenceMetadata } from '@bitcobblers/wod-wiki-core';
import { dedupeEntitiesByPrecedence, resolveEntityRank, type IEffort, type IEquipment, type ResolvedEffort } from './types';
import { normalizeForFuzzy } from './fuzzyMatch';

/** Catalog collections the resolver resolves against (hydrated from storage/seed). */
export interface ReferenceCatalog {
  efforts: readonly IEffort[];
  equipment: readonly IEquipment[];
}

/** Note/workout-level reference defaults (`metrics.*` frontmatter). */
export interface ReferenceResolutionDefaults {
  /** Default effort slug applied when a statement's movement is otherwise missing. */
  effort?: string;
  /** Default equipment slugs applied when the line and effort define none. */
  equipment?: readonly string[];
}

/** Result of resolving one authored label. */
export interface ResolvedReferences {
  matched: ReferenceMatchKind;
  /** Full authored label — never rewritten. */
  label: string;
  /** Materialized effort, or null when unresolved. */
  effort: ResolvedEffort | null;
  /** Canonical effort ref, or null. */
  effortRef: ReferenceRef | null;
  /** Ordered deduplicated canonical equipment refs. */
  equipment: ReferenceRef[];
  /** Remaining movement text after the equipment prefix strip (split path). */
  remaining: string;
  /** Unknown/ambiguous/invalid findings — never silently dropped. */
  diagnostics: ReferenceDiagnostic[];
}

/** Materialize an effort definition (MET/derivation math) — pass the legacy EffortResolver in hosts. */
export type EffortMaterializer = (effort: IEffort) => ResolvedEffort;

export interface ReferenceIndex {
  /** Resolve an authored movement label (statement effort text or frontmatter value). */
  resolve(label: string, defaults?: ReferenceResolutionDefaults): ResolvedReferences;
  /** Exact slug/alias effort lookup — no fuzzy, never synthetic. */
  resolveEffort(slugOrAlias: string): IEffort | null;
  /** Exact slug/alias equipment lookup — no fuzzy. */
  resolveEquipment(slugOrAlias: string): IEquipment | null;
  /** Materialize a resolved definition (wraps the legacy resolver when provided). */
  materialize(effort: IEffort): ResolvedEffort;
}

interface ExactIndex<T> {
  readonly byKey: ReadonlyMap<string, readonly T[]>;
  lookup(key: string): { entity: T | null; ambiguous: T[] };
}

/**
 * Build a slug/label/alias → entities map.
 * Higher-precedence tiers (core < community < imported < user) shadow lower tiers;
 * collisions across distinct slugs within the same highest tier remain ambiguous.
 */
function buildExactIndex<T extends { slug: string; label: string; aliases: readonly string[]; registrySource?: string; sourceId?: string | null }>(
  entities: readonly T[],
): ExactIndex<T> {
  const deduped = dedupeEntitiesByPrecedence(entities);
  const byKey = new Map<string, T[]>();
  const add = (key: string, entity: T) => {
    if (!key) return;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.includes(entity)) existing.push(entity);
    } else {
      byKey.set(key, [entity]);
    }
  };
  for (const entity of deduped) {
    add(entity.slug.toLowerCase(), entity);
    add(normalizeForFuzzy(entity.label), entity);
    for (const alias of entity.aliases) add(normalizeForFuzzy(alias), entity);
  }
  return {
    byKey,
    lookup(key: string) {
      const direct = byKey.get(key) ?? byKey.get(normalizeForFuzzy(key));
      if (!direct || direct.length === 0) return { entity: null, ambiguous: [] };
      if (direct.length === 1) return { entity: direct[0], ambiguous: [] };
      let maxRank = -1;
      for (const candidate of direct) {
        const rank = resolveEntityRank(candidate);
        if (rank > maxRank) maxRank = rank;
      }
      const topTier = direct.filter((candidate) => resolveEntityRank(candidate) === maxRank);
      if (topTier.length === 1) return { entity: topTier[0], ambiguous: [] };
      return { entity: null, ambiguous: topTier };
    },
  };
}

interface PrefixCandidate {
  /** Lowercased authored-form text (label or alias) matched against the raw label start. */
  readonly lower: string;
  readonly entity: IEquipment;
}


function equipmentRef(entity: IEquipment): ReferenceRef {
  return { kind: 'equipment', slug: entity.slug, label: entity.label };
}

/** Ordered dedupe of canonical refs by kind+slug. */
function dedupeRefs(refs: ReferenceRef[]): ReferenceRef[] {
  const seen = new Set<string>();
  const result: ReferenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

export function createReferenceIndex(
  catalog: ReferenceCatalog,
  materialize?: EffortMaterializer,
): ReferenceIndex {
  const dedupedEquipment = dedupeEntitiesByPrecedence(catalog.equipment ?? []);
  const efforts = buildExactIndex(catalog.efforts ?? []);
  const equipment = buildExactIndex(dedupedEquipment);

  // Longest-first prefix candidates; rebuilt only here, at hydration.
  const prefixCandidates: PrefixCandidate[] = dedupedEquipment
    .flatMap(entity => [entity.label, ...entity.aliases]
      .filter(name => !!name && !!name.trim())
      .map(name => ({ lower: name.trim().toLowerCase(), entity })))
    .sort((a, b) => b.lower.length - a.lower.length);

  // Identity materialization for exact-ref consumers without a legacy resolver;
  // hosts pass the EffortResolver for MET/derivation math.
  // ponytail: skips derivation-chain materialization; add when indexes must resolve derived user efforts without a resolver.
  const materializer: EffortMaterializer = materialize ?? (effort => ({
    effort,
    definition: effort,
    slug: effort.slug,
    label: effort.label,
    met: effort.baseAttributes.met,
    baseAttributes: effort.baseAttributes,
    discipline: effort.baseAttributes.discipline,
    disciplineFactor: effort.baseAttributes.disciplineFactor ?? 1,
    intensityTier: effort.baseAttributes.intensityTier,
    modifiers: {},
    registrySource: effort.registrySource,
    resolvedFrom: effort.registrySource === 'user' ? 'user' : effort.registrySource === 'bundled' ? 'bundled' : 'default',
    isEstimated: false,
  }));

  const resolveEffortExact = (key: string): { entity: IEffort | null; diagnostic?: ReferenceDiagnostic } => {
    const found = efforts.lookup(key.trim());
    if (found.entity) return { entity: found.entity };
    if (found.ambiguous.length > 0) {
      return {
        entity: null,
        diagnostic: {
          reason: 'ambiguous-effort',
          message: `"${key}" matches multiple efforts.`,
          token: key,
          candidates: found.ambiguous.map(e => e.slug),
        },
      };
    }
    return {
      entity: null,
      diagnostic: { reason: 'unknown-effort', message: `Unknown effort "${key}".`, token: key },
    };
  };

  const resolveEquipmentValues = (values: readonly unknown[]): { refs: ReferenceRef[]; diagnostics: ReferenceDiagnostic[] } => {
    const refs: ReferenceRef[] = [];
    const diagnostics: ReferenceDiagnostic[] = [];
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) {
        diagnostics.push({
          reason: 'invalid-explicit',
          message: `Equipment reference must be a slug string, got ${JSON.stringify(value) ?? 'null'}.`,
          token: String(value),
        });
        continue;
      }
      const found = equipment.lookup(value.trim());
      if (found.entity) {
        refs.push(equipmentRef(found.entity));
      } else if (found.ambiguous.length > 0) {
        diagnostics.push({
          reason: 'ambiguous-equipment',
          message: `"${value}" matches multiple equipment entries.`,
          token: value,
          candidates: found.ambiguous.map(e => e.slug),
        });
      } else {
        diagnostics.push({
          reason: 'invalid-explicit',
          message: `Unknown equipment "${value}".`,
          token: value,
        });
      }
    }
    return { refs: dedupeRefs(refs), diagnostics };
  };

  const index: ReferenceIndex = {
    resolveEffort(slugOrAlias) {
      return efforts.lookup(slugOrAlias).entity;
    },
    resolveEquipment(slugOrAlias) {
      return equipment.lookup(slugOrAlias).entity;
    },
    materialize(effort) {
      return materializer(effort);
    },

    resolve(label, defaults) {
      const source = (label ?? '').trim();
      const diagnostics: ReferenceDiagnostic[] = [];
      const push = (diagnostic: ReferenceDiagnostic | undefined) => {
        if (diagnostic) diagnostics.push(diagnostic);
      };

      let matched: ReferenceMatchKind = 'none';
      let effortEntity: IEffort | null = null;
      let remaining = '';
      let equipmentRefs: ReferenceRef[] = [];
      let equipmentAuthored = false;

      /** Note defaults (above definition equipment) then effort-definition equipment. */
      const fillEquipment = () => {
        if (equipmentRefs.length > 0 || equipmentAuthored) return;
        if (effortEntity === null) return; // no resolved movement → no invented equipment context
        if (defaults?.equipment?.length) {
          const resolvedDefaults = resolveEquipmentValues(defaults.equipment);
          equipmentRefs = resolvedDefaults.refs;
          for (const diagnostic of resolvedDefaults.diagnostics) {
            push({ ...diagnostic, reason: 'unknown-equipment' });
          }
          if (equipmentRefs.length > 0) return;
        }
        if (effortEntity.equipment?.length) {
          const resolvedDefEquipment = resolveEquipmentValues(effortEntity.equipment);
          equipmentRefs = resolvedDefEquipment.refs;
          for (const diagnostic of resolvedDefEquipment.diagnostics) {
            push({ ...diagnostic, reason: 'unknown-equipment' });
          }
        }
      };

      // Empty authored label: only note defaults may fill the missing movement.
      if (!source) {
        if (defaults?.effort) {
          const found = resolveEffortExact(defaults.effort);
          if (found.entity) {
            effortEntity = found.entity;
            matched = 'default';
          } else {
            push({
              reason: found.diagnostic?.reason === 'ambiguous-effort' ? 'ambiguous-effort' : 'unknown-effort',
              message: `Default effort "${defaults.effort}" is not in the catalog.`,
              token: defaults.effort,
              candidates: found.diagnostic?.candidates,
            });
          }
        }
        fillEquipment();
        return {
          matched,
          label: source,
          effort: effortEntity ? materializer(effortEntity) : null,
          effortRef: effortEntity ? { kind: 'effort', slug: effortEntity.slug, label: effortEntity.label } : null,
          equipment: equipmentRefs,
          remaining: '',
          diagnostics,
        };
      }

      // 1. Explicit JSON reference — wins over everything; never falls back.
      if (source.startsWith('{')) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(source);
        } catch {
          return {
            matched: 'none',
            label: source,
            effort: null,
            effortRef: null,
            equipment: [],
            remaining: '',
            diagnostics: [{
              reason: 'malformed-json',
              message: 'Reference object is not valid JSON.',
              token: source,
            }],
          };
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          && ('effort' in parsed || 'equipment' in parsed)) {
          matched = 'explicit';
          const obj = parsed as { effort?: unknown; equipment?: unknown };
          if (obj.effort !== undefined) {
            if (typeof obj.effort === 'string' && obj.effort.trim()) {
              const found = resolveEffortExact(obj.effort);
              effortEntity = found.entity;
              if (found.diagnostic) {
                push(found.diagnostic.reason === 'ambiguous-effort'
                  ? found.diagnostic
                  : { ...found.diagnostic, reason: 'invalid-explicit', message: `Explicit effort "${obj.effort}" is not in the catalog.` });
              }
            } else {
              push({
                reason: 'invalid-explicit',
                message: 'Explicit "effort" must be a slug string.',
                token: String(obj.effort),
              });
            }
          }
          if (obj.equipment !== undefined) {
            equipmentAuthored = true;
            const values = Array.isArray(obj.equipment) ? obj.equipment : [obj.equipment];
            const resolvedEquipment = resolveEquipmentValues(values);
            equipmentRefs = resolvedEquipment.refs;
            diagnostics.push(...resolvedEquipment.diagnostics);
            // Explicit equipment contradicting the named effort's definition equipment is a conflict.
            if (effortEntity?.equipment?.length) {
              const definitionSlugs = new Set(effortEntity.equipment);
              const authoredSlugs = equipmentRefs.map(ref => ref.slug);
              if (authoredSlugs.length > 0 && authoredSlugs.some(slug => !definitionSlugs.has(slug))) {
                push({
                  reason: 'conflict',
                  message: `Explicit equipment [${authoredSlugs.join(', ')}] contradicts effort "${effortEntity.slug}" definition equipment [${effortEntity.equipment.join(', ')}].`,
                  token: source,
                });
              }
            }
          }
          fillEquipment(); // definition equipment only fills when the line did not author equipment
          return {
            matched,
            label: source,
            effort: effortEntity ? materializer(effortEntity) : null,
            effortRef: effortEntity ? { kind: 'effort', slug: effortEntity.slug, label: effortEntity.label } : null,
            equipment: equipmentRefs,
            remaining: '',
            diagnostics,
          };
        }
        // JSON without reference keys falls through to plain-label handling.
      }

      // 2. Exact equipment prefix + remaining effort — BOTH must resolve uniquely.
      // Try longest prefix first; an invalid remainder falls back to shorter candidates.
      const lowerSource = source.toLowerCase();
      for (const candidate of prefixCandidates) {
        if (!lowerSource.startsWith(candidate.lower)) continue;
        const after = source.slice(candidate.lower.length);
        if (after && !/^\s/.test(after)) continue; // word boundary required
        const candidateRemaining = after.trim();
        if (!candidateRemaining) continue; // equipment alone is not a movement
        const equipmentFound = equipment.lookup(candidate.lower);
        if (equipmentFound.ambiguous.length > 0) {
          push({
            reason: 'ambiguous-equipment',
            message: `"${candidate.lower}" matches multiple equipment entries.`,
            token: source,
            candidates: equipmentFound.ambiguous.map(e => e.slug),
          });
          return {
            matched: 'none',
            label: source,
            effort: null,
            effortRef: null,
            equipment: [],
            remaining: '',
            diagnostics,
          };
        }
        if (!equipmentFound.entity) continue;
        const effortFound = resolveEffortExact(candidateRemaining);
        if (effortFound.entity) {
          matched = 'split';
          effortEntity = effortFound.entity;
          equipmentRefs = [equipmentRef(equipmentFound.entity)];
          equipmentAuthored = true;
          remaining = candidateRemaining;
          break;
        }
        if (effortFound.diagnostic?.reason === 'ambiguous-effort') {
          push(effortFound.diagnostic);
          return {
            matched: 'none',
            label: source,
            effort: null,
            effortRef: null,
            equipment: [],
            remaining: '',
            diagnostics,
          };
        }
        // Unknown remaining movement — try the next shorter equipment candidate.
      }

      // 3. Whole-label exact (slug or alias) — only when no valid split was found.
      if (matched === 'none') {
        const found = resolveEffortExact(source);
        if (found.entity) {
          effortEntity = found.entity;
          matched = 'whole';
        } else if (found.diagnostic?.reason === 'ambiguous-effort') {
          // Ambiguity never falls through to defaults or partial matches.
          push(found.diagnostic);
          return {
            matched: 'none',
            label: source,
            effort: null,
            effortRef: null,
            equipment: [],
            remaining: '',
            diagnostics,
          };
        } else if (found.diagnostic) {
          push(found.diagnostic);
        }
      }

      fillEquipment();

      return {
        matched,
        label: source,
        effort: effortEntity ? materializer(effortEntity) : null,
        effortRef: effortEntity ? { kind: 'effort', slug: effortEntity.slug, label: effortEntity.label } : null,
        equipment: equipmentRefs,
        remaining,
        diagnostics,
      };
    },
  };

  return index;
}

/**
 * Canonical statement refs for index/analytics projection — the single shared
 * replacement for the per-host `extractEffortSlugs` copies.
 *
 * ONLY validated durable refs are returned: canonical slugs carried on the
 * statement's effort/equipment metrics by the shared resolver at parse time.
 * Unresolved labels yield nothing here (their authored source and diagnostics
 * stay on the statement) — resolve authored labels through
 * `ReferenceIndex.resolve` when projecting un-parsed text.
 */
export function extractStatementRefs(statements: readonly ICodeStatement[]): {
  efforts: string[];
  equipment: string[];
} {
  const efforts: string[] = [];
  const equipment: string[] = [];
  const seenEffort = new Set<string>();
  const seenEquipment = new Set<string>();

  const pushUnique = (list: string[], seen: Set<string>, value: string | undefined) => {
    if (!value) return;
    if (seen.has(value)) return;
    seen.add(value);
    list.push(value);
  };

  for (const statement of statements ?? []) {
    const metrics: IMetric[] = Array.isArray(statement.metrics)
      ? statement.metrics
      : statement.metrics?.toArray?.() ?? [];
    for (const metric of metrics) {
      const refs = getReferenceMetadata(metric.metadata)?.refs;
      if (!refs) continue;
      for (const ref of refs) {
        if (ref.kind === 'effort') pushUnique(efforts, seenEffort, ref.slug);
        if (ref.kind === 'equipment') pushUnique(equipment, seenEquipment, ref.slug);
      }
    }
  }
  return { efforts, equipment };
}

/** Canonical slugify for label→candidate-slug hygiene in host projection code. */
export function slugifyRefLabel(label: string): string {
  return normalizeForFuzzy(label).replace(/\s+/g, '-');
}
