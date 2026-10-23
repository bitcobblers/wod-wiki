import { IMetric, MetricType, ParsedCodeStatement } from '@bitcobblers/wod-wiki-core';
import { ActionMetric } from '../runtime/compiler/metrics/ActionMetric';
import { DistanceMetric } from '../runtime/compiler/metrics/DistanceMetric';
import { DurationMetric } from '../runtime/compiler/metrics/DurationMetric';
import { EffortMetric } from '../runtime/compiler/metrics/EffortMetric';
import { EquipmentMetric } from '../runtime/compiler/metrics/EquipmentMetric';
import { GroupMetric } from '../runtime/compiler/metrics/GroupMetric';
import { PropertyMetric } from '../runtime/compiler/metrics/PropertyMetric';
import { RepMetric } from '../runtime/compiler/metrics/RepMetric';
import { ResistanceMetric } from '../runtime/compiler/metrics/ResistanceMetric';
import { RoundsMetric } from '../runtime/compiler/metrics/RoundsMetric';
import { TextMetric } from '../runtime/compiler/metrics/TextMetric';
import { hintMetric } from '../metrics/hints';
import type { ReferenceIndex, ReferenceResolutionDefaults, ResolvedReferences } from '../effort-registry/reference-resolution';
import { UnitRegistry } from '../metrics/units';
import { EMPTY_UNIT } from '../runtime/compiler/metrics/dimensionFactory';
import { SyntaxFacts, SyntaxMeta, SyntaxPrimitive, SyntaxStatement } from './syntax-facts';
import { resolveTagMetrics } from '../tags/TagCatalog';
import type { TagIndex } from '../tags/TagCatalog';

type MetricPair = { metrics: IMetric; meta: SyntaxMeta };

const PROPERTY_KEY_TO_METRIC_TYPE: Record<string, MetricType> = {
  rpe: MetricType.SessionRPE,
  rir: MetricType.RIR,
  intensity: MetricType.Intensity,
  load: MetricType.Load,
  volume: MetricType.Volume,
  work: MetricType.Work,
};

/** Parser-level reference configuration: shared index + note-level defaults. */
export interface ParseReferences {
  index: ReferenceIndex;
  defaults?: ReferenceResolutionDefaults;
  /** Tags a script can reference with `#{tag-slug}`. */
  tags?: TagIndex;
}

/** Structural keywords that lex as effort words but are not movements. */
const STRUCTURAL_EFFORT_WORDS: ReadonlySet<string> = new Set(['rest', 'amrap', 'emom', 'tabata', 'for time']);

const STANDARD_UNITS = UnitRegistry.standard();

const REFERENCE_PAIR_KEYS: ReadonlySet<string> = new Set(['effort', 'equipment']);

function referenceMetadata(resolution: ResolvedReferences): Record<string, unknown> {
  return {
    matched: resolution.matched,
    source: resolution.label,
    ...(resolution.effortRef || resolution.equipment.length > 0
      ? { refs: [...(resolution.effortRef ? [resolution.effortRef] : []), ...resolution.equipment] }
      : {}),
    ...(resolution.remaining ? { remaining: resolution.remaining } : {}),
    ...(resolution.diagnostics.length > 0 ? { diagnostics: resolution.diagnostics } : {}),
  };
}

export function classifyStatements(facts: SyntaxFacts, references?: ParseReferences): ParsedCodeStatement[] {
  return facts.statements.map((fact) => {
    const statement = new ParsedCodeStatement();
    let metricPairs: MetricPair[] = [];

    for (const primitive of fact.primitives) {
      metricPairs.push(...classifyPrimitive(primitive, references));
    }

    const mergedPairs = mergeFragments(metricPairs);
    const finalPairs = references
      ? applyReferenceResolution(mergedPairs, fact, references)
      : mergedPairs;

    statement.metrics = finalPairs.map((pair) => pair.metrics);
    statement.metricMeta = new Map(finalPairs.map((pair) => [pair.metrics, pair.meta]));

    statement.id = fact.id;
    statement.line = fact.line;
    statement.text = fact.meta.raw;
    statement.raw = fact.meta.raw;
    statement.meta = fact.meta;
    statement.parent = fact.parentId;
    statement.children = fact.children;
    statement.isLeaf = fact.isLeaf;

    return statement;
  });
}

/**
 * Statement-level reference resolution: explicit JSON refs, equipment-prefix
 * split with canonical EffortMetric/EquipmentMetric emission, and note-default
 * effort fill for leaf exercise lines missing a movement. Rest/group headings
 * and timer-only lines never receive defaults.
 */
function applyReferenceResolution(pairs: MetricPair[], fact: SyntaxStatement, references: ParseReferences): MetricPair[] {
  const { index, defaults } = references;
  const result: MetricPair[] = [];

  const emitResolution = (resolution: ResolvedReferences, authored: string, meta: SyntaxMeta): void => {
    if (resolution.effortRef || resolution.matched !== 'none' || resolution.diagnostics.length > 0) {
      result.push({
        metrics: new EffortMetric(authored, {
          resolvedSlug: resolution.effortRef?.slug,
          references: referenceMetadata(resolution),
        }),
        meta,
      });
    }
    if (resolution.equipment.length > 0) {
      result.push({
        metrics: new EquipmentMetric(
          resolution.equipment.map(ref => ref.slug),
          {
            refs: resolution.equipment,
            source: authored,
            matched: resolution.matched,
            diagnostics: resolution.diagnostics,
          },
        ),
        meta,
      });
    }
  };

  // Explicit JSON reference objects — classify their pairs up front.
  const handledRawObjects = new Set<string>();
  const malformedHints: MetricPair[] = [];
  for (const primitive of fact.primitives) {
    if (primitive.kind !== 'metric_object') continue;
    if (handledRawObjects.has(primitive.raw)) continue;
    handledRawObjects.add(primitive.raw);

    if (primitive.pairs.length === 0) {
      // Malformed JSON — currently silent; make the rejection visible.
      malformedHints.push({
        metrics: {
          ...hintMetric('reference.malformed_json', 'parser'),
          metadata: referenceMetadata(index.resolve(primitive.raw)),
        },
        meta: primitive.meta,
      });
      continue;
    }
    const hasReferenceKeys = primitive.pairs.some(pair => REFERENCE_PAIR_KEYS.has(pair.key.toLowerCase()));
    if (!hasReferenceKeys) continue;

    const resolution = index.resolve(primitive.raw);
    if (resolution.matched === 'explicit') {
      emitResolution(resolution, primitive.raw, primitive.meta);
    }
    // Non-reference sibling keys stay authored properties.
    for (const pair of primitive.pairs) {
      if (REFERENCE_PAIR_KEYS.has(pair.key.toLowerCase())) continue;
      const metricType = PROPERTY_KEY_TO_METRIC_TYPE[pair.key.toLowerCase()] ?? MetricType.Custom;
      const rawValue = Array.isArray(pair.value) ? pair.value.join(', ') : pair.value;
      result.push({
        metrics: new PropertyMetric(pair.key, rawValue, { type: metricType, image: `${pair.key}: ${rawValue}` }),
        meta: primitive.meta,
      });
    }
  }

  let sawEffortMetric = false;
  let sawDurationMetric = false;
  let sawMovementQuantity = false;
  let statementMeta: SyntaxMeta | undefined;

  for (const pair of pairs) {
    const metric = pair.metrics;

    // JSON-object property pairs already handled above.
    if (metric.type === MetricType.Custom && handledRawObjects.has(pair.meta.raw)) continue;

    if (metric.type === MetricType.Effort) {
      const authored = metric instanceof EffortMetric ? metric.effort : String(metric.value ?? '');
      const normalized = authored.trim().toLowerCase();
      if (STRUCTURAL_EFFORT_WORDS.has(normalized) || STANDARD_UNITS.has(normalized)) {
        result.push(pair);
        continue;
      }
      sawEffortMetric = true;
      const resolution = index.resolve(authored, defaults);
      if (resolution.matched === 'none' && resolution.diagnostics.length === 0) {
        result.push(pair);
        continue;
      }
      emitResolution(resolution, authored, pair.meta);
      continue;
    }

    if (metric.type === MetricType.Duration) sawDurationMetric = true;
    if (metric.type === MetricType.Rep || metric.type === MetricType.Rounds
      || metric.type === MetricType.Resistance || metric.type === MetricType.Distance) {
      sawMovementQuantity = true;
    }

    result.push(pair);
    statementMeta ??= pair.meta;
  }

  // Note defaults fill an otherwise missing movement on leaf exercise lines only —
  // never rest/group headings or timer-only lines.
  if (defaults && !sawEffortMetric && fact.isLeaf && sawMovementQuantity && !sawDurationMetric) {
    const resolution = index.resolve('', defaults);
    if (resolution.effortRef) {
      emitResolution(resolution, resolution.effortRef.label, statementMeta ?? fact.meta);
    }
  }

  result.push(...malformedHints);
  return result;
}

function classifyPrimitive(primitive: SyntaxPrimitive, references?: ParseReferences): MetricPair[] {
  switch (primitive.kind) {
    case 'lap':
      return [{ metrics: new GroupMetric(primitive.lapType, primitive.raw), meta: primitive.meta }];

    case 'duration': {
      const pairs: MetricPair[] = [];
      if (primitive.timerRaw) {
        pairs.push({ metrics: new DurationMetric(primitive.timerRaw, primitive.hasTrend, primitive.isRequired), meta: primitive.meta });
      }
      if (primitive.isRequired) {
        pairs.push({ metrics: hintMetric('behavior.required_timer', 'parser'), meta: primitive.meta });
      }
      return pairs;
    }

    case 'rounds': {
      if (primitive.sequence) {
        if (primitive.sequence.length === 1) {
          return [{ metrics: new RoundsMetric(primitive.sequence[0]), meta: primitive.meta }];
        }

        return [
          { metrics: new RoundsMetric(primitive.sequence.length), meta: primitive.meta },
          ...primitive.sequence.map((value) => ({ metrics: new RepMetric(value), meta: primitive.meta })),
        ];
      }

      return primitive.label
        ? [{ metrics: new RoundsMetric(primitive.label), meta: primitive.meta }]
        : [];
    }

    case 'round_scheme': {
      // NxM — N rounds of M reps each; same Rounds+Rep scheme as paren ladders.
      return [
        { metrics: new RoundsMetric(primitive.rounds), meta: primitive.meta },
        { metrics: new RepMetric(primitive.reps), meta: primitive.meta },
      ];
    }

    case 'action': {
      const actionText = primitive.hasColonPrefix
        ? primitive.raw.substring(2, primitive.raw.length - 1).trim()
        : primitive.raw.substring(1, primitive.raw.length - 1).trim();
      return [{ metrics: new ActionMetric(actionText, { raw: actionText }), meta: primitive.meta }];
    }

    case 'text': {
      const content = primitive.raw.substring(2).trim();
      return [{ metrics: new TextMetric(content, undefined), meta: primitive.meta }];
    }

    case 'heading': {
      const match = primitive.raw.match(/^(#+)\s*(.*)$/);
      const level = match ? String(match[1].length) : '1';
      const content = match ? match[2].trim() : primitive.raw.substring(1).trim();
      return [{ metrics: new TextMetric(content, level), meta: primitive.meta }];
    }

    case 'quantity': {
      if (primitive.hasAtSign) {
        return [{ metrics: new ResistanceMetric(primitive.value, EMPTY_UNIT), meta: primitive.meta }];
      }

      return [{ metrics: new RepMetric(primitive.value), meta: primitive.meta }];
    }

    case 'effort':
      return [{ metrics: new EffortMetric(primitive.raw), meta: primitive.meta }];

    case 'property': {
      // A tag reference (`#{tag-slug}`) contributes the metrics the tag is
      // marked down with, rather than the literal reference text. Several
      // references can be stacked on one line, so every one contributes.
      if (primitive.tagRefs !== undefined) {
        const tagMetrics = primitive.tagRefs.flatMap(
          slug => resolveTagMetrics(references?.tags, slug),
        );
        if (tagMetrics.length > 0) {
          return tagMetrics.map(metrics => ({ metrics, meta: primitive.meta }));
        }
      }

      const metricType = PROPERTY_KEY_TO_METRIC_TYPE[primitive.key.toLowerCase()] ?? MetricType.Custom;
      return [{
        metrics: new PropertyMetric(primitive.key, primitive.value, {
          type: metricType,
          image: primitive.raw,
        }),
        meta: primitive.meta,
      }];
    }

    case 'metric_object': {
      const pairs = primitive.pairs;
      return pairs.map((pair) => {
        const metricType = PROPERTY_KEY_TO_METRIC_TYPE[pair.key.toLowerCase()] ?? MetricType.Custom;
        const rawValue = Array.isArray(pair.value) ? pair.value.join(', ') : pair.value;
        return {
          metrics: new PropertyMetric(pair.key, rawValue, {
            type: metricType,
            image: `${pair.key}: ${rawValue}`,
          }),
          meta: primitive.meta,
        };
      });
    }

    default:
      return [];
  }
}

function mergeFragments(pairs: MetricPair[]): MetricPair[] {
  if (pairs.length < 2) return pairs;

  const result: MetricPair[] = [];
  let current = pairs[0];

  for (let index = 1; index < pairs.length; index++) {
    const next = pairs[index];

    if (current.metrics instanceof EffortMetric && next.metrics instanceof EffortMetric) {
      if (current.metrics.effort === '/' || current.metrics.effort === '|' ||
          next.metrics.effort === '/' || next.metrics.effort === '|') {
        result.push(current);
        current = next;
        continue;
      }
      const gap = next.meta.startOffset - current.meta.endOffset;
      if (gap <= 1) {
        const mergedMeta: SyntaxMeta = {
          ...current.meta,
          endOffset: next.meta.endOffset,
          columnEnd: next.meta.columnEnd,
          length: next.meta.endOffset - current.meta.startOffset,
          raw: current.meta.raw + (gap === 1 ? ' ' : '') + next.meta.raw,
        };
        current = {
          metrics: new EffortMetric(current.metrics.effort + (gap === 1 ? ' ' : '') + next.metrics.effort),
          meta: mergedMeta,
        };
        continue;
      }
    }

    if (current.metrics instanceof RepMetric && next.metrics instanceof EffortMetric && /^(reps?)$/i.test(next.metrics.effort)) {
      const gap = next.meta.startOffset - current.meta.endOffset;
      if (gap <= 1) {
        const mergedMeta: SyntaxMeta = {
          ...current.meta,
          endOffset: next.meta.endOffset,
          columnEnd: next.meta.columnEnd,
          length: next.meta.endOffset - current.meta.startOffset,
          raw: current.meta.raw + (gap === 1 ? ' ' : '') + next.meta.raw,
        };
        current = {
          metrics: current.metrics,
          meta: mergedMeta,
        };
        continue;
      }
    }

    if (current.metrics instanceof RepMetric && (next.metrics instanceof ResistanceMetric || next.metrics instanceof DistanceMetric)) {
      const gap = next.meta.startOffset - current.meta.endOffset;
      if (gap <= 1) {
        const mergedMeta: SyntaxMeta = {
          ...current.meta,
          endOffset: next.meta.endOffset,
          columnEnd: next.meta.columnEnd,
          length: next.meta.endOffset - current.meta.startOffset,
          raw: current.meta.raw + (gap === 1 ? ' ' : '') + next.meta.raw,
        };
        if (next.metrics instanceof ResistanceMetric && next.metrics.value.amount === undefined) {
          current = {
            metrics: new ResistanceMetric(current.metrics.reps, next.metrics.unit),
            meta: mergedMeta,
          };
          continue;
        }
        if (next.metrics instanceof DistanceMetric && next.metrics.value.amount === undefined) {
          current = {
            metrics: new DistanceMetric(current.metrics.reps, next.metrics.unit),
            meta: mergedMeta,
          };
          continue;
        }
      }
    }

    result.push(current);
    current = next;
  }

  result.push(current);
  return result;
}
