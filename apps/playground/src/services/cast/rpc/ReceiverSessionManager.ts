/**
 * ReceiverSessionManager — stateless receiver-side session orchestration.
 *
 * Replaces `ChromecastProxyRuntime` + `ProxyBlock` completely. Given a
 * connected `IRpcTransport`, this module owns:
 *   1. `rpc-audio` routing to the local `AudioService`
 *   2. Clock offset handshake (`rpc-clock-sync-request` / `rpc-clock-sync-result`)
 *   3. Workbench display state (`rpc-workbench-update` + `rpc-analytics-summary`),
 *      preserving `previewData` title across `mode: 'active'` transitions
 *   4. Projected Session frames (`rpc-session-frame`)
 *   5. Authoritative clock snapshots (`rpc-clock-snapshot`)
 *   6. Library catalog listings (`rpc-library-state`)
 *   7. Outbound `rpc-event` dispatch back to the browser authority
 */

import { wallClockNow, type INowProvider } from '@bitcobblers/wod-wiki-engine';
import { audioService } from '@/services/AudioService';
import type { ClockSnapshot } from '@/clock/clockCommands';
import type { IRpcTransport, RpcUnsubscribe } from './IRpcTransport';
import {
  isRpcClockSnapshot,
  isRpcLibraryState,
  isRpcSessionFrame,
  type RpcLibraryState,
  type RpcMessage,
  type RpcSessionFrame,
  type WorkbenchDisplayState,
} from './RpcMessages';

export interface ReceiverSessionHandle {
  onDisconnected(handler: () => void): () => void;
  onWorkbenchUpdate(handler: (state: WorkbenchDisplayState) => void): () => void;
  getWorkbenchState(): WorkbenchDisplayState;
  onSessionFrame(handler: (frame: RpcSessionFrame | null) => void): () => void;
  getSessionFrame(): RpcSessionFrame | null;
  onClockSnapshot(handler: (snapshot: ClockSnapshot | null) => void): () => void;
  getClockSnapshot(): ClockSnapshot | null;
  onLibraryUpdate(handler: (library: RpcLibraryState | null) => void): () => void;
  sendEvent(name: string, data?: unknown): void;
  getSenderNowMs(): number;
  dispose(): void;
}

export interface ReceiverSessionOptions {
  audio?: boolean;
  disposeTransportOnDisconnect?: boolean;
}

export interface ReceiverSessionDeps {
  now?: INowProvider;
  playAudio: (name: string, volume: number) => void;
  setAudioEnabled: (enabled: boolean) => void;
}

const defaultDeps: ReceiverSessionDeps = {
  now: wallClockNow,
  playAudio: (name, volume) => audioService.playSound(name, volume),
  setAudioEnabled: (enabled) => audioService.setEnabled(enabled),
};

export function createReceiverSession(
  transport: IRpcTransport,
  options: ReceiverSessionOptions = {},
  deps: ReceiverSessionDeps = defaultDeps,
): ReceiverSessionHandle {
  const nowProvider = deps.now ?? wallClockNow;
  const audioEnabled = options.audio ?? true;
  if (audioEnabled) {
    deps.setAudioEnabled(true);
  }

  let disposed = false;
  let clockOffsetMs = 0;
  let workbenchState: WorkbenchDisplayState = { mode: 'idle' };
  let latestSessionFrame: RpcSessionFrame | null = null;
  let latestClockSnapshot: ClockSnapshot | null = null;
  let latestLibrary: RpcLibraryState | null = null;

  const disconnectHandlers = new Set<() => void>();
  const workbenchListeners = new Set<(state: WorkbenchDisplayState) => void>();
  const sessionFrameListeners = new Set<(frame: RpcSessionFrame | null) => void>();
  const clockSnapshotListeners = new Set<(snapshot: ClockSnapshot | null) => void>();
  const libraryListeners = new Set<(library: RpcLibraryState | null) => void>();

  const notifyWorkbench = () => {
    for (const listener of workbenchListeners) listener(workbenchState);
  };

  const notifySessionFrame = () => {
    for (const listener of sessionFrameListeners) listener(latestSessionFrame);
  };

  const messageUnsub: RpcUnsubscribe = transport.onMessage((msg: RpcMessage) => {
    if (disposed) return;

    if (msg.type === 'rpc-audio') {
      deps.playAudio(msg.name, msg.volume ?? 1);
      return;
    }

    if (msg.type === 'rpc-clock-sync-request') {
      transport.send({
        type: 'rpc-clock-sync-response',
        requestTimestamp: msg.timestamp,
        receiverTimestamp: nowProvider.nowMs(),
      });
      return;
    }

    if (msg.type === 'rpc-clock-sync-result') {
      clockOffsetMs = msg.offsetMs;
      return;
    }

    if (msg.type === 'rpc-workbench-update') {
      // Preserve previewData when transitioning into 'active' without a new
      // previewData payload so workoutTitle never blanks out mid-workout.
      const nextPreviewData =
        msg.previewData !== undefined
          ? msg.previewData
          : msg.mode === 'active' || msg.mode === 'review'
            ? workbenchState.previewData
            : undefined;
      workbenchState = {
        mode: msg.mode,
        ...(nextPreviewData ? { previewData: nextPreviewData } : {}),
        ...(msg.reviewData ? { reviewData: msg.reviewData } : {}),
      };
      if (msg.mode === 'idle') {
        latestSessionFrame = null;
        notifySessionFrame();
      }
      notifyWorkbench();
      return;
    }

    if (msg.type === 'rpc-analytics-summary') {
      workbenchState = {
        ...workbenchState,
        analyticsSummary: {
          totalDurationMs: msg.totalDurationMs,
          completedSegments: msg.completedSegments,
          projections: msg.projections,
        },
      };
      notifyWorkbench();
      return;
    }

    if (isRpcSessionFrame(msg)) {
      latestSessionFrame = msg;
      notifySessionFrame();
      return;
    }

    if (isRpcClockSnapshot(msg)) {
      latestClockSnapshot = msg.snapshot;
      for (const listener of clockSnapshotListeners) listener(msg.snapshot);
      return;
    }

    if (isRpcLibraryState(msg)) {
      latestLibrary = msg;
      for (const listener of libraryListeners) listener(msg);
      return;
    }

    if (msg.type === 'rpc-dispose') {
      transport.dispose();
      handle.dispose();
    }
  });

  const transportDisconnectedUnsub: RpcUnsubscribe = transport.onDisconnected(() => {
    if (options.disposeTransportOnDisconnect) {
      transport.dispose();
    }
    latestSessionFrame = null;
    latestClockSnapshot = null;
    for (const handler of disconnectHandlers) handler();
  });

  const handle: ReceiverSessionHandle = {
    onDisconnected(handler) {
      if (disposed) return () => {};
      disconnectHandlers.add(handler);
      return () => disconnectHandlers.delete(handler);
    },
    onWorkbenchUpdate(handler) {
      if (disposed) return () => {};
      workbenchListeners.add(handler);
      handler(workbenchState);
      return () => workbenchListeners.delete(handler);
    },
    getWorkbenchState() {
      return workbenchState;
    },
    onSessionFrame(handler) {
      if (disposed) return () => {};
      sessionFrameListeners.add(handler);
      handler(latestSessionFrame);
      return () => sessionFrameListeners.delete(handler);
    },
    getSessionFrame() {
      return latestSessionFrame;
    },
    onClockSnapshot(handler) {
      if (disposed) return () => {};
      clockSnapshotListeners.add(handler);
      handler(latestClockSnapshot);
      return () => clockSnapshotListeners.delete(handler);
    },
    getClockSnapshot() {
      return latestClockSnapshot;
    },
    onLibraryUpdate(handler) {
      if (disposed) return () => {};
      libraryListeners.add(handler);
      handler(latestLibrary);
      return () => libraryListeners.delete(handler);
    },
    sendEvent(name: string, data?: unknown) {
      if (disposed || !transport.connected) return;
      transport.send({
        type: 'rpc-event',
        name,
        timestamp: nowProvider.nowMs(),
        data,
      });
    },
    getSenderNowMs() {
      return nowProvider.nowMs() - clockOffsetMs;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      messageUnsub();
      transportDisconnectedUnsub();
      disconnectHandlers.clear();
      workbenchListeners.clear();
      sessionFrameListeners.clear();
      clockSnapshotListeners.clear();
      libraryListeners.clear();
      latestSessionFrame = null;
      latestClockSnapshot = null;
      latestLibrary = null;
    },
  };

  return handle;
}
