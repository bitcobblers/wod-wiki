/**
 * useLiveNoteFacets — Real-time extraction of recognized Tags, Efforts,
 * Equipment, and Unrecognized labels from live markdown/workout content.
 *
 * Uses the canonical section splitter (`parseDocumentSections`), frontmatter
 * tag extractor (`extractTypedFrontmatterTags`), and Whiteboard Script parser
 * (`parseScript` + `createReferenceIndex`) so live L2/L3 menus match persisted
 * storage projections without waiting for an IndexedDB write.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  extractTypedFrontmatterTags,
  getReferenceMetadata,
  getTagReference,
  KNOWN_SECTION_WIDGETS,
  MetricType,
  parseDocumentSections,
  type IMetric,
  type Tag,
  type TagIndex,
} from '@bitcobblers/wod-wiki-core';
import { readFrontmatterMeta } from '@bitcobblers/wod-wiki-engine';
import {
  createReferenceIndex,
  parseScript,
  slugifyRefLabel,
  type IEffort,
  type IEquipment,
  type ReferenceResolutionDefaults,
} from '@bitcobblers/wod-wiki-lang';
import { storageService } from '@/services/storage';
import { getAppEffortRegistry } from '@/services/effortRegistry';
import { getAppEquipmentRegistry } from '@/services/equipmentRegistry';
import { useTagIndex } from '@/hooks/useTagIndex';
import { useOptionalEffortRegistry } from '../../contexts/EffortRegistryContext';
import { useOptionalEquipmentRegistry } from '../../contexts/EquipmentRegistryContext';

const STRUCTURAL_LABELS = new Set([
  'rest',
  'work',
  'amrap',
  'emom',
  'e2mom',
  'e3mom',
  'tabata',
  'for-time',
  'for time',
  'rounds',
  'round',
  'sets',
  'set',
  'buy-in',
  'buy in',
  'cash-out',
  'cash out',
  'cap',
  'time-cap',
  'time cap',
  'warmup',
  'warm-up',
  'cooldown',
  'cool-down',
]);

const INLINE_HASH_TAG_RE = /(?:^|[\s(])#([a-zA-Z][a-zA-Z0-9_-]*)\b/g;

export interface RecognizedTagFacet {
  slug: string;
  label: string;
  type: string;
}

export interface RecognizedEntityFacet {
  slug: string;
  label: string;
}

export interface UnrecognizedFacet {
  /** Exact authored text (without leading `#` for tags). */
  rawLabel: string;
  /** Normalized hyphenated candidate slug (`slugifyRefLabel`). */
  candidateSlug: string;
  /** Default entity kind pre-selected in the creation dialog. */
  suggestedKind: 'tag' | 'effort' | 'equipment';
  /** Suggested tag category when authored under a typed frontmatter key. */
  suggestedCategory?: string;
}

export interface LiveNoteFacets {
  ready?: boolean;
  tags: RecognizedTagFacet[];
  efforts: RecognizedEntityFacet[];
  equipment: RecognizedEntityFacet[];
  unrecognized: UnrecognizedFacet[];
}

export const EMPTY_LIVE_NOTE_FACETS: LiveNoteFacets = {
  ready: false,
  tags: [],
  efforts: [],
  equipment: [],
  unrecognized: [],
};

export interface LiveFacetCatalog {
  efforts: readonly IEffort[];
  equipment: readonly IEquipment[];
  tags: readonly Tag[];
  tagTypes: readonly string[];
  tagIndex?: TagIndex;
}

function extractNoteDefaults(rawContent: string): ReferenceResolutionDefaults {
  const meta = readFrontmatterMeta(rawContent);
  const effort = typeof meta['metrics.effort'] === 'string' ? meta['metrics.effort'].trim() : '';
  const equipmentRaw = meta['metrics.equipment'];
  const equipmentValues = Array.isArray(equipmentRaw)
    ? equipmentRaw
    : typeof equipmentRaw === 'string'
      ? [equipmentRaw]
      : [];
  const equipment = equipmentValues.map((v) => String(v).trim()).filter(Boolean);
  return {
    ...(effort ? { effort } : {}),
    ...(equipment.length > 0 ? { equipment } : {}),
  };
}

function isStructuralMovementLabel(text: string): boolean {
  const cleaned = text.trim().toLowerCase();
  if (!cleaned || !/[a-z]/i.test(cleaned)) return true;
  const slug = slugifyRefLabel(cleaned);
  return !slug || STRUCTURAL_LABELS.has(cleaned) || STRUCTURAL_LABELS.has(slug);
}

/**
 * Pure facet extractor over raw markdown content + current catalog state.
 * Exported directly for unit tests.
 */
export function extractLiveNoteFacets(
  rawContent: string,
  catalog: LiveFacetCatalog,
): LiveNoteFacets {
  if (!rawContent || !rawContent.trim()) {
    return EMPTY_LIVE_NOTE_FACETS;
  }

  const referenceIndex = createReferenceIndex({
    efforts: catalog.efforts,
    equipment: catalog.equipment,
  });

  const tagsByLower = new Map<string, Tag>();
  for (const tag of catalog.tags) {
    const key = tag.label.trim().toLowerCase();
    if (key && !tagsByLower.has(key)) tagsByLower.set(key, tag);
  }
  const knownTagSlugs = new Set<string>(tagsByLower.keys());
  if (catalog.tagIndex) {
    for (const def of catalog.tagIndex.list()) {
      if (!def.isCategory && def.slug.trim()) {
        knownTagSlugs.add(def.slug.trim().toLowerCase());
      }
    }
  }

  const tags: RecognizedTagFacet[] = [];
  const efforts: RecognizedEntityFacet[] = [];
  const equipment: RecognizedEntityFacet[] = [];
  const unrecognized: UnrecognizedFacet[] = [];

  const seenTags = new Set<string>();
  const seenEfforts = new Set<string>();
  const seenEquipment = new Set<string>();
  const seenUnrecognized = new Set<string>();

  const pushTag = (label: string, type = 'general') => {
    const normalizedType = type.trim() || 'general';
    const key = `${normalizedType.toLowerCase()}:${label.toLowerCase()}`;
    if (seenTags.has(key)) return;
    seenTags.add(key);
    tags.push({ slug: label, label, type: normalizedType });
  };

  const pushEffort = (slug: string, label: string) => {
    const key = slug.toLowerCase();
    if (!key || seenEfforts.has(key)) return;
    seenEfforts.add(key);
    efforts.push({ slug, label: label || slug });
  };

  const pushEquipment = (slug: string, label: string) => {
    const key = slug.toLowerCase();
    if (!key || seenEquipment.has(key)) return;
    seenEquipment.add(key);
    equipment.push({ slug, label: label || slug });
  };

  const pushUnrecognized = (
    rawLabel: string,
    suggestedKind: UnrecognizedFacet['suggestedKind'],
    suggestedCategory?: string,
  ) => {
    const cleaned = rawLabel.trim();
    if (!cleaned) return;
    const candidateSlug = slugifyRefLabel(cleaned);
    if (!candidateSlug) return;
    // Never flag as unrecognized if already matched in any recognized bucket.
    if (
      seenEfforts.has(candidateSlug) ||
      seenEquipment.has(candidateSlug) ||
      knownTagSlugs.has(cleaned.toLowerCase()) ||
      knownTagSlugs.has(candidateSlug)
    ) {
      return;
    }
    const dedupeKey = `${suggestedKind}:${candidateSlug}`;
    if (seenUnrecognized.has(dedupeKey)) return;
    seenUnrecognized.add(dedupeKey);
    unrecognized.push({
      rawLabel: cleaned,
      candidateSlug,
      suggestedKind,
      ...(suggestedCategory ? { suggestedCategory } : {}),
    });
  };

  const handleTagCandidate = (rawLabel: string, explicitType?: string) => {
    const trimmed = rawLabel.trim().replace(/^#+/, '');
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const stored = tagsByLower.get(lower);
    const effectiveType = (explicitType ?? stored?.type ?? '').trim().toLowerCase();

    // Anti-duplication rule: effort/equipment-typed tags merge into Efforts / Equipment
    // so `/t/effort/*` and `/t/equipment/*` never leak and items never duplicate.
    if (effectiveType === 'effort') {
      const match = referenceIndex.resolveEffort(trimmed);
      if (match) pushEffort(match.slug, match.label);
      else pushUnrecognized(trimmed, 'effort');
      return;
    }
    if (effectiveType === 'equipment') {
      const match = referenceIndex.resolveEquipment(trimmed);
      if (match) pushEquipment(match.slug, match.label);
      else pushUnrecognized(trimmed, 'equipment');
      return;
    }

    if (knownTagSlugs.has(lower)) {
      pushTag(stored?.label ?? trimmed, stored?.type || explicitType || 'general');
      return;
    }

    // If someone wrote `#kettlebell` or `#fran` and it matches known gear/effort, link it cleanly.
    const eqMatch = referenceIndex.resolveEquipment(trimmed);
    if (eqMatch && !explicitType) {
      pushEquipment(eqMatch.slug, eqMatch.label);
      return;
    }
    const effMatch = referenceIndex.resolveEffort(trimmed);
    if (effMatch && !explicitType) {
      pushEffort(effMatch.slug, effMatch.label);
      return;
    }

    pushUnrecognized(trimmed, 'tag', explicitType || undefined);
  };

  const sections = parseDocumentSections(rawContent, { registeredWidgets: KNOWN_SECTION_WIDGETS });
  const defaults = extractNoteDefaults(rawContent);

  // 1. Frontmatter defaults & typed/general frontmatter tags
  if (defaults.effort) {
    const match = referenceIndex.resolveEffort(defaults.effort);
    if (match) pushEffort(match.slug, match.label);
    else if (!isStructuralMovementLabel(defaults.effort)) pushUnrecognized(defaults.effort, 'effort');
  }
  if (defaults.equipment) {
    for (const eq of defaults.equipment) {
      const match = referenceIndex.resolveEquipment(eq);
      if (match) pushEquipment(match.slug, match.label);
      else pushUnrecognized(eq, 'equipment');
    }
  }

  const splitLeadingEquipment = (phrase: string): string => {
    const words = phrase.trim().split(/\s+/);
    if (words.length < 2) return phrase.trim();
    // Try longest multi-word equipment prefix first (up to words.length - 1).
    for (let len = words.length - 1; len >= 1; len--) {
      const prefix = words.slice(0, len).join(' ');
      const remainder = words.slice(len).join(' ').trim();
      if (!remainder) continue;
      const eq = referenceIndex.resolveEquipment(prefix);
      if (eq) {
        pushEquipment(eq.slug, eq.label);
        return remainder;
      }
    }
    return phrase.trim();
  };

  for (const section of sections) {
    if (section.type === 'frontmatter') {
      const declared = extractTypedFrontmatterTags(section.displayContent, [...catalog.tagTypes]);
      for (const item of declared) {
        if (item.label.startsWith('notebook:') || item.label.startsWith('notebook/')) continue;
        handleTagCandidate(item.label, item.type);
      }
      continue;
    }

    const firstFenceLine = section.rawContent.split(/\r\n|\n|\r/, 1)[0]?.trim() ?? '';
    const wodFenceMatch =
      !section.scriptBlock && section.type === 'code'
        ? firstFenceLine.match(/^`{3,}(?:wod|whiteboard)(?::([\w-]+))?\s*$/i)
        : null;
    const scriptContent = section.scriptBlock?.content ?? (wodFenceMatch ? section.displayContent : undefined);
    const scriptSport = section.scriptBlock?.sport ?? wodFenceMatch?.[1];

    if (!scriptContent) {
      // Scan prose/heading sections (skipping non-workout code/query/widget fences) for inline `#tag` tokens.
      if (section.type !== 'code' && section.type !== 'query' && section.type !== 'widget') {
        for (const line of section.displayContent.split('\n')) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          INLINE_HASH_TAG_RE.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = INLINE_HASH_TAG_RE.exec(trimmedLine)) !== null) {
            if (match[1]) handleTagCandidate(match[1]);
          }
        }
      }
      continue;
    }
    const parsed = parseScript(scriptContent, {
      sport: scriptSport,
      references: referenceIndex,
      defaults,
      tags: catalog.tagIndex,
    });

    for (const statement of parsed.statements ?? []) {
      const metrics: IMetric[] = Array.isArray(statement.metrics)
        ? statement.metrics
        : statement.metrics?.toArray?.() ?? [];

      let sawReferenceMeta = false;
      for (const metric of metrics) {
        const tagRef = getTagReference(metric.metadata);
        if (tagRef?.slug) {
          handleTagCandidate(tagRef.slug);
        }

        const refMeta = getReferenceMetadata(metric.metadata);
        if (!refMeta) continue;
        sawReferenceMeta = true;
        let hasEffortRef = false;
        for (const ref of refMeta.refs ?? []) {
          if (ref.kind === 'effort') {
            hasEffortRef = true;
            pushEffort(ref.slug, ref.label);
          } else if (ref.kind === 'equipment') {
            pushEquipment(ref.slug, ref.label);
          }
        }
        if (!hasEffortRef) {
          const rawCandidate = (
            refMeta.matched === 'split' && refMeta.remaining
              ? refMeta.remaining
              : refMeta.source
          ).trim();
          const candidate =
            refMeta.matched === 'none' ? splitLeadingEquipment(rawCandidate) : rawCandidate;
          if (!isStructuralMovementLabel(candidate)) {
            pushUnrecognized(candidate, 'effort');
          }
        }
      }

      if (!sawReferenceMeta) {
        const effortMetric = statement.metrics?.getMetric?.(MetricType.Effort);
        const rawEffort = typeof effortMetric?.value === 'string' ? effortMetric.value.trim() : '';
        if (rawEffort && !isStructuralMovementLabel(rawEffort)) {
          const resolved = referenceIndex.resolve(rawEffort, defaults);
          for (const eq of resolved.equipment) pushEquipment(eq.slug, eq.label);
          if (resolved.effortRef) {
            pushEffort(resolved.effortRef.slug, resolved.effortRef.label);
          } else {
            const rawCandidate = (
              resolved.matched === 'split' && resolved.remaining ? resolved.remaining : rawEffort
            ).trim();
            const candidate =
              resolved.matched === 'none' ? splitLeadingEquipment(rawCandidate) : rawCandidate;
            if (!isStructuralMovementLabel(candidate)) {
              pushUnrecognized(candidate, 'effort');
            }
          }
        }
      }
    }

    // Catch standalone `#tag` lines inside script fences that have no movement statement.
    for (const line of scriptContent.split('\n')) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('//')) continue;
      INLINE_HASH_TAG_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = INLINE_HASH_TAG_RE.exec(trimmedLine)) !== null) {
        if (match[1]) handleTagCandidate(match[1]);
      }
    }
  }

  return { ready: true, tags, efforts, equipment, unrecognized };
}

// Pub/sub so in-place tag/effort/equipment creation immediately re-runs live facet hooks.
const facetRefreshListeners = new Set<() => void>();

export function notifyReferenceCatalogChanged(): void {
  for (const listener of facetRefreshListeners) listener();
}

export function subscribeReferenceCatalogChanged(listener: () => void): () => void {
  facetRefreshListeners.add(listener);
  return () => {
    facetRefreshListeners.delete(listener);
  };
}

/**
 * Debounced React hook returning live recognized & unrecognized facets for `rawContent`.
 */
export function useLiveNoteFacets(
  rawContent: string | undefined,
  options?: { enabled?: boolean; debounceMs?: number },
): LiveNoteFacets {
  const enabled = options?.enabled !== false;
  const debounceMs = options?.debounceMs ?? 120;
  const effortCtx = useOptionalEffortRegistry();
  const equipmentCtx = useOptionalEquipmentRegistry();
  const effortsReady = effortCtx ? effortCtx.isReady : true;
  const equipmentReady = equipmentCtx ? equipmentCtx.isReady : true;
  const effortRevision = effortCtx?.revision ?? 0;
  const equipmentRevision = equipmentCtx?.revision ?? 0;
  const effortRegistry = effortCtx?.registry ?? getAppEffortRegistry();
  const equipmentRegistry = equipmentCtx?.registry ?? getAppEquipmentRegistry();
  const tagIndex = useTagIndex();

  const [debouncedContent, setDebouncedContent] = useState(rawContent ?? '');
  const [storedCatalog, setStoredCatalog] = useState<{
    loaded: boolean;
    tags: Tag[];
    tagTypes: string[];
  }>({
    loaded: false,
    tags: [],
    tagTypes: [],
  });
  const [catalogBump, setCatalogBump] = useState(0);

  useEffect(() => {
    return subscribeReferenceCatalogChanged(() => {
      setCatalogBump((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.all([
      storageService.getAllTags().catch(() => [] as Tag[]),
      storageService.getAllTagTypes().catch(() => []),
    ]).then(([tags, types]) => {
      if (!cancelled) {
        setStoredCatalog({
          loaded: true,
          tags,
          tagTypes: types.map((t) => t.name),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, tagIndex, catalogBump]);

  // Immediate sync on first non-empty content, debounced on subsequent keystrokes.
  useEffect(() => {
    const next = rawContent ?? '';
    if (!debouncedContent && next) {
      setDebouncedContent(next);
      return;
    }
    if (debounceMs <= 0) {
      setDebouncedContent(next);
      return;
    }
    const timer = setTimeout(() => setDebouncedContent(next), debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawContent, debounceMs]);

  const reloadCatalog = useCallback(() => {
    return {
      efforts: effortsReady ? effortRegistry.list() : [],
      equipment: equipmentReady ? equipmentRegistry.list() : [],
      tags: storedCatalog.tags,
      tagTypes: storedCatalog.tagTypes,
      tagIndex,
    };
  }, [effortsReady, effortRegistry, equipmentReady, equipmentRegistry, storedCatalog, tagIndex]);

  return useMemo(() => {
    if (!enabled || !effortsReady || !equipmentReady || !storedCatalog.loaded) {
      return EMPTY_LIVE_NOTE_FACETS;
    }
    if (!debouncedContent) {
      return { ...EMPTY_LIVE_NOTE_FACETS, ready: true };
    }
    return extractLiveNoteFacets(debouncedContent, reloadCatalog());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    debouncedContent,
    effortsReady,
    equipmentReady,
    storedCatalog.loaded,
    reloadCatalog,
    effortRevision,
    equipmentRevision,
    catalogBump,
  ]);
}
