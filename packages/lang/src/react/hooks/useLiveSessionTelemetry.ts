import { useEffect, useMemo, useState } from 'react';
import { useOptionalScriptRuntime } from '../context/RuntimeContext';
import type { IScriptRuntime } from '../../runtime/contracts/IScriptRuntime';
import {
  projectLiveSessionTelemetry,
  type LiveSessionTelemetryFrame,
} from '../../runtime/projection/LiveSessionTelemetry';

/**
 * Reactive React hook over `projectLiveSessionTelemetry`.
 *
 * Updates whenever the runtime emits a segment or live analytics change signal.
 */
export function useLiveSessionTelemetry(
  runtimeOverride?: IScriptRuntime | null,
): LiveSessionTelemetryFrame {
  const contextRuntime = useOptionalScriptRuntime();
  const runtime = runtimeOverride !== undefined ? runtimeOverride : contextRuntime;
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!runtime) {
      setVersion(0);
      return undefined;
    }
    return runtime.subscribeToOutput?.(() => {
      setVersion((v) => v + 1);
    });
  }, [runtime]);

  return useMemo(() => {
    void version;
    return projectLiveSessionTelemetry(runtime);
  }, [runtime, version]);
}
