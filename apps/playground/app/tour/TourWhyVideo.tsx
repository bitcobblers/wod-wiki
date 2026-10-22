/**
 * TourWhyVideo.tsx — the "Why Wod Wiki?" video pitch inside the hero: the
 * YouTube thumbnail (the nocookie embed's hqdefault) with a play affordance,
 * clicking opens the fullscreen YouTubeLightbox, exactly like the guide
 * watch buttons. Under it, a paragraph hands off to the live demo below.
 */
import { useState } from 'react'
import { ChevronDown, Play, X } from 'lucide-react'
import { YouTubeLightbox } from './YouTubeLightbox'

// ponytail: rickroll stand-in — swap WHY_VIDEO_ID for the real
// "Why Wod Wiki?" cut when it ships (same component, no other change).
const WHY_VIDEO_ID = 'dQw4w9WgXcQ'

export function TourWhyVideo({ onWatched }: { onWatched?: () => void }) {
  const [playing, setPlaying] = useState(false)

  // ponytail: "watched" = the lightbox was closed — the nocookie embed
  // reports no end-of-video event without the YouTube iframe API; wire
  // onWatched to that if exact completion ever matters.
  const closeLightbox = () => {
    setPlaying(false)
    onWatched?.()
  }

  // Skip: dismiss the pitch without watching it. Same effect as watching
  // (the hero hands over to the editor below), so a visitor who is not
  // interested in the pitch is never held hostage by it.
  const skip = () => {
    setPlaying(false)
    onWatched?.()
  }

  return (
    <div className="flex w-full flex-col items-center gap-4 xl:gap-5">
      {/* The thumbnail and the skip button are siblings, not nested: a
          button inside the play button would be invalid HTML and would
          swallow the play click. */}
      <div className="group relative aspect-video w-full max-w-2xl rounded-xl border border-border bg-black text-left shadow-xl transition-shadow hover:shadow-2xl 2xl:max-w-3xl">
        <button
          type="button"
          onClick={() => setPlaying(true)}
          data-testid="tour-why-video"
          aria-label="Play the Why Wod Wiki? video"
          className="block h-full w-full overflow-hidden rounded-xl"
        >
          <img
            src={`https://i.ytimg.com/vi/${WHY_VIDEO_ID}/hqdefault.jpg`}
            alt="Why Wod Wiki? video thumbnail"
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          <span className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg transition-transform duration-300 group-hover:scale-110 xl:size-16">
            <Play className="ml-1 size-6 fill-current xl:size-7" />
          </span>
          <span className="absolute bottom-3 left-4 font-mono text-[11px] uppercase tracking-[0.2em] text-white/90">
            Why Wod Wiki? · YouTube
          </span>
        </button>
        {/* Skip the pitch. Offset by a quarter of the button so it hangs
            over the thumbnail's corner instead of sitting inside it. Below
            md the video fills its container edge to edge, so there is no
            room to hang over (it would hang off the screen) and the button
            sits flush in the corner. The ::after grows the TAP target to
            56px without changing the 32px circle — a finger needs more
            than the visual size. */}
        <button
          type="button"
          onClick={skip}
          data-testid="tour-why-video-skip"
          title="Skip the video"
          aria-label="Skip the Why Wod Wiki? video"
          className="absolute right-0 top-0 z-10 flex size-8 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary after:absolute after:-inset-3 after:content-[''] md:-right-2 md:-top-2"
        >
          <X className="size-4" />
        </button>
      </div>

      <p
        data-testid="tour-scroll-hint"
        className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground"
      >
        <ChevronDown className="size-4 animate-bounce" />
        Keep scrolling for the demo
      </p>

      {playing && (
        <YouTubeLightbox videoId={WHY_VIDEO_ID} title="Why Wod Wiki?" onClose={closeLightbox} />
      )}
    </div>
  )
}

export default TourWhyVideo
