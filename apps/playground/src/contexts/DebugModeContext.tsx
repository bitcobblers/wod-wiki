/**
 * DebugModeContext - Global debug mode toggle for the workbench
 *
 * Provides a shared `isDebugMode` flag that any panel can consume.
 * Panels are free to ignore the flag, but any debugging UI should
 * be gated behind it.
 *
 * The top-bar DebugButton drives this context; individual panels
 * no longer need their own local debug toggles.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Button } from "@bitcobblers/wod-wiki-ui/primitives";
import { Bug } from 'lucide-react';
import { RuntimeLogger } from '@/hooks/useRuntimeDebug';

// ── Context ────────────────────────────────────────────────────

interface DebugModeContextValue {
  isDebugMode: boolean;
  toggleDebugMode: () => void;
}

const DebugModeContext = createContext<DebugModeContextValue>({
  isDebugMode: false,
  toggleDebugMode: () => { },
});

// ── Provider ───────────────────────────────────────────────────

export const DebugModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDebugMode, setIsDebugMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('wod-wiki-debug-mode') === 'true';
    }
    return false;
  });

  const toggleDebugMode = useCallback(() => {
    setIsDebugMode(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('wod-wiki-debug-mode', String(next));
      }
      if (next) {
        RuntimeLogger.enable();
      } else {
        RuntimeLogger.disable();
      }
      return next;
    });
  }, []);

  // Sync logger state on mount
  useEffect(() => {
    if (isDebugMode) {
      RuntimeLogger.enable();
    } else {
      RuntimeLogger.disable();
    }
  }, [isDebugMode]);

  return (
    <DebugModeContext.Provider value={{ isDebugMode, toggleDebugMode }}>
      {children}
    </DebugModeContext.Provider>
  );
};

// ── Hook ───────────────────────────────────────────────────────

export function useDebugMode(): DebugModeContextValue {
  return useContext(DebugModeContext);
}

// ── DebugButton ────────────────────────────────────────────────

export interface DebugButtonProps {
  disabled?: boolean;
}

/**
 * Standalone button that toggles global debug mode via context.
 * Place anywhere inside a `<DebugModeProvider>`.
 */
export const DebugButton: React.FC<DebugButtonProps> = ({ disabled = false }) => {
  const { isDebugMode, toggleDebugMode } = useDebugMode();

  return (
    <Button
      variant={isDebugMode ? 'default' : 'ghost'}
      size="icon"
      onClick={toggleDebugMode}
      disabled={disabled}
      className="h-9 w-9 relative"
      title={isDebugMode ? 'Debug mode on (console logging enabled)' : 'Toggle debug mode'}
    >
      <Bug className="h-[1.2rem] w-[1.2rem]" />
      {isDebugMode && (
        <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      )}
      <span className="sr-only">Toggle debug mode</span>
    </Button>
  );
};
