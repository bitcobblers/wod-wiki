/**
 * FeedCard — one FEED in the home Library & Community Feeds section.
 *
 * The feed is the unit a reader subscribes to, so the card is the feed:
 * cover identity (deterministic monogram tile tinted by feed id), the
 * repository label and description, and — because one Subscribe brings
 * the feed's notebooks — the notebooks the feed publishes as chips.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, CloudDownload, Layers, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { feedPath } from '../../lib/routes';
import { formatNotebookDate as formatDate, monogramLetter, monogramTint } from './notebookGalleryModel';
import type { FeedSummary } from './notebookGalleryModel';

/** Notebooks listed on a card before the rest collapse into a count. */
const MAX_NOTEBOOK_CHIPS = 4;

export interface FeedCardProps {
  feed: FeedSummary;
  /** Root test id — callers pass a stable per-feed id. */
  testId?: string;
  /** Extra classes on the root article (e.g. fixed width inside a marquee row). */
  className?: string;
  /** Subscribe action for feeds whose content is not yet subscribed; omit → no button. */
  onImport?: (feedId: string) => void;
  /** True while this feed's subscribe/import is running (spinner). */
  importing?: boolean;
  /** True while another feed's subscribe/import is running (disable, no spinner). */
  busy?: boolean;
  /** Inline status line from the owning section (progress / error text). */
  status?: { text: string; tone: 'muted' | 'error' };
  /** Toggle an individual notebook subscription */
  onToggleNotebookSubscription?: (feedId: string, chunkId: string, subscribed: boolean) => void;
}

export function FeedCard({ feed, testId = 'feed-card', className, onImport, importing, busy, status, onToggleNotebookSubscription }: FeedCardProps) {
  const tint = monogramTint(feed.slug);
  const [background, foreground] = tint.split(' ');
  const updated = formatDate(feed.latestDate);
  const shown = feed.notebooks.slice(0, MAX_NOTEBOOK_CHIPS);
  const overflow = feed.notebooks.length - shown.length;
  const previewHref = feed.feedId ? feedPath(feed.feedId) : feed.href;
  const open = feed.installed && feed.feedId ? feed.href : previewHref;
  const coverImage = feed.notebooks.find((notebook) => notebook.image)?.image;

  const meta = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="tabular-nums">
        {feed.notebooks.length} {feed.notebooks.length === 1 ? 'notebook' : 'notebooks'}
      </span>
      {feed.installed && feed.itemCount > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            {feed.itemCount} {feed.itemCount === 1 ? 'item' : 'items'}
          </span>
        </>
      )}
      {feed.installed && updated && (
        <>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">updated {updated}</span>
        </>
      )}
      {!feed.installed && <span aria-hidden="true">·</span>}
      {!feed.installed && <span>{feed.subscribed ? 'index active' : 'not subscribed'}</span>}
    </div>
  );

  const cover = (
    <div className={cn('relative overflow-hidden bg-muted/40 aspect-[16/10]', background)}>
      {coverImage ? (
        <img src={coverImage} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn('text-7xl font-black tracking-tighter select-none', foreground)} aria-hidden="true">
            {monogramLetter(feed.label)}
          </span>
          <Layers className={cn('absolute bottom-4 right-4 size-6 opacity-50', foreground)} aria-hidden="true" />
        </div>
      )}
    </div>
  );

  return (
    <article
      data-testid={testId}
      data-installed={feed.installed}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card',
        'transition-colors hover:border-foreground/25 focus-within:border-foreground/25',
        className,
      )}
    >
      <Link
        to={open}
        data-testid={`${testId}-open`}
        className="block outline-none no-underline"
        aria-label={`Open ${feed.label}`}
      >
        {cover}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-bold leading-snug text-foreground">
            <Link to={open} className="no-underline text-foreground transition-colors hover:text-primary">
              {feed.label}
            </Link>
          </h3>
          {feed.installed || !onImport || !feed.feedId ? (
            <Link
              to={open}
              data-testid={`${testId}-cta`}
              aria-label={`Open ${feed.label}`}
              className="no-underline flex min-h-11 min-w-11 size-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <button
              type="button"
              data-testid={`${testId}-import`}
              disabled={importing || busy}
              onClick={() => onImport(feed.feedId!)}
              className={cn(
                'flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4',
                'text-[11px] font-bold uppercase tracking-wider',
                'border-primary/30 bg-primary/10 text-primary',
                'transition-colors hover:bg-primary/20',
                'disabled:cursor-wait disabled:opacity-60',
              )}
            >
              {importing ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <CloudDownload className="size-3" aria-hidden="true" />}
              {importing ? 'Importing' : 'Subscribe'}
            </button>
          )}
        </div>

        {feed.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground text-pretty">{feed.description}</p>
        )}

        {feed.notebooks.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid={`${testId}-notebooks`}>
            {shown.map((notebook) => {
              const notebookHref = notebook.installed
                ? notebook.href
                : `${notebook.href}${feed.feedId ? `?feed=${encodeURIComponent(feed.feedId)}` : ''}`;
              const hasToggle = Boolean(onToggleNotebookSubscription && feed.feedId && notebook.chunkId);
              return (
                <span
                  key={notebook.packageId}
                  data-testid={`${testId}-notebook-${notebook.packageId}`}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border text-[11px] font-semibold tracking-wide transition-colors',
                    hasToggle ? 'pl-2.5 pr-1 py-0.5' : 'px-2.5 py-1',
                    notebook.subscribed
                      ? 'border-emerald-600/30 bg-emerald-100 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  <Link
                    to={notebookHref}
                    className="no-underline text-current hover:text-primary"
                  >
                    {notebook.label}
                  </Link>
                  {hasToggle && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleNotebookSubscription!(feed.feedId!, notebook.chunkId!, !notebook.subscribed);
                      }}
                      title={notebook.subscribed ? `Unsubscribe ${notebook.label}` : `Subscribe ${notebook.label}`}
                      aria-label={notebook.subscribed ? `Unsubscribe ${notebook.label}` : `Subscribe ${notebook.label}`}
                      data-testid={`${testId}-notebook-toggle-${notebook.packageId}`}
                      className="inline-flex size-7 items-center justify-center rounded-full font-bold hover:bg-foreground/10 hover:text-foreground"
                    >
                      {notebook.subscribed ? '✓' : '+'}
                    </button>
                  )}
                </span>
              );
            })}
            {overflow > 0 && (
              <span className="rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
                +{overflow} more
              </span>
            )}
          </div>
        )}

        <div className="mt-auto pt-1">
          {meta}
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
