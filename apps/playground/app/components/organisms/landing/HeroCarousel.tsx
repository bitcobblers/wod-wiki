/**
 * HeroCarousel — scroll-driven, snap-scrolling image carousel for canvas hero sections.
 *
 * Renders a full-width horizontal strip of slides. Users can scroll/swipe
 * naturally to see each step in the workflow. The carousel is responsive and
 * uses CSS scroll-snap for smooth mobile interaction.
 *
 * Wired into the canvas prose pipeline via the `{{hero-carousel}}` inline
 * token (see `CanvasProsePanel.tsx`).
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface HeroSlide {
  src: string;
  alt: string;
  eyebrow: string;
  title: string;
  caption: string;
}

export const HERO_CAROUSEL_TOKEN = '{{hero-carousel}}';

export const DEFAULT_HERO_SLIDES: HeroSlide[] = [
  {
    src: '/images/hero/editing.png',
    alt: 'WhiteboardScript editor with live syntax highlighting and inline previews',
    eyebrow: 'Write',
    title: 'Type your workout in plain Markdown.',
    caption: 'Movements, reps, time caps, and rounds — fenced in a familiar ```time block. No drag-and-drop. No proprietary DSL.',
  },
  {
    src: '/images/hero/timer.png',
    alt: 'Live runtime timer HUD counting down an interval with active round and rest indicators',
    eyebrow: 'Run',
    title: 'Press Run. The compiler takes over.',
    caption: 'Your Markdown becomes a live wallclock. The JIT engine dispatches rounds, counts reps, and tracks rest — all offline.',
  },
  {
    src: '/images/hero/journal.png',
    alt: 'Unified Library listing journal notes, notebook workouts, and dated entries',
    eyebrow: 'Library',
    title: 'Browse Journal and Notebook notes in one Library.',
    caption: 'Your dated journal notes and preloaded notebook benchmarks live in one unified surface. Search, filter by source, or clone to today’s note.',
  },
  {
    src: '/images/hero/results.png',
    alt: 'WQL Metric Explorer displaying volume trends and embedded dashboard blocks',
    eyebrow: 'Query',
    title: 'Ask questions with Wod Query Language (WQL).',
    caption: 'Aggregate volume, track TIS intensity trends, or embed live query and dashboard blocks directly in your Markdown notes.',
  },
  // ponytail: a 'Cast' slide lived here referencing /images/hero/casting.png,
  // which does not exist in public/ (every load 404'd). Re-add the slide
  // when a real casting screenshot lands in public/images/hero/.
];

export interface HeroCarouselProps {
  slides?: HeroSlide[];
  className?: string;
}

export function HeroCarousel({ slides = DEFAULT_HERO_SLIDES, className }: HeroCarouselProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const handler = () => {
      const slideWidth = track.clientWidth;
      const next = Math.round(track.scrollLeft / slideWidth);
      setActiveIndex(Math.min(Math.max(next, 0), slides.length - 1));
    };

    track.addEventListener('scroll', handler, { passive: true });
    return () => track.removeEventListener('scroll', handler);
  }, [slides.length]);

  const goTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className={cn('relative w-full', className)}>
      <div
        ref={trackRef}
        className="flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth scrollbar-none"
        style={{ scrollbarWidth: 'none' }}
      >
        {slides.map((slide, idx) => (
          <article
            key={slide.src}
            className="relative flex w-full shrink-0 snap-start flex-col gap-4 sm:flex-row sm:items-center sm:gap-8"
            aria-label={`Slide ${idx + 1} of ${slides.length}: ${slide.title}`}
          >
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-border/60 bg-muted shadow-sm sm:w-1/2">
              <img
                src={slide.src}
                alt={slide.alt}
                loading={idx === 0 ? 'eager' : 'lazy'}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-1/2 sm:gap-3">
              <span className="text-[10px] font-black uppercase tracking-[0.24em] text-primary/80">
                {slide.eyebrow}
              </span>
              <h3 className="text-2xl font-black tracking-[-0.04em] text-foreground sm:text-3xl">
                {slide.title}
              </h3>
              <p className="text-sm leading-7 text-muted-foreground sm:text-base">
                {slide.caption}
              </p>
              <div className="mt-2 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                <span className="text-primary">Step {idx + 1}</span>
                <span aria-hidden="true">/</span>
                <span>{slides.length}</span>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        {slides.map((slide, idx) => (
          <button
            key={slide.src}
            type="button"
            onClick={() => goTo(idx)}
            aria-label={`Go to slide ${idx + 1}: ${slide.title}`}
            aria-current={idx === activeIndex ? 'true' : 'false'}
            className={cn(
              'h-2 rounded-full transition-all',
              idx === activeIndex
                ? 'w-8 bg-primary'
                : 'w-2 bg-border hover:bg-muted-foreground/40'
            )}
          />
        ))}
      </div>
    </div>
  );
}
