import { useSyncExternalStore } from 'react';
import { EFFORT_DISCIPLINES } from '@bitcobblers/wod-wiki-lang';
import { catalogOfItem, WQL_INTENSITY_TIERS } from '@bitcobblers/wod-wiki-wql';
import type { BlockIndexRow } from '@bitcobblers/wod-wiki-core';

export interface SuggestionItem {
  value: string;
  label?: string;
  description?: string;
  icon?: string;
}

export type SuggestionCachePolicy = 'static' | { ttlMs: number };

export interface SuggestionBinding {
  load: () => Promise<SuggestionItem[]>;
  cache: SuggestionCachePolicy;
  open: boolean;
  emptyText: string;
}

export function tagsFromStaticBlocks(blocks: BlockIndexRow[]): string[] {
  const set = new Set<string>();
  for (const b of blocks) {
    const row = b as unknown as { frontmatter?: { tags?: unknown[] } };
    if (row.frontmatter?.tags && Array.isArray(row.frontmatter.tags)) {
      for (const t of row.frontmatter.tags) {
        if (typeof t === 'string' && t.trim().length > 0) set.add(t.trim());
      }
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function catalogIdsFromBlocks(blocks: BlockIndexRow[]): string[] {
  const set = new Set<string>();
  for (const b of blocks) {
    if (b.sourceId && b.sourceId.startsWith('collection:')) {
      const catalog = catalogOfItem(b);
      if (catalog) set.add(catalog);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function blockTypesFromBlocks(blocks: BlockIndexRow[]): string[] {
  const set = new Set<string>();
  for (const b of blocks) {
    if (b.dataType && b.dataType.trim().length > 0) set.add(b.dataType.trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Tags: user labels rank first with their spelling, corpus fills the rest —
 *  one case-insensitive dedup path, insertion order kept (no global sort). */
export function mergeTagSuggestions(userLabels: string[], corpusLabels: string[]): string[] {
  return mergeSuggestionItems(
    [...userLabels, ...corpusLabels].map((label) => ({ value: label.trim() })),
    [],
  ).map((item) => item.value);
}

/** Canonical static block types — actual indexed corpus types rank ahead at runtime. */
export const CANONICAL_BLOCK_TYPES = ['wod', 'query', 'widget', 'embed'] as const;

/** Suggestion items for a canonical readonly vocabulary; labels are display-only. */
export function canonicalSuggestionItems(values: readonly string[]): SuggestionItem[] {
  return values.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }));
}

/** Case-insensitive dedup by value key: vault entries keep their position,
 *  enum keys take the canonical spelling, then remaining canonical values
 *  append. First label wins — it is display-only. */
export function mergeSuggestionItems(vault: SuggestionItem[], canonical: SuggestionItem[]): SuggestionItem[] {
  const keyOf = (value: string) => value.trim().toLowerCase();
  const canonicalValueByKey = new Map(canonical.map((item) => [keyOf(item.value), item.value]));
  const seen = new Map<string, SuggestionItem>();
  const add = (item: SuggestionItem) => {
    const key = keyOf(item.value);
    if (!key || seen.has(key)) return;
    seen.set(key, { ...item, value: canonicalValueByKey.get(key) ?? item.value });
  };
  for (const item of vault) add(item);
  for (const item of canonical) add(item);
  return Array.from(seen.values());
}

const builtinBindings: Record<string, SuggestionBinding> = {
  discipline: {
    load: async () => canonicalSuggestionItems(EFFORT_DISCIPLINES),
    cache: 'static',
    open: false,
    emptyText: 'No disciplines available',
  },
  notebook: {
    load: async () => [],
    cache: 'static',
    open: false,
    emptyText: 'No notebooks in the static corpus',
  },
  intensity: {
    load: async () => canonicalSuggestionItems(WQL_INTENSITY_TIERS),
    cache: 'static',
    open: false,
    emptyText: 'No intensity tiers available',
  },
  type: {
    load: async () => canonicalSuggestionItems(CANONICAL_BLOCK_TYPES),
    cache: 'static',
    open: false,
    emptyText: 'No indexed block types yet',
  },
  // Tag-plane contribution kinds (ticket 08) — an open slot: qualifiers like
  // `metric:rpe` or `function:calc.e1rm` are typed, never listed as labels.
  contributes: {
    load: async () => canonicalSuggestionItems(['metric', 'tag', 'function']),
    cache: 'static',
    open: true,
    emptyText: 'metric, tag, or function',
  },
};

export const SUGGESTION_BINDINGS: Record<string, SuggestionBinding> = { ...builtinBindings };

/** Clause types with a registered suggestion source — lets catalogs offer
 *  binding-backed fields without hardcoding type lists. */
export function suggestionBoundTypes(): string[] {
  return Object.keys(SUGGESTION_BINDINGS);
}

// Reactive availability of binding-backed clause types: async app
// registrations (dynamic tag types, origins) notify subscribers so pickers
// render sources once loaded, not only at module init.
const bindingListeners = new Set<() => void>();
let boundTypesSnapshot = Object.keys(SUGGESTION_BINDINGS);

export function subscribeSuggestionBoundTypes(listener: () => void): () => void {
  bindingListeners.add(listener);
  return () => {
    bindingListeners.delete(listener);
  };
}

/** useSyncExternalStore-compatible snapshot of registered binding types. */
export function useSuggestionBoundTypes(): string[] {
  return useSyncExternalStore(subscribeSuggestionBoundTypes, () => boundTypesSnapshot);
}

export function setSuggestionBinding(type: string, binding: SuggestionBinding | undefined): void {
  if (binding) {
    SUGGESTION_BINDINGS[type] = binding;
  } else if (builtinBindings[type]) {
    SUGGESTION_BINDINGS[type] = builtinBindings[type];
  } else {
    delete SUGGESTION_BINDINGS[type];
  }
  invalidateSuggestions(type);
  boundTypesSnapshot = Object.keys(SUGGESTION_BINDINGS);
  for (const listener of bindingListeners) listener();
}

export function getSuggestionBinding(type: string): SuggestionBinding | undefined {
  return SUGGESTION_BINDINGS[type];
}

interface CacheEntry {
  items: SuggestionItem[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function loadSuggestions(type: string): Promise<SuggestionItem[]> {
  const binding = getSuggestionBinding(type);
  if (!binding) return [];

  const now = Date.now();
  const cached = cache.get(type);
  if (cached && cached.expiresAt > now) {
    return cached.items;
  }

  try {
    // One normalization path for every binding, custom hosts included:
    // case-insensitive dedup preserving source (vault-first) order.
    const items = mergeSuggestionItems(await binding.load(), []);
    const ttlMs = typeof binding.cache === 'object' ? binding.cache.ttlMs : Number.POSITIVE_INFINITY;
    cache.set(type, { items, expiresAt: now + ttlMs });
    return items;
  } catch {
    return cached ? cached.items : [];
  }
}

export function invalidateSuggestions(type?: string): void {
  if (type) {
    cache.delete(type);
  } else {
    cache.clear();
  }
}
