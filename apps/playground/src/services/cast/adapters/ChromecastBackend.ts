/**
 * ChromecastBackend — ICastBackend adapter that drives the real Chromecast
 * device picker and produces a `WebRtcRpcTransport` for the cast session.
 *
 * State stream
 * ------------
 * Mapped from `ChromecastSdk.getState()`:
 *   'not-loaded' | 'loading'  → 'ready'   (the SDK hasn't booted; the button
 *                                        should still render the click target
 *                                        — clicking it triggers load)
 *   'unavailable'             → 'unavailable'  (no Cast support in this browser)
 *   'ready'                   → 'ready'
 *   'session-active'          → 'session-active'
 *
 * On the SDK's `'session-ended'` event, we transition to `'session-ended'`.
 *
 * The chromecast SDK does not have a 'connecting' state — `requestSession()`
 * blocks on the user gesture (device picker), so we emit `'connecting'`
 * synchronously before calling it, mirroring the local backend's behavior.
 *
 * Why a port at this layer?
 * -------------------------
 * The button does not need to know about the SDK. It calls
 * `getCastBackend().startSession()`. The chromecast adapter owns the SDK
 * interaction; the local adapter owns the popup-and-broadcast-channel
 * interaction. The rest of the cast stack sees only an `IRpcTransport`.
 */

import { ChromecastSdk, type CastSdkState } from '../ChromecastSdk';
import { CAST_APP_ID, hasCustomCastAppId } from '../config';
import { SenderCastSignaling } from '../CastSignaling';
import { WebRtcRpcTransport, type ISignaling } from '../rpc/WebRtcRpcTransport';


import type { IRpcTransport } from '../rpc/IRpcTransport';
import type { SenderCastSessionLike } from '@/types/cast/sdk';

import { rpcWarn } from '../rpc/rpcLogger';

const sdkToBackend: Record<CastSdkState, ICastBackendState> = {
    'not-loaded': 'ready',
    'loading': 'ready',
    'unavailable': 'unavailable',
    'ready': 'ready',
    'session-active': 'session-active',
};

/** Structural subset of the `ChromecastSdk` singleton the backend touches. */
export interface ChromecastSdkLike {
    getState(): CastSdkState;
    load(appId: string): Promise<void>;
    requestSession(): Promise<void>;
    endSession(): void;
    getSession(): SenderCastSessionLike | null;
    on(
        event: 'state-changed' | 'session-started' | 'session-ended',
        listener: (...args: unknown[]) => void,
    ): () => void;
}

/**
 * Optional dependencies for `ChromecastBackend`. Every field defaults to the
 * production implementation, so `new ChromecastBackend()` stays the app path;
 * tests inject fakes via `deps` instead of mocking modules.
 */
export interface ChromecastBackendDeps {
    /** Cast SDK wrapper; defaults to the shared `ChromecastSdk` singleton. */
    sdk?: ChromecastSdkLike;
    /** Transport factory; defaults to a `'offerer'` `WebRtcRpcTransport` over `signaling`. */
    createTransport?: (signaling: ISignaling) => IRpcTransport;
    /** Signaling factory; defaults to a `SenderCastSignaling` bound to `session`. */
    createSignaling?: (session: SenderCastSessionLike) => ISignaling;
    /** Cast application id; defaults to `CAST_APP_ID` from config. */
    appId?: string;
    /** Whether the app id is a custom receiver; defaults to `hasCustomCastAppId`. */
    hasCustomAppId?: boolean;
}

export class ChromecastBackend implements ICastBackend {
    private _state: ICastBackendState;
    private readonly stateListeners = new Set<(s: ICastBackendState) => void>();
    private sdkUnsubState: (() => void) | null = null;
    private sdkUnsubEnded: (() => void) | null = null;
    private readonly sdk: ChromecastSdkLike;
    private readonly createTransport: (signaling: ISignaling) => IRpcTransport;
    private readonly createSignaling: (session: SenderCastSessionLike) => ISignaling;
    private readonly appId: string;
    private readonly hasCustomAppId: boolean;
    private activeTransport: IRpcTransport | null = null;
    private disposed = false;

    constructor(deps: ChromecastBackendDeps = {}) {
        this.sdk = deps.sdk ?? ChromecastSdk;
        this.createTransport =
            deps.createTransport ?? ((signaling) => new WebRtcRpcTransport('offerer', signaling));
        this.createSignaling =
            deps.createSignaling ?? ((session) => new SenderCastSignaling(session));
        this.appId = deps.appId ?? CAST_APP_ID;
        this.hasCustomAppId = deps.hasCustomAppId ?? hasCustomCastAppId;

        this._state = sdkToBackend[this.sdk.getState()];
        this.subscribeToSdk();
        if (this.hasCustomAppId && typeof window !== 'undefined') {
            void this.sdk.load(this.appId).catch(() => {});
        }
    }

    get state(): ICastBackendState {
        return this._state;
    }

    onStateChanged(handler: (state: ICastBackendState) => void): StateUnsubscribe {
        this.stateListeners.add(handler);
        return () => {
            this.stateListeners.delete(handler);
        };
    }

    private setState(next: ICastBackendState): void {
        if (this._state === next) return;
        this._state = next;
        for (const h of [...this.stateListeners]) {
            h(next);
        }
    }

    private subscribeToSdk(): void {
        this.sdkUnsubState = this.sdk.on('state-changed', (next: unknown) => {
            const mapped = sdkToBackend[next as CastSdkState] ?? 'ready';
            // While 'session-active' we trust our own more specific state over
            // the SDK's coarse stream. While 'connecting', only suppress
            // 'session-active': CAF emits NO_SESSION / SESSION_ENDED (mapped
            // to 'ready') when the launch fails or the user cancels, and that
            // must reach us — otherwise a failed startSession bricks the
            // button on 'connecting' until page reload.
            if (this._state === 'session-active') {
                return;
            }
            if (this._state === 'connecting' && mapped === 'session-active') {
                return;
            }
            this.setState(mapped);
        });
        this.sdkUnsubEnded = this.sdk.on('session-ended', () => {
            this.activeTransport = null;
            this.setState('session-ended');
        });
    }

    async startSession(): Promise<IRpcTransport> {
        if (this.disposed) {
            throw new Error('ChromecastBackend: startSession after dispose');
        }
        if (!this.hasCustomAppId) {
            this.setState('unavailable');
            throw new Error('ChromecastBackend: VITE_CAST_APP_ID is not configured');
        }

        this.setState('connecting');

        let transport: IRpcTransport | null = null;
        try {
            try {
                await this.sdk.load(this.appId);
            } catch (err) {
                this.setState(sdkToBackend[this.sdk.getState()]);
                throw err;
            }

            if (this.disposed) {
                throw new Error('ChromecastBackend: dispose() called during SDK load');
            }

            if (this.sdk.getState() === 'unavailable') {
                this.setState('unavailable');
                throw new Error('ChromecastBackend: Cast not supported in this browser');
            }

            // Open the native device picker. Throws on user-cancel or when
            // CAF reports a launch error (e.g. session_error).
            await this.sdk.requestSession();

            if (this.disposed) {
                throw new Error('ChromecastBackend: dispose() called during requestSession');
            }

            const castSession = this.sdk.getSession();
            if (!castSession) {
                throw new Error('ChromecastBackend: no Cast session after requestSession()');
            }

            // Best-effort ping to verify the receiver is up before we start
            // the WebRTC handshake. Mirrors the existing flow.
            try {
                await castSession.sendMessage('urn:x-cast:com.wodwiki', { type: 'ping', timestamp: Date.now() });
            } catch (err) {
                rpcWarn('ChromecastBackend', 'namespace ping failed', err);
            }

            const signaling = this.createSignaling(castSession);
            transport = this.createTransport(signaling);
            await transport.connect();
        } catch (err) {
            // Failure recovery: a cancelled picker, launch error, or handshake
            // timeout must release the half-built transport and return to
            // 'ready', or the Cast button stays disabled on 'connecting'.
            // Explicit earlier transitions ('unavailable', SDK-load mapping)
            // are preserved because they leave 'connecting' before this runs.
            transport?.dispose();
            if (!this.disposed && this._state === 'connecting') {
                this.setState('ready');
            }
            throw err;
        }

        this.activeTransport = transport;
        transport.onDisconnected(() => {
            if (this._state === 'session-active') {
                this.activeTransport = null;
                this.setState('session-ended');
            }
        });
        this.setState('session-active');
        return transport;
    }

    async resumeSession(): Promise<IRpcTransport> {
        if (this.disposed) {
            throw new Error('ChromecastBackend: resumeSession after dispose');
        }
        if (this.activeTransport) {
            return this.activeTransport;
        }

        await this.sdk.load(this.appId);

        const castSession = this.sdk.getSession();
        if (!castSession) {
            throw new Error('ChromecastBackend: no Cast session to resume');
        }

        // The receiver returned to its waiting screen when the previous
        // transport's datachannel closed (page nav / reload). A fresh offer
        // re-claims it; the 15s connect timeout throws if it is gone.
        const signaling = this.createSignaling(castSession);
        const transport = this.createTransport(signaling);
        try {
            await transport.connect();
        } catch (err) {
            transport.dispose();
            throw err;
        }

        this.activeTransport = transport;
        transport.onDisconnected(() => {
            if (this._state === 'session-active') {
                this.activeTransport = null;
                this.setState('session-ended');
            }
        });
        this.setState('session-active');
        return transport;
    }

    endSession(): void {
        try {
            this.sdk.endSession();
        } catch {
            // SDK may already be torn down; ignore
        }
        if (this.activeTransport) {
            this.activeTransport.dispose();
            this.activeTransport = null;
        }
        if (this._state !== 'unavailable') {
            this.setState('ready');
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.endSession();
        this.sdkUnsubState?.();
        this.sdkUnsubEnded?.();
        this.sdkUnsubState = null;
        this.sdkUnsubEnded = null;
        this.stateListeners.clear();
    }
}
