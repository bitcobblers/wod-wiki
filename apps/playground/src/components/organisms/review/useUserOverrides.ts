/**
 * useUserOverrides — CRUD hook for user-supplied metrics overrides.
 *
 * Wraps the Zustand store actions (`setUserOverride`, `clearUserOverride`)
 * with convenience helpers for adding, updating, and removing individual
 * user metrics keyed by `sourceBlockKey`.
 *
 * Optionally persists overrides to localStorage for session survival.
 */

import { useCallback, useEffect } from 'react';
import { MetricType, type IMetric } from '@bitcobblers/wod-wiki-engine';
import { MetricContainer } from '@bitcobblers/wod-wiki-engine';
import { useActiveRunStore } from '@/stores/activeRunStore';

const STORAGE_KEY = 'wod-wiki:userOutputOverrides';

// ─── Public Interface ──────────────────────────────────────────

export interface UseUserOverridesReturn {
  /** Current override map (from store) */
  overrides: Map<string, MetricContainer>;

  /** Add or replace a single user metrics for a block+metricType */
  setOverride: (blockKey: string, metricType: MetricType, value: unknown, image?: string) => void;

  /** Remove a specific metrics type override for a block */
  removeOverride: (blockKey: string, metricType: MetricType) => void;

  /** Clear all overrides for a block */
  clearBlock: (blockKey: string) => void;

  /** Clear all user overrides */
  clearAll: () => void;
}

export function useUserOverrides(persistToStorage = false): UseUserOverridesReturn {
  const overrides = useActiveRunStore((s) => s.userOutputOverrides);
  const storeSet = useActiveRunStore((s) => s.setUserOverride);
  const storeClear = useActiveRunStore((s) => s.clearUserOverride);

  // ── Restore from localStorage on mount ────────────────────

  useEffect(() => {
    if (!persistToStorage) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, SerializedFragment[]>;
      for (const [blockKey, frags] of Object.entries(parsed)) {
        storeSet(blockKey, frags.map(deserializeFragment));
      }
    } catch {
      // Silently ignore corrupt storage
    }
  }, [persistToStorage, storeSet]);

  // ── Persist to localStorage on change ─────────────────────

  useEffect(() => {
    if (!persistToStorage) return;
    if (overrides.size === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const serializable: Record<string, SerializedFragment[]> = {};
    for (const [key, frags] of overrides) {
      serializable[key] = frags.map(serializeFragment);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  }, [overrides, persistToStorage]);

  // ── Actions ───────────────────────────────────────────────

  const setOverride = useCallback(
    (blockKey: string, metricType: MetricType, value: unknown, image?: string) => {
      const existing = overrides.get(blockKey) ?? MetricContainer.empty(blockKey);
      // Replace any existing metrics of the same type, keep others
      const filtered = existing.filter((f) => f.type !== metricType);
      const newFragment = {
        type: metricType,
        origin: 'user' as const,
        value,
        image: image ?? String(value ?? ''),
      };
      storeSet(blockKey, MetricContainer.from(filtered, blockKey).add(newFragment));
    },
    [overrides, storeSet],
  );

  const removeOverride = useCallback(
    (blockKey: string, metricType: MetricType) => {
      const existing = overrides.get(blockKey);
      if (!existing) return;

      const filtered = existing.filter((f) => f.type !== metricType);
      if (filtered.length === 0) {
        storeClear(blockKey);
      } else {
        storeSet(blockKey, filtered);
      }
    },
    [overrides, storeSet, storeClear],
  );

  const clearBlock = useCallback(
    (blockKey: string) => {
      storeClear(blockKey);
    },
    [storeClear],
  );

  const clearAll = useCallback(() => {
    // Clear each block key individually
    for (const key of overrides.keys()) {
      storeClear(key);
    }
  }, [overrides, storeClear]);

  return { overrides, setOverride, removeOverride, clearBlock, clearAll };
}

// ─── Serialization helpers (for localStorage) ─────────────────

interface SerializedFragment {
  type: MetricType;
  value?: unknown;
  image?: string;
  origin?: string;
  sourceBlockKey?: string;
  timestamp?: string;
}

function serializeFragment(f: IMetric): SerializedFragment {
  return {
    type: f.type as MetricType,
    value: f.value,
    image: f.image,
    origin: f.origin,
    sourceBlockKey: f.sourceBlockKey,
    timestamp: f.timestamp?.toISOString(),
  };
}

function deserializeFragment(s: SerializedFragment): IMetric {
  return {
    type: s.type,
    value: s.value,
    image: s.image,
    origin: (s.origin as IMetric['origin']) ?? 'user',
    sourceBlockKey: s.sourceBlockKey,
    timestamp: s.timestamp ? new Date(s.timestamp) : undefined,
  };
}
