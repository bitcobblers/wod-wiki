/**
 * useWakeLock - React hook for managing Screen Wake Lock API
 * 
 * This hook allows React components to request and release a screen wake lock,
 * which prevents the device from dimming or locking the screen. This is useful
 * for workout tracking where users need to see the timer without touching the screen.
 * 
 * The Screen Wake Lock API is not supported in all browsers. This hook gracefully
 * handles unsupported browsers by returning `isSupported: false`.
 * 
 * @example
 * ```tsx
 * // Basic usage - manually control wake lock
 * const { isActive, isSupported, request, release } = useWakeLock();
 * 
 * const handleStartWorkout = () => {
 *   request();
 * };
 * 
 * const handleStopWorkout = () => {
 *   release();
 * };
 * ```
 * 
 * @example
 * ```tsx
 * // Automatic wake lock based on condition
 * const { isActive, isSupported } = useWakeLock({
 *   enabled: viewMode === 'track' && isRunning
 * });
 * ```
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Type declarations for Screen Wake Lock API
 * These are needed because the API may not be in all TypeScript lib definitions
 */
interface WakeLockSentinelType {
  readonly released: boolean;
  readonly type: 'screen';
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockType {
  request(type: 'screen'): Promise<WakeLockSentinelType>;
}

export interface UseWakeLockOptions {
  /**
   * When true, automatically requests the wake lock.
   * When false, releases any active wake lock.
   * When undefined, manual control via request/release functions.
   */
  enabled?: boolean;
}

export interface UseWakeLockResult {
  /** Whether a wake lock is currently active */
  isActive: boolean;
  /** Whether the Screen Wake Lock API is supported by the browser */
  isSupported: boolean;
  /** Request a wake lock. Returns true if successful. */
  request: () => Promise<boolean>;
  /** Release the current wake lock. */
  release: () => Promise<void>;
}

/**
 * Hook to manage Screen Wake Lock API for keeping the device screen awake
 */
export function useWakeLock(options: UseWakeLockOptions = {}): UseWakeLockResult {
  const { enabled } = options;
  
  const [isActive, setIsActive] = useState(false);
  const [isSupported] = useState(() => {
    // Check if running in browser and if Wake Lock API is supported
    const nav = typeof navigator !== 'undefined' ? navigator as unknown as { wakeLock?: WakeLockType } : undefined;
    return nav !== undefined && 'wakeLock' in nav && nav.wakeLock !== undefined;
  });
  
  // Use ref to track the wake lock sentinel
  const wakeLockRef = useRef<WakeLockSentinelType | null>(null);

  /**
   * Request a screen wake lock
   */
  const request = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      return false;
    }

    // Don't request if already active
    if (wakeLockRef.current) {
      return true;
    }

    try {
      const nav = navigator as unknown as { wakeLock: WakeLockType };
      wakeLockRef.current = await nav.wakeLock.request('screen');
      setIsActive(true);

      // Listen for the wake lock being released (e.g., when tab becomes hidden)
      wakeLockRef.current.addEventListener('release', () => {
        wakeLockRef.current = null;
        setIsActive(false);
      });

      return true;
    } catch {
      // Wake lock request can fail if:
      // - Document is not visible
      // - Permission denied
      // - Low battery mode (on some devices)
      wakeLockRef.current = null;
      setIsActive(false);
      return false;
    }
  }, [isSupported]);

  /**
   * Release the current wake lock
   */
  const release = useCallback(async (): Promise<void> => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // Wake lock release failed silently
      }
      wakeLockRef.current = null;
      setIsActive(false);
    }
  }, []);

  /**
   * Re-acquire wake lock when document becomes visible again
   * This is needed because wake locks are automatically released when the tab becomes hidden
   */
  useEffect(() => {
    if (!isSupported) return;

    const handleVisibilityChange = () => {
      // Only re-acquire if we were previously active and document is now visible
      // and the enabled option is either undefined (manual mode) or true
      if (
        document.visibilityState === 'visible' &&
        !wakeLockRef.current &&
        (enabled === undefined ? isActive : enabled)
      ) {
        // Re-request the wake lock if it was released due to visibility change
        // and we still want it active
        void request();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isSupported, enabled, isActive, request]);

  /**
   * Automatically manage wake lock based on enabled option
   */
  useEffect(() => {
    // Only manage automatically if enabled is explicitly set
    if (enabled === undefined) return;

    if (enabled) {
      void request();
    } else {
      void release();
    }
  }, [enabled, request, release]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {
          // Ignore errors during cleanup
        });
        wakeLockRef.current = null;
      }
    };
  }, []);

  return {
    isActive,
    isSupported,
    request,
    release,
  };
}

