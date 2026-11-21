import type { EditorView } from '@codemirror/view';
import { TEST_IDS } from '@/lib/testIds';

export interface MobileSafeBand {
  safeTop: number;
  safeBottom: number;
  idealCenterY: number;
  vvHeight: number;
  keyboardOffsetBottom: number;
}

export interface RevealMobileEditRowOptions {
  pos?: number;
  overlayEl?: HTMLElement | null;
  forceCenter?: boolean;
  behavior?: ScrollBehavior;
}

const STICKY_BOUNDARY_SELECTOR = '[data-page-sticky-boundary="true"]';

function findActiveDeckOverlay(overlayEl?: HTMLElement | null): HTMLElement | null {
  if (overlayEl) return overlayEl;
  const byAttr = document.querySelector<HTMLElement>('[data-mobile-editor-deck="true"]');
  if (byAttr) return byAttr;
  for (const el of document.querySelectorAll<HTMLElement>('[data-testid]')) {
    const id = el.getAttribute('data-testid');
    if (id === TEST_IDS.MOBILE_WHEEL_COMPOSER || id === TEST_IDS.MOBILE_TYPING_BAR) {
      return el;
    }
  }
  return null;
}

function isInsideRunwayContainer(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    const id = node.getAttribute('data-testid');
    if (
      id === 'tour-runway' ||
      id === 'scroll-runway-section' ||
      id?.startsWith('guide-runway-')
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Computes the unobscured vertical editing band on mobile between any sticky
 * top navigation (excluding sticky wrappers that contain the editor itself)
 * and the bottom mobile editor deck / visual viewport edge.
 */
export function computeMobileSafeBand(
  view: EditorView,
  overlayEl?: HTMLElement | null,
): MobileSafeBand {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      safeTop: 14,
      safeBottom: 58,
      idealCenterY: 36,
      vvHeight: 0,
      keyboardOffsetBottom: 0,
    };
  }

  const vv = window.visualViewport;
  const vvTop = vv?.offsetTop ?? 0;
  const vvHeight = vv?.height ?? window.innerHeight;
  const vvBottom = vvTop + vvHeight;
  const keyboardOffsetBottom = Math.max(0, window.innerHeight - vvBottom);

  let stickyTop = 0;
  const boundaries = document.querySelectorAll<HTMLElement>(STICKY_BOUNDARY_SELECTOR);
  for (const el of boundaries) {
    if (el.contains(view.dom)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom <= 0) continue;
    stickyTop = Math.max(stickyTop, rect.bottom);
  }
  const effectiveTop = stickyTop > 0 ? stickyTop : vvTop;

  let bottomOverlayTop = vvBottom;
  const activeOverlay = findActiveDeckOverlay(overlayEl);
  if (activeOverlay) {
    const rect = activeOverlay.getBoundingClientRect();
    if (rect.height > 0 && rect.top > 0) {
      bottomOverlayTop = Math.min(vvBottom, rect.top);
    }
  }

  const safeTop = Math.max(vvTop, effectiveTop) + 14;
  const safeBottom = Math.max(safeTop + 44, bottomOverlayTop - 14);
  const idealCenterY = safeTop + (safeBottom - safeTop) * 0.46;

  return {
    safeTop,
    safeBottom,
    idealCenterY,
    vvHeight,
    keyboardOffsetBottom,
  };
}

function findStickyAncestor(el: HTMLElement): HTMLElement | null {
  if (typeof window === 'undefined') return null;
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    if (window.getComputedStyle(node).position === 'sticky') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Returns true when `el` sits inside a `position: sticky` ancestor so outer
 * window scrolling does not push a pinned editor pane out of its runway stage.
 */
export function isInsideStickyContainer(el: HTMLElement): boolean {
  return findStickyAncestor(el) !== null;
}

function findOuterScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function scrollOuterBy(el: HTMLElement, top: number, behavior: ScrollBehavior): number {
  const outerScroller = findOuterScrollParent(el);
  if (outerScroller && typeof outerScroller.scrollBy === 'function') {
    const before = outerScroller.scrollTop;
    outerScroller.scrollBy({ top, behavior });
    return outerScroller.scrollTop - before;
  }
  if (typeof window.scrollBy === 'function') {
    const before = window.scrollY;
    window.scrollBy({ top, behavior });
    return window.scrollY - before;
  }
  return 0;
}

/**
 * Ensures the active edit row at `pos` (or main selection head) stays framed
 * inside the unobscured mobile viewport band. Advances unpinned non-runway
 * sticky panels toward their sticky ceiling, scrolls the inner CodeMirror
 * scroller next, and falls back to outer page scroll for non-sticky editors.
 */
export function revealMobileEditRow(
  view: EditorView,
  options?: RevealMobileEditRowOptions,
): boolean {
  if (typeof window === 'undefined' || !view || !view.dom) return false;
  if (window.visualViewport && window.visualViewport.scale > 1.05) return false;

  const pos = options?.pos ?? view.state.selection.main.head;
  let coords: { top: number; bottom: number; left: number; right: number } | null;
  try {
    coords = view.coordsAtPos(pos);
  } catch {
    return false;
  }
  if (!coords || (coords.top === 0 && coords.bottom === 0)) return false;

  const { safeTop, safeBottom, idealCenterY } = computeMobileSafeBand(
    view,
    options?.overlayEl,
  );
  const visibleInBand = coords.top >= safeTop && coords.bottom <= safeBottom;
  if (visibleInBand && !options?.forceCenter) return false;

  let deltaY = (coords.top + coords.bottom) / 2 - idealCenterY;
  if (Math.abs(deltaY) <= 1) return false;

  const inRunway = isInsideRunwayContainer(view.dom);
  const stickyAncestor = findStickyAncestor(view.dom);
  const behavior = options?.behavior ?? 'auto';

  if (!inRunway && stickyAncestor) {
    const stickyRect = stickyAncestor.getBoundingClientRect();
    if (stickyRect.height > 0) {
      const rawTop = Number.parseFloat(window.getComputedStyle(stickyAncestor).top);
      const cssTop = Number.isFinite(rawTop) ? rawTop : 0;
      if (deltaY > 0 && stickyRect.top > cssTop + 1) {
        const desiredAdvance = Math.max(deltaY, stickyRect.bottom - safeBottom);
        const unpinnedAdvance = Math.min(desiredAdvance, stickyRect.top - cssTop);
        if (unpinnedAdvance > 2) {
          const consumed = scrollOuterBy(view.dom, unpinnedAdvance, behavior);
          deltaY -= consumed !== 0 ? consumed : unpinnedAdvance;
        }
      } else if (deltaY < 0 && stickyRect.top < cssTop - 1) {
        const retreat = Math.max(deltaY, stickyRect.top - cssTop);
        if (retreat < -2) {
          const consumed = scrollOuterBy(view.dom, retreat, behavior);
          deltaY -= consumed !== 0 ? consumed : retreat;
        }
      }
    }
  }

  const scroller = view.scrollDOM;
  if (scroller && Math.abs(deltaY) > 1) {
    const cs = window.getComputedStyle(scroller);
    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    if (maxScrollTop > 1 && cs.overflowY !== 'hidden' && cs.overflowY !== 'visible') {
      const prevTop = scroller.scrollTop;
      const nextTop = Math.max(0, Math.min(maxScrollTop, prevTop + deltaY));
      const consumed = nextTop - prevTop;
      if (Math.abs(consumed) > 0.5) {
        scroller.scrollTop = nextTop;
        deltaY -= consumed;
      }
    }
  }

  if (Math.abs(deltaY) > 2 && !inRunway && !stickyAncestor) {
    scrollOuterBy(view.dom, deltaY, behavior);
  }

  return true;
}
