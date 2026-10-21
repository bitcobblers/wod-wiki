/**
 * ReceiverSessionManager — receiver-side session orchestration.
 *
 * Owns the receiver half of the cast stack. Given a connected
 * `IRpcTransport`, it:
 *
 *   1. Builds a `ChromecastProxyRuntime` against the transport.
 *   2. Routes `rpc-audio` messages to the local `AudioService`
 *      (so the receiver plays the same cues as the sender).
 *   3. Subscribes to the runtime's workbench stream and exposes a
 *      single `onWorkbenchUpdate(handler)` stream for the React
 *      tree. Without this, every component that wants the workbench
 *      state would have to reach into the runtime's subscribe API.
 *   4. Surfaces transport disconnect through `onDisconnected(handler)`
 *      so the React tree can reset to the waiting screen.
 *
 * Two callers converge here:
 *   - `LocalReceiverApp` (local-tab dual-pane mirror): acquires a
 *     `BroadcastChannelRpcTransport` via `acquireLocalReceiverSession`,
 *     then hands it to `createReceiverSession`.
 *   - `ReceiverApp` (chromecast path): receives a WebRTC offer over
 *     CAF, creates a `WebRtcRpcTransport`, hands it to
 *     `createReceiverSession`.
 *
 * `dispose()` tears down the runtime, audio listener, workbench
 * stream, and disconnect subscriptions. The transport itself is
 * left to its owner (the React tree, the CAF signaling, or the
 * local-tab adapter).
 */

import { audioService } from '@/services/AudioService';
import { ChromecastProxyRuntime, type WorkbenchDisplayState } from './ChromecastProxyRuntime';
import { isRpcClockSnapshot } from './RpcMessages';
import type { ClockSnapshot } from '@/clock/clockCommands';
import type { IRpcTransport, RpcUnsubscribe } from './IRpcTransport';

/**
 * The handle a connected receiver session returns to its caller.
 *
 * Exposes:
 *   - `runtime` — the `ChromecastProxyRuntime` the React tree renders
 *     against.
 *   - `onDisconnected(handler)` — register a callback fired when the
 *     sender drops the transport. Returns the unsubscribe function so
 *     callers don't have to track the handler themselves.
 *   - `onWorkbenchUpdate(handler)` — register a callback fired on
 *     every workbench state push from the sender. The handler is
 *     called immediately with the current state, then on every
 *     update. Returns the unsubscribe function.
 *   - `dispose()` — tear down the session. Idempotent.
 */
export interface ReceiverSessionHandle {
    readonly runtime: ChromecastProxyRuntime;
    onDisconnected(handler: () => void): () => void;
    onWorkbenchUpdate(handler: (state: WorkbenchDisplayState) => void): () => void;
    /**
     * Subscribe to the sender's clock-authority snapshot. The handler fires
     * immediately with the latest known snapshot (possibly `null`), then on
     * every `rpc-clock-snapshot` push. `null` = no active run: commands are
     * disabled and none may be replayed.
     */
    onClockSnapshot(handler: (snapshot: ClockSnapshot | null) => void): () => void;
    /** Latest known clock snapshot, or `null` when none has arrived. */
    getClockSnapshot(): ClockSnapshot | null;
    dispose(): void;
}

/**
 * Options for a single `createReceiverSession()` call.
 */
export interface ReceiverSessionOptions {
    /**
     * Enable the audio service on connect. Defaults to `true` — both
     * backends (chromecast and local-tab) want sound by default. Tests
     * that don't want audio side-effects set this to `false`.
     */
    audio?: boolean;
}

/**
 * Dependencies the receiver session needs. Production wires up the
 * defaults; tests inject fakes. Kept narrow so the unit-test surface
 * is obvious.
 */
export interface ReceiverSessionDeps {
    createRuntime: (transport: IRpcTransport) => ChromecastProxyRuntime;
    playAudio: (name: string, volume: number) => void;
    setAudioEnabled: (enabled: boolean) => void;
}

const defaultDeps: ReceiverSessionDeps = {
    createRuntime: (transport) => new ChromecastProxyRuntime(transport),
    playAudio: (name, volume) => audioService.playSound(name, volume),
    setAudioEnabled: (enabled) => audioService.setEnabled(enabled),
};

/**
 * Create a receiver session bound to the supplied transport.
 *
 * Steps:
 *   1. Build a `ChromecastProxyRuntime` against the transport.
 *   2. Subscribe to `rpc-audio` messages and route them to the
 *      audio service. This is a one-line `onMessage` handler — a
 *      dedicated `EventProvider` would be overkill.
 *   3. Bridge the runtime's workbench subscription into a single
 *      observer stream on the handle.
 *   4. (Optionally) enable the audio service so the receiver has
 *      sound on by default.
 *
 * The returned handle lets the caller register disconnect and
 * workbench handlers, and dispose the session when the React tree
 * unmounts.
 *
 * The transport is NOT disposed by `dispose()`. The transport's
 * lifetime is managed by the caller (the chromecast signaling path
 * reuses the transport across offers; the local-tab adapter owns
 * the underlying port).
 */
export function createReceiverSession(
    transport: IRpcTransport,
    options: ReceiverSessionOptions = {},
    deps: ReceiverSessionDeps = defaultDeps,
): ReceiverSessionHandle {
    const audioEnabled = options.audio ?? true;
    const runtime = deps.createRuntime(transport);

    const audioUnsub = transport.onMessage((msg) => {
        if (msg.type === 'rpc-audio') {
            deps.playAudio(msg.name, msg.volume ?? 1);
        }
    });

    // Workbench updates are pushed by the runtime's own subscription
    // mechanism. We register exactly one listener against the
    // runtime, then fan out to the handle's listeners. This keeps
    // the runtime's listener set bounded regardless of how many
    // components subscribe via the handle.
    const workbenchListeners = new Set<(state: WorkbenchDisplayState) => void>();
    runtime.subscribeToWorkbench((state) => {
        for (const listener of workbenchListeners) listener(state);
    });

    if (audioEnabled) {
        deps.setAudioEnabled(true);
    }

    const disconnectHandlers = new Set<() => void>();
    const transportDisconnectedUnsub: RpcUnsubscribe = transport.onDisconnected(() => {
        for (const handler of disconnectHandlers) handler();
    });

// ============================================================================
// Clock snapshot stream (browser → receiver)
// ============================================================================
// The sender pushes `rpc-clock-snapshot` messages whenever the authoritative
// clock controller publishes state (and once on connect). The session keeps
// the latest snapshot so late React subscribers see current state immediately,
// and fans new snapshots out to every subscriber. `null` snapshots are real
// data ("no active run") — they must disable receiver commands.

    const clockSnapshotListeners = new Set<(snapshot: ClockSnapshot | null) => void>();
    let latestClockSnapshot: ClockSnapshot | null = null;
    const clockUnsub = transport.onMessage((msg) => {
        if (!isRpcClockSnapshot(msg)) return;
        latestClockSnapshot = msg.snapshot;
        for (const listener of clockSnapshotListeners) listener(msg.snapshot);
    });

    let disposed = false;
    return {
        runtime,
        onDisconnected(handler) {
            if (disposed) return () => {};
            disconnectHandlers.add(handler);
            return () => disconnectHandlers.delete(handler);
        },
        onWorkbenchUpdate(handler) {
            if (disposed) return () => {};
            workbenchListeners.add(handler);
            return () => workbenchListeners.delete(handler);
        },
        onClockSnapshot(handler) {
            if (disposed) return () => {};
            clockSnapshotListeners.add(handler);
            // Immediate replay of the latest known snapshot so components
            // mounting mid-run (mode switches, reconnects) render accurate
            // state instead of a disabled flash.
            handler(latestClockSnapshot);
            return () => clockSnapshotListeners.delete(handler);
        },
        getClockSnapshot() {
            return latestClockSnapshot;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            audioUnsub();
            clockUnsub();
            transportDisconnectedUnsub();
            disconnectHandlers.clear();
            workbenchListeners.clear();
            clockSnapshotListeners.clear();
            runtime.dispose();
        },
    };
}
