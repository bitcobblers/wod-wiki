/**
 * NotebookCard — one community notebook (feed or collection) in the home
 * Library & Community Feeds section.
 *
 * Chrome recedes, the cover carries the identity (atlas-style):
 *  - declared `image:` covers load blur-up (5px → 0 + opacity fade);
 *  - undeclared covers render a deterministic flat monogram tile
 *    (no gradients, no icon containers) tinted by a slug hash;
 *  - hover/focus reveals the description over the cover on a scrim, with
 *    the primary action always reachable by tap/keyboard (never hover-only).
 *
 * Installed notebooks link straight to their detail surface; registry-only
 * notebooks render an Import action (package review state) handled by the
 * section through `onImport`. One primary action per card — re-sync and
 * removal live in Settings → Sync.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, CloudDownload, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotebookCoverArt } from './NotebookCoverArt';
import { formatNotebookDate as formatDate } from './notebookGalleryModel';
import type { NotebookSummary } from './notebookGalleryModel';

export interface NotebookCardProps {
  notebook: NotebookSummary;
  /** Root test id — callers pass a stable per-package id. */
  testId?: string;
  /** Extra classes on the root article (e.g. fixed width inside a marquee row). */
  className?: string;
  /** Import action for registry-only notebooks; omit → no import button. */
  onImport?: (packageId: string) => void;
  /** True while this package's import is running (spinner). */
  importing?: boolean;
  /** True while another package's import is running (disable, no spinner). */
  busy?: boolean;
  /** Inline status line from the owning section (progress / error text). */
  status?: { text: string; tone: 'muted' | 'error' };
}

export function NotebookCard({ notebook, testId = 'notebook-card', className, onImport, importing, busy, status }: NotebookCardProps) {
  const updated = formatDate(notebook.latestDate);

  const metaRow = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
      <span>{notebook.sourceLabel}</span>
      {notebook.installed && notebook.itemCount > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {notebook.itemCount} {notebook.itemCount === 1 ? 'workout' : 'workouts'}
          </span>
        </>
      )}
      {updated && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">updated {updated}</span>
        </>
      )}
      {!notebook.installed && <span aria-hidden>·</span>}
      {!notebook.installed && <span>not imported</span>}
    </div>
  );

  return (
    <article
      data-testid={testId}
      data-kind={notebook.kind}
      data-installed={notebook.installed}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card',
        'transition-colors hover:border-foreground/25 focus-within:border-foreground/25',
        className,
      )}
    >
      <Link
        to={notebook.href}
        data-testid={`${testId}-open`}
        className="block outline-none"
        aria-label={`Open ${notebook.label}`}
      >
        <NotebookCoverArt notebook={notebook} className="aspect-[16/10]" />
      </Link>

      {/* Hover/focus reveal — the description scrim over the cover. */}
      {notebook.description && (
        <Link
          to={notebook.href}
          data-testid={`${testId}-scrim`}
          className={cn(
            'absolute inset-x-0 top-0 flex aspect-[16/10] items-end bg-card/85 p-4 backdrop-blur-[2px]',
            'pointer-events-none opacity-0 transition-opacity duration-300',
            'group-hover:pointer-events-auto group-hover:opacity-100',
            'group-focus-within:pointer-events-auto group-focus-within:opacity-100',
            'outline-none',
          )}
          aria-label={`Open ${notebook.label}`}
        >
          <p className="line-clamp-4 text-xs leading-relaxed text-foreground/90">{notebook.description}</p>
        </Link>
      )}

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-bold leading-snug text-foreground">
            <Link to={notebook.href} className="transition-colors hover:text-primary">
              {notebook.label}
            </Link>
          </h3>
          {notebook.installed ? (
            <Link
              to={notebook.href}
              data-testid={`${testId}-cta`}
              aria-label={`Open ${notebook.label}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ) : (
            <button
              type="button"
              data-testid={`${testId}-import`}
              disabled={importing || busy}
              onClick={() => onImport?.(notebook.packageId)}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3',
                'text-[10px] font-black uppercase tracking-widest',
                'border-primary/30 bg-primary/10 text-primary',
                'transition-colors hover:bg-primary/20',
                'disabled:cursor-wait disabled:opacity-60',
              )}
            >
              {importing ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <CloudDownload className="size-3" aria-hidden />}
              {importing ? 'Importing' : 'Import'}
            </button>
          )}
        </div>

        {/* Description sits under the title for touch devices (no hover) and
            as the accessible source for the scrim reveal on pointer devices. */}
        {notebook.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:hidden">
            {notebook.description}
          </p>
        )}

        {notebook.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {notebook.categories.map(category => (
              <span
                key={category}
                className="rounded-full border border-border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/70"
              >
                {category}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto pt-1">
          {metaRow}
          {status && (
            <p
              role={status.tone === 'error' ? 'alert' : 'status'}
              data-testid={`${testId}-status`}
              className={cn(
                'mt-1.5 flex items-start gap-1.5 text-xs',
                status.tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              <span>{status.text}</span>
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
