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
import type { PropertyPrimitive, TagRefPrimitive } from './syntax-facts';
import {
    resolveTagContributions,
    tagContributionMetrics,
    tagMarkerType,
    tagReferenceFor,
} from '../tags/TagContributions';
import { TAG_REFERENCE_METADATA_KEY, type TagIndex, type TagReferenceMetadata } from '@bitcobblers/wod-wiki-core';

type MetricPair = { metrics: IMetric; meta: SyntaxMeta };

/**
 * One classified metric and where it came from.
 *
 * `explicit` is what the line states, `contributed` is what a tag brings,
 * and `marker` records that a tag applied to the statement.
 */
type ClassifiedSlot =
  | { kind: 'explicit'; pair: MetricPair }
  | { kind: 'contributed'; pair: MetricPair }
  | { kind: 'marker'; pair: MetricPair };

const PROPERTY_KEY_TO_METRIC_TYPE: Record<string, MetricType> = {
  rpe: MetricType.SessionRPE,
  rir: MetricType.RIR,
  intensity: MetricType.Intensity,
  load: MetricType.Load,
  volume: MetricType.Volume,
  work: MetricType.Work,
  // `sound: classic` names a sound profile, the same way a `#{sound-classic}`
  // tag reference does.
  sound: MetricType.Sound,
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

    const slots: ClassifiedSlot[] = [];
    for (const primitive of fact.primitives) {
      slots.push(...classifySlots(primitive, references));
    }

    // What the line states wins over what a tag brings: a contributed metric
    // only fills a type the statement does not already carry. The explicit
    // metrics are known only once every primitive is classified, so the slots
    // are separated first and merged after.
    const explicitTypes = new Set<string>();
    for (const slot of slots) {
      if (slot.kind === 'explicit') explicitTypes.add(slot.pair.metrics.type);
    }
    const contributedTypes = new Set<string>();
    const metricPairs: MetricPair[] = [];
    for (const slot of slots) {
      if (slot.kind !== 'contributed') {
        metricPairs.push(slot.pair);
        continue;
      }
      const type = slot.pair.metrics.type;
      if (explicitTypes.has(type) || contributedTypes.has(type)) continue;
      contributedTypes.add(type);
      metricPairs.push(slot.pair);
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
 * The meta of the equipment token itself — the prefix of the authored label.
 *
 * `KB swings` resolves to the equipment `KB` and the effort `swings`; the
 * equipment's own range is `KB`, so the two marks do not overlap.
 */
function equipmentMeta(resolution: ResolvedReferences, authored: string, meta: SyntaxMeta): SyntaxMeta {
  if (resolution.matched !== 'split' || !resolution.remaining) return meta;
  const prefixEnd = authored.trimEnd().length - resolution.remaining.length;
  if (prefixEnd <= 0) return meta;
  const raw = meta.raw.slice(0, prefixEnd).trimEnd();
  const length = raw.length;
  if (length <= 0) return meta;
  return {
    ...meta,
    endOffset: meta.startOffset + length,
    length,
    columnEnd: meta.columnStart + length,
    raw,
  };
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
        // The equipment is the prefix of the authored label; the effort is
        // what follows. Marking the whole phrase for both would let one mark
        // hide the other.
        meta: equipmentMeta(resolution, authored, meta),
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

function classifyPrimitive(primitive: SyntaxPrimitive): MetricPair[] {
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
      return [propertyPair(primitive)];
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

/**
 * Classify one primitive into the metrics it states, contributes, or marks.
 *
 * A tag reference (`#{tag-slug}`) is not a value the line states — it points
 * at what the tag brings — so it is classified separately from the other
 * primitives.
 */
function classifySlots(primitive: SyntaxPrimitive, references?: ParseReferences): ClassifiedSlot[] {
  if (primitive.kind === 'property' && primitive.tagRefs !== undefined) {
    return propertyTagSlots(primitive, references);
  }
  if (primitive.kind === 'tag_ref') {
    return fragmentTagSlots(primitive, references);
  }
  return classifyPrimitive(primitive).map(pair => ({ kind: 'explicit', pair }));
}

/**
 * The slots a tag reference produces: the metrics the tag contributes, and a
 * marker recording that the tag applied to the statement.
 *
 * Several references can be stacked on one line, so every one contributes.
 * A reference to a tag the catalogue does not know keeps the line's own
 * property metric, so the reference stays visible exactly as written.
 */
function propertyTagSlots(primitive: PropertyPrimitive, references?: ParseReferences): ClassifiedSlot[] {
  const { slots, resolved } = referenceSlots(primitive.tagRefs ?? [], primitive.meta, references);
  if (resolved) return slots;
  return [{ kind: 'explicit', pair: propertyPair(primitive) }];
}

/**
 * The slots a tag reference standing on a line produces.
 *
 * A reference the catalogue does not know keeps a metric showing the
 * reference as written, so an unresolved tag stays visible.
 */
function fragmentTagSlots(primitive: TagRefPrimitive, references?: ParseReferences): ClassifiedSlot[] {
  const { slots, resolved } = referenceSlots([primitive.slug], primitive.meta, references);
  if (resolved) return slots;
  return [{
    kind: 'explicit',
    pair: {
      metrics: {
        type: MetricType.Custom,
        value: primitive.raw,
        origin: 'parser',
        image: primitive.raw,
      },
      meta: primitive.meta,
    },
  }];
}

/**
 * The slots a set of tag references produces, and whether any of them
 * resolved to a tag the catalogue knows.
 */
function referenceSlots(
  slugs: readonly string[],
  meta: SyntaxMeta,
  references?: ParseReferences,
): { slots: ClassifiedSlot[]; resolved: boolean } {
  const slots: ClassifiedSlot[] = [];
  let resolved = false;

  for (const slug of slugs) {
    const contributions = resolveTagContributions(references?.tags, slug);
    // The tag the line points at: the metrics it brings record where they
    // came from, so the editor can link to the tag.
    const reference = tagReferenceFor(references?.tags, slug);

    const contributed = tagContributionMetrics(contributions.metrics);
    if (contributed.length > 0) resolved = true;
    for (const metric of contributed) {
      slots.push({
        kind: 'contributed',
        pair: { metrics: withTagReference(metric, reference), meta },
      });
    }

    for (const tag of contributions.tags) {
      resolved = true;
      // Each tag that applied carries its own reference — a tag a tag
      // applies is a reference of its own, not of the tag that applied it.
      const tagReference = tag === slug
        ? reference
        : tagReferenceFor(references?.tags, tag);
      slots.push({
        kind: 'marker',
        pair: {
          metrics: withTagReference({
            type: tagMarkerType(tag),
            value: tag,
            origin: 'parser',
            image: tag,
          }, tagReference),
          meta,
        },
      });
    }
  }

  return { slots, resolved };
}

/** A metric that records the tag it came from. */
function withTagReference(metric: IMetric, reference: TagReferenceMetadata): IMetric {
  return {
    ...metric,
    metadata: { ...(metric.metadata ?? {}), [TAG_REFERENCE_METADATA_KEY]: reference },
  };
}

/** The property metric a line states outright. */
function propertyPair(primitive: PropertyPrimitive): MetricPair {
  const metricType = PROPERTY_KEY_TO_METRIC_TYPE[primitive.key.toLowerCase()] ?? MetricType.Custom;
  return {
    metrics: new PropertyMetric(primitive.key, primitive.value, {
      type: metricType,
      image: primitive.raw,
    }),
    meta: primitive.meta,
  };
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
