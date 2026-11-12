/**
 * useSessionCastBridge — single-owner React hook bridging an active workout
 * `IScriptRuntime` + `WorkoutRunIdentity` to `attachSessionCastProjector` over
 * the active `IRpcTransport`.
 */

import { useEffect, useState } from 'react';
import type { IScriptRuntime, SessionExecutionStatus } from '@bitcobblers/wod-wiki-engine';
import {
  attachSessionCastProjector,
  getActiveCastTransport,
  onCastTransportChange,
  type IRpcTransport,
} from '@/hooks/useCastSignaling';
import type { WorkoutRunIdentity } from '@/app/editor/SessionRunHost';

export function useSessionCastBridge(options: {
  readonly runtime: IScriptRuntime | null;
  readonly identity: WorkoutRunIdentity;
  readonly executionStatus: SessionExecutionStatus | 'error';
  readonly canNext?: boolean;
}): IRpcTransport | null {
  const [castTransport, setCastTransport] = useState<IRpcTransport | null>(() =>
    getActiveCastTransport(),
  );

  useEffect(() => onCastTransportChange(setCastTransport), []);

  useEffect(() => {
    if (!options.runtime || !castTransport) return undefined;
    return attachSessionCastProjector(options.runtime, castTransport, {
      workoutTitle: options.identity.workoutTitle,
      workoutFormat: options.identity.workoutFormat,
      getExecutionStatus: () =>
        options.executionStatus === 'error' ? 'idle' : options.executionStatus,
      getCanNext: () => options.canNext,
    });
  }, [
    options.runtime,
    castTransport,
    options.identity.workoutTitle,
    options.identity.workoutFormat,
    options.executionStatus,
    options.canNext,
  ]);

  return castTransport;
}
