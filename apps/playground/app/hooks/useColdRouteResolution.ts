import { useEffect, useRef, useState } from 'react';
import { setSurfaceBusy } from '@/agent/surfaceBridges';
import { subscribeSeedContent } from '@/services/content/seedContent';
import { useFeedImportPending, useFeedReadiness } from '@/services/feed/feedReadiness';
import { subscribeFeedUpdates } from '@/services/feed/feedSync';
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
 * Shared cold-boot settlement & retry signal for detail routes (`/note/:id`,
 * `/effort/:slug`, `/equipment/:slug`, `/t/:type/:tag`, `/feed/:slug`, `/notebook/:slug`).
 *
 * Prevents definitive "not found" verdicts while cold-boot seed/feed import is still
 * active (`feedReadiness === 'preparing' || feedImportPending`), holds `data-agent-status`
 * busy until resolution completes, and triggers automatic re-resolution on settlement.
 */
export function useColdRouteResolution(options: ColdRouteResolutionOptions = {}): ColdRouteResolution {
  const readiness = useFeedReadiness();
  const importPending = useFeedImportPending();
  const isSettling = readiness === 'preparing' || importPending;
  const [settlementTick, setSettlementTick] = useState(0);
  const wasSettlingRef = useRef(isSettling);

  useEffect(() => {
    if (wasSettlingRef.current && !isSettling) {
      setSettlementTick((t) => t + 1);
    }
    wasSettlingRef.current = isSettling;
  }, [isSettling]);

  useEffect(() => {
    const bump = () => setSettlementTick((t) => t + 1);
    const unsubSeed = subscribeSeedContent(bump);
    const unsubFeed = subscribeFeedUpdates(bump);
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
  return readiness === 'preparing' || importPending;
}

export function useSurfaceBusyHold(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return setSurfaceBusy(true);
  }, [active]);
}
