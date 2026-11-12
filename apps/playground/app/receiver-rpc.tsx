/**
 * receiver-rpc.tsx — Stateless React Chromecast receiver.
 *
 * Consumes projected `RpcSessionFrame` + authoritative `ClockSnapshot` streams
 * from `ReceiverSessionManager` with zero `ChromecastProxyRuntime` or
 * `ProxyBlock` stubs. Auto-fades interactive button chrome after 5s of D-pad
 * inactivity while keeping focusable buttons mounted in the DOM.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CAST_NAMESPACE } from '@/types/cast/messages';
import type { WebRTCSignalMessage } from '@/types/cast/messages';
import { ReceiverCastSignaling } from '@/services/cast/CastSignaling';
import { WebRtcRpcTransport, type ISignaling } from '@/services/cast/rpc/WebRtcRpcTransport';
import type {
  RpcLibraryState,
  RpcSessionFrame,
  WorkbenchDisplayState,
} from '@/services/cast/rpc/RpcMessages';
import type { CastReceiverContextLike } from '@/types/cast/sdk';
import {
  createReceiverSession,
  type ReceiverSessionHandle,
} from '@/services/cast/rpc/ReceiverSessionManager';
import type { IRpcTransport } from '@/services/cast/rpc/IRpcTransport';
import { PanelSizeProvider } from '@/panels/panel-system/PanelSizeContext';
import { ReceiverTimerPanel } from '@/panels/wallclock-panel-chromecast';
import { ReceiverPreviewPanel } from '@/panels/preview-panel-chromecast';
import { ReceiverLibraryPanel } from '@/panels/library-panel-chromecast';
import { ReceiverReviewPanel } from '@/panels/review-panel-chromecast';
import { useSpatialNavigation } from '@/hooks/useSpatialNavigation';
import {
  ClockCommandBoard,
  ClockControlModeToggle,
  ClockKeyCheckDialog,
} from '@/clock/ClockCommandBoard';
import {
  applyEntryKey,
  getClockDraft,
  parseClockDraftValue,
  writeClockDraft,
} from '@/clock/clockCommands';
import type { ClockCommand, ClockKeyAction, ClockSnapshot } from '@/clock/clockCommands';
import { audioService } from '@/services/AudioService';
import { telemetry, engagementMs } from '@/services/telemetry';
import {
  armReceiverBootFallback,
  dismissReceiverBootLoader,
  RECEIVER_BOOT_DEGRADED_STATUS,
  RECEIVER_BOOT_READY_TIMEOUT_MS,
} from '@/services/cast/receiverBootLoader';
import '@/index.css';

const IDLE_CHROME_FADE_MS = 5000;

const ReceiverApp: React.FC = () => {
  const [sessionConnected, setSessionConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('waiting-for-cast');
  const [workbenchState, setWorkbenchState] = useState<WorkbenchDisplayState>({ mode: 'idle' });
  const [sessionFrame, setSessionFrame] = useState<RpcSessionFrame | null>(null);
  const [library, setLibrary] = useState<RpcLibraryState | null>(null);
  const [clockSnapshot, setClockSnapshot] = useState<ClockSnapshot | null>(null);
  const [controlsIdleHidden, setControlsIdleHidden] = useState(false);
  const [dpadFlash, setDpadFlash] = useState(false);
  const [keyCheckOpen, setKeyCheckOpen] = useState(false);

  const transportRef = useRef<IRpcTransport | null>(null);
  const activeSessionHandleRef = useRef<ReceiverSessionHandle | null>(null);
  const bootFadeTimerRef = useRef<Parameters<typeof clearTimeout>[0]>(undefined);
  const bootTimeoutRef = useRef<Parameters<typeof clearTimeout>[0]>(undefined);
  const idleControlsTimerRef = useRef<Parameters<typeof clearTimeout>[0]>(undefined);

  const clockSnapshotRef = useRef<ClockSnapshot | null>(null);
  clockSnapshotRef.current = clockSnapshot;
  const workbenchStateRef = useRef(workbenchState);
  workbenchStateRef.current = workbenchState;

  const lastModeRef = useRef<string | null>(null);
  const lastTitleRef = useRef<string | undefined>(undefined);
  const modeStartRef = useRef<number>(Date.now());
  const signalingRef = useRef<ReceiverCastSignaling | null>(null);

  const libraryVisible =
    library !== null &&
    library.entries.length > 0 &&
    (!sessionConnected ||
      workbenchState.mode === 'idle' ||
      (workbenchState.mode === 'preview' &&
        (!workbenchState.previewData || workbenchState.previewData.blocks.length === 0)));

  const wakeRemoteControls = useCallback(() => {
    setControlsIdleHidden(false);
    clearTimeout(idleControlsTimerRef.current);
    if (workbenchStateRef.current.mode === 'active') {
      idleControlsTimerRef.current = setTimeout(() => {
        setControlsIdleHidden(true);
      }, IDLE_CHROME_FADE_MS);
    }
  }, []);

  useEffect(() => {
    if (workbenchState.mode !== 'active') {
      clearTimeout(idleControlsTimerRef.current);
      setControlsIdleHidden(false);
      return undefined;
    }
    wakeRemoteControls();
    const onActivity = () => wakeRemoteControls();
    window.addEventListener('keydown', onActivity, true);
    window.addEventListener('pointerdown', onActivity, true);
    return () => {
      clearTimeout(idleControlsTimerRef.current);
      window.removeEventListener('keydown', onActivity, true);
      window.removeEventListener('pointerdown', onActivity, true);
    };
  }, [workbenchState.mode, wakeRemoteControls]);

  const sendEvent = useCallback((eventName: string, data?: unknown) => {
    activeSessionHandleRef.current?.sendEvent(eventName, data);
  }, []);

  const sendCommand = useCallback((command: ClockCommand) => {
    const handle = activeSessionHandleRef.current;
    const snapshot = clockSnapshotRef.current;
    if (!handle || !snapshot) return;
    handle.sendEvent('clock-command', { runId: snapshot.runId, command });
  }, []);

  const sendSelectBlock = useCallback(
    (blockId: string, index: number) => {
      sendEvent('select-block', { blockId, index });
    },
    [sendEvent],
  );

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
    clearTimeout(bootFadeTimerRef.current);
    bootFadeTimerRef.current = setTimeout(() => {
      loader.style.display = 'none';
      bootFadeTimerRef.current = undefined;
    }, 500);
  }, []);

  const dismissToWaiting = useCallback(() => {
    sendEvent('dismiss');
    setWorkbenchState({ mode: 'idle' });
  }, [sendEvent]);

  const dismissReview = useCallback(() => {
    if (clockSnapshotRef.current) {
      sendCommand({ kind: 'dismiss' });
      return;
    }
    dismissToWaiting();
  }, [sendCommand, dismissToWaiting]);

  const dispatchBoardCommand = useCallback(
    (command: ClockCommand) => {
      sendCommand(command);
      return true;
    },
    [sendCommand],
  );

  const { getFocusProps, setFocusedId } = useSpatialNavigation({
    enabled: sessionConnected,
    initialFocusId:
      workbenchState.mode === 'preview'
        ? 'preview-block-0'
        : workbenchState.mode === 'review'
          ? 'btn-dismiss'
          : 'btn-next',
    entryOpen: clockSnapshot?.entry != null,
    onClockAction: useCallback(
      (
        action: Extract<
          ClockKeyAction,
          { kind: 'playback' | 'cancel' | 'values' | 'reps-adjust' | 'primary' | 'digit' | 'back' }
        >,
      ) => {
        flash();
        wakeRemoteControls();
        switch (action.kind) {
          case 'playback':
            sendCommand({ kind: 'playback' });
            return;
          case 'cancel':
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
            const selected = clockSnapshotRef.current?.selectedOccurrenceId;
            if (selected) {
              sendCommand({ kind: 'reps-adjust', occurrenceId: selected, delta: action.delta });
            }
            return;
          }
          case 'digit':
            if (clockSnapshotRef.current?.entry) {
              writeClockDraft(
                applyEntryKey(clockSnapshotRef.current.entry.domain, getClockDraft(), action.digit),
              );
            }
            return;
          case 'back':
            if (clockSnapshotRef.current?.entry) {
              writeClockDraft(
                applyEntryKey(clockSnapshotRef.current.entry.domain, getClockDraft(), 'back'),
              );
            }
            return;
          case 'primary': {
            const snapshot = clockSnapshotRef.current;
            if (!snapshot) return;
            if (snapshot.entry) {
              const parsed = parseClockDraftValue(getClockDraft(), snapshot.entry.domain);
              if (parsed.ok) {
                sendCommand({
                  kind: 'entry-save',
                  fieldId: snapshot.entry.fieldId,
                  value: parsed.value,
                });
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
            sendCommand({ kind: 'next' });
            return;
          }
        }
      },
      [flash, wakeRemoteControls, sendCommand, sendEvent],
    ),
    onFocusChanged: useCallback(() => {
      wakeRemoteControls();
      audioService.playSound('click', 0.3);
    }, [wakeRemoteControls]),
    onSelect: useCallback(
      (elementId: string, element: HTMLElement) => {
        flash();
        wakeRemoteControls();
        audioService.playSound('select', 0.5);

        if (elementId.startsWith('preview-block-')) {
          const index = Number(elementId.slice('preview-block-'.length));
          const block = workbenchStateRef.current.previewData?.blocks[index];
          if (block) {
            sendSelectBlock(block.id, index);
          }
          return;
        }
        switch (elementId) {
          case 'btn-dismiss':
            dismissReview();
            break;
          default:
            element.click();
            break;
        }
      },
      [flash, wakeRemoteControls, dismissReview, sendSelectBlock],
    ),
  });

  const renderClockBoard = () =>
    clockSnapshot ? (
      <div className="absolute inset-x-0 bottom-0 flex w-full shrink-0 justify-center px-10 pb-6">
        <ClockCommandBoard
          snapshot={clockSnapshot}
          dispatch={dispatchBoardCommand}
          getFocusProps={getFocusProps}
        />
      </div>
    ) : null;

  useEffect(() => {
    if (libraryVisible) {
      setFocusedId('library-0');
      return;
    }
    if (clockSnapshot?.entry) {
      setFocusedId('entry-digit-1');
      return;
    }
    if (clockSnapshot?.phase === 'ready') {
      setFocusedId('board-ready-start');
      return;
    }
    if (workbenchState.mode === 'preview') {
      if (workbenchState.previewData && workbenchState.previewData.blocks.length > 0) {
        setFocusedId('preview-block-0');
      }
    } else if (workbenchState.mode === 'active') {
      setFocusedId(clockSnapshot?.entry ? 'entry-digit-1' : 'btn-next');
    } else if (workbenchState.mode === 'review') {
      setFocusedId('btn-dismiss');
    }
  }, [
    libraryVisible,
    workbenchState.mode,
    workbenchState.previewData,
    clockSnapshot?.entry,
    clockSnapshot?.phase,
    setFocusedId,
  ]);

  const effectiveTitle = sessionFrame?.workoutTitle ?? workbenchState.previewData?.title;

  useEffect(() => {
    const currentMode = workbenchState.mode;
    const currentTitle = effectiveTitle;

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

    if (prevMode && durationMs >= 1000 && telemetry.consent) {
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
    if (telemetry.consent) {
      window.gtag?.('event', 'page_view', {
        page_title: pageTitle,
        page_path: pagePath,
        page_location: window.location.href,
        engagement_time_msec: engagementMs(),
      });
    }

    lastModeRef.current = currentMode;
    lastTitleRef.current = currentTitle;
    modeStartRef.current = now;
  }, [workbenchState.mode, effectiveTitle]);

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
      if (mode && durationMs >= 1000 && telemetry.consent) {
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

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement && target.closest('button')) {
        audioService.playSound('click', 0.5);
      }
    };
    window.addEventListener('click', handleGlobalClick, true);
    return () => window.removeEventListener('click', handleGlobalClick, true);
  }, []);

  const clearSessionRefs = useCallback(() => {
    activeSessionHandleRef.current = null;
    transportRef.current = null;
  }, []);

  const wireSession = useCallback(
    (
      handle: ReceiverSessionHandle,
      options: {
        ownsLifetime: boolean;
        transport?: IRpcTransport | null;
        disconnectedLog: string;
      },
    ): (() => void) => {
      activeSessionHandleRef.current = handle;
      if (options.transport) {
        transportRef.current = options.transport;
      }
      setSessionConnected(true);
      setConnectionStatus('connected');
      dismissBootLoader('ready');

      const unsubWorkbench = handle.onWorkbenchUpdate(setWorkbenchState);
      const unsubFrame = handle.onSessionFrame(setSessionFrame);
      const unsubLibrary = handle.onLibraryUpdate(setLibrary);
      const unsubClock = handle.onClockSnapshot(setClockSnapshot);
      const unsubDisconnect = handle.onDisconnected(() => {
        console.log(options.disconnectedLog);
        setConnectionStatus('disconnected');
        setSessionConnected(false);
        setSessionFrame(null);
        setClockSnapshot(null);
        setLibrary(null);
        if (activeSessionHandleRef.current === handle) {
          activeSessionHandleRef.current = null;
        }
        if (options.transport && transportRef.current === options.transport) {
          transportRef.current = null;
        }
      });

      return () => {
        unsubWorkbench();
        unsubFrame();
        unsubClock();
        unsubLibrary();
        unsubDisconnect();
        if (options.ownsLifetime) {
          handle.dispose();
        }
        clearSessionRefs();
      };
    },
    [dismissBootLoader, clearSessionRefs],
  );

  const setupTransport = useCallback(
    (trigger?: WebRTCSignalMessage) => {
      if (!signalingRef.current) return;
      activeSessionHandleRef.current?.dispose();
      activeSessionHandleRef.current = null;
      transportRef.current?.dispose();
      transportRef.current = null;
      setSessionConnected(false);
      setSessionFrame(null);

      const sharedSignaling = signalingRef.current;
      const signalingFacade: ISignaling = {
        send: (signal) => sharedSignaling.send(signal),
        onSignal: (handler) => sharedSignaling.onSignal(handler),
        dispose: () => {},
      };
      const transportInstance = new WebRtcRpcTransport('answerer', signalingFacade);
      if (trigger) transportInstance.receiveSignal(trigger);
      const handle = createReceiverSession(transportInstance, {
        disposeTransportOnDisconnect: true,
      });

      wireSession(handle, {
        ownsLifetime: true,
        transport: transportInstance,
        disconnectedLog: '[ReceiverApp] RPC transport disconnected — returning to waiting screen',
      });

      transportInstance.connect().catch((err: unknown) => {
        console.error('[ReceiverApp] RPC transport connect failed', err);
        setConnectionStatus('error');
      });
    },
    [wireSession],
  );

  useEffect(() => {
    const castGlobal = (
      window as unknown as {
        cast?: {
          framework?: {
            CastReceiverContext?: { getInstance(): CastReceiverContextLike };
            system?: { EventType?: { READY?: string } };
          };
        };
      }
    ).cast;
    const castContext = castGlobal?.framework?.CastReceiverContext?.getInstance();
    if (!castContext) {
      setConnectionStatus('error: no Cast SDK');
      const bootMsg = document.getElementById('booting-msg');
      if (bootMsg) bootMsg.textContent = 'Receiver error: Cast SDK did not load';
      dismissBootLoader('error');
      return undefined;
    }
    castContext.start({
      customNamespaces: {
        [CAST_NAMESPACE]: 'JSON',
      },
      disableIdleTimeout: true,
    });
    setConnectionStatus('cast-ready');

    const readyEvent = castGlobal?.framework?.system?.EventType?.READY;
    if (readyEvent) {
      castContext.addEventListener(readyEvent, () => {
        dismissBootLoader('ready');
        clearTimeout(bootTimeoutRef.current);
        bootTimeoutRef.current = undefined;
        signalingRef.current?.send({ type: 'cast-ready' });
      });
    }
    bootTimeoutRef.current = armReceiverBootFallback(() => {
      setConnectionStatus(RECEIVER_BOOT_DEGRADED_STATUS);
      dismissBootLoader('timeout');
    }, RECEIVER_BOOT_READY_TIMEOUT_MS);

    const signaling = new ReceiverCastSignaling(castContext);
    signalingRef.current = signaling;
    signaling.onSignal((signal) => {
      if (signal.type === 'webrtc-offer') {
        setupTransport(signal);
      }
    });
    return () => {
      clearTimeout(bootTimeoutRef.current);
      bootTimeoutRef.current = undefined;
      clearTimeout(bootFadeTimerRef.current);
      bootFadeTimerRef.current = undefined;
      activeSessionHandleRef.current?.dispose();
      transportRef.current?.dispose();
      signaling.dispose();
      signalingRef.current = null;
      clearSessionRefs();
    };
  }, [setupTransport, dismissBootLoader, clearSessionRefs]);

  if (libraryVisible && library) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-black text-white">
        {dpadFlash && (
          <div className="pointer-events-none fixed inset-0 z-50 bg-primary/10 animate-in fade-in duration-150" />
        )}
        <ReceiverLibraryPanel
          library={library}
          onOpenNotebook={(href) => sendEvent('open-notebook', { href })}
          getFocusProps={getFocusProps}
        />
        <div className="absolute bottom-2 right-2 font-mono text-[8px] uppercase tracking-tighter opacity-10">
          {connectionStatus}
        </div>
      </div>
    );
  }

  if (!sessionConnected || workbenchState.mode === 'idle') {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-black font-mono uppercase tracking-[0.5em] text-white/60">
        <div className="animate-pulse">Wod.Wiki // {connectionStatus}</div>
        <div className="mt-8 flex items-center gap-4 font-mono tracking-normal normal-case">
          <ClockControlModeToggle className="font-mono text-xs text-white/50" />
          <button
            type="button"
            onClick={() => setKeyCheckOpen(true)}
            className="font-mono text-xs text-white/50 underline underline-offset-4 hover:text-white/80"
          >
            Key check
          </button>
        </div>
        <ClockKeyCheckDialog open={keyCheckOpen} onClose={() => setKeyCheckOpen(false)} />
      </div>
    );
  }

  if (workbenchState.mode === 'preview' && workbenchState.previewData) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        {dpadFlash && (
          <div className="pointer-events-none fixed inset-0 z-50 bg-primary/10 animate-in fade-in duration-150" />
        )}
        <ReceiverPreviewPanel
          previewData={workbenchState.previewData}
          getFocusProps={getFocusProps}
          onBlockSelect={(blockId, index) => sendSelectBlock(blockId, index)}
        />
        {renderClockBoard()}
        <div className="absolute bottom-2 right-2 font-mono text-[8px] uppercase tracking-tighter opacity-10">
          {connectionStatus}
        </div>
      </div>
    );
  }

  if (workbenchState.mode === 'review' && workbenchState.reviewData) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        {dpadFlash && (
          <div className="pointer-events-none fixed inset-0 z-50 bg-primary/10 animate-in fade-in duration-150" />
        )}
        <ReceiverReviewPanel
          reviewData={workbenchState.reviewData}
          analyticsSummary={workbenchState.analyticsSummary}
          onDismiss={dismissReview}
          getFocusProps={getFocusProps}
        />
        {renderClockBoard()}
        <div className="absolute bottom-2 right-2 font-mono text-[8px] uppercase tracking-tighter opacity-10">
          {connectionStatus}
        </div>
      </div>
    );
  }

  return (
    <PanelSizeProvider>
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        {dpadFlash && (
          <div className="pointer-events-none fixed inset-0 z-50 bg-primary/10 animate-in fade-in duration-150" />
        )}
        <ReceiverTimerPanel
          sessionFrame={sessionFrame}
          getSenderNowMs={() => activeSessionHandleRef.current?.getSenderNowMs() ?? Date.now()}
          controlsIdleHidden={controlsIdleHidden}
          snapshot={clockSnapshot}
          sendCommand={sendCommand}
          getFocusProps={getFocusProps}
          workoutTitle={effectiveTitle}
        />
        <div className="absolute bottom-2 right-2 font-mono text-[8px] uppercase tracking-tighter opacity-10">
          {connectionStatus}
        </div>
      </div>
    </PanelSizeProvider>
  );
};

interface ReceiverErrorBoundaryState {
  error: Error | null;
}

class ReceiverErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ReceiverErrorBoundaryState
> {
  state: ReceiverErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ReceiverErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ReceiverApp] render error', error, info);
    dismissReceiverBootLoader('error');
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen w-screen flex-col items-center justify-center bg-black p-8 text-white">
          <div className="max-w-2xl space-y-4 text-center">
            <div className="text-2xl font-bold text-red-400">Receiver error</div>
            <div className="break-words text-sm text-zinc-300">{this.state.error.message}</div>
            <div className="pt-4 text-xs text-zinc-500">
              You can close this tab and try casting again from the sender.
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <ReceiverErrorBoundary>
      <ReceiverApp />
    </ReceiverErrorBoundary>,
  );
}
