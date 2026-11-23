import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeOutboxWrites } from '@bitcobblers/wod-wiki-storage/idb';
import { setSurfaceBusy } from '@/agent/surfaceBridges';
import { subscribeSeedContent } from '@/services/content/seedContent';
import {
  getFeedReadiness,
  isBootImportPending,
  useFeedImportPending,
  useFeedReadiness,
} from '@/services/feed/feedReadiness';
import { subscribeFeedUpdates } from '@/services/feed/feedSync';
import { subscribeActiveLocalDatabase } from '@/services/storage';
import { getStorageUpdate, subscribeStorageUpdate } from '@/services/storage/storageUpdate';
import { getSyncActivity, subscribeSyncActivity } from '@/services/syncActivity';
import { SEED_BROADCAST_CHANNEL } from '@/types/seed';

export interface ColdRouteResolutionOptions {
  /** Hold `data-agent-status="busy"` unconditionally while active async route loading is running. */
  loading?: boolean;
  /** Hold `data-agent-status="busy"` when the route target appears missing ONLY while `isSettling` is true. */
  missing?: boolean;
}

export interface ColdRouteResolution {
  /** True while cold-boot / background feed/seed import can still deliver records. */
  isSettling: boolean;
  /** Monotonically increments when boot settles or new seed/feed content lands. */
  settlementTick: number;
}

/**
 * Synchronous non-reactive check of whether any cold-boot import, feed/backup
 * download, or storage schema migration is currently unsettled.
 */
export function isColdSettlementActive(): boolean {
  return (
    getFeedReadiness() === 'preparing' ||
    isBootImportPending() ||
    getSyncActivity().downloading > 0 ||
    getStorageUpdate().phase === 'updating'
  );
}

/**
 * Shared cold-boot settlement & retry signal for detail routes (`/note/:id`,
 * `/effort/:slug`, `/equipment/:slug`, `/t/:type/:tag`, `/feed/:slug`, `/notebook/:slug`).
 *
 * Prevents definitive "not found" verdicts while cold-boot seed/feed import or
 * active sync/hydration is still running, holds `data-agent-status` busy until
 * resolution completes, and triggers automatic re-resolution on settlement or
 * storage persistence updates.
 */
export function useColdRouteResolution(options: ColdRouteResolutionOptions = {}): ColdRouteResolution {
  const readiness = useFeedReadiness();
  const importPending = useFeedImportPending();
  const syncActivity = useSyncExternalStore(subscribeSyncActivity, getSyncActivity);
  const storageUpdate = useSyncExternalStore(subscribeStorageUpdate, getStorageUpdate);
  const rawSettling =
    readiness === 'preparing' ||
    importPending ||
    syncActivity.downloading > 0 ||
    storageUpdate.phase === 'updating';
  const [settlementTick, setSettlementTick] = useState(0);
  const wasSettlingRef = useRef(rawSettling);
  // Hold `isSettling` through the transition render where `rawSettling` flips
  // true -> false so consumers never flash a definitive "not found" verdict or
  // release `data-agent-status="loading"` before `settlementTick` triggers
  // their post-settlement re-resolution.
  const justSettled = wasSettlingRef.current && !rawSettling;
  const isSettling = rawSettling || justSettled;

  useEffect(() => {
    if (wasSettlingRef.current && !rawSettling) {
      setSettlementTick((t) => t + 1);
    }
    wasSettlingRef.current = rawSettling;
  }, [rawSettling]);

  useEffect(() => {
    const bump = () => setSettlementTick((t) => t + 1);
    const unsubSeed = subscribeSeedContent(bump);
    const unsubFeed = subscribeFeedUpdates(bump);
    const unsubOutbox = subscribeOutboxWrites(bump);
    const unsubDb = subscribeActiveLocalDatabase(bump);
    let lastSyncResultId = getSyncActivity().result?.id ?? -1;
    const unsubSync = subscribeSyncActivity(() => {
      const nextId = getSyncActivity().result?.id ?? -1;
      if (nextId !== lastSyncResultId) {
        lastSyncResultId = nextId;
        bump();
      }
    });
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
        channel.onmessage = (event) => {
          const kind = (event.data as { kind?: string } | null)?.kind;
          if (!kind || kind === 'seed-imported' || kind === 'seed-removed') bump();
        };
      } catch {
        // Same-tab subscriptions remain active even if BroadcastChannel is unavailable.
      }
    }
    return () => {
      unsubSeed();
      unsubFeed();
      unsubOutbox();
      unsubDb();
      unsubSync();
      channel?.close();
    };
  }, []);

  const holdBusy = Boolean(options.loading) || (Boolean(options.missing) && isSettling);
  useEffect(() => {
    if (!holdBusy) return;
    return setSurfaceBusy(true);
  }, [holdBusy]);

  return { isSettling, settlementTick };
}

/**
 * Derive initial settling state safely before passing final `busy` to
 * `useColdRouteResolution` or for routes using separate busy state.
 */
export function useIsFeedSettling(): boolean {
  const readiness = useFeedReadiness();
  const importPending = useFeedImportPending();
  const syncActivity = useSyncExternalStore(subscribeSyncActivity, getSyncActivity);
  const storageUpdate = useSyncExternalStore(subscribeStorageUpdate, getStorageUpdate);
  return (
    readiness === 'preparing' ||
    importPending ||
    syncActivity.downloading > 0 ||
    storageUpdate.phase === 'updating'
  );
}

export function useSurfaceBusyHold(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return setSurfaceBusy(true);
  }, [active]);
}
