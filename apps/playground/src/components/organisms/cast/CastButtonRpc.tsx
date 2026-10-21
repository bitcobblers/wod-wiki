/**
 * CastButton — sender-side cast control.
 *
 * The button does not know which Chromecast device it will target. It asks
 * `getCastBackend()` for
 * the build's `ICastBackend`, calls `startSession()` from a user gesture,
 * and gets back a connected `IRpcTransport`. The transport is then handed
 * to a `CastSessionManager` (which owns subscription / event provider /
 * clock sync on top of the transport).
 *
 * The active transport is exposed to the rest of the page via
 * `CastTransportContext` (see `CastButtonRpc` return value). The bridge
 * components (`WorkbenchCastBridge`, `EditorCastBridge`) consume it from
 * context rather than the workbench sync store.
 *
 * This is the single seam for "is the cast going to a TV or a popup tab".
 * The chromecast adapter drives the native device picker; the local
 * adapter opens a popup and uses BroadcastChannel + MessageChannel. The
 * rest of the cast stack (subscription, event wiring, workbench sync) is
 * identical for both.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TvMinimal, Cast } from 'lucide-react';
import { Button } from '@/components/atoms/primitives/button';
import { useWorkbenchSessionStore } from '@/stores/workbenchSessionStore.shim';
import {
    sharedCastSessionManager,
    type CastSessionHandle,
    getCastBackend,
    setActiveCastTransport,
    type ICastBackend,
    type ICastBackendState,
    type IRpcTransport,
} from '@/hooks/useCastSignaling';
import { clockCommandForLegacyEvent } from '@/services/cast/rpc/eventRouter';
import { parseClockCommandPayload } from '@/services/cast/rpc/RpcMessages';
import { dispatchClockCommand, getClockSnapshot, subscribeClock } from '@/clock/clockCommands';
import type { ICastSubscription } from '@/hooks/useRuntimeTimer';
import { cn } from '@/lib/utils';
import { CastTransportProvider } from '@/contexts/CastTransportContext';
import { ProjectionSyncProvider } from '@/contexts/ProjectionSyncContext';
import { workbenchModeResolver } from '@/app/cast/workbenchModeResolver';
import { useCastWakeLock } from '@/hooks/useCastWakeLock';

/**
 * CAF and the WebRTC transport reject with different shapes: Error instances,
 * `{ code, description }` objects (chrome.cast.Error), and plain objects.
 * Logging them raw prints "[object Object]" and loses the failure code — the
 * thing you need when diagnosing a cast failure from console logs.
 */
export function describeCastError(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && err !== null) {
        const { code, description } = err as { code?: unknown; description?: unknown };
        if (code !== undefined || description !== undefined) {
            return [code !== undefined ? String(code) : null, description ? String(description) : null]
                .filter((part): part is string => part !== null)
                .join(': ') || 'unknown';
        }
        try {
            return JSON.stringify(err);
        } catch {
            return String(err);
        }
    }
    return String(err);
}

// Module-scope publication dedupe: several CastButtonRpc mounts share one
// cast session, and each would otherwise push the same snapshot per change.
let lastPushedFingerprint = '';
let lastPushedTransport: IRpcTransport | null = null;

export const CastButtonRpc: React.FC = () => {
    const backend: ICastBackend = getCastBackend();
    const [backendState, setBackendState] = useState<ICastBackendState>(backend.state);
    const [isCasting, setIsCasting] = useState(false);
    // Casting must outlast display sleep: the browser keeps receiving
    // receiver events (workout control from the couch) only while awake.
    useCastWakeLock(isCasting);
    const [isDisconnecting, setIsDisconnecting] = useState(false);
    const [sessionSubscription, setSessionSubscription] = useState<ICastSubscription | null>(null);
    const [sessionHandle, setSessionHandle] = useState<CastSessionHandle | null>(null);

    const buttonRef = useRef<HTMLButtonElement | null>(null);

    // One manager per button lifetime. The manager is the source of
    // truth for the active session — refs would defeat the point.
    const sessionManager = sharedCastSessionManager;
    const handleRef = useRef<CastSessionHandle | null>(sessionManager.getActiveHandle());
    const connectingRef = useRef(false);

    const cleanupCast = useCallback((notifyRemote: boolean) => {
        const handle = handleRef.current;
        handleRef.current = null;
        if (handle) {
            sessionManager.dispose(notifyRemote);
        }
        setActiveCastTransport(null);
        setSessionHandle(null);
        setSessionSubscription(null);
        setIsCasting(false);
    }, [sessionManager]);

    const connectSession = useCallback(async (transport: IRpcTransport) => {
        if (connectingRef.current) return;
        connectingRef.current = true;
        try {
            // Read the registry once at connect time — we don't want
            // this callback to invalidate on every store update.
            const registry = useWorkbenchSessionStore.getState().subscriptionManager;
            const handle = sessionManager.connect(transport, registry);
            handleRef.current = handle;
            setSessionHandle(handle);
            setSessionSubscription(handle.subscription);
            setIsCasting(true);
            // Publish the transport so runtimes created outside the workbench
            // session (the /run inline timer) can mirror to the receiver — the
            // context provider below only wraps this button. (#704)
            setActiveCastTransport(handle.transport);

            // Receiver events reach the browser through one gated path: the
            // clock-command channel carries validated {runId, command}
            // payloads straight to dispatchClockCommand; legacy D-Pad event
            // names are translated to the same commands so an old receiver
            // cannot bypass the paused/completed authority gates. There is
            // deliberately no direct-handle fallback — a rejected command
            // stays rejected (the receiver's UI already shows the gated
            // availability from the snapshot).
            handle.eventProvider.onEvent((event) => {
                if (event.name === 'clock-command') {
                    const payload = parseClockCommandPayload(event.data);
                    if (!payload) {
                        console.warn('[CastButtonRpc] Dropped malformed clock-command payload');
                        return;
                    }
                    if (!dispatchClockCommand(payload.runId, payload.command)) {
                        console.warn('[CastButtonRpc] Clock command rejected by authority:', payload.command.kind);
                    }
                    return;
                }
                const snapshot = getClockSnapshot();
                const command = clockCommandForLegacyEvent(event.name, snapshot);
                if (command && snapshot && !dispatchClockCommand(snapshot.runId, command)) {
                    console.warn('[CastButtonRpc] Legacy receiver event rejected by authority:', event.name);
                }
            });

            // Push the current workbench mode immediately so the
            // receiver doesn't sit on the waiting screen while it waits
            // for the first reactive WorkbenchCastBridge effect tick.
            // The send (with disconnect-tolerant error handling) is
            // owned by the session — the resolver stays here.
            const wb = useWorkbenchSessionStore.getState();
            const message = workbenchModeResolver.resolve({
                viewMode: wb.viewMode,
                executionStatus: wb.execution.status,
                runtime: wb.runtime,
                analyticsSegments: wb.analyticsSegments,
                selectedBlock: wb.selectedBlock,
                documentItems: wb.documentItems,
            });
            handle.pushInitialWorkbench(message);
        } finally {
            connectingRef.current = false;
        }
    }, [sessionManager]);

    // Adopt a platform session that outlived this mount (SPA navigation or
    // page reload): the CAF session is still running, so rebuild the local
    // transport against it rather than showing a dead "connected" button.
    // `connectSession` bails while `connectingRef` is set, so adoption tracks
    // its own in-flight flag.
    const adoptingRef = useRef(false);
    const adoptSession = useCallback(async () => {
        if (sessionManager.isConnected && sessionManager.getActiveHandle()) {
            const handle = sessionManager.getActiveHandle()!;
            handleRef.current = handle;
            setSessionHandle(handle);
            setSessionSubscription(handle.subscription);
            setIsCasting(true);
            return;
        }
        if (handleRef.current || adoptingRef.current) return;
        if (typeof backend.resumeSession !== 'function') return;
        adoptingRef.current = true;
        try {
            const transport = await backend.resumeSession();
            await connectSession(transport);
        } catch (err) {
            console.warn('[CastButtonRpc] Session resume failed:', describeCastError(err));
            cleanupCast(false);
            backend.endSession();
        } finally {
            adoptingRef.current = false;
        }
    }, [backend, connectSession, cleanupCast, sessionManager]);

    // Subscribe to backend state changes.
    useEffect(() => {
        const unsub = backend.onStateChanged((s) => {
            setBackendState(s);
            if (s === 'session-active') {
                setIsCasting(true);
                // The platform session may have outlived this mount (SPA
                // navigation or page reload) — rebuild the local transport
                // against it instead of leaving a dead "connected" button.
                void adoptSession();
            } else if (s === 'ready' || s === 'unavailable') {
                setIsCasting(false);
            } else if (s === 'session-ended') {
                cleanupCast(false);
            }
        });
        return unsub;
    }, [backend, cleanupCast, adoptSession]);

    // Mount: if the platform session was already active before this component
    // existed (route remount after SPA navigation, or a reload where CAF
    // resumed before React subscribed), no state CHANGE will ever arrive —
    // adopt directly from the current state.
    useEffect(() => {
        if (sessionManager.isConnected && sessionManager.getActiveHandle()) {
            const handle = sessionManager.getActiveHandle()!;
            handleRef.current = handle;
            setSessionHandle(handle);
            setSessionSubscription(handle.subscription);
            setIsCasting(true);
        } else if (backend.state === 'session-active') {
            void adoptSession();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design; adoptSession reads live refs
    }, [backend, sessionManager]);

    // Push the sender's clock snapshot to the receiver, bound to the active
    // session's transport lifetime: one immediate publication on connect (the
    // run may already be live before the receiver attaches), then one push per
    // authoritative snapshot change via subscribeClock. Several button mounts
    // share one session, so the dedupe lives at module scope: a publication is
    // sent once per (snapshot, transport) pair. No replay queue — a send that
    // fails is dropped; the next snapshot or reconnect resyncs.
    useEffect(() => {
        const transport = sessionHandle?.transport;
        if (!transport) return;
        const push = () => {
            const snap = getClockSnapshot();
            const fingerprint = JSON.stringify(snap);
            if (fingerprint === lastPushedFingerprint && transport === lastPushedTransport) return;
            lastPushedFingerprint = fingerprint;
            lastPushedTransport = transport;
            try {
                transport.send({ type: 'rpc-clock-snapshot', snapshot: snap });
            } catch {
                // Transport dropped between the connected check and send —
                // the receiver resets on its own onDisconnected handler.
            }
        };
        push();
        return subscribeClock(push);
    }, [sessionHandle]);

    // Best-effort: tell the receiver we're going away when the tab
    // closes. The transport-level disconnect handler on the receiver
    // is the source of truth — this is the polite signal that gets the
    // receiver back to the waiting screen promptly.
    useEffect(() => {
        const onPageHide = () => {
            sessionManager.sendDisposeSignal();
        };
        window.addEventListener('pagehide', onPageHide);
        return () => window.removeEventListener('pagehide', onPageHide);
    }, [sessionManager]);

    useEffect(() => {
        const btn = buttonRef.current;
        if (!btn) return;

        const onNativeClick = async () => {
            if (backendStateRef.current === 'session-active') {
                if (isDisconnectingRef.current) return;

                setIsDisconnecting(true);
                try {
                    cleanupCast(true);
                    backend.endSession();
                } finally {
                    setTimeout(() => setIsDisconnecting(false), 2000);
                }
                return;
            }

            try {
                const transport = await backend.startSession();
                setIsCasting(true);
                await connectSession(transport);
            } catch (err) {
                const message = describeCastError(err);
                if (message === 'cancel' || message.includes('cancel')) {
                    console.log('[CastButtonRpc] Cast request canceled or gesture expired');
                } else {
                    console.error('[CastButtonRpc] Cast failed:', message);
                }
                cleanupCast(false);
            }
        };

        btn.addEventListener('click', onNativeClick);
        return () => btn.removeEventListener('click', onNativeClick);
    }, [backend, connectSession, cleanupCast]);


    const backendStateRef = useRef(backendState);
    backendStateRef.current = backendState;
    const isDisconnectingRef = useRef(isDisconnecting);
    isDisconnectingRef.current = isDisconnecting;

    const isUnavailable = backendState === 'unavailable';
    const isAvailable = backendState === 'ready';
    const isConnected = backendState === 'session-active';
    const isConnecting = backendState === 'connecting';
    const isWebRtcActive = isCasting && isConnected;
    const isCurrentlyConnecting = isConnecting;
    const isCurrentlyBusy = isCurrentlyConnecting || isDisconnecting;
    const canInteract = isAvailable || isConnected;

    if (isUnavailable) {
        return (
            <Button variant="ghost" size="icon" disabled className="opacity-20 cursor-not-allowed">
                <Cast className="h-5 w-5" />
            </Button>
        );
    }

    return (
        <CastTransportProvider transport={sessionHandle?.transport ?? null}>
            <ProjectionSyncProvider chromecastSubscription={sessionSubscription}>
                <Button
                    ref={buttonRef}
                    variant="ghost"
                    size="icon"
                    disabled={isCurrentlyBusy}
                    onClick={() => { /* listener attached imperatively */ }}
                    className={cn(
                        'transition-all',
                        isWebRtcActive && 'text-signal-positive ring-2 ring-signal-positive/30',
                        isCurrentlyConnecting && 'animate-pulse text-signal-caution',
                        !canInteract && 'opacity-50',
                    )}
                    aria-label={isWebRtcActive ? 'Stop casting' : 'Cast to TV'}
                    title={isWebRtcActive ? 'Stop casting' : isCurrentlyConnecting ? 'Connecting...' : 'Cast to TV'}
                >
                    {isWebRtcActive ? <TvMinimal className="h-5 w-5" /> : <Cast className="h-5 w-5" />}
                </Button>
            </ProjectionSyncProvider>
        </CastTransportProvider>
    );
};
