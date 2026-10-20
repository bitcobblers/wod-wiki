/**
 * YouTubeLightbox.tsx — a fullscreen YouTube overlay shared by the home
 * page's "Why Wod Wiki?" placeholder and the guide watch buttons.
 *
 * Portals to document.body (mirrors FocusedDialog — CodeMirror traps fixed
 * positioning), renders a 16:9 nocookie embed with autoplay, and closes on
 * backdrop click, the close button, or Escape.
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface YouTubeLightboxProps {
  videoId: string
  title?: string
  onClose: () => void
}

export function YouTubeLightbox({ videoId, title = 'YouTube video', onClose }: YouTubeLightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 animate-in fade-in duration-200"
      data-testid="youtube-lightbox"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <button
        type="button"
        onClick={onClose}
        title="Close video"
        data-testid="youtube-lightbox-close"
        className="absolute right-4 top-4 z-[110] flex size-11 items-center justify-center rounded-full border border-border bg-background/80 text-foreground transition-colors hover:bg-accent"
      >
        <X className="size-5" />
      </button>
      <div className="aspect-video w-full max-w-5xl overflow-hidden rounded-lg border border-border bg-black shadow-2xl">
        <iframe
          className="h-full w-full border-0"
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>,
    document.body,
  )
}

export default YouTubeLightbox
