/**
 * useSectionScrollSpy — keeps NavContext's activeL3 on the section the reader
 * is actually looking at. HomeTour publishes the tour outline with
 * `setL3Items`, but `usePageScrollSync`'s observer only watches
 * `currentNavLinks`, and `deriveNav` returns [] on `/` — so without this hook
 * the right rail only highlights after a click.
 *
 * Dispatches the DOM section id (`tour-section-*`) — the id space the rail
 * already compares against everywhere: MenuList matches
 * `entry.sectionId === activeId`, NavSidebar matches
 * `navState.activeL3Id === item.action.sectionId`, and clicks dispatch the
 * same value via `NavContext.scrollToSection`.
 */
import { useEffect } from 'react'
import { useNav } from '../nav/NavContext'
import type { NavStateAction } from '../nav/navTypes'

/** A section counts as "being read" once its top has crossed this line. */
const READING_LINE = 0.4

export function useSectionScrollSpy(sectionIds: readonly string[]): void {
  const { dispatch: navDispatch } = useNav()

  useEffect(() => {
    const els = sectionIds
      .map(id => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)
    if (els.length === 0 || typeof IntersectionObserver === 'undefined') return

    // The current section is the last one whose top crossed the reading line.
    // Recomputing from live rects on every callback keeps the pick exact no
    // matter which threshold fired, so a section merely peeking at the
    // viewport bottom never steals the highlight.
    const pick = (): string | null => {
      const line = window.innerHeight * READING_LINE
      let current: string | null = null
      for (const el of els) {
        const rect = el.getBoundingClientRect()
        // Hidden steps (e.g. the boards step below lg) report a zero rect
        // pinned to 0,0 — they would otherwise always read as "crossed".
        if (rect.width === 0 && rect.height === 0) continue
        if (rect.top > line) break
        current = el.id
      }
      return current
    }

    const observer = new IntersectionObserver(
      () => {
        const id = pick()
        if (id) navDispatch({ type: 'SET_ACTIVE_L3', id } satisfies NavStateAction)
      },
      {
        // Dense thresholds keep callbacks flowing while a section scrolls;
        // the SET_ACTIVE_L3 reducer no-ops on an unchanged id, so redundant
        // recomputes are free.
        threshold: Array.from({ length: 21 }, (_, i) => i / 20),
      },
    )
    els.forEach(el => observer.observe(el))
    return () => observer.disconnect()
    // Callers pass an inline literal derived from a memoized outline —
    // compare by value so unrelated re-renders don't rebuild the observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionIds.join('\n'), navDispatch])
}
