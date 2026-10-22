/**
 * GuideIndexFooter — end-of-page chapter list, two variants:
 *
 *  - 'index' (default): the compact bordered list at the end of /guide/*
 *    chapters ("What's Next" — the chapter after the current one is marked,
 *    last wraps to First Workout). Rows mirror the collection sub-note
 *    listing (bordered card, uppercase band header, divide-y links).
 *  - 'university': the home page's "Wod Wiki University" section — a
 *    TaglineHeader section (id tour-section-university, listed in the L3
 *    "On this page" outline) with one card per chapter: title, one-line
 *    description (guide frontmatter `description`), and a small YouTube
 *    thumbnail that opens the walkthrough lightbox. Video and text
 *    alternate sides per row.
 *
 * On lg+ the canvas home + guide pages drop the desktop L2 sidebar
 * (AppContent's hideDesktopSidebar) and this list carries the chapter links
 * instead; below lg the mobile drawer keeps the L2 as well.
 */

import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Play } from 'lucide-react'

import { useCanvasRoutes } from './canvasRoutes'
import { guideChildrenFrom } from '../nav/appNavTree'
import { YouTubeLightbox } from '../tour/YouTubeLightbox'
import { TaglineHeader } from '../tour/TaglineHeader'
import { TOUR_ACCENTS } from '../tour/tourConstants'
import { cn } from '@/lib/utils'

// ponytail: every guide watches the rickroll stand-in until the real
// per-guide YouTube cuts exist — add a chapter-id → video-id map here.
const GUIDE_VIDEO_ID = 'dQw4w9WgXcQ'
const THUMB_URL = `https://i.ytimg.com/vi/${GUIDE_VIDEO_ID}/hqdefault.jpg`

export function GuideIndexFooter({ variant = 'index' }: { variant?: 'index' | 'university' }) {
  const routes = useCanvasRoutes()
  const { pathname } = useLocation()
  const [watching, setWatching] = useState<{ id: string; label: string } | null>(null)
  const chapters = useMemo(
    () =>
      guideChildrenFrom(routes).flatMap((c) =>
        c.action?.type === 'route' ? [{ id: c.id, label: c.label, to: c.action.to }] : [],
      ),
    [routes],
  )
  // Card blurb per chapter — the guide frontmatter `description` field.
  const descriptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of routes) {
      if (r.route.startsWith('/collections') || r.page.frontmatter?.type !== 'guide') continue
      const d = r.page.frontmatter?.description
      if (d) map.set(`guide-${r.route}`, String(d))
    }
    return map
  }, [routes])
  if (chapters.length === 0) return null

  const currentIndex = chapters.findIndex((c) => c.to === pathname)
  const isGuidePage = currentIndex >= 0
  const nextIndex =
    isGuidePage && chapters.length > 1 ? (currentIndex + 1) % chapters.length : -1

  const lightbox = watching && (
    <YouTubeLightbox
      videoId={GUIDE_VIDEO_ID}
      title={watching.label}
      onClose={() => setWatching(null)}
    />
  )

  if (variant === 'university') {
    return (
      <section
        id="tour-section-university"
        data-testid="tour-section-university"
        aria-label="Wod Wiki University"
      >
        <TaglineHeader
          index="05"
          before="Wod Wiki "
          accentText="University"
          after=""
          accent={TOUR_ACCENTS.library}
          blurb="Eight short chapters take you from your first workout to querying your training history. Each guide pairs a video walkthrough with a runnable example."
        />
        <nav aria-label="Wod Wiki University" className="px-6 pb-16 lg:px-12 xl:px-16">
          <ul className="mx-auto flex w-full max-w-5xl flex-col gap-5">
            {chapters.map((c, idx) => (
              <li
                key={c.id}
                className={cn(
                  'flex flex-col gap-5 rounded-lg border border-border p-5 md:flex-row md:items-center md:gap-8 md:p-6',
                  idx % 2 === 1 && 'md:flex-row-reverse',
                )}
              >
                <button
                  type="button"
                  onClick={() => setWatching({ id: c.id, label: c.label })}
                  title={`Watch: ${c.label}`}
                  aria-label={`Watch: ${c.label}`}
                  data-testid="guide-watch"
                  className="group relative block w-full flex-none overflow-hidden rounded-md border border-border md:w-56"
                >
                  <img
                    src={THUMB_URL}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/40">
                    <Play className="size-9 fill-white text-white" />
                  </span>
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Link to={c.to} className="font-semibold hover:underline">
                    {c.label}
                  </Link>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {descriptions.get(c.id) ?? c.to}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </nav>
        {lightbox}
      </section>
    )
  }

  return (
    <nav
      aria-label={isGuidePage ? 'What’s Next' : 'Syntax & Guides'}
      data-testid="guide-index-footer"
      className="border-t border-border px-6 py-12 xl:py-16"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col rounded-lg border border-border overflow-hidden">
        <h2 className="px-4 py-2 text-xs font-black uppercase tracking-wider text-muted-foreground bg-muted/40">
          {isGuidePage ? 'What’s Next' : 'Syntax & Guides'} · {chapters.length}
        </h2>
        <ul className="flex flex-col divide-y divide-border">
          {chapters.map((c, idx) => (
            <li key={c.id} className="flex items-stretch">
              <Link
                to={c.to}
                aria-current={idx === currentIndex ? 'page' : undefined}
                className={cn(
                  'flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 hover:bg-muted/50',
                  idx === currentIndex && 'bg-muted/50',
                )}
              >
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span className="font-medium">{c.label}</span>
                  {idx === nextIndex && (
                    <span className="text-xs font-semibold text-primary" data-testid="guide-next-marker">
                      Next →
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{c.to}</span>
              </Link>
              <button
                type="button"
                onClick={() => setWatching({ id: c.id, label: c.label })}
                title={`Watch: ${c.label}`}
                aria-label={`Watch: ${c.label}`}
                data-testid="guide-watch"
                className="flex flex-none items-center gap-1.5 border-l border-border px-4 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <Play className="size-3.5" />
                Watch
              </button>
            </li>
          ))}
        </ul>
      </div>
      {lightbox}
    </nav>
  )
}
