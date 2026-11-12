import { useEffect, useMemo, useState } from 'react';
import { useOptionalScriptRuntime } from '../context/RuntimeContext';
import type { IScriptRuntime } from '../../runtime/contracts/IScriptRuntime';
import {
  projectScriptOutline,
  type ScriptOutlineNode,
} from '../../runtime/projection/ScriptOutlineProjection';

export function useScriptOutline(
  runtimeOverride?: IScriptRuntime | null,
): ScriptOutlineNode[] {
  const contextRuntime = useOptionalScriptRuntime();
  const runtime = runtimeOverride !== undefined ? runtimeOverride : contextRuntime;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!runtime) return undefined;
    const unsubStack = runtime.subscribeToStack(() => setTick((t) => t + 1));
    const unsubOut = runtime.subscribeToOutput?.(() => setTick((t) => t + 1));
    return () => {
      unsubStack();
      unsubOut?.();
    };
  }, [runtime]);

  return useMemo(() => {
    void tick;
    return projectScriptOutline(runtime);
  }, [runtime, tick]);
}
