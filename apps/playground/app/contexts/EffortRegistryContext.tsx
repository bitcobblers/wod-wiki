/**
 * EffortRegistryContext
 *
 * Provides a CompositeEffortRegistry instance to the playground app.
 * Lazy-initializes on first mount and exposes async init state.
 * Re-hydrates when the feed import lands new content (BroadcastChannel
 * 'wodwiki.seed') so bundled efforts appear without a reload.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { IEffortRegistry, IEffort, EffortRegistrySource } from '@bitcobblers/wod-wiki-lang';
import { getAppEffortRegistry, hydrateAppEffortRegistry, subscribeAppEffortRegistry } from '@/services/effortRegistry';
import { SEED_BROADCAST_CHANNEL } from '@/services/feed/feedSync';

interface EffortRegistryContextValue {
  registry: IEffortRegistry;
  isReady: boolean;
  error: Error | null;
  /** Successful hydration count; the registry itself is a stable singleton. */
  revision: number;
  refresh: () => Promise<void>;
}

const EffortRegistryContext = createContext<EffortRegistryContextValue | null>(null);

export function EffortRegistryProvider({ children }: { children: React.ReactNode }) {
  const mountedRef = React.useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [{ isReady, error, revision }, setStatus] = useState<Pick<EffortRegistryContextValue, 'isReady' | 'error' | 'revision'>>({
    isReady: false, error: null, revision: 0,
  });
  const registry = getAppEffortRegistry();

  const init = useCallback(async () => {
    try {
      // Always re-read: hydration REPLACES the bundled tier and reloads the
      // user tier, so post-save refreshes and feed broadcasts see new and
      // removed rows alike (a one-shot init would cache stale rows forever).
      await hydrateAppEffortRegistry(registry);
      if (!mountedRef.current || typeof window === 'undefined') return;
      setStatus(s => ({ isReady: true, error: null, revision: s.revision + 1 }));
    } catch (err) {
      if (!mountedRef.current || typeof window === 'undefined') return;
      setStatus(s => ({ ...s, isReady: false, error: err instanceof Error ? err : new Error(String(err)) }));
    }
  }, [registry]);
  const refresh = useCallback(async () => {
    await init();
  }, [init]);

  useEffect(() => {
    init();
  }, [init]);

  // Same-tab feed imports hydrate the singleton directly (BroadcastChannel
  // does not echo to the posting context) → bump revision so consumers re-read.
  useEffect(() => {
    return subscribeAppEffortRegistry(() => {
      setStatus(s => ({ isReady: true, error: null, revision: s.revision + 1 }));
    });
  }, []);

  // A sibling tab's feed import landed new content → re-read efforts from Storage.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
    channel.onmessage = () => { void refresh(); };
    return () => channel.close();
  }, [refresh]);

  return (
    <EffortRegistryContext.Provider value={{ registry, isReady, error, revision, refresh }}>
      {children}
    </EffortRegistryContext.Provider>
  );
}

export function useOptionalEffortRegistry(): EffortRegistryContextValue | null {
  return useContext(EffortRegistryContext);
}

export function useEffortRegistry(): EffortRegistryContextValue {
  const ctx = useContext(EffortRegistryContext);
  if (!ctx) {
    throw new Error('useEffortRegistry must be within EffortRegistryProvider');
  }
  return ctx;
}

/**
 * Hook for catalog listing with search/filter.
 */
export function useEffortCatalog(options?: {
  origin?: EffortRegistrySource | 'all';
  discipline?: string;
  query?: string;
}): readonly IEffort[] {
  const { registry, isReady } = useEffortRegistry();

  if (!isReady) return [];

  let efforts = registry.list();

  if (options?.origin && options.origin !== 'all') {
    efforts = efforts.filter(e => e.registrySource === options.origin);
  }

  if (options?.discipline) {
    efforts = efforts.filter(e => e.baseAttributes.discipline === options.discipline);
  }

  if (options?.query?.trim()) {
    const q = options.query.trim().toLowerCase();
    efforts = efforts.filter(e =>
      e.label.toLowerCase().includes(q) ||
      e.aliases.some(a => a.toLowerCase().includes(q)) ||
      e.slug.toLowerCase().includes(q)
    );
  }

  return efforts;
}
