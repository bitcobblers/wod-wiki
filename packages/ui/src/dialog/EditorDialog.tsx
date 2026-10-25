import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../utils/cn';
import { useVisualViewportRect } from './visualViewport';

export interface EditorDialogProps {
  /** Controls visibility; the dialog unmounts its portal when closed. */
  open: boolean;
  onClose: () => void;
  /** Dialog heading (aria-labelledby target). */
  title: string;
  /** Optional secondary line under the title (aria-describedby target). */
  description?: string;
  /** Body content — scrolls independently of the header/footer. */
  children: ReactNode;
  /** Sticky footer (e.g. Cancel/Save) — pinned above the keyboard on mobile. */
  footer?: ReactNode;
  /** 'default' (centered/full-screen, unchanged) or 'sheet' (mobile bottom
   *  sheet over the lower visible viewport, non-input initial focus,
   *  safe-area footer; desktop keeps the centered panel). */
  presentation?: 'default' | 'sheet';
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * EditorDialog — accessible editor surface shared by dashboard/effort/note
 * editing flows.
 *
 * Deliberately NOT a native `<dialog>`: the top layer would obscure any
 * body-portaled surfaces a host renders above it (the WQL composer's
 * hover/touch affordances, palette results). This renders a plain fixed
 * overlay via portal, so portaled content keeps painting and receiving
 * clicks/focus above it.
 *
 * Focus containment is lenient by the same constraint: Tab cycles within the
 * dialog only while focus is inside it — focus that moves into a body-portaled
 * popover is never yanked back, and the popover keeps its own keyboard
 * handling. Escape is handled at the dialog container, so Escape consumed by
 * a popover (e.g. to dismiss it) does not also close the dialog.
 *
 * Mobile (< sm): full visual-viewport screen driven by `window.visualViewport`
 * (falls back to `100dvh`) — the keyboard shrinking the viewport lifts the
 * footer, never the focused field. Desktop (sm+): contained centered panel.
 */
export function EditorDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  presentation = 'default',
}: EditorDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const viewport = useVisualViewportRect();
  const sheet = presentation === 'sheet';

  // Background scroll lock + initial focus while open; restore on close.
  // Sheet presentation never pulls focus into an input — the keyboard must
  // stay closed until an explicit tap — so it skips [data-autofocus].
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = sheet
        ? panel
        : (panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel);
      target.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      const restore = restoreFocusRef.current;
      if (restore instanceof HTMLElement && document.contains(restore)) restore.focus();
    };
  }, [open, sheet]);

  if (!open || typeof document === 'undefined') return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      // CodeMirror and other nested popovers prevent Escape when they consume
      // it to close themselves; only an unconsumed Escape closes the dialog.
      if (!event.defaultPrevented) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Visual-viewport anchoring: `left/right: 0` + explicit top/height keeps the
  // dialog exactly on the visible rectangle (keyboard lift, pinch-zoom top),
  // with 100dvh as the no-VisualViewport fallback.
  const viewportStyle: CSSProperties = {
    top: viewport.offsetTop,
    height: viewport.height ?? '100dvh',
  };

  return createPortal(
    <div
      className={cn(
        'fixed left-0 right-0 z-50 flex flex-col bg-black/40 dark:bg-black/60 sm:items-center sm:justify-center sm:bg-background/80 sm:p-4 sm:backdrop-blur-sm',
        sheet && 'max-sm:justify-end',
      )}
      style={viewportStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex min-h-0 w-full flex-col overflow-hidden bg-card outline-none sm:max-h-full sm:max-w-2xl sm:flex-none sm:rounded-xl sm:border sm:border-border sm:shadow-2xl',
          // Sheet: bottom-anchored at its natural height over the lower
          // visible viewport (expands toward full height as content needs),
          // with a rounded top edge; desktop keeps the centered panel.
          sheet
            ? 'max-sm:flex-none max-sm:min-h-[66%] max-sm:max-h-full max-sm:rounded-t-2xl'
            : 'flex-1 sm:max-h-full',
        )}
      >
        {sheet && (
          <div aria-hidden className="flex justify-center pt-2 sm:hidden">
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>
        )}
        <div className="flex items-start justify-between gap-3 border-b border-border/80 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:size-9"
          >
            <X className="size-5 sm:size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
        {footer && (
          <div
            className={cn(
              'border-t border-border/80 bg-muted/10 px-4 py-3 sm:px-6',
              // 44px default mobile density; sheet actions get the full
              // 48px touch target.
              sheet
                ? 'max-sm:[&_button]:min-h-12 max-sm:[&_button]:min-w-11'
                : 'max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11',
              // Sheet rides the visual viewport bottom; clear the home
              // indicator / gesture area.
              sheet && 'max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]',
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
