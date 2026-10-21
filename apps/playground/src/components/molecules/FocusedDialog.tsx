/**
 * FocusedDialog
 *
 * Full-screen takeover dialog used for immersive views (track, review).
 * Covers the entire viewport with an opaque background, prevents body scroll,
 * and renders children in a full-height flex column with an optional header.
 */

import React, { useEffect } from "react";
import * as ReactDOM from "react-dom";
import { X } from "lucide-react";
import { TEST_IDS } from "@/testing/contracts/TestIdContract";

export interface FocusedDialogProps {
  /** Title shown in the header bar. If omitted, no header is rendered. */
  title?: string;
  /** Called when the user clicks the close button. */
  onClose: () => void;
  /** Dialog contents — fills the remaining vertical space. */
  children: React.ReactNode;
  /** Extra class name for the close button (e.g. to set z-index when header is hidden). */
  closeButtonClassName?: string;
  /** When true, render a floating close button instead of a header bar. */
  floatingClose?: boolean;
  /** Visual variant of the dialog. 'minimal' reduces chrome but still follows the active theme. */
  variant?: 'default' | 'minimal';
  /** Optional actions (e.g. Cast button) to show to the left of the close button. */
  actions?: React.ReactNode;
  /** Visible label for the close button (e.g. "Exit"). Renders a ≥44px text button; default keeps the icon X. */
  closeLabel?: string;
}

export const FocusedDialog: React.FC<FocusedDialogProps> = ({
  title,
  onClose,
  children,
  closeButtonClassName,
  floatingClose = false,
  variant = 'default',
  actions,
  closeLabel,
}) => {
  // Prevent scrolling on the body while the dialog is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Modal focus ownership: save prior focus, move into the dialog, contain
  // Tab inside, restore on exit — the underlying editor must never stay
  // active under a fullscreen clock.
  const containerRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    containerRef.current?.focus({ preventScroll: true });
    return () => previous?.focus({ preventScroll: true });
  }, []);

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !containerRef.current) return;
    const focusables = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && (active === first || active === containerRef.current || !containerRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const isMinimal = variant === 'minimal';

  const closeBtn = (
    <button
      onClick={onClose}
      className={
        closeButtonClassName ??
        `rounded-pill transition-colors shadow-[rgba(0,0,0,0.06)_0px_1px_2px] ${isMinimal ? 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground' : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground'} ${
          closeLabel ? 'flex h-11 min-w-[44px] items-center justify-center px-4 text-sm font-medium hover:text-foreground' : 'p-2'
        }`
      }
      title={closeLabel ?? "Close"}
      data-testid={TEST_IDS.FOCUSED_DIALOG_CLOSE}
    >
      {closeLabel ?? <X className="h-5 w-5" />}
    </button>
  );

  // Portal to document.body so we escape any CSS containing blocks
  // (CodeMirror sets `contain: size style` on .cm-editor which traps fixed positioning).
  return ReactDOM.createPortal(
    <div
      ref={containerRef}
      onKeyDown={trapTab}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Workout'}
      className={`fixed inset-0 z-[100] flex flex-col bg-background text-foreground outline-none animate-in fade-in duration-200`}
    >
      {floatingClose || (isMinimal && !title) ? (
        <div className="absolute top-4 right-4 z-[110] flex items-center gap-2">
          {actions}
          {closeBtn}
        </div>
      ) : title ? (
        <div className={`flex items-center justify-between px-6 py-4 border-b border-border ${isMinimal ? 'bg-muted/10' : 'bg-muted/30'} shrink-0`}>
          <h2 className={`text-lg ${isMinimal ? 'font-black tracking-tight uppercase text-[11px] text-muted-foreground' : 'font-semibold'}`}>{title}</h2>
          <div className="flex items-center gap-2">
            {actions}
            {closeBtn}
          </div>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {children}
      </div>
    </div>,
    document.body,
  );
};
