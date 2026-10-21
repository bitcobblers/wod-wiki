/**
 * SeedCard — one SEED in the home Library & Community Feeds section.
 *
 * The seed is the unit a reader subscribes to, so the card is the seed:
 * cover identity (deterministic monogram tile tinted by seed id), the
 * repository label and description, and — because one Subscribe imports all
 * of them — the notebooks the seed publishes, as chips. Chips deep-link to
 * their own surface once the notebook is installed; before that the card's
 * one primary action is the seed-wide Import (re-sync and removal live in
 * Settings → Sync).
 */
import { Link } from 'react-router-dom';
import { ArrowRight, CloudDownload, Layers, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNotebookDate as formatDate, monogramLetter, monogramTint } from './notebookGalleryModel';
import type { SeedSummary } from './notebookGalleryModel';

/** Notebooks listed on a card before the rest collapse into a count. */
const MAX_NOTEBOOK_CHIPS = 4;

export interface SeedCardProps {
  seed: SeedSummary;
  /** Root test id — callers pass a stable per-seed id. */
  testId?: string;
  /** Extra classes on the root article (e.g. fixed width inside a marquee row). */
  className?: string;
  /** Import action for seeds whose content is not all present; omit → no button. */
  onImport?: (seedId: string) => void;
  /** True while this seed's import is running (spinner). */
  importing?: boolean;
  /** True while another seed's import is running (disable, no spinner). */
  busy?: boolean;
  /** Inline status line from the owning section (progress / error text). */
  status?: { text: string; tone: 'muted' | 'error' };
}

export function SeedCard({ seed, testId = 'seed-card', className, onImport, importing, busy, status }: SeedCardProps) {
  const tint = monogramTint(seed.slug);
  const [background, foreground] = tint.split(' ');
  const updated = formatDate(seed.latestDate);
  const shown = seed.notebooks.slice(0, MAX_NOTEBOOK_CHIPS);
  const overflow = seed.notebooks.length - shown.length;
  const open = seed.installed && seed.seedId ? seed.href : undefined;
  const coverImage = seed.notebooks.find((notebook) => notebook.image)?.image;

  const meta = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
      <span className="tabular-nums">
        {seed.notebooks.length} {seed.notebooks.length === 1 ? 'notebook' : 'notebooks'}
      </span>
      {seed.installed && seed.itemCount > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {seed.itemCount} {seed.itemCount === 1 ? 'item' : 'items'}
          </span>
        </>
      )}
      {seed.installed && updated && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">updated {updated}</span>
        </>
      )}
      {!seed.installed && <span aria-hidden>·</span>}
      {!seed.installed && <span>not imported</span>}
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
            {monogramLetter(seed.label)}
          </span>
          <Layers className={cn('absolute bottom-4 right-4 size-6 opacity-50', foreground)} aria-hidden />
        </div>
      )}
    </div>
  );

  return (
    <article
      data-testid={testId}
      data-installed={seed.installed}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card',
        'transition-colors hover:border-foreground/25 focus-within:border-foreground/25',
        className,
      )}
    >
      {open ? (
        <Link to={open} data-testid={`${testId}-open`} className="block outline-none" aria-label={`Open the library for ${seed.label}`}>
          {cover}
        </Link>
      ) : (
        cover
      )}

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-bold leading-snug text-foreground">
            {open ? <Link to={open} className="transition-colors hover:text-primary">{seed.label}</Link> : seed.label}
          </h3>
          {open ? (
            <Link
              to={open}
              data-testid={`${testId}-cta`}
              aria-label={`Open the library for ${seed.label}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ) : onImport && seed.seedId ? (
            <button
              type="button"
              data-testid={`${testId}-import`}
              disabled={importing || busy}
              onClick={() => onImport(seed.seedId!)}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3',
                'text-[10px] font-black uppercase tracking-widest',
                'border-primary/30 bg-primary/10 text-primary',
                'transition-colors hover:bg-primary/20',
                'disabled:cursor-wait disabled:opacity-60',
              )}
            >
              {importing ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <CloudDownload className="size-3" aria-hidden />}
              {importing ? 'Importing' : 'Import seed'}
            </button>
          ) : null}
        </div>

        {seed.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{seed.description}</p>
        )}

        {/* One Subscribe brings every notebook — say which. */}
        {seed.notebooks.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid={`${testId}-notebooks`}>
            {shown.map((notebook) =>
              notebook.installed ? (
                <Link
                  key={notebook.packageId}
                  to={notebook.href}
                  data-testid={`${testId}-notebook-${notebook.packageId}`}
                  className="rounded-full border border-border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/80 transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {notebook.label}
                </Link>
              ) : (
                <span
                  key={notebook.packageId}
                  data-testid={`${testId}-notebook-${notebook.packageId}`}
                  className="rounded-full border border-border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/70"
                >
                  {notebook.label}
                </span>
              ),
            )}
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
