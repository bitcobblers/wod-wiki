/**
 * NotebookCoverArt — the visual identity of a notebook package.
 *
 * Two modes:
 *  - declared cover (`image:` front matter): blur-up lazy load (5px → 0 +
 *    opacity fade over 500ms) with graceful fallback to the monogram on error;
 *  - no cover: a deterministic flat monogram tile — one muted tint chosen by
 *    hashing the slug, a giant initial, and the kind glyph. No gradients, no
 *    stock imagery, stable across sessions and themes.
 *
 * Shared by the section card and any future detail hero; the caller owns
 * the outer frame (aspect ratio, rounding) via `className`.
 */
import { useState } from 'react';
import { Layers, Rss } from 'lucide-react';
import { cn } from '@/lib/utils';
import { monogramLetter, monogramTint } from './notebookGalleryModel';
import type { NotebookSummary } from './notebookGalleryModel';

const KIND_ICON = { feed: Rss, collection: Layers } as const;

export function NotebookCoverArt({
  notebook,
  className,
}: {
  notebook: Pick<NotebookSummary, 'slug' | 'label' | 'kind' | 'image'>;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const Icon = KIND_ICON[notebook.kind];
  const tint = monogramTint(notebook.slug);
  const showImage = notebook.image && !broken;

  return (
    <div className={cn('relative overflow-hidden bg-muted/40', className)}>
      {showImage ? (
        <img
          src={notebook.image}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          className={cn(
            'absolute inset-0 size-full object-cover transition-[filter,opacity] duration-500',
            loaded ? 'opacity-100 blur-0' : 'opacity-0 blur-[5px]',
          )}
        />
      ) : (
        <div className={cn('absolute inset-0 flex items-center justify-center', tint.split(' ')[0])}>
          <span
            className={cn('text-7xl font-black tracking-tighter select-none', tint.split(' ')[1])}
            aria-hidden
          >
            {monogramLetter(notebook.label)}
          </span>
          <Icon className={cn('absolute bottom-4 right-4 size-6 opacity-50', tint.split(' ')[1])} aria-hidden />
        </div>
      )}
    </div>
  );
}
