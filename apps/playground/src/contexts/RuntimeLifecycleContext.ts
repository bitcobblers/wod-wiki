/**
 * RuntimeLifecycleContext - Shared context definition for runtime lifecycle management
 * 
 * This context manages the full lifecycle of ScriptRuntime instances:
 * creation, initialization, disposal, and error tracking.
 * 
 * For simple runtime injection (passing a pre-created IScriptRuntime to children),
 * use ScriptRuntimeContext from '@bitcobblers/wod-wiki-engine' instead.
 */

import { createContext } from 'react';
import type { ScriptRuntime } from '@/hooks/useRuntimeTimer';
import type { ScriptBlock } from '@/components/Editor/types';
import type { RuntimeStackOptions } from '@bitcobblers/wod-wiki-engine';

/**
 * Runtime lifecycle context state interface
 */
export interface RuntimeLifecycleState {
  /** Current active runtime instance (null if none) */
  runtime: ScriptRuntime | null;

  /** Whether runtime is currently initializing */
  isInitializing: boolean;

  /** Error from last runtime operation */
  error: Error | null;

  /**
   * Initialize a new runtime for the given block.
   *
   * Options carry the run's sound configuration — the available sound
   * profiles and the one the note selected — so the compiler can resolve
   * the profile for each block.
   */
  initializeRuntime: (block: ScriptBlock, options?: RuntimeStackOptions) => void;

  /** Dispose the current runtime */
  disposeRuntime: () => void;
}

export const RuntimeLifecycleContext = createContext<RuntimeLifecycleState | undefined>(undefined);

