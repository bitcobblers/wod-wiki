/**
 * SessionCastProjector — sender-side Session frame adapter over `IRpcTransport`.
 *
 * Shares `observeSessionClockInputs` with `useSessionClockProjection` and streams
 * one fingerprinted `RpcSessionFrame` to the stateless Chromecast receiver.
 */

import {
  observeSessionClockInputs,
  projectLiveSessionTelemetry,
  projectSessionClock,
  synthesizeWorkoutFormat,
  type IScriptRuntime,
  type SessionExecutionStatus,
} from '@bitcobblers/wod-wiki-engine';
import type { IRpcTransport } from './IRpcTransport';
import type { RpcSessionFrame } from './RpcMessages';

export interface SessionCastProjectorOptions {
  readonly workoutTitle?: string;
  readonly workoutFormat?: string;
  readonly getExecutionStatus?: () => SessionExecutionStatus;
  readonly getCanNext?: () => boolean | undefined;
}

function computeFrameFingerprint(payload: RpcSessionFrame): string {
  const f = payload.frame;
  const structuralClock = {
    mainLabel: f.mainLabel,
    subLabels: f.subLabels,
    direction: f.direction,
    durationMs: f.durationMs,
    activeSpans: f.activeSpans,
    basePolarity: f.basePolarity,
    required: f.required,
    sessionSpans: f.sessionSpans,
    roundCurrent: f.roundCurrent,
    roundTotal: f.roundTotal,
    roundLabel: f.roundLabel,
    secondaryTimers: f.secondaryTimers.map((st) => ({
      id: st.id,
      label: st.label,
      direction: st.direction,
      durationMs: st.durationMs,
      spans: st.spans,
    })),
    upNext: f.upNext,
    repTargets: f.repTargets,
    isRunning: f.isRunning,
    isPaused: f.isPaused,
    isNextDisabled: f.isNextDisabled,
    skipFlash: f.skipFlash,
    skipFlashKey: f.skipFlashKey,
  };
  return JSON.stringify({
    workoutTitle: payload.workoutTitle,
    workoutFormat: payload.workoutFormat,
    clock: structuralClock,
    telemetry: payload.telemetry,
  });
}

export function attachSessionCastProjector(
  runtime: IScriptRuntime,
  transport: IRpcTransport,
  options: SessionCastProjectorOptions = {},
): () => void {
  let skipFlash = false;
  let skipFlashKey = 0;
  let lastFingerprint = '';
  let disposed = false;

  const resolvedFormat =
    options.workoutFormat ?? synthesizeWorkoutFormat(runtime.script);

  const pushFrame = () => {
    if (disposed || !transport.connected) return;
    const status = options.getExecutionStatus?.() ?? 'running';
    const frame = projectSessionClock(runtime, {
      executionStatus: status,
      canNextOverride: options.getCanNext?.(),
      skipFlash,
      skipFlashKey,
    });
    const telemetry = projectLiveSessionTelemetry(runtime);
    const message: RpcSessionFrame = {
      type: 'rpc-session-frame',
      frame,
      telemetry,
      ...(options.workoutTitle ? { workoutTitle: options.workoutTitle } : {}),
      ...(resolvedFormat ? { workoutFormat: resolvedFormat } : {}),
    };
    const fingerprint = computeFrameFingerprint(message);
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    try {
      transport.send(message);
    } catch {
      // Transport disconnect handles teardown independently.
    }
  };

  pushFrame();

  const unsubInputs = observeSessionClockInputs(runtime, (signal) => {
    skipFlash = signal.skipFlash;
    skipFlashKey = signal.skipFlashKey;
    pushFrame();
  });
  const unsubOutput = runtime.subscribeToOutput(() => {
    pushFrame();
  });
  const unsubConnected = transport.onConnected(() => {
    lastFingerprint = '';
    pushFrame();
  });

  return () => {
    disposed = true;
    unsubInputs();
    unsubOutput();
    unsubConnected();
  };
}
