/**
 * usePageScrollSync — owns the page-scroll-spy plumbing that `AppContent`
 * used to inline.
 *
 * Three concerns, all related to making NavContext L3 clicks scroll the
 * right target and keeping the active L3 in sync with what is on screen:
 *
 *   1. `scrollToSection` — the DOM `getElementById` + `scrollIntoView` path
 *      (used by canvas / list pages), with a CodeMirror fallback that
 *      resolves the heading-id to a doc line and dispatches an editor
 *      scroll (used by editor / playground-note pages).
 *   2. `registerScrollFn` — registers the scroll function with `NavContext`
 *      so the NavSidebar L3 click can dispatch into our handler.
 *   3. `IntersectionObserver` — observes every link's DOM target and
 *      dispatches `SET_ACTIVE_L3` to NavContext as the user scrolls.
 *   4. `setL3Items` — mirrors the current nav-link list into NavContext so
 *      the right-side accordion / panel stays in sync.
 *
 * The hook returns `handleViewCreated`, the callback editor pages pass to
 * their CodeMirror factory so we can hold a ref to the live `EditorView`.
 */
import { useCallback, useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { useNav } from '../nav/NavContext'
import type { NavStateAction } from '../nav/navTypes'
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'
import { mapIndexToL3 } from '../pages/shared/pageUtils'
import { sectionField } from '@bitcobblers/wod-wiki-ui'
export interface UsePageScrollSync {
  /** Pass to a CodeMirror factory so we can hold the live `EditorView` for editor-scroll fallback. */
  handleViewCreated: (view: EditorView) => void
  /** Resolve an L3 link id to a scroll target — DOM first, CodeMirror second. */
  scrollToSection: (id: string) => void
}

export function usePageScrollSync(currentNavLinks: PageNavLink[]): UsePageScrollSync {
  const { setL3Items, registerScrollFn, dispatch: navDispatch } = useNav()
  const editorViewRef = useRef<EditorView | null>(null)

  const handleViewCreated = useCallback((view: EditorView) => {
    editorViewRef.current = view
  }, [])

  const scrollToSection = useCallback((id: string) => {
    if (!id) return

    const findDomElement = (targetId: string): HTMLElement | null => {
      let el = document.getElementById(targetId)
      if (el) return el
      el = document.querySelector(`[data-section-id="${targetId}"]`)
      if (el) return el
      const parts = targetId.split(':')
      for (const part of parts) {
        if (part) {
          el = document.getElementById(part) ?? document.querySelector(`[data-section-id="${part}"]`)
          if (el) return el
        }
      }
      return null
    }

    // 1. Try standard DOM element (Canvas / List / Card pages).
    const el = findDomElement(id)
    if (el) {
      const prev = el.style.scrollMarginTop
      const isMobileViewport = window.innerWidth < 1024
      const offset = isMobileViewport ? 75 : 96
      el.style.scrollMarginTop = `${offset}px`
      el.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      requestAnimationFrame(() => { el.style.scrollMarginTop = prev })
      if (typeof window.scrollTo === 'function') {
        const top = el.getBoundingClientRect().top + window.scrollY - offset
        window.scrollTo({ top: Math.max(0, top) })
      }
      return
    }

    // 2. Try CodeMirror line (Editor pages / Note surfaces).
    if (editorViewRef.current) {
      const view = editorViewRef.current
      const content = view.state.doc.toString()
      const lines = content.split('\n')

      let lineIdx = -1

      // Line-anchored outline ids — one per fence family (time/log workout
      // blocks, query widgets, custom widgets). `<tag>-line-N` is 1-based.
      const lineMatch = id.match(/^(?:workout|time|log|query|widget)-line-(\d+)$/)
      if (lineMatch) {
        lineIdx = Number(lineMatch[1]) - 1
      } else {
        const sections = view.state.field(sectionField, false)?.sections ?? []
        const matchedSec = sections.find((s) => {
          if (s.id === id) return true
          if (id.includes(`:${s.id}:`) || id.endsWith(`:${s.id}`)) return true
          return false
        })

        if (matchedSec) {
          lineIdx = matchedSec.startLine
        } else {
          // Fallback: heading match
          lineIdx = lines.findIndex((line) => {
            const match = line.match(/^(#{1,6})\s+(.*)$/)
            if (match) {
              let label = match[2]!.trim()
              const timeMatch = label.match(/(\d{1,2}:\d{2})/)
              if (timeMatch) {
                const timestamp = timeMatch[1]!
                label = label.replace(timestamp, '').replace(/\s+/g, ' ').trim()
                if (!label) label = timestamp
              }
              const headerId = label.toLowerCase().replace(/[^\w]+/g, '-')
              return headerId === id
            }
            return false
          })
        }
      }

      if (lineIdx >= 0 && lineIdx < lines.length) {
        const pos = view.state.doc.line(lineIdx + 1).from
        view.dispatch({
          selection: { anchor: pos, head: pos },
          effects: [EditorView.scrollIntoView(pos, { y: 'start', yMargin: 20 })],
        })
        const editorEl = view.dom.parentElement
        if (editorEl && window.innerWidth >= 1024) {
          const y = editorEl.getBoundingClientRect().top + window.scrollY - 120
          window.scrollTo({ top: y, behavior: 'smooth' })
        }
      }
    }
  }, [])

  // Register the scroll function with NavContext so NavSidebar L3 clicks scroll correctly.
  useEffect(() => {
    registerScrollFn(scrollToSection)
  }, [scrollToSection, registerScrollFn])

  // Track scroll position to keep NavContext activeL3 in sync.
  useEffect(() => {
    if (currentNavLinks.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        let bestId: string | null = null
        let bestRatio = -1
        entries.forEach(e => {
          if (e.isIntersecting && e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio
            bestId = e.target.id
          }
        })
        if (bestId) navDispatch({ type: 'SET_ACTIVE_L3', id: bestId } satisfies NavStateAction)
      },
      { rootMargin: '-10% 0px -50% 0px', threshold: [0, 0.25, 0.5, 1] },
    )
    currentNavLinks.forEach(link => {
      const el = document.getElementById(link.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [currentNavLinks, navDispatch])

  // Sync currentNavLinks → NavContext L3 items (feeds sidebar accordion + right panel).
  // Skip empty indexes: pages that derive their own anchors from rendered content
  // (e.g. QueriableStreamView's WQL-driven grouping) own l3Items on routes whose
  // static index is empty — publishing [] here would clobber their links.
  useEffect(() => {
    if (currentNavLinks.length === 0) return
    setL3Items(mapIndexToL3(currentNavLinks))
  }, [currentNavLinks, setL3Items])

  return { handleViewCreated, scrollToSection }
}
