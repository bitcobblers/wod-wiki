/**
 * JournalPageShell Component
 *
 * Layout shell for stored-note / journal pages (Configuration 3).
 * Renders the note column (card-like container with Header + Editor); the
 * "On this page" TOC is owned by the common layout — pages publish their
 * index via useNotePageNav → NavContext L3 → SecondaryNav rail (desktop) /
 * ⋯ ActionsMenu (mobile), so the shell renders no index of its own.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PAGE_SHELL_CONTENT_SURFACE_CLASS, PAGE_SHELL_CONTAINER_CLASS } from './contentSurface';
import { StickyPageHeader } from './StickyPageHeader';

export interface JournalPageShellProps {
  /** Editor panel content — typically a PlanPanel with stored note */
  editor: ReactNode;

  /** Title shown in the sticky header */
  title?: string;
  subtitle?: ReactNode;

  /** Optional data-testid for the sticky-header title element (e2e/TestIdContract) */
  titleTestId?: string;
  /** Right-side actions (e.g. New Entry, Cast, etc.) */
  actions?: ReactNode;

  /** Optional timer overlay (dialog-based, rendered over editor) */
  timerOverlay?: ReactNode;

  /** Optional review overlay (dialog-based, rendered over editor) */
  reviewOverlay?: ReactNode;

  /** Whether the timer dialog is currently open */
  isTimerOpen?: boolean;

  /** Whether the review dialog is currently open */
  isReviewOpen?: boolean;

  /** Callback to close the timer dialog */
  onCloseTimer?: () => void;

  /** Callback to close the review dialog */
  onCloseReview?: () => void;

  /** Additional CSS classes */
  className?: string;
}

/**
 * JournalPageShell
 *
 * Implements the universal reactive display for notes/canvas:
 * - mobile: nav collapsed, editor full, index in the ⋯ header menu.
 * - desktop: nav visible, editor column constrained, TOC in the SecondaryNav rail.
 */
export function JournalPageShell({
  editor,
  title,
  subtitle,
  titleTestId,
  actions,
  timerOverlay,
  reviewOverlay,
  isTimerOpen = false,
  isReviewOpen = false,
  onCloseTimer,
  onCloseReview,
  className,
}: JournalPageShellProps) {

  return (
    <div className={cn('relative flex w-full min-h-screen justify-start items-start', className)}>
      {/* 
        Note Column — Constrained to 3xl max-width on large screens.
        Everything inside (Header + Editor) has the background and shadow.
      */}
      <div className={cn(
        PAGE_SHELL_CONTAINER_CLASS,
        PAGE_SHELL_CONTENT_SURFACE_CLASS,
      )}>
        {/* Responsive actions own mobile placement; the header stays desktop-only. */}
        <StickyPageHeader
          title={title}
          subtitle={subtitle}
          titleTestId={titleTestId}
          actions={actions}
        />
        {/* Main Editor Content */}
        <div className="flex-1 min-w-0 max-w-full">
          {editor}
        </div>
      </div>

      {/* Timer dialog overlay */}
      {isTimerOpen && timerOverlay && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
          <div className="w-full h-full flex flex-col">
            <div className="flex justify-end p-4">
              <button
                onClick={onCloseTimer}
                className="px-3 py-1.5 rounded-md text-sm font-bold text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted transition-colors"
              >
                Close
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {timerOverlay}
            </div>
          </div>
        </div>
      )}

      {/* Review dialog overlay */}
      {isReviewOpen && reviewOverlay && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
          <div className="w-full h-full flex flex-col">
            <div className="flex justify-end p-4">
              <button
                onClick={onCloseReview}
                className="px-3 py-1.5 rounded-md text-sm font-bold text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted transition-colors"
              >
                Close
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {reviewOverlay}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

