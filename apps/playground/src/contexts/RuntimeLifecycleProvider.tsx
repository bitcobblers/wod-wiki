import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ScriptRuntime, SubscriptionManager, LocalRuntimeSubscription } from '@/hooks/useRuntimeTimer';
import type { IRuntimeFactory } from '@/hooks/useRuntimeFactory';
import type { ScriptBlock } from '@/components/Editor/types';
import type { RuntimeStackOptions } from '@bitcobblers/wod-wiki-engine';
import { RuntimeLifecycleContext, type RuntimeLifecycleState } from './RuntimeLifecycleContext';
import { SubscriptionManagerContext } from './SubscriptionManagerContext';
import { useWorkbenchSessionStore } from '@/stores/workbenchSessionStore.shim';

export { useRuntimeLifecycle } from '@/components/layout/useRuntimeLifecycle';

/**
 * Props for RuntimeLifecycleProvider
 */
interface RuntimeLifecycleProviderProps {
  /** Factory for creating runtime instances */
  factory: IRuntimeFactory;

  /** Child components */
  children: React.ReactNode;
}

/**
 * RuntimeLifecycleProvider Component
 * 
 * Manages the lifecycle of ScriptRuntime instances:
 * - Creates runtimes via injected factory
 * - Automatically disposes old runtime when new one is created
 * - Cleans up on unmount
 */
export const RuntimeLifecycleProvider: React.FC<RuntimeLifecycleProviderProps> = ({
  factory,
  children
}) => {
  const [runtime, setRuntime] = useState<ScriptRuntime | null>(null);
  const [subscriptionManager, setSubscriptionManager] = useState<SubscriptionManager | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Keep factory ref to avoid recreating callbacks
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  // Track current runtime and subscription manager in refs to avoid stale closure issues
  const currentRuntimeRef = useRef<ScriptRuntime | null>(null);
  const currentSubManagerRef = useRef<SubscriptionManager | null>(null);
  // Ref-based guard to prevent duplicate initialization without causing re-renders
  const isInitializingRef = useRef(false);

  /**
   * Dispose the current runtime safely
   */
  const disposeRuntime = useCallback(() => {
    // Dispose subscription manager first (it unsubscribes from the runtime)
    if (currentSubManagerRef.current) {
      currentSubManagerRef.current.dispose();
      currentSubManagerRef.current = null;
    }
    setSubscriptionManager(null);
    useWorkbenchSessionStore.getState().setSubscriptionManager(null);

    // Dispose the runtime synchronously via the ref — NEVER inside a setState
    // updater.  React calls updater functions during the render phase; disposal
    // triggers MemoryLocation subscribers (e.g. setVersion in useStackTimers)
    // which call setState on other components, producing the
    // "Cannot update a component while rendering a different component" warning.
    const runtimeToDispose = currentRuntimeRef.current;
    currentRuntimeRef.current = null;
    if (runtimeToDispose) {
      try {
        factoryRef.current.disposeRuntime(runtimeToDispose);
      } catch (err) {
        console.error('[RuntimeProvider] Error disposing runtime:', err);
      }
    }
    setRuntime(null);
    setError(null);
  }, []);

  /**
   * Initialize a new runtime for the given block
   * Automatically disposes existing runtime first
   */
  const initializeRuntime = useCallback((block: ScriptBlock, options?: RuntimeStackOptions) => {
    // Guard against duplicate initialization using ref (avoids re-render cascade)
    if (isInitializingRef.current) {
      return;
    }

    isInitializingRef.current = true;
    setIsInitializing(true);
    setError(null);

    try {
      // Dispose old runtime synchronously BEFORE creating the new one.
      // Must use the ref (not the state value) to avoid stale closures.
      // Must NOT call disposeRuntime inside a setState updater — updaters run
      // during the React render phase and disposal fires MemoryLocation
      // subscribers (setState in useStackTimers) causing the
      // "Cannot update a component while rendering" warning.
      if (currentSubManagerRef.current) {
        currentSubManagerRef.current.dispose();
        currentSubManagerRef.current = null;
      }
      const oldRuntime = currentRuntimeRef.current;
      currentRuntimeRef.current = null;
      if (oldRuntime) {
        try {
          factoryRef.current.disposeRuntime(oldRuntime);
        } catch (err) {
          console.error('[RuntimeProvider] Error disposing existing runtime:', err);
        }
      }

      const newRuntime = factoryRef.current.createRuntime(block, options) as ScriptRuntime | null;
      currentRuntimeRef.current = newRuntime;
      setRuntime(newRuntime);

      if (newRuntime) {
        // Create a SubscriptionManager and add a local subscription
        const mgr = new SubscriptionManager(newRuntime);
        mgr.add(new LocalRuntimeSubscription({ id: 'local' }));
        currentSubManagerRef.current = mgr;
        setSubscriptionManager(mgr);
        useWorkbenchSessionStore.getState().setSubscriptionManager(mgr);
      } else {
        currentSubManagerRef.current = null;
        setSubscriptionManager(null);
        useWorkbenchSessionStore.getState().setSubscriptionManager(null);
      }
    } catch (err) {
      console.error('[RuntimeProvider] Error creating runtime:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      currentRuntimeRef.current = null;
    } finally {
      isInitializingRef.current = false;
      setIsInitializing(false);
    }
  }, []);

  // Cleanup on unmount - use ref to avoid stale closure
  useEffect(() => {
    return () => {
      // Dispose subscription manager first
      if (currentSubManagerRef.current) {
        currentSubManagerRef.current.dispose();
      }
      // Use ref to get current runtime value, avoiding stale closure
      if (currentRuntimeRef.current) {
        try {
          factoryRef.current.disposeRuntime(currentRuntimeRef.current);
        } catch (err) {
          console.error('[RuntimeProvider] Error disposing runtime on unmount:', err);
        }
      }
    };
  }, []); // Empty deps - only run on unmount

  const value: RuntimeLifecycleState = {
    runtime,
    isInitializing,
    error,
    initializeRuntime,
    disposeRuntime
  };

  return (
    <RuntimeLifecycleContext.Provider value={value}>
      <SubscriptionManagerContext.Provider value={subscriptionManager}>
        {children}
      </SubscriptionManagerContext.Provider>
    </RuntimeLifecycleContext.Provider>
  );
};

