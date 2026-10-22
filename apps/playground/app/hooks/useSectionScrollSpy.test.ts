/**
 * useSectionScrollSpy.test — proves the spy dispatches the DOM section id
 * (`tour-section-*`) of the section under the reading line — the same id
 * space the rail compares against (`entry.sectionId === activeId` in MenuList,
 * `activeL3Id === item.action.sectionId` in NavSidebar) — and that a section
 * merely peeking at the viewport bottom never steals the highlight.
 */
import { afterEach, describe, expect, it, mock, type Mock } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router'
import React from 'react'

import { useSectionScrollSpy } from './useSectionScrollSpy'
import { NavContext, initialNavState, type NavContextValue } from '../nav/NavContext'
import type { NavItem } from '../nav/navTypes'
import type { NavStateAction } from '../nav/navTypes'

const SECTION_IDS = ['tour-hero', 'tour-section-editor', 'tour-section-insights', 'tour-section-boards']

interface Rect {
  top: number
  width: number
  height: number
}

const LINE = () => window.innerHeight * 0.4

function setRect(el: HTMLElement, rect: Rect) {
  el.getBoundingClientRect = () =>
    // jsdom reports zero rects; the spy only reads top/width/height.
    ({ ...rect, bottom: rect.top + rect.height, left: 0, right: rect.width, x: 0, y: rect.top, toJSON: () => ({}) }) as DOMRect
}

// ── IntersectionObserver stub — the test drives the callbacks ────────────────

let fire: () => void
class StubIntersectionObserver {
  constructor(callback: () => void) {
    fire = () => callback()
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.defineProperty(globalThis, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: StubIntersectionObserver,
})

// ── Harness ──────────────────────────────────────────────────────────────────

function Probe(): null {
  useSectionScrollSpy(SECTION_IDS)
  return null
}

function providerValue(dispatch: Mock<(action: NavStateAction) => void>): NavContextValue {
  return {
    tree: [] as NavItem[],
    navState: initialNavState,
    dispatch,
    l3Items: [],
    setL3Items: () => {},
    secondarySpec: undefined,
    setSecondarySpec: () => {},
    scrollToSection: () => {},
    registerScrollFn: () => {},
    setContextNav: () => {},
    setStreamControls: () => {},
    openCreateJournal: () => {},
    registerCreateJournal: () => {},
  }
}

function renderSpy(): Mock<(action: NavStateAction) => void> {
  const dispatch = mock<(action: NavStateAction) => void>(() => {})
  render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/'] },
      React.createElement(
        NuqsAdapter,
        null,
        React.createElement(
          NavContext.Provider,
          { value: providerValue(dispatch) },
          React.createElement(
            'div',
            null,
            SECTION_IDS.map(id => React.createElement('section', { key: id, id })),
            React.createElement(Probe),
          ),
        ),
      ),
    ),
  )
  return dispatch
}

/** The test's scroll model: rects per section, in document order. */
function scroll(doc: Record<string, Rect>) {
  for (const id of SECTION_IDS) {
    const el = document.getElementById(id)
    if (el && doc[id]) setRect(el, doc[id]!)
  }
  fire()
}

function lastActive(dispatch: Mock<(action: NavStateAction) => void>): NavStateAction | undefined {
  return dispatch.mock.calls.filter(([action]) => action.type === 'SET_ACTIVE_L3').at(-1)?.[0]
}

describe('useSectionScrollSpy', () => {
  afterEach(() => cleanup())

  it('dispatches the DOM section id of the section under the reading line', () => {
    const dispatch = renderSpy()
    scroll({
      'tour-hero': { top: 0, width: 800, height: LINE() + 60 },
      'tour-section-editor': { top: 100, width: 800, height: 200 },
      'tour-section-insights': { top: LINE() + 50, width: 800, height: 400 },
      'tour-section-boards': { top: LINE() + 300, width: 800, height: 400 },
    })
    // Not the L3 item id (`editor`) — the DOM id the rail compares against.
    expect(lastActive(dispatch)).toEqual({ type: 'SET_ACTIVE_L3', id: 'tour-section-editor' })
  })

  it('does not let a section peeking at the viewport bottom steal the highlight', () => {
    const dispatch = renderSpy()
    scroll({
      'tour-hero': { top: 0, width: 800, height: LINE() + 60 },
      'tour-section-editor': { top: 100, width: 800, height: 200 },
      'tour-section-insights': { top: window.innerHeight - 120, width: 800, height: 400 },
      'tour-section-boards': { top: window.innerHeight - 20, width: 800, height: 400 },
    })
    expect(lastActive(dispatch)).toEqual({ type: 'SET_ACTIVE_L3', id: 'tour-section-editor' })
  })

  it('advances the highlight as the reader scrolls into the next section', () => {
    const dispatch = renderSpy()
    scroll({
      'tour-hero': { top: -600, width: 800, height: 400 },
      'tour-section-editor': { top: -400, width: 800, height: 300 },
      'tour-section-insights': { top: 100, width: 800, height: 900 },
      'tour-section-boards': { top: 700, width: 800, height: 400 },
    })
    expect(lastActive(dispatch)).toEqual({ type: 'SET_ACTIVE_L3', id: 'tour-section-insights' })
  })

  it('ignores hidden sections that report a zero rect', () => {
    const dispatch = renderSpy()
    scroll({
      'tour-hero': { top: -600, width: 800, height: 400 },
      'tour-section-editor': { top: -200, width: 800, height: 300 },
      'tour-section-insights': { top: 100, width: 800, height: 900 },
      // The boards step is display:none below lg — zero rect at 0,0.
      'tour-section-boards': { top: 0, width: 0, height: 0 },
    })
    expect(lastActive(dispatch)).toEqual({ type: 'SET_ACTIVE_L3', id: 'tour-section-insights' })
  })
})
