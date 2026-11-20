import type { ReactNode } from 'react';
import { Edit3, ExternalLink, Eye } from 'lucide-react';
import { cn } from '../utils/cn';

export interface WidgetFrameProps {
  /** DOM anchor for the frame (e.g. `widget-<key>`) — L3 indexes scroll here. */
  id?: string;
  title: string;
  question: string;
  /** Raw WQL for the widget. Hidden by default — only rendered with showQuery. */
  query?: string;
  span?: string;
  /** Semantic heading level (h2 when top-level inside a page h1, h3 under a section h2). */
  headingLevel?: 2 | 3;
  /** Show the raw WQL query box (teaching/authoring surfaces). View-first default hides it. */
  showQuery?: boolean;
  /**
   * Read-only inspection affordance — an always-visible button (prebuilt
   * seeds, teaching surfaces) opening the host's query inspector. Distinct
   * from editing: present without a toolbar.
   */
  onInspect?: () => void;
  /** Always-visible affordance: open this widget's resolved query in the
   * WQL explorer (host navigates). */
  onOpenInExplorer?: () => void;
  /**
   * Edit-mode action cluster (edit / duplicate / remove / reorder / size),
   * rendered top-right and always visible while present. The host builds it;
   * the frame only positions it.
   */
  toolbar?: ReactNode;
  children: ReactNode;
}

export function WidgetFrame({ id, title, question, query, span, headingLevel = 2, showQuery = false, onInspect, onOpenInExplorer, toolbar, children }: WidgetFrameProps) {
  const HeadingTag = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div
      id={id}
      className={cn(
        'relative group/frame bg-card border border-border rounded-lg p-4 flex flex-col min-h-0',
        span,
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <HeadingTag className="text-sm font-semibold text-foreground">{title}</HeadingTag>
          {question && <p className="mt-1 text-xs text-muted-foreground text-pretty">{question}</p>}
        </div>
        {(onInspect || onOpenInExplorer) && (
          <div className="flex shrink-0 items-center gap-1">
            {onInspect && (
              <button
                type="button"
                onClick={onInspect}
                title="Inspect widget query"
                aria-label={`Inspect query for ${title || 'widget'}`}
                className="inline-flex items-center justify-center p-1 max-lg:min-h-11 max-lg:min-w-11 rounded bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}
            {onOpenInExplorer && (
              <button
                type="button"
                onClick={onOpenInExplorer}
                title="Open in explorer"
                aria-label={`Open ${title || 'widget'} in explorer`}
                className="inline-flex items-center justify-center p-1 max-lg:min-h-11 max-lg:min-w-11 rounded bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      {toolbar && <div className="mb-3">{toolbar}</div>}
      {/* Long WQL wraps in place - an in-card horizontal scrollbar reads as
          a layout bug (dogfood #4). `break-all` covers spaceless fragments
          like `sum:totalVolume{effort:bench-press}`. */}
      {showQuery && query != null && query !== '' && (
        <div className="font-mono text-[11px] text-primary/90 bg-background/60 rounded px-2 py-1 mb-3 whitespace-pre-wrap break-all">
          {query}
        </div>
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

/** Standard edit-mode tool-button chrome for the widget toolbar. */
export function WidgetToolButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center p-1 max-lg:min-h-11 max-lg:min-w-11 rounded bg-muted/80 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground transition-colors',
        active && 'text-primary bg-primary/10',
      )}
    >
      {children}
    </button>
  );
}

/** The primary "open the full editor" affordance inside the toolbar. */
export function WidgetEditButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Edit widget"
      aria-label={`Edit widget ${title || ''}`.trim()}
      className="inline-flex items-center justify-center p-1 max-lg:min-h-11 max-lg:min-w-11 rounded bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
    >
      <Edit3 className="w-3.5 h-3.5" />
    </button>
  );
}
