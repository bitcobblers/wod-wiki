/**
 * FeedCard — one FEED in the home Library & Community Feeds section.
 *
 * The feed is the unit a reader subscribes to, so the card is the feed:
 * cover identity (deterministic monogram tile tinted by feed id), the
 * repository label and description, and — because one Subscribe imports all
 * of them — the notebooks the feed publishes, as chips. Chips deep-link to
 * their own surface once the notebook is installed; before that the card's
 * one primary action is the feed-wide Import (re-sync and removal live in
 * Settings → Sync).
 */
import { Link } from 'react-router-dom';
import { ArrowRight, CloudDownload, Layers, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  /** Import action for feeds whose content is not all present; omit → no button. */
  onImport?: (feedId: string) => void;
  /** True while this feed's import is running (spinner). */
  importing?: boolean;
  /** True while another feed's import is running (disable, no spinner). */
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
  const open = feed.installed && feed.feedId ? feed.href : undefined;
  const coverImage = feed.notebooks.find((notebook) => notebook.image)?.image;

  const meta = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
      <span className="tabular-nums">
        {feed.notebooks.length} {feed.notebooks.length === 1 ? 'notebook' : 'notebooks'}
      </span>
      {feed.installed && feed.itemCount > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {feed.itemCount} {feed.itemCount === 1 ? 'item' : 'items'}
          </span>
        </>
      )}
      {feed.installed && updated && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">updated {updated}</span>
        </>
      )}
      {!feed.installed && <span aria-hidden>·</span>}
      {!feed.installed && <span>not imported</span>}
    </div>
  );

  const cover = (
    <div className={cn('relative overflow-hidden bg-muted/40 aspect-[16/10]', background)}>
      {coverImage ? (
        // A published cover from the corpus (README `image:`), else the monogram.
        <img src={coverImage} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn('text-7xl font-black tracking-tighter select-none', foreground)} aria-hidden>
            {monogramLetter(feed.label)}
          </span>
          <Layers className={cn('absolute bottom-4 right-4 size-6 opacity-50', foreground)} aria-hidden />
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
      {open ? (
        <Link to={open} data-testid={`${testId}-open`} className="block outline-none" aria-label={`Open the library for ${feed.label}`}>
          {cover}
        </Link>
      ) : (
        cover
      )}

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-bold leading-snug text-foreground">
            {open ? <Link to={open} className="transition-colors hover:text-primary">{feed.label}</Link> : feed.label}
          </h3>
          {open ? (
            <Link
              to={open}
              data-testid={`${testId}-cta`}
              aria-label={`Open the library for ${feed.label}`}
              className="flex min-h-11 min-w-11 size-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ) : onImport && feed.feedId ? (
            <button
              type="button"
              data-testid={`${testId}-import`}
              disabled={importing || busy}
              onClick={() => onImport(feed.feedId!)}
              className={cn(
                'flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4',
                'text-[10px] font-black uppercase tracking-widest',
                'border-primary/30 bg-primary/10 text-primary',
                'transition-colors hover:bg-primary/20',
                'disabled:cursor-wait disabled:opacity-60',
              )}
            >
              {importing ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <CloudDownload className="size-3" aria-hidden />}
              {importing ? 'Importing' : 'Import feed'}
            </button>
          ) : null}
        </div>

        {feed.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{feed.description}</p>
        )}

        {/* One Subscribe brings every notebook — say which. */}
        {feed.notebooks.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid={`${testId}-notebooks`}>
            {shown.map((notebook) => (
              <span
                key={notebook.packageId}
                data-testid={`${testId}-notebook-${notebook.packageId}`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest transition-colors',
                  notebook.subscribed
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                    : 'border-border text-muted-foreground/70',
                )}
              >
                {notebook.installed ? (
                  <Link to={notebook.href} className="hover:text-primary">
                    {notebook.label}
                  </Link>
                ) : (
                  <span>{notebook.label}</span>
                )}
                {/* ponytail: -my-3 negative margin keeps pill compact while providing 44px tap target; expand pill fully if touch collision occurs. */}
                {onToggleNotebookSubscription && feed.feedId && notebook.chunkId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleNotebookSubscription(feed.feedId!, notebook.chunkId!, !notebook.subscribed);
                    }}
                    title={notebook.subscribed ? `Unsubscribe ${notebook.label}` : `Subscribe ${notebook.label}`}
                    aria-label={notebook.subscribed ? `Unsubscribe ${notebook.label}` : `Subscribe ${notebook.label}`}
                    data-testid={`${testId}-notebook-toggle-${notebook.packageId}`}
                    className="relative -my-3 -mr-2.5 ml-0.5 inline-flex min-h-11 min-w-11 items-center justify-center font-bold hover:text-foreground"
                  >
                    {notebook.subscribed ? '✓' : '+'}
                  </button>
                )}
              </span>
            ))}
            {overflow > 0 && (
              <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">
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
