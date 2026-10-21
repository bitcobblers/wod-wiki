/**
 * receiver-rpc.tsx — React Chromecast receiver using ChromecastProxyRuntime.
 *
 * This replaces receiver-main.tsx's manual state parsing with a proper
 * IScriptRuntime proxy. The proxy hydrates RPC messages into stack snapshots
 * and output statements, letting standard workbench hooks (useSnapshotBlocks,
 * useStackTimers, etc.) work identically to the browser.
 *
 * Setup:
 * 1. Cast Receiver SDK starts and creates signaling
 * 2. WebRtcRpcTransport connects as answerer
 * 3. ChromecastProxyRuntime wraps the transport
 * 4. <ScriptRuntimeProvider> exposes runtime to hooks
 * 5. D-Pad events → proxyRuntime.handle() → RPC → browser
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CAST_NAMESPACE } from '@/types/cast/messages';
import { ReceiverCastSignaling } from '@/services/cast/CastSignaling';
import { WebRtcRpcTransport, type ISignaling } from '@/services/cast/rpc/WebRtcRpcTransport';
import { ChromecastProxyRuntime } from '@/services/cast/rpc/ChromecastProxyRuntime';
import type { WorkbenchDisplayState } from '@/services/cast/rpc/ChromecastProxyRuntime';
import type { CastReceiverContextLike } from '@/types/cast/sdk';
import { createReceiverSession, type ReceiverSessionHandle } from '@/services/cast/rpc/ReceiverSessionManager';
import type { IRpcTransport } from '@/services/cast/rpc/IRpcTransport';
import { ScriptRuntimeProvider } from '@bitcobblers/wod-wiki-engine';
import { PanelSizeProvider } from '@/panels/panel-system/PanelSizeContext';
import { ReceiverTimerPanel } from '@/panels/wallclock-panel-chromecast';
import { ReceiverPreviewPanel } from '@/panels/preview-panel-chromecast';
import { ReceiverReviewPanel } from '@/panels/review-panel-chromecast';
import { useSpatialNavigation } from '@/hooks/useSpatialNavigation';
import { ClockCommandBoard, ClockControlModeToggle, ClockKeyCheckDialog } from '@/clock/ClockCommandBoard';
import { applyEntryKey, getClockDraft, parseClockDraftValue, writeClockDraft } from '@/clock/clockCommands';
import type { ClockCommand, ClockKeyAction, ClockSnapshot } from '@/clock/clockCommands';
import { audioService } from '@/services/AudioService';
import {
    armReceiverBootFallback,
    dismissReceiverBootLoader,
    RECEIVER_BOOT_DEGRADED_STATUS,
    RECEIVER_BOOT_READY_TIMEOUT_MS,
} from './receiverBootLoader';
import {
    acquireLocalReceiverSession,
    readLocalSessionIdFromUrl,
} from '@/services/cast/adapters/LocalReceiverBackend';
import '@/index.css';
// ============================================================================
// ReceiverApp — Main receiver component
// ============================================================================
const ReceiverApp: React.FC<{
    transport?: IRpcTransport;
    runtime?: ChromecastProxyRuntime;
    /** Pre-built receiver session handle (local-tab path). */
    externalHandle?: ReceiverSessionHandle;
}> = ({ transport, runtime: externalRuntime, externalHandle }) => {
    const [proxyRuntime, setProxyRuntime] = useState<ChromecastProxyRuntime | null>(null);
    const [connectionStatus, setConnectionStatus] = useState('waiting-for-cast');
    const [workbenchState, setWorkbenchState] = useState<WorkbenchDisplayState>({ mode: 'idle' });
    const [clockSnapshot, setClockSnapshot] = useState<ClockSnapshot | null>(null);
    const [dpadFlash, setDpadFlash] = useState(false);
    const [keyCheckOpen, setKeyCheckOpen] = useState(false);
    const runtimeRef = useRef<ChromecastProxyRuntime | null>(null);
    const transportRef = useRef<IRpcTransport | null>(null);
    const activeSessionHandleRef = useRef<ReceiverSessionHandle | null>(null);
    const bootFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Latest snapshot for stable callbacks (sendCommand never stale).
    const clockSnapshotRef = useRef<ClockSnapshot | null>(null);
    clockSnapshotRef.current = clockSnapshot;
    // Boot-fallback timer for the Chromecast CAF path. Distinct from
    // bootFadeTimerRef (loader fade): this one fires if the CAF READY event
    // never arrives (see armReceiverBootFallback, receiverBootLoader.ts).
    // Was undeclared prior to Finding 05 Step 1 — caused a device-only
    // ReferenceError on real Chromecast hardware.
    const bootTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastModeRef = useRef<string | null>(null);
    const lastTitleRef = useRef<string | undefined>(undefined);
    const modeStartRef = useRef<number>(Date.now());

    // Persistent signaling instance (lives for the life of the Receiver app)
    const signalingRef = useRef<ReceiverCastSignaling | null>(null);

    // Send event back to browser via the proxy runtime
    const sendEvent = useCallback((eventName: string, data?: unknown) => {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        runtime.handle({
            name: eventName,
            timestamp: new Date(),
            data,
        });
    }, []);

    // Authoritative clock command channel. Carries {runId, command} so the
    // sender can validate the active run before dispatching through the same
    // gates as local controls. Commands are dropped (never queued, never
    // replayed) while disconnected or without an active snapshot — a dead
    // control must not fire on reconnect.
    const sendCommand = useCallback((command: ClockCommand) => {
        const runtime = runtimeRef.current;
        const snapshot = clockSnapshotRef.current;
        if (!runtime || !snapshot) return;
        runtime.handle({
            name: 'clock-command',
            timestamp: new Date(),
            data: { runId: snapshot.runId, command },
        });
    }, []);

    // Preview selection carries the stable block id (index kept for legacy
    // senders) so the browser resolves the exact block, not an array slot.
    const sendSelectBlock = useCallback((blockId: string, index: number) => {
        sendEvent('select-block', { blockId, index });
    }, [sendEvent]);

    // D-Pad flash helper
    const flash = useCallback(() => {
        setDpadFlash(true);
        setTimeout(() => setDpadFlash(false), 200);
    }, []);

    const dismissBootLoader = useCallback((reason: 'ready' | 'timeout' | 'error') => {
        const loader = document.getElementById('initial-loader');
        if (!loader || loader.dataset.bootDismissed === 'true') {
            return;
        }

        loader.dataset.bootDismissed = reason;
        loader.style.opacity = '0';

        if (bootFadeTimerRef.current) {
            clearTimeout(bootFadeTimerRef.current);
        }
        bootFadeTimerRef.current = setTimeout(() => {
            loader.style.display = 'none';
            bootFadeTimerRef.current = null;
        }, 500);
    }, []);

    const workbenchStateRef = useRef(workbenchState);
    workbenchStateRef.current = workbenchState;

    const dismissToWaiting = useCallback(() => {
        // Best effort: notify sender so it can react while still connected.
        sendEvent('dismiss');

        // Reset to idle but keep proxyRuntime: nulling it strands the UI on
        // the waiting screen while the sender is still connected — subsequent
        // workbench updates (preview/active/review) must restore the display.
        setWorkbenchState({ mode: 'idle' });
    }, [sendEvent]);

    // Review dismissal: when the sender publishes a snapshot the post-run
    // review controller is authoritative — it consumes `dismiss` and the next
    // workbench/snapshot update redraws the receiver. Only snapshotless
    // (legacy) senders fall back to the local reset.
    const dismissReview = useCallback(() => {
        if (clockSnapshotRef.current) {
            sendCommand({ kind: 'dismiss' });
            return;
        }
        dismissToWaiting();
    }, [sendCommand, dismissToWaiting]);

    // Shared command board dispatch for receiver-mounted boards (preview /
    // review modes); sent is the strongest claim the receiver can make.
    const dispatchBoardCommand = useCallback((command: ClockCommand) => {
        sendCommand(command);
        return true;
    }, [sendCommand]);

    // The command board with snapshot-driven controls (entry card, reps,
    // Ready/stop-confirm) — rendered under any mirrored mode so pre-run and
    // post-run value entry work on the TV, not only in active mode.
    const renderClockBoard = () => (
        clockSnapshot ? (
            <div className="absolute inset-x-0 bottom-0 flex w-full shrink-0 justify-center px-10 pb-6">
                <ClockCommandBoard
                    snapshot={clockSnapshot}
                    dispatch={dispatchBoardCommand}
                    getFocusProps={getFocusProps}
                />
            </div>
        ) : null
    );

    // D-Pad navigation activation
    const { getFocusProps, setFocusedId } = useSpatialNavigation({
        enabled: !!proxyRuntime,
        initialFocusId: workbenchState.mode === 'preview'
            ? 'preview-block-0'
            : workbenchState.mode === 'review'
                ? 'btn-dismiss'
                : 'btn-next',
        // Value entry open: every digit — Num Lock on or off — is data.
        entryOpen: clockSnapshot?.entry != null,
        onClockAction: useCallback((action: Extract<ClockKeyAction, { kind: 'playback' | 'cancel' | 'values' | 'reps-adjust' | 'primary' | 'digit' | 'back' }>) => {
            flash();
            switch (action.kind) {
                case 'playback':
                    sendCommand({ kind: 'playback' });
                    return;
                case 'cancel':
                    // Cancel means, in order: close the entry draft, back out
                    // of a requested stop, request stop while live, dismiss
                    // review. Legacy senders fall back to the stop event.
                    if (clockSnapshotRef.current?.entry) {
                        sendCommand({ kind: 'entry-cancel' });
                    } else if (clockSnapshotRef.current?.stopRequested) {
                        sendCommand({ kind: 'stop-cancel' });
                    } else if (clockSnapshotRef.current) {
                        sendCommand({ kind: 'stop-request' });
                    } else if (workbenchStateRef.current.mode === 'active') {
                        sendEvent('stop');
                    }
                    return;
                case 'values':
                    sendCommand({ kind: 'values-open' });
                    return;
                case 'reps-adjust': {
                    // Grouped movements require explicit selection — no
                    // implicit first-row target.
                    const selected = clockSnapshotRef.current?.selectedOccurrenceId;
                    if (selected) {
                        sendCommand({ kind: 'reps-adjust', occurrenceId: selected, delta: action.delta });
                    }
                    return;
                }
                case 'digit':
                    // Remote digits edit the shared draft buffer; the entry
                    // card renders it (controlled) and Save/primary commit it.
                    if (clockSnapshotRef.current?.entry) writeClockDraft(applyEntryKey(clockSnapshotRef.current.entry.domain, getClockDraft(), action.digit));
                    return;
                case 'back':
                    if (clockSnapshotRef.current?.entry) writeClockDraft(applyEntryKey(clockSnapshotRef.current.entry.domain, getClockDraft(), 'back'));
                    return;
                case 'primary': {
                    const snapshot = clockSnapshotRef.current;
                    if (!snapshot) return;
                    if (snapshot.entry) {
                        // Commit the shared draft once (keys with their target
                        // inside the entry card are handled by the card).
                        const parsed = parseClockDraftValue(getClockDraft(), snapshot.entry.domain);
                        if (parsed.ok) {
                            sendCommand({ kind: 'entry-save', fieldId: snapshot.entry.fieldId, value: parsed.value });
                        }
                        return;
                    }
                    if (snapshot.stopRequested) {
                        sendCommand({ kind: 'stop-confirm' });
                        return;
                    }
                    if (snapshot.phase === 'ready' || snapshot.phase === 'collection') {
                        sendCommand({ kind: 'ready-start' });
                        return;
                    }
                    if (snapshot.phase === 'review') {
                        sendCommand({ kind: 'dismiss' });
                        return;
                    }
                    // Live: primary is Next irrespective of focus.
                    sendCommand({ kind: 'next' });
                    return;
                }
            }
        }, [flash, sendCommand, sendEvent]),
        onFocusChanged: useCallback((_elementId: string | null, _element: HTMLElement | null) => {
            audioService.playSound('click', 0.3);
        }, []),
        onSelect: useCallback((elementId: string, element: HTMLElement) => {
            flash();
            // Local audible feedback for remote button press
            audioService.playSound('select', 0.5);

            // Preview screen items → start the workout (stable block id).
            if (elementId.startsWith('preview-block-')) {
                const index = Number(elementId.slice('preview-block-'.length));
                const block = workbenchStateRef.current.previewData?.blocks[index];
                if (block) {
                    sendSelectBlock(block.id, index);
                }
                return;
            }
            // Track panel controls: the surface buttons dispatch commands
            // through their own onClick (single virtual click — the native
            // click for this keydown is suppressed by the navigator).
            switch (elementId) {
                case 'btn-dismiss':
                    dismissReview();
                    break;
                default:
                    element.click();
                    break;
            }
        }, [flash, dismissReview, sendSelectBlock]),
    });

    // Programmatically focus the correct element when the workbench mode changes
    useEffect(() => {
        if (clockSnapshot?.entry) {
            setFocusedId('entry-digit-1');
            return;
        }
        if (clockSnapshot?.phase === 'ready') {
            setFocusedId('board-ready-start');
            return;
        }
        if (workbenchState.mode === 'preview') {
            // Only focus first block when blocks exist; otherwise leave focus
            // unset so spatial nav can fall back to the first registered element.
            if (workbenchState.previewData && workbenchState.previewData.blocks.length > 0) {
                setFocusedId('preview-block-0');
            }
        } else if (workbenchState.mode === 'active') {
            // Value entry owns focus while a field is open — land on the
            // D-pad-reachable digit grid (the text input is not registered).
            setFocusedId(clockSnapshot?.entry ? 'entry-digit-1' : 'btn-next');
        } else if (workbenchState.mode === 'review') {
            setFocusedId('btn-dismiss');
        }
    }, [workbenchState.mode, workbenchState.previewData, clockSnapshot?.entry, clockSnapshot?.phase, setFocusedId]);
    // Track receiver mode changes (browsing, timer, showing results) and durations in GA4
    useEffect(() => {
        const currentMode = workbenchState.mode;
        const currentTitle = workbenchState.previewData?.title;

        if (lastModeRef.current === currentMode && lastTitleRef.current === currentTitle) {
            return;
        }

        const now = Date.now();
        const prevMode = lastModeRef.current;
        const durationMs = now - modeStartRef.current;

        const modeCategory: Record<string, string> = {
            preview: 'browsing',
            active: 'timer',
            review: 'showing_results',
            idle: 'idle',
        };

        if (prevMode && durationMs >= 1000) {
            window.gtag?.('event', 'receiver_mode_duration', {
                receiver_mode: modeCategory[prevMode] ?? prevMode,
                duration_seconds: Math.round(durationMs / 1000),
                engagement_time_msec: durationMs,
                workout_title: lastTitleRef.current,
            });
        }

        const titleMap: Record<string, string> = {
            idle: 'Wod.Wiki TV - Idle',
            preview: `Wod.Wiki TV - Browsing${currentTitle ? ': ' + currentTitle : ''}`,
            active: `Wod.Wiki TV - Timer${currentTitle ? ': ' + currentTitle : ''}`,
            review: `Wod.Wiki TV - Showing Results${currentTitle ? ': ' + currentTitle : ''}`,
        };
        const pathMap: Record<string, string> = {
            idle: '/tv/idle',
            preview: '/tv/browsing',
            active: '/tv/timer',
            review: '/tv/results',
        };

        const pageTitle = titleMap[currentMode] || `Wod.Wiki TV - ${currentMode}`;
        const pagePath = pathMap[currentMode] || `/tv/${currentMode}`;

        document.title = pageTitle;
        window.gtag?.('event', 'page_view', {
            page_title: pageTitle,
            page_path: pagePath,
            page_location: `${window.location.origin}${pagePath}`,
        });

        lastModeRef.current = currentMode;
        lastTitleRef.current = currentTitle;
        modeStartRef.current = now;
    }, [workbenchState.mode, workbenchState.previewData?.title]);

    // Flush final mode duration on unmount or tab close
    useEffect(() => {
        const flush = () => {
            const mode = lastModeRef.current;
            const durationMs = Date.now() - modeStartRef.current;
            const modeCategory: Record<string, string> = {
                preview: 'browsing',
                active: 'timer',
                review: 'showing_results',
                idle: 'idle',
            };
            if (mode && durationMs >= 1000) {
                window.gtag?.('event', 'receiver_mode_duration', {
                    receiver_mode: modeCategory[mode] ?? mode,
                    duration_seconds: Math.round(durationMs / 1000),
                    engagement_time_msec: durationMs,
                    workout_title: lastTitleRef.current,
                });
            }
        };

        window.addEventListener('beforeunload', flush);
        return () => {
            window.removeEventListener('beforeunload', flush);
            flush();
        };
    }, []);

    // Global click listener for on-screen interactions on receiver
    useEffect(() => {
        const handleGlobalClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('button')) {
                audioService.playSound('click', 0.5);
            }
        };
        window.addEventListener('click', handleGlobalClick, true);
        return () => window.removeEventListener('click', handleGlobalClick, true);
    }, []);

    // Expose the sender's clock time globally for useTimerDisplay hook access
    useEffect(() => {
        const updateClock = () => {
            (window as any).__chromecast_senderClockTimeMs = runtimeRef.current?.getSenderClockTimeMs?.bind(runtimeRef.current) ?? (() => Date.now());
        };
        updateClock();

        // Update whenever proxyRuntime changes
        const cleanup = () => (window as any).__chromecast_senderClockTimeMs = undefined;

        return cleanup;
    }, [proxyRuntime]);

    // ── Shared session wiring (paths 1 & 2 & 3) ──────────────────────
    // Both the externalHandle path (parent owns lifetime) and the legacy
    // transport path (this receiver builds + disposes the handle) do the same
    // bookkeeping + subscriptions. The only thing that varies is **who owns
    // the handle's lifetime** — captured by `ownsLifetime`. Extracted per
    // Finding 05 Step 2 so the bug a missing ref caused in path 3 (the CAF
    // bootTimeoutRef crash) cannot recur here through drift.
    const wireSession = useCallback((
        handle: ReceiverSessionHandle,
        options: {
            ownsLifetime: boolean;
            /** External runtime override (used when the parent supplies one). */
            runtime?: ChromecastProxyRuntime;
            /** Transport to bookkeep in `transportRef` (path 2 only). */
            transport?: IRpcTransport | null;
            /** Log label for the disconnect event. */
            disconnectedLog: string;
        },
    ): (() => void) => {
        const runtime = options.runtime ?? handle.runtime;
        activeSessionHandleRef.current = handle;
        runtimeRef.current = runtime;
        if (options.transport) {
            transportRef.current = options.transport;
        }
        setProxyRuntime(runtime);
        setConnectionStatus('connected');
        dismissBootLoader('ready');

        const unsubWorkbench = handle.onWorkbenchUpdate((state) => {
            setWorkbenchState(state);
        });
        // Authoritative clock state: immediate replay of the latest snapshot
        // on subscribe, then every push. Null snapshot ⇒ controls disabled.
        const unsubClock = handle.onClockSnapshot((snapshot) => {
            setClockSnapshot(snapshot);
        });
        const unsubDisconnect = handle.onDisconnected(() => {
            console.log(options.disconnectedLog);
            setConnectionStatus('disconnected');
            setProxyRuntime(null);
            // Transport gone: no snapshot, no commands, nothing to replay.
            setClockSnapshot(null);
            if (activeSessionHandleRef.current === handle) {
                activeSessionHandleRef.current = null;
            }
            if (options.transport && transportRef.current === options.transport) {
                transportRef.current = null;
            }
        });

        return () => {
            unsubWorkbench();
            unsubClock();
            unsubDisconnect();
            if (options.ownsLifetime) {
                handle.dispose();
            }
            clearSessionRefs();
        };
    }, [dismissBootLoader]);

    // ── Shared ref-clearing for session cleanup (all paths) ──────────
    // Path 1/2 (via wireSession) and path 3 (direct CAF cleanup) both null
    // the runtime + transport refs on teardown. Centralized so the shape is
    // identical across paths — Finding 05 Step 3.
    const clearSessionRefs = useCallback(() => {
        runtimeRef.current = null;
        transportRef.current = null;
    }, []);

    /**
     * Initialize/Re-initialize the WebRTC transport and receiver session.
     * Called whenever a new signaling offer arrives.
     *
     * The session manager handles audio routing and the workbench
     * subscription; the React tree only needs to observe the runtime
     * and react to disconnect events.
     */
    const setupTransport = useCallback(() => {
        if (!signalingRef.current) return;
        console.log('[ReceiverApp] Setting up new transport session…');

        // 1. Dispose previous session + transport. The receiver session
        //    manager's dispose() tears down the runtime and audio routing;
        //    we then dispose the transport so the signaling facade can
        //    be re-issued. ReceiverApp owns the signaling lifetime, not
        //    the transport, so we wrap it in a non-disposable facade.
        activeSessionHandleRef.current?.dispose();
        activeSessionHandleRef.current = null;
        transportRef.current?.dispose();
        transportRef.current = null;
        setProxyRuntime(null);

        const sharedSignaling = signalingRef.current;
        const signalingFacade: ISignaling = {
            send: (signal) => sharedSignaling.send(signal),
            onSignal: (handler) => sharedSignaling.onSignal(handler),
            dispose: () => { /* no-op — signaling is owned by ReceiverApp */ },
        };
        const transportInstance: IRpcTransport = new WebRtcRpcTransport('answerer', signalingFacade);
        const handle = createReceiverSession(transportInstance);

        wireSession(handle, {
            ownsLifetime: true,
            transport: transportInstance,
            disconnectedLog: '[ReceiverApp] RPC transport disconnected — returning to waiting screen',
        });

        transportInstance.connect().catch((err: unknown) => {
            console.error('[ReceiverApp] RPC transport connect failed', err);
            setConnectionStatus('error');
        });
    }, [wireSession]);

    // ── Transport initialization ──────────────────────────────────────────
    // Three paths (Finding 05):
    //  1. Local-tab + parent-supplied handle: externalHandle. Skip CAF.
    //  2. Local-tab + bare transport: build a session via createReceiverSession.
    //  3. Chromecast: initialise CAF SDK, signaling, and wait for a sender.
    // Paths 1 and 2 share `wireSession` (above); path 3 keeps its own block.
    useEffect(() => {
        // ── Path 1: external handle provided by parent ──────────
        // The session manager (LocalReceiverApp) owns the handle's lifetime.
        // The React tree just observes it via wireSession.
        if (externalHandle) {
            console.log('[ReceiverApp] external handle provided — skipping CAF init');
            return wireSession(externalHandle, {
                ownsLifetime: false,
                runtime: externalRuntime,
                disconnectedLog: '[ReceiverApp] session disconnected',
            });
        }
        // ── Path 2: legacy transport prop — build session in-place ──
        // This receiver owns the handle's lifetime (creates + disposes it).
        if (transport) {
            console.log('[ReceiverApp] legacy transport prop — building session in-place');
            const handle = createReceiverSession(transport);
            return wireSession(handle, {
                ownsLifetime: true,
                runtime: externalRuntime,
                transport,
                disconnectedLog: '[ReceiverApp] local transport disconnected',
            });
        }
        // ── Path 3: Chromecast — initialise CAF SDK ───────────────
        // Unchecked cast: the CAF receiver SDK injects `window.cast` at
        // runtime; its shape is owned by @/types/cast/sdk, not by TS DOM lib.
        const castGlobal = (window as unknown as {
            cast?: { framework?: { CastReceiverContext?: { getInstance(): CastReceiverContextLike } } };
        }).cast;
        const castContext = castGlobal?.framework?.CastReceiverContext?.getInstance();
        if (!castContext) {
            console.error('[ReceiverApp] Cast Receiver SDK not loaded');
            setConnectionStatus('error: no Cast SDK');
            // Never leave the boot spinner up: without the SDK there is no
            // READY event and no later code path that would dismiss it.
            const bootMsg = document.getElementById('booting-msg');
            if (bootMsg) bootMsg.textContent = 'Receiver error: Cast SDK did not load';
            dismissBootLoader('error');
            return;
        }
        // Start the CAF receiver context FIRST — the custom namespace must be
        // declared in start() before addCustomMessageListener() is called.
        castContext.start({
            customNamespaces: {
                [CAST_NAMESPACE]: 'JSON',
            },
            // Prevent the CAF SDK from consuming D-Pad / media key events
            // so they propagate to our spatial navigation handler.
            disableIdleTimeout: true,
        });
        setConnectionStatus('cast-ready');
        console.log('[ReceiverApp] castContext.start() called — namespace registered');
        // ── Diagnostic: log ALL key events reaching the page ──────────
        // This capture-phase listener fires before anything else and logs
        // key info to the console (visible in chrome://inspect remote debug).
        // Remove once D-Pad navigation is confirmed working on device.
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            console.log(`[KeyDiag] key=${e.key} code=${e.code} keyCode=${e.keyCode} type=${e.type}`);
        }, true);
        castContext.addEventListener((window as any).cast.framework.system.EventType.READY, () => {
            console.log('[ReceiverApp] Cast Receiver READY');
            dismissBootLoader('ready');
            if (bootTimeoutRef.current) {
                clearTimeout(bootTimeoutRef.current);
                bootTimeoutRef.current = null;
            }
        });
        bootTimeoutRef.current = armReceiverBootFallback(() => {
            console.warn('[ReceiverApp] CAF READY did not arrive before the boot timeout; showing degraded waiting shell');
            setConnectionStatus(RECEIVER_BOOT_DEGRADED_STATUS);
            dismissBootLoader('timeout');
        }, RECEIVER_BOOT_READY_TIMEOUT_MS);
        // Create signaling AFTER start().
        // We keep this signaling instance alive for the duration of the app.
        const signaling = new ReceiverCastSignaling(castContext);
        signalingRef.current = signaling;
        // CRITICAL: Reconnection support.
        // Listen for incoming signals. If we see a 'webrtc-offer', it means a
        // sender is trying to start a new session. We trigger setupTransport()
        // to handle the handshake even if we were already connected to an
        // old session (clearing it out first).
        signaling.onSignal((signal) => {
            if (signal.type === 'webrtc-offer') {
                console.log('[ReceiverApp] Received webrtc-offer — triggering transport setup');
                setupTransport();
            }
        });
        return () => {
            // CAF-specific: boot-fallback + boot-fade timers
            if (bootTimeoutRef.current) {
                clearTimeout(bootTimeoutRef.current);
                bootTimeoutRef.current = null;
            }
            if (bootFadeTimerRef.current) {
                clearTimeout(bootFadeTimerRef.current);
                bootFadeTimerRef.current = null;
            }
            // Dispose transport + runtime (CAF-specific — paths 1/2 don't,
            // because the ReceiverSessionHandle owns them via its dispose()).
            runtimeRef.current?.dispose();
            transportRef.current?.dispose();
            signaling.dispose();
            signalingRef.current = null;
            // Same ref-clearing shape as paths 1/2 (wireSession's cleanup).
            clearSessionRefs();
        };
    }, [setupTransport, wireSession, clearSessionRefs]);

    // Escape/Backspace cancel semantics ride the shared spatial-navigation
    // key policy (hook `cancel` action → entry-cancel / stop-cancel /
    // stop-request; Backspace during entry stays with the draft editor).

    // Waiting screen: not yet connected, or connected with no runtime active.
    // The sender flips this back to preview/active/review on the next update.
    if (!proxyRuntime || workbenchState.mode === 'idle') {
        return (
            <div className="h-screen w-screen bg-black flex flex-col items-center justify-center text-white/60 font-mono uppercase tracking-[0.5em]">
                <div className="animate-pulse">Wod.Wiki // {connectionStatus}</div>
                {/* Remote mapping aids: Navigation/Keypad key mode plus a
                    live key-check table for verifying a given remote. */}
                <div className="mt-8 flex items-center gap-4 tracking-normal normal-case">
                    <ClockControlModeToggle className="text-xs font-mono text-white/50" />
                    <button
                        type="button"
                        onClick={() => setKeyCheckOpen(true)}
                        className="text-xs font-mono text-white/50 underline underline-offset-4 hover:text-white/80"
                    >
                        Key check
                    </button>
                </div>
                <ClockKeyCheckDialog open={keyCheckOpen} onClose={() => setKeyCheckOpen(false)} />
            </div>
        );
    }

    // Preview mode: note loaded but no active runtime
    if (workbenchState.mode === 'preview' && workbenchState.previewData) {
        return (
            <div className="h-screen w-screen bg-background text-foreground overflow-hidden">
                {dpadFlash && (
                    <div className="fixed inset-0 bg-primary/10 pointer-events-none z-50 animate-in fade-in duration-150" />
                )}
                <ReceiverPreviewPanel
                    previewData={workbenchState.previewData}
                    getFocusProps={getFocusProps}
                    onBlockSelect={(blockId, index) => sendSelectBlock(blockId, index)}
                />
                {/* Pre-run collection / Ready controls ride the shared board. */}
                {renderClockBoard()}
                <div className="absolute bottom-2 right-2 opacity-10 text-[8px] font-mono tracking-tighter uppercase">
                    {connectionStatus}
                </div>
            </div>
        );
    }

    // Review mode: workout completed, results available
    if (workbenchState.mode === 'review' && workbenchState.reviewData) {
        return (
            <div className="h-screen w-screen bg-background text-foreground overflow-hidden">
                {dpadFlash && (
                    <div className="fixed inset-0 bg-primary/10 pointer-events-none z-50 animate-in fade-in duration-150" />
                )}
                <ReceiverReviewPanel
                    reviewData={workbenchState.reviewData}
                    analyticsSummary={workbenchState.analyticsSummary}
                    onDismiss={dismissReview}
                    getFocusProps={getFocusProps}
                />
                {/* Post-run corrections ride the shared board. */}
                {renderClockBoard()}
                <div className="absolute bottom-2 right-2 opacity-10 text-[8px] font-mono tracking-tighter uppercase">
                    {connectionStatus}
                </div>
            </div>
        );
    }

    // Active mode: General (Tier 2) timer surface, full-bleed — no stack
    // panel; history/audit is Detail-tier chrome and stays off the TV.
    return (
        <ScriptRuntimeProvider runtime={proxyRuntime}>
            <PanelSizeProvider>
                <div className="h-screen w-screen bg-background text-foreground overflow-hidden">
                    {/* D-Pad flash overlay */}
                    {dpadFlash && (
                        <div className="fixed inset-0 bg-primary/10 pointer-events-none z-50 animate-in fade-in duration-150" />
                    )}

                    <ReceiverTimerPanel
                        snapshot={clockSnapshot}
                        sendCommand={sendCommand}
                        getFocusProps={getFocusProps}
                        workoutTitle={workbenchState.previewData?.title}
                    />
                    <div className="absolute bottom-2 right-2 opacity-10 text-[8px] font-mono tracking-tighter uppercase">
                        {connectionStatus}
                    </div>
                </div>
            </PanelSizeProvider>
        </ScriptRuntimeProvider>
    );
};

// ============================================================================
// LocalReceiverApp — boot path for the local-tab dual-pane mirror.
// ============================================================================

type LocalBootState =
    | { kind: 'handshaking' }
    | { kind: 'connected'; handle: import('@/services/cast/rpc/ReceiverSessionManager').ReceiverSessionHandle }
    | { kind: 'failed'; error: Error };

const LocalReceiverApp: React.FC = () => {
    const sessionId = readLocalSessionIdFromUrl();
    const [state, setState] = useState<LocalBootState>({ kind: 'handshaking' });

    useEffect(() => {
        if (!sessionId) {
            setState({
                kind: 'failed',
                error: new Error('Local receiver opened without a `?local=<id>` query param. Did the sender open this tab?'),
            });
            return;
        }

        console.log('[LocalReceiverApp] starting handshake', { sessionId, url: window.location.href });

        let cancelled = false;
        let handleRef: import('@/services/cast/rpc/ReceiverSessionManager').ReceiverSessionHandle | null = null;
        let transportDispose: (() => void) | null = null;

        acquireLocalReceiverSession({ sessionId })
            .then((result) => {
                if (cancelled) {
                    result.dispose();
                    return;
                }
                // Create the receiver session eagerly (before React re-renders)
                // so the transport.onMessage handler is registered before the
                // sender can start clock sync. Without this, the sender's
                // first rpc-clock-sync-request arrives with no handler and is
                // lost. The session manager handles audio routing and the
                // workbench subscription that the React tree reads from.
                const handle = createReceiverSession(result.transport);
                handleRef = handle;
                transportDispose = result.dispose;
                const loader = document.getElementById('initial-loader');
                if (loader) {
                    loader.dataset.bootDismissed = 'true';
                    loader.style.opacity = '0';
                    setTimeout(() => { loader.style.display = 'none'; }, 500);
                }
                setState({ kind: 'connected', handle });
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const error = err instanceof Error ? err : new Error(String(err));
                console.error('[LocalReceiverApp] handshake failed', error);
                setState({ kind: 'failed', error });
            });

        return () => {
            cancelled = true;
            handleRef?.dispose();
            transportDispose?.();
        };
    }, [sessionId]);

    if (state.kind === 'failed') {
        return (
            <div
                data-nav-root="true"
                className="min-h-screen w-screen flex flex-col items-center justify-center bg-black text-white p-8"
            >
                <div className="max-w-2xl text-center space-y-4">
                    <div className="text-2xl font-bold text-red-400">Local cast failed</div>
                    <div className="text-sm text-zinc-300 break-words">{state.error.message}</div>
                    <div className="text-xs text-zinc-500 pt-4">
                        The sender did not transfer a connection. You can close this tab and try again.
                    </div>
                </div>
            </div>
        );
    }

    if (state.kind === 'handshaking') {
        return (
            <div
                data-nav-root="true"
                className="min-h-screen w-screen flex flex-col items-center justify-center bg-black text-white"
            >
                <div className="text-2xl font-bold opacity-80">Waiting for sender</div>
                <div className="text-sm opacity-60 mt-2">
                    The sender opened this tab. The connection will appear when the handshake completes.
                </div>
            </div>
        );
    }

    return <ReceiverApp
        runtime={state.handle.runtime}
        externalHandle={state.handle}
    />;
};

// ============================================================================
// Root — dispatches between the local boot path and the chromecast path.
// ============================================================================

const Root: React.FC = () => {
    const localSessionId = readLocalSessionIdFromUrl();
    if (localSessionId) {
        return <LocalReceiverApp />;
    }
    return <ReceiverApp />;
};

// ============================================================================
// ReceiverErrorBoundary — keeps the popup from blanking on a render error.
// ============================================================================

interface ReceiverErrorBoundaryState {
    error: Error | null;
}

class ReceiverErrorBoundary extends React.Component<{ children: React.ReactNode }, ReceiverErrorBoundaryState> {
    state: ReceiverErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ReceiverErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        console.error('[ReceiverApp] render error', error, info);
        // The loader overlay sits above this boundary's error card; dismiss it
        // or a render/effect crash still shows an infinite spinner.
        dismissReceiverBootLoader('error');
    }

    render(): React.ReactNode {
        if (this.state.error) {
            return (
                <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-black text-white p-8">
                    <div className="max-w-2xl text-center space-y-4">
                        <div className="text-2xl font-bold text-red-400">Receiver error</div>
                        <div className="text-sm text-zinc-300 break-words">{this.state.error.message}</div>
                        <div className="text-xs text-zinc-500 pt-4">
                            You can close this tab and try casting again from the sender.
                        </div>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

// ── Mount ────────────────────────────────────────────────────────────────────

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(
        <ReceiverErrorBoundary>
            <Root />
        </ReceiverErrorBoundary>,
    );
}