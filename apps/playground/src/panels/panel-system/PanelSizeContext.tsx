/**
 * PanelSizeContext - Container-aware sizing for panels
 *
 * Provides ResizeObserver-based width measurement so each panel knows its
 * actual rendered width. Panels use this to switch between compact (phone-like),
 * wide (landscape/tablet), and full (desktop) layouts based on their container
 * size rather than the viewport width.
 *
 * Breakpoints:
 * - isCompact: width < 500px  → single-column, phone-style layout
 * - isWide:    width ≥ 500px  → two-column, landscape layout
 * - isFull:    width ≥ 900px  → full desktop experience
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

/** Panel size mode derived from container width */
export type PanelSizeMode = 'compact' | 'wide' | 'full';

/** Container size information exposed to panels */
export interface PanelSizeInfo {
  /** Measured container width in px (0 before first measurement) */
  width: number;
  /** Measured container height in px (0 before first measurement) */
  height: number;
  /** True when container < 500px — phone-like single-column layout */
  isCompact: boolean;
  /** True when container ≥ 500px — landscape two-column layout */
  isWide: boolean;
  /** True when container ≥ 900px — full desktop layout */
  isFull: boolean;
  /** True when height is measured and < 560px — bounded vertical context
   * (embedded demo panes, landscape phones). Screens shrink fixed vertical
   * chrome and fit the clock to the remaining band instead of cropping. */
  isShort: boolean;
  /** Derived mode string */
  mode: PanelSizeMode;
}

const COMPACT_BREAKPOINT = 500;
const FULL_BREAKPOINT = 900;
const SHORT_BREAKPOINT = 560;

export function derivePanelSize(width: number, height: number): PanelSizeInfo {
  const isCompact = width < COMPACT_BREAKPOINT;
  const isFull = width >= FULL_BREAKPOINT;
  const isWide = !isCompact;
  const isShort = height > 0 && height < SHORT_BREAKPOINT;
  const mode: PanelSizeMode = isFull ? 'full' : isWide ? 'wide' : 'compact';
  return { width, height, isCompact, isWide, isFull, isShort, mode };
}

/** Default (pre-measurement) — assumes wide and tall enough to avoid layout flash */
const DEFAULT_SIZE: PanelSizeInfo = derivePanelSize(800, 600);

export const PanelSizeContext = createContext<PanelSizeInfo>(DEFAULT_SIZE);

/**
 * Hook for panels to read their container size.
 *
 * @example
 * ```tsx
 * const { isCompact, isWide } = usePanelSize();
 * return isCompact ? <CompactLayout /> : <WideLayout />;
 * ```
 */
export function usePanelSize(): PanelSizeInfo {
  return useContext(PanelSizeContext);
}

/**
 * PanelSizeProvider — Wraps panel content and measures its container width via
 * ResizeObserver. Place this around the content area of each panel so children
 * can call `usePanelSize()` to adapt their layout.
 */
export const PanelSizeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<PanelSizeInfo>(DEFAULT_SIZE);

  const handleResize = useCallback((entries: ResizeObserverEntry[]) => {
    const entry = entries[0];
    if (!entry) return;
    const width = entry.contentRect.width;
    const height = entry.contentRect.height;
    setSize(prev => {
      // Only update state if a mode boundary changed or size differs significantly
      const next = derivePanelSize(width, height);
      if (prev.mode === next.mode && Math.abs(prev.width - width) < 2 && Math.abs(prev.height - height) < 2) {
        return prev; // No meaningful change
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(handleResize);
    ro.observe(el);

    return () => ro.disconnect();
  }, [handleResize]);

  return (
    <div ref={containerRef} className="h-full w-full">
      <PanelSizeContext.Provider value={size}>
        {children}
      </PanelSizeContext.Provider>
    </div>
  );
};
