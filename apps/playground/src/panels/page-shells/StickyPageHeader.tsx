/**
 * StickyPageHeader — the standard playground page header.
 *
 * ONE sticky zone containing the title row and the optional subheader, so a
 * stateful subheader (e.g. the library's WqlComposer) mounts exactly once:
 *   - Desktop (lg+): the zone sticks to the viewport top (the app has no
 *     desktop navbar) — accent + title + optional subtitle + accessory,
 *     right-aligned actions, subheader below.
 *   - Mobile: the zone is hidden entirely (max-lg:hidden) — the SidebarLayout
 *     navbar is the single mobile header. Page identity (title/slug/date)
 *     reaches the navbar via the App breadcrumb (route-derived workout name);
 *     mobile-critical actions (e.g. a note's Edit toggle) portal into the
 *     navbar's MobileQuerySlot target, mirroring the stream query bar.
 *
 * The zone carries `data-page-sticky-boundary="true"` so stacked sticky
 * elements (date-group headers, scroll targets) can measure the real
 * occupied height via `measureStickyBoundary` / `useStickyBoundaryOffset`
 * instead of hardcoding `top` values.
 *
 * Extracted from CanvasPage's title-bar mode so any page can adopt the
 * standard header directly, without routing through App's shell config.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface StickyPageHeaderProps {
  /** DOM anchor on the sticky zone (e.g. L3 "page title" scroll target). */
  id?: string;
  /** Page title shown in the sticky bar. When omitted, the row space is
   *  left for the queryBar/actions (e.g. stream pages). */
  title?: string;
  /** Secondary line under the title (e.g. a dynamic page description). */
  subtitle?: ReactNode;
  /** Content rendered next to the title (e.g. a challenge badge). */
  titleAccessory?: ReactNode;
  /** Right-side actions (e.g. search, cast, actions menu). */
  actions?: ReactNode;
  /**
   * Content rendered below the title row inside the sticky zone.
   */
  subheader?: ReactNode;
  /**
   * Inline query bar rendered in the title row (StreamQueryBar). Keeps the
   * composer on the same line as the title — the header IS the query bar.
   */
  queryBar?: ReactNode;
  /** Optional data-testid on title heading */
  titleTestId?: string;
  /** Optional class names on the sticky header container */
  className?: string;
}

export function StickyPageHeader({
  id,
  title,
  subtitle,
  titleAccessory,
  actions,
  queryBar,
  subheader,
  titleTestId,
  className,
}: StickyPageHeaderProps) {
  return (
    <div
      id={id}
      data-page-sticky-boundary="true"
      className={cn(
        'max-lg:hidden lg:sticky lg:top-0 z-30 border-b border-border/50 bg-background/95 backdrop-blur-md transition-colors',
        className,
      )}
    >
      {/* Title row — items-start: a multi-line queryBar (stream composer +
          example line) keeps right-side actions on the composer's line
          instead of floating mid-block. */}
      <div className="flex items-start justify-between gap-3 px-4 sm:px-6 lg:px-8 py-2 sm:py-2.5">
        {title && (
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="h-5 w-1.5 shrink-0 rounded-full bg-primary" />
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="min-w-0">
                <h1
                  data-testid={titleTestId}
                  className="text-base sm:text-lg font-black tracking-tight text-foreground leading-none truncate"
                >
                  {title}
                </h1>
                {subtitle && (
                  <p className="mt-0.5 text-xs text-muted-foreground truncate">{subtitle}</p>
                )}
              </div>
              {titleAccessory}
            </div>
          </div>
        )}
        {queryBar && <div className="min-w-0 flex-1">{queryBar}</div>}
        {actions && (
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
            {actions}
          </div>
        )}
      </div>

      {subheader && (
        // Tint alone separates the band from the title row.
        <div className="bg-background/40">
          {subheader}
        </div>
      )}
    </div>
  );
}
