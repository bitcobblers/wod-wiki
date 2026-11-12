import { createContext, useContext, ReactNode } from 'react';
import { IScriptRuntime } from '../../runtime/contracts/IScriptRuntime';

/**
 * React Context for providing IScriptRuntime to components.
 * 
 * This is a simple dependency injection context — it passes a pre-created
 * IScriptRuntime instance to children. No lifecycle management.
 * 
 * For lifecycle management (creation, disposal, error tracking),
 * use RuntimeLifecycleProvider from '@/contexts/RuntimeLifecycleProvider' instead.
 * 
 * Components can use useScriptRuntime() to access runtime memory and state.
 */
const ScriptRuntimeContext = createContext<IScriptRuntime | undefined>(undefined);

export interface ScriptRuntimeProviderProps {
  runtime: IScriptRuntime;
  children: ReactNode;
}

/**
 * Provides IScriptRuntime context to child components.
 * Must wrap any components that need access to runtime memory or state.
 * 
 * @example
 * ```tsx
 * const runtime = new ScriptRuntime();
 * const script = parseWorkout('For Time: 30 Jumping Jacks');
 * runtime.execute(script);
 * 
 * return (
 *   <ScriptRuntimeProvider runtime={runtime}>
 *     <ClockAnchor blockKey="block-001" />
 *   </ScriptRuntimeProvider>
 * );
 * ```
 */
export const ScriptRuntimeProvider: React.FC<ScriptRuntimeProviderProps> = ({
  runtime,
  children
}) => {
  return (
    <ScriptRuntimeContext.Provider value={runtime}>
      {children}
    </ScriptRuntimeContext.Provider>
  );
};

/**
 * Hook to access the IScriptRuntime from context.
 * Must be used within a ScriptRuntimeProvider.
 * 
 * @throws Error if called outside ScriptRuntimeProvider
 * @returns IScriptRuntime instance
 */
export function useScriptRuntime(): IScriptRuntime {
  const runtime = useContext(ScriptRuntimeContext);
  if (!runtime) {
    throw new Error('useScriptRuntime must be used within ScriptRuntimeProvider');
  }
  return runtime;
}

/**
 * Optional variant of `useScriptRuntime` returning `null` when mounted outside
 * `ScriptRuntimeProvider` (e.g. stateless Cast receiver frames or fixture stories).
 */
export function useOptionalScriptRuntime(): IScriptRuntime | null {
  return useContext(ScriptRuntimeContext) ?? null;
}

