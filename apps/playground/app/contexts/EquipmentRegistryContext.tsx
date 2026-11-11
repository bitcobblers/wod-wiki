/**
 * EquipmentRegistryContext
 *
 * Provides the app equipment registry (CompositeEquipmentRegistry — bundled
 * seed tier + user tier, both from IndexedDB) to the playground app.
 * Mirrors EffortRegistryContext: async hydration, re-hydration on feed
 * broadcasts ('wodwiki.seed') so bundled equipment appears/disappears
 * without a reload.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { IEquipmentRegistry, IEquipment } from '@bitcobblers/wod-wiki-lang';
import { getAppEquipmentRegistry, hydrateAppEquipmentRegistry } from '@/services/equipmentRegistry';
import { SEED_BROADCAST_CHANNEL } from '@/services/feed/feedSync';

interface EquipmentRegistryContextValue {
  registry: IEquipmentRegistry;
  isReady: boolean;
  error: Error | null;
  /** Successful hydration count; increments whenever equipment is created/refreshed. */
  revision: number;
  refresh: () => Promise<void>;
}

const EquipmentRegistryContext = createContext<EquipmentRegistryContextValue | null>(null);

export function EquipmentRegistryProvider({ children }: { children: React.ReactNode }) {
  const [{ isReady, error, revision }, setStatus] = useState<Pick<EquipmentRegistryContextValue, 'isReady' | 'error' | 'revision'>>({
    isReady: false,
    error: null,
    revision: 0,
  });
  const registry = getAppEquipmentRegistry();

  const init = useCallback(async () => {
    try {
      // Always re-read — hydration replaces the bundled tier and reloads the
      // user tier (see EffortRegistryContext).
      await hydrateAppEquipmentRegistry(registry);
      setStatus((s) => ({ isReady: true, error: null, revision: s.revision + 1 }));
    } catch (err) {
      setStatus((s) => ({ ...s, isReady: false, error: err instanceof Error ? err : new Error(String(err)) }));
    }
  }, [registry]);

  const refresh = useCallback(async () => {
    await init();
  }, [init]);

  useEffect(() => {
    init();
  }, [init]);

  // A feed import landed/removed content → re-read equipment from Storage.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
    channel.onmessage = () => { void refresh(); };
    return () => channel.close();
  }, [refresh]);

  return (
    <EquipmentRegistryContext.Provider value={{ registry, isReady, error, revision, refresh }}>
      {children}
    </EquipmentRegistryContext.Provider>
  );
}

export function useOptionalEquipmentRegistry(): EquipmentRegistryContextValue | null {
  return useContext(EquipmentRegistryContext);
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
