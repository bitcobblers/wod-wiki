/**
 * EffortEnrichmentPass — Post-compilation pass that injects planned effort metrics.
 *
 * Runs AFTER JIT compilation completes, once per compiled block (there is no
 * block tree — see `applyEffortEnrichment`'s doc comment). Enriches exercise
 * blocks with resolved effort-data metrics containing planned MET, discipline
 * factor, and intensity information.
 *
 * This enables the runtime UI to display "planned 12 MET-min" and effort identity
 * during execution, before analytics finalization.
 *
 * IMPORTANT: because this pass runs strictly after `JitCompiler.compile()`,
 * any hints it merges onto the block (`resolved.effort.hints`, via
 * `block.mergeHints`) arrive too late to affect strategy `match()`/`apply()`
 * decisions — those already ran against the pre-compile *statement*, which
 * this pass never touches. See docs/architectural-cleanup-tier-3-extensibility.md
 * §3.3 verification notes for the full explanation, and
 * docs/adr/effort-hints-pre-compile-resolution.md for the proposed fix
 * (a sibling pre-compile pass, `applyEffortHintsToStatements`, not yet
 * implemented as of this comment).
 *
 * @see docs/adr/effort-resolution-compile-time.md
 */

import type { IRuntimeBlock } from '../contracts/IRuntimeBlock';
import type { IEffortResolver, ResolvedEffort } from '../../effort-registry/types';
import type { ReferenceIndex } from '../../effort-registry/reference-resolution';
import { EquipmentMetric } from './metrics/EquipmentMetric';
import { EFFORT_DATA_METRIC_TYPE } from '../../analytics/effortResolution';
import {
  MetricType,
  REFERENCE_METADATA_KEY,
  type IMetric,
  type ReferenceDiagnostic,
  type ReferenceMatchKind,
  type ReferenceRef,
} from '@bitcobblers/wod-wiki-core';
import { IMemoryLocation, MemoryLocation } from '../memory/MemoryLocation';

export interface EffortEnrichmentPassOptions {
  /** Effort resolver for label → definition lookup. */
  resolver: IEffortResolver;
  /** Shared reference index — canonical effort/equipment resolution when configured. */
  references?: ReferenceIndex;
  /** Whether to overwrite existing effort-data metrics (default: false). */
  overwrite?: boolean;
  /** Debug logging enabled (default: false). */
  debug?: boolean;
}

/**
 * Enriches a single compiled block with planned effort metrics.
 *
 * There is no block *tree* to walk here: the JIT compiler is lazy and
 * per-round (see docs/parser-compiler-runtime-metrics.md) — `JitCompiler.compile()`
 * returns exactly one block per call, and `IRuntimeBlock` has no `children`
 * field. Each child block gets its own `applyEffortEnrichment` call when
 * *it* is compiled and pushed (see `CompileAndPushBlockAction`), so a single,
 * non-recursive call here already covers every block in the workout — an
 * earlier version of this function attempted to recurse into `block.children`,
 * which is dead code (no `IRuntimeBlock` implementation ever has that field).
 *
 * @param block The single compiled block to enrich (not a tree root)
 * @param options Resolver and configuration
 */
// Console is the sanctioned sink for these debug-traced enrichment passes.
// eslint-disable-next-line no-console
const logTrace = (message: string): void => console.log(message);

export function applyEffortEnrichment(block: IRuntimeBlock, options: EffortEnrichmentPassOptions): void {
  const { resolver, references, overwrite = false, debug = false } = options;
  tryEnrichBlock(block, resolver, references, overwrite, debug);
}

function tryEnrichBlock(
  block: IRuntimeBlock,
  resolver: IEffortResolver,
  references: ReferenceIndex | undefined,
  overwrite: boolean,
  debug: boolean,
): void {
  // Only enrich exercise blocks and effort blocks
  const normalizedBlockType = block.blockType?.toLowerCase();
  if (normalizedBlockType !== 'effort' && normalizedBlockType !== 'exercise') {
    return;
  }

  // Get the block label to use as the effort identifier
  const label = block.label;
  if (!label) {
    if (debug) logTrace(`[EffortEnrichment] Skipping block with no label: ${block.key}`);
    return;
  }

  // Check if block already has effort-data metric
  const existingEffortData = block.getAllMemory().find(
    loc => loc.metrics.toArray().some(m => m.type === EFFORT_DATA_METRIC_TYPE),
  );

  if (existingEffortData && !overwrite) {
    if (debug) logTrace(`[EffortEnrichment] Skipping block already enriched: ${label}`);
    return;
  }
  try {
  // Resolve the effort. `resolved.effort.hints` carries effort-defined hints
  // (Tier 3 §3.3), merged into 'metric:hint' block memory below. NOTE: this
  // runs after JitCompiler.compile() has already returned, so these hints
  // are NOT visible to hasHint()/getHints() during strategy match()/apply()
  // (those only read statement metrics, attached before compilation) — see
  // IRuntimeBlock.mergeHints's doc comment and
  // docs/architectural-cleanup-tier-3-extensibility.md §3.3 for the gap.
  //
  // With a reference index configured, resolution is canonical-only: an
  // unknown/ambiguous label keeps its authored source and carries a visible
  // diagnostic instead of a synthetic fallback.
  let resolved: ResolvedEffort | undefined;
  let matchedKind: ReferenceMatchKind = 'none';
  let equipmentRefs: ReferenceRef[] = [];
  let diagnostics: ReferenceDiagnostic[] = [];
  if (references) {
    const resolution = references.resolve(label);
    resolved = resolution.effort ?? undefined;
    matchedKind = resolution.matched;
    equipmentRefs = resolution.equipment;
    diagnostics = resolution.diagnostics;
  } else {
    resolved = resolver.resolveEffort(label);
  }

  if (!resolved) {
    if (diagnostics.length > 0) {
      block.pushMemory(new MemoryLocation('metric:tracked', [{
        type: MetricType.Hint,
        value: 'reference.unresolved',
        image: label,
        origin: 'compiler',
        metadata: { [REFERENCE_METADATA_KEY]: { matched: 'none', source: label, diagnostics } },
      }]));
    }
    if (debug) logTrace(`[EffortEnrichment] Unresolved effort: ${label}`);
    return;
  }

  const effortHints = resolved.effort.hints;
  if (effortHints && Object.keys(effortHints).length > 0) {
      block.mergeHints(effortHints);
  }

    if (debug) {
      logTrace(`[EffortEnrichment] Resolved effort: ${label} → ${resolved.label} (MET: ${resolved.met})`);
    }

    // Create the effort-data metric
    const effortDataMetric: IMetric = {
      type: EFFORT_DATA_METRIC_TYPE as MetricType,
      image: resolved.label,
      value: resolved,
      origin: 'compiler',
      timestamp: new Date(),
      ...(equipmentRefs.length > 0 || diagnostics.length > 0
        ? { metadata: { [REFERENCE_METADATA_KEY]: { matched: matchedKind, source: label, refs: [{ kind: 'effort', slug: resolved.slug, label: resolved.label }, ...equipmentRefs], ...(diagnostics.length > 0 ? { diagnostics } : {}) } } }
        : {}),
    };

    // Create or update a private metrics memory location
    const privateMetrics = block.getMetricMemoryByVisibility('private');
    const existingLoc: IMemoryLocation | undefined = privateMetrics.find(loc =>
      loc.metrics.toArray().some(m => m.type === EFFORT_DATA_METRIC_TYPE),
    );

    if (existingLoc && overwrite) {
      // Update existing effort-data location: remove old effort-data and add new one
      const existingMetrics = existingLoc.metrics.toArray();
      const filtered = existingMetrics.filter(m => m.type !== EFFORT_DATA_METRIC_TYPE);
      filtered.push(effortDataMetric);
      existingLoc.update(filtered);
    } else if (!existingLoc) {
      // Create new private metrics location
      const location = new MemoryLocation('metric:tracked', [effortDataMetric]);
      block.pushMemory(location);
    }

    if (equipmentRefs.length > 0) {
      pushPrivateMetrics(block, MetricType.Equipment, [
        new EquipmentMetric(equipmentRefs.map(ref => ref.slug), {
          refs: equipmentRefs,
          source: label,
          origin: 'compiler',
        }),
      ], MetricType.Equipment, overwrite);
    }
  } catch (err) {
    console.error(`[EffortEnrichment] Failed to resolve effort "${label}":`, err);
  }
}

/** Push metrics into a private memory location keyed by metric type, replacing an existing entry when overwriting. */
function pushPrivateMetrics(
  block: IRuntimeBlock,
  markerType: MetricType | string,
  metrics: IMetric[],
  replaceType: MetricType | string,
  overwrite: boolean,
): void {
  const privateMetrics = block.getMetricMemoryByVisibility('private');
  const existingLoc = privateMetrics.find(loc =>
    loc.metrics.toArray().some(m => m.type === markerType),
  );

  if (existingLoc && overwrite) {
    const filtered = existingLoc.metrics.toArray().filter(m => m.type !== replaceType);
    existingLoc.update([...filtered, ...metrics]);
  } else if (!existingLoc) {
    block.pushMemory(new MemoryLocation('metric:tracked', metrics));
  }
}
