/**
 * useCastSignaling — Public hook boundary for sender-side cast services.
 *
 * Components in `src/components/` must import cast services through this
 * module rather than directly from `src/services/cast/`.
 */

import { useMemo } from 'react';
import type { ICastBackend } from '@/services/cast/ICastBackend';

// ── Cast backend factory and transport registry ─────────────────────────────
export { getCastBackend } from '@/services/cast/getCastBackend';
export {
  getActiveCastTransport,
  setActiveCastTransport,
  onCastTransportChange,
} from '@/services/cast/castTransportRegistry';

// ── RPC session manager and runtime subscription ────────────────────────────
export { CastSessionManager, sharedCastSessionManager } from '@/services/cast/rpc/CastSessionManager';
export { ChromecastRuntimeSubscription } from '@/services/cast/rpc/ChromecastRuntimeSubscription';

// ── Cast boundary validators (payload gates components dispatch through) ───
export { parseClockCommandPayload, parseOpenNotebookPayload } from '@/services/cast/rpc/RpcMessages';
export { clockCommandForLegacyEvent } from '@/services/cast/rpc/eventRouter';

// ── Types ─────────────────────────────────────────────────────────────────
export type { CastSessionHandle } from '@/services/cast/rpc/CastSessionManager';
export type { ICastBackend, ICastBackendState } from '@/services/cast/ICastBackend';
export type { IRpcTransport } from '@/services/cast/rpc/IRpcTransport';

// ── Editor preview services ────────────────────────────────────────────────
export { queryService } from '@/services/queryService';
export { onResultSaved } from '@/services/resultRecorder';

// ── React hook ─────────────────────────────────────────────────────────────

export interface UseCastSignalingReturn {
  /** Resolved cast backend for the current build. */
  backend: ICastBackend;
}

/**
 * Hook that exposes the active cast backend.
 */
export function useCastSignaling(): UseCastSignalingReturn {
  return useMemo(() => ({ backend: getCastBackend() }), []);
}
