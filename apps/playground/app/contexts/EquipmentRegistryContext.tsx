/**
 * EquipmentRegistryContext
 *
 * Provides the app equipment registry (CompositeEquipmentRegistry — bundled
 * seed tier + user tier, both from IndexedDB) to the playground app.
 * Mirrors EffortRegistryContext: async hydration, re-hydration on seed
 * broadcasts ('wodwiki.seed') so bundled equipment appears/disappears
 * without a reload.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { IEquipmentRegistry, IEquipment } from '@bitcobblers/wod-wiki-lang';
import { getAppEquipmentRegistry, hydrateAppEquipmentRegistry } from '@/services/equipmentRegistry';
import { SEED_BROADCAST_CHANNEL } from '@/services/seed/seedSync';

interface EquipmentRegistryContextValue {
  registry: IEquipmentRegistry;
  isReady: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const EquipmentRegistryContext = createContext<EquipmentRegistryContextValue | null>(null);

export function EquipmentRegistryProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const registry = getAppEquipmentRegistry();

  const init = useCallback(async () => {
    try {
      // Always re-read — hydration replaces the bundled tier and reloads the
      // user tier (see EffortRegistryContext).
      await hydrateAppEquipmentRegistry(registry);
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

  // Seed Import landed/removed a seed → re-read equipment from Storage.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
    channel.onmessage = () => { void refresh(); };
    return () => channel.close();
  }, [refresh]);

  return (
    <EquipmentRegistryContext.Provider value={{ registry, isReady, error, refresh }}>
      {children}
    </EquipmentRegistryContext.Provider>
  );
}

export function useEquipmentRegistry(): EquipmentRegistryContextValue {
  const ctx = useContext(EquipmentRegistryContext);
  if (!ctx) {
    throw new Error('useEquipmentRegistry must be within EquipmentRegistryProvider');
  }
  return ctx;
}

/**
 * Hook for the equipment catalog listing with search/filter.
 */
export function useEquipmentCatalog(options?: {
  origin?: 'bundled' | 'user' | 'all';
  query?: string;
}): readonly IEquipment[] {
  const { registry, isReady } = useEquipmentRegistry();

  if (!isReady) return [];

  let equipment = registry.list();

  if (options?.origin && options.origin !== 'all') {
    equipment = equipment.filter((e) => e.registrySource === options.origin);
  }
  if (options?.query) {
    const q = options.query.trim().toLowerCase();
    equipment = equipment.filter((e) =>
      e.label.toLowerCase().includes(q)
      || e.slug.toLowerCase().includes(q)
      || e.aliases.some((alias) => alias.toLowerCase().includes(q)));
  }

  return equipment;
}
