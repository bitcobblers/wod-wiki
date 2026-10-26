/**
 * MarqueeRow — an infinitely sliding row of cards.
 *
 * The Library & Community Feeds section rows: content wider than the
 * viewport loops seamlessly by rendering the card set enough times to fill
 * at least one viewport width per half, then translating the track by
 * exactly one half. Row direction (left/right/alternating) is the caller's
 * choice, so paired rows can slide opposite ways.
 *
 * Accessibility: the row pauses on hover/focus-within (interactive cards
 * must not move under the pointer or keyboard), duplicate copies are
 * aria-hidden, and prefers-reduced-motion renders a single static copy.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { cn } from '@/lib/utils'

export interface MarqueeRowProps {
  /** 'left' | 'right' loop infinitely one way; 'alternate' slides out and back. */
  direction: 'left' | 'right' | 'alternate'
  /** One full set of children — repeated as needed to fill the viewport. */
  children: ReactNode
  testId?: string
  className?: string
}

export function MarqueeRow({ direction, children, testId, className }: MarqueeRowProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  // Card sets per half: enough copies that one half covers the viewport.
  const [perHalf, setPerHalf] = useState(1)
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  useEffect(() => {
    const container = containerRef.current
    const track = trackRef.current
    if (!container || !track) return
    const update = () => {
      const copies = perHalf * 2
      const setWidth = track.scrollWidth / copies
      if (setWidth <= 0) return
      const needed = Math.max(1, Math.ceil(container.clientWidth / setWidth))
      if (needed !== perHalf) setPerHalf(needed)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(track)
    return () => observer.disconnect()
  }, [perHalf, children])

  const copies = reduceMotion ? 1 : perHalf * 2

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      className={cn('wod-marquee overflow-hidden', className)}
    >
      <div
        ref={trackRef}
        className={cn(
          'flex w-max',
          !reduceMotion && 'wod-marquee-track',
          !reduceMotion && direction === 'left' && 'wod-marquee-track--left',
          !reduceMotion && direction === 'right' && 'wod-marquee-track--right',
          !reduceMotion && direction === 'alternate' && 'wod-marquee-track--left wod-marquee-track--alternate',
        )}
      >
        {Array.from({ length: copies }, (_, copy) => (
          // Copies repeat for the seamless loop; tests scope queries to copy 0.
          <div key={copy} data-marquee-copy={copy} aria-hidden={copy > 0} inert={copy > 0} className="flex shrink-0 items-stretch gap-4 pr-4">
            {children}
          </div>
        ))}
      </div>
    </div>
  )
}
