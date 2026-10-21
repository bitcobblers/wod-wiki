/**
 * GuideIndexFooter — the end-of-page chapter list for the canvas home page
 * and the /guide/* chapters. On lg+ those pages drop the desktop L2 sidebar
 * (AppContent's hideDesktopSidebar) and this list carries the chapter links
 * instead; below lg the mobile drawer keeps the L2 as well.
 *
 * On a guide page the card is headed "What's Next" and the chapter after the
 * current one is marked — the successor of the old prev/next button block
 * (last chapter wraps back to First Workout). Rows mirror the collection
 * sub-note listing (bordered card, uppercase band header, divide-y links).
 */

import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Play } from 'lucide-react'

import { useCanvasRoutes } from './canvasRoutes'
import { guideChildrenFrom } from '../nav/appNavTree'
import { YouTubeLightbox } from '../tour/YouTubeLightbox'
import { cn } from '@/lib/utils'

// ponytail: every guide watches the rickroll stand-in until the real
// per-guide YouTube cuts exist — add a chapter-id → video-id map here.
const GUIDE_VIDEO_ID = 'dQw4w9WgXcQ'

export function GuideIndexFooter() {
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
  if (chapters.length === 0) return null

  const currentIndex = chapters.findIndex((c) => c.to === pathname)
  const isGuidePage = currentIndex >= 0
  const nextIndex =
    isGuidePage && chapters.length > 1 ? (currentIndex + 1) % chapters.length : -1

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
      {watching && (
        <YouTubeLightbox
          videoId={GUIDE_VIDEO_ID}
          title={watching.label}
          onClose={() => setWatching(null)}
        />
      )}
    </nav>
  )
}
