/**
 * CastSignaling.ts
 *
 * Signaling adapter that exchanges WebRTC SDP offers/answers and ICE candidates
 * through the Google Cast SDK custom message namespace.
 *
 * Two concrete implementations:
 *
 *  • `SenderCastSignaling`   — wraps a CAF sender `CastSession`
 *  • `ReceiverCastSignaling` — wraps a CAF `CastReceiverContext`
 *
 * Both implement `ISignaling` from WebRTCTransport.ts so they can be plugged
 * directly into `new WebRTCTransport(role, signaling)`.
 */

import { CAST_NAMESPACE } from '@/types/cast/messages';
import type { WebRTCSignalMessage } from '@/types/cast/messages';
import type { CastMessageListener, CastReceiverContextLike, CastReceiverMessageListener, SenderCastSessionLike } from '@/types/cast/sdk';
import type { ISignaling } from './rpc/WebRtcRpcTransport';

// ── Sender-side signaling (runs in the web app) ────────────────────────────

/**
 * Uses `CastSession.sendMessage()` / `addMessageListener()` to exchange
 * WebRTC signaling payloads with the receiver over the Cast message bus.
 */
export class SenderCastSignaling implements ISignaling {
  private readonly listeners = new Set<(signal: WebRTCSignalMessage) => void>();
  private boundListener: CastMessageListener | null = null;

  /**
   * @param session  The active CastSession from `CastContext.getCurrentSession()`.
   *                 Must be in SESSION_STARTED state.
   */
  constructor(private readonly session: SenderCastSessionLike) {
    this.boundListener = (_namespace: string, message: string) => {
      try {
        console.log('[SenderCastSignaling] RAW incoming:', typeof message, typeof message === 'string' ? message.substring(0, 120) : JSON.stringify(message).substring(0, 120));
        // The sender SDK delivers messages as strings from the receiver.
        // Parse if string, pass through if already an object.
        const signal = (typeof message === 'string'
          ? JSON.parse(message)
          : message) as WebRTCSignalMessage;
        console.log('[SenderCastSignaling] Parsed signal type:', signal.type);
        for (const listener of this.listeners) {
            listener(signal);
        }
      } catch (err) {
        console.error('[SenderCastSignaling] Failed to parse incoming signal', err);
      }
    };

    this.session.addMessageListener(CAST_NAMESPACE, this.boundListener);
    console.log(`[SenderCastSignaling] Listening on ${CAST_NAMESPACE}`);
    console.log(`[SenderCastSignaling] Session state: ${this.session.getSessionState?.()}`);
  }

  send(signal: WebRTCSignalMessage): void {
    console.log(`[SenderCastSignaling] Sending: ${signal.type}`);
    // Send as a plain object — the Cast SDK serialises it for transport.
    this.session
      .sendMessage(CAST_NAMESPACE, signal)
      .then(() => console.log(`[SenderCastSignaling] sendMessage(${signal.type}) OK`))
      .catch((err: unknown) =>
        console.error(`[SenderCastSignaling] sendMessage(${signal.type}) FAILED`, err)
      );
  }

  onSignal(handler: (signal: WebRTCSignalMessage) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  dispose(): void {
    if (this.boundListener) {
      try {
        this.session.removeMessageListener(CAST_NAMESPACE, this.boundListener);
      } catch { /* session may already be gone */ }
      this.boundListener = null;
    }
    this.listeners.clear();
  }
}

// ── Receiver-side signaling (runs on the Chromecast) ────────────────────────

/**
 * Uses the CAF Receiver SDK's `CastReceiverContext` to receive signaling
 * messages from the sender and respond back.
 */
export class ReceiverCastSignaling implements ISignaling {
  private readonly listeners = new Set<(signal: WebRTCSignalMessage) => void>();
  private senderId: string | null = null;
  private boundListener: CastReceiverMessageListener | null = null;

  /**
   * @param context  `cast.framework.CastReceiverContext.getInstance()`
   */
  constructor(private readonly context: CastReceiverContextLike) {
    this.boundListener = (event) => {
      try {
        console.log('[ReceiverCastSignaling] RAW incoming:', event.senderId, typeof event.data === 'string' ? event.data.substring(0, 120) : JSON.stringify(event.data).substring(0, 120));
        // Remember the sender's ID so we can reply
        this.senderId = event.senderId;
        // With 'JSON' namespace type, event.data is already a parsed object.
        // Keep string fallback for safety.
        const signal = (typeof event.data === 'string'
          ? JSON.parse(event.data)
          : event.data) as WebRTCSignalMessage;
        console.log('[ReceiverCastSignaling] Parsed signal type:', signal.type);
        for (const listener of this.listeners) {
            listener(signal);
        }
      } catch (err) {
        console.error('[ReceiverCastSignaling] Failed to parse incoming signal', err);
      }
    };

    this.context.addCustomMessageListener(CAST_NAMESPACE, this.boundListener);
    console.log(`[ReceiverCastSignaling] Listening on ${CAST_NAMESPACE}`);
  }

  send(signal: WebRTCSignalMessage): void {
    if (!this.senderId) {
      console.warn('[ReceiverCastSignaling] No senderId yet — cannot reply');
      return;
    }
    console.log(`[ReceiverCastSignaling] Sending: ${signal.type} to ${this.senderId}`);
    // Send as a plain object — 'JSON' namespace type handles serialization.
    try {
      this.context.sendCustomMessage(
        CAST_NAMESPACE,
        this.senderId,
        signal,
      );
      console.log(`[ReceiverCastSignaling] sendCustomMessage(${signal.type}) OK`);
    } catch (err) {
      console.error(`[ReceiverCastSignaling] sendCustomMessage(${signal.type}) FAILED`, err);
    }
  }

  onSignal(handler: (signal: WebRTCSignalMessage) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  dispose(): void {
    // The CAF receiver SDK doesn't expose removeCustomMessageListener in all
    // versions, so we guard the call.
    if (this.boundListener && typeof this.context.removeCustomMessageListener === 'function') {
      try {
        this.context.removeCustomMessageListener(CAST_NAMESPACE, this.boundListener);
      } catch { /* ignore */ }
    }
    this.boundListener = null;
    this.listeners.clear();
  }
}
