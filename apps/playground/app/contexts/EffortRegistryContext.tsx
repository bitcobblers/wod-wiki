/**
 * EffortRegistryContext
 *
 * Provides a CompositeEffortRegistry instance to the playground app.
 * Lazy-initializes on first mount and exposes async init state.
 * Re-hydrates when the Seed Import lands a new seed (BroadcastChannel
 * 'wodwiki.seed') so bundled efforts appear without a reload.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { IEffortRegistry, IEffort, EffortRegistrySource } from '@bitcobblers/wod-wiki-lang';
import { getAppEffortRegistry, hydrateAppEffortRegistry } from '@/services/effortRegistry';
import { SEED_BROADCAST_CHANNEL } from '@/services/seed/seedSync';

interface EffortRegistryContextValue {
  registry: IEffortRegistry;
  isReady: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const EffortRegistryContext = createContext<EffortRegistryContextValue | null>(null);


export function EffortRegistryProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const registry = getAppEffortRegistry();

  const init = useCallback(async () => {
    try {
      // Always re-read: hydration REPLACES the bundled tier and reloads the
      // user tier, so post-save refreshes and seed broadcasts see new and
      // removed rows alike (a one-shot init would cache stale rows forever).
      await hydrateAppEffortRegistry(registry);
      setIsReady(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsReady(false);
    }
  }, [registry]);

  const refresh = useCallback(async () => {
    setIsReady(false);
    await init();
  }, [init]);

  useEffect(() => {
    init();
  }, [init]);

  // Seed Import landed a new seed → re-read efforts from Storage.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
    channel.onmessage = () => { void refresh(); };
    return () => channel.close();
  }, [refresh]);

  return (
    <EffortRegistryContext.Provider value={{ registry, isReady, error, refresh }}>
      {children}
    </EffortRegistryContext.Provider>
  );
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
