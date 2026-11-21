import { afterEach, describe, expect, it } from 'bun:test';
import type { EditorView } from '@codemirror/view';
import {
  computeMobileSafeBand,
  isInsideStickyContainer,
  revealMobileEditRow,
} from './mobileEditViewport';

const originalVisualViewport = window.visualViewport;
const originalInnerHeight = window.innerHeight;
const originalScrollBy = window.scrollBy;

function setWindowInnerHeight(h: number) {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: h,
  });
}

function setVisualViewport(vv: Partial<VisualViewport> | undefined) {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: vv,
  });
}

function mockRect(el: Element, rect: { top: number; bottom: number; height?: number; left?: number; right?: number; width?: number }) {
  const height = rect.height ?? Math.max(0, rect.bottom - rect.top);
  const width = rect.width ?? (rect.right !== undefined && rect.left !== undefined ? rect.right - rect.left : 390);
  const left = rect.left ?? 0;
  const right = rect.right ?? left + width;
  el.getBoundingClientRect = () =>
    ({
      x: left,
      y: rect.top,
      top: rect.top,
      bottom: rect.bottom,
      left,
      right,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = '';
  setWindowInnerHeight(originalInnerHeight);
  setVisualViewport(originalVisualViewport);
  window.scrollBy = originalScrollBy;
});

describe('mobileEditViewport', () => {
  it('excludes sticky boundaries containing view.dom while respecting header and overlay bounds', () => {
    setWindowInnerHeight(844);
    setVisualViewport({
      height: 540,
      offsetTop: 0,
      scale: 1,
    });

    const navbar = document.createElement('header');
    navbar.setAttribute('data-page-sticky-boundary', 'true');
    mockRect(navbar, { top: 0, bottom: 65, height: 65 });

    const stickyEditorShell = document.createElement('div');
    stickyEditorShell.setAttribute('data-page-sticky-boundary', 'true');
    mockRect(stickyEditorShell, { top: 65, bottom: 380, height: 315 });

    const editorDom = document.createElement('div');
    stickyEditorShell.appendChild(editorDom);

    const deck = document.createElement('div');
    deck.setAttribute('data-testid', 'mobile-wheel-composer');
    mockRect(deck, { top: 420, bottom: 540, height: 120 });

    document.body.append(navbar, stickyEditorShell, deck);

    const mockView = { dom: editorDom } as unknown as EditorView;
    const band = computeMobileSafeBand(mockView, deck);

    // Sticky top uses navbar (65), NOT stickyEditorShell (380)
    expect(band.safeTop).toBe(65 + 14);
    // Bottom uses deck.top (420)
    expect(band.safeBottom).toBe(420 - 14);
    expect(band.vvHeight).toBe(540);
    expect(band.keyboardOffsetBottom).toBe(844 - 540);
  });

  it('detects sticky ancestor containers via computed style', () => {
    const outer = document.createElement('div');
    outer.style.position = 'sticky';
    const inner = document.createElement('div');
    outer.appendChild(inner);
    document.body.appendChild(outer);

    expect(isInsideStickyContainer(inner)).toBe(true);

    const plain = document.createElement('div');
    document.body.appendChild(plain);
    expect(isInsideStickyContainer(plain)).toBe(false);
  });

  it('scrolls .cm-scroller first without scrolling window when edit row is obscured and inside a sticky pane', () => {
    setWindowInnerHeight(844);
    setVisualViewport({ height: 844, offsetTop: 0, scale: 1 });

    const navbar = document.createElement('header');
    navbar.setAttribute('data-page-sticky-boundary', 'true');
    mockRect(navbar, { top: 0, bottom: 65, height: 65 });

    const stickyWrap = document.createElement('div');
    stickyWrap.style.position = 'sticky';
    const editorDom = document.createElement('div');
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { value: 800, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 260, configurable: true });
    scroller.scrollTop = 20;
    editorDom.appendChild(scroller);
    stickyWrap.appendChild(editorDom);

    const deck = document.createElement('div');
    deck.setAttribute('data-testid', 'mobile-wheel-composer');
    mockRect(deck, { top: 480, bottom: 844, height: 364 });

    document.body.append(navbar, stickyWrap, deck);

    let scrollByCalls = 0;
    window.scrollBy = () => {
      scrollByCalls += 1;
    };

    const view = {
      dom: editorDom,
      scrollDOM: scroller,
      state: { selection: { main: { head: 10 } } },
      coordsAtPos: () => ({ top: 520, bottom: 544, left: 20, right: 120 }),
    } as unknown as EditorView;

    const changed = revealMobileEditRow(view, { overlayEl: deck });
    expect(changed).toBe(true);
    expect(scroller.scrollTop).toBeGreaterThan(20);
    expect(scrollByCalls).toBe(0);
  });

  it('does not scroll when line is already comfortably visible inside safe band unless forceCenter is set', () => {
    setWindowInnerHeight(844);
    setVisualViewport({ height: 844, offsetTop: 0, scale: 1 });

    const deck = document.createElement('div');
    mockRect(deck, { top: 500, bottom: 844, height: 344 });
    const editorDom = document.createElement('div');
    const scroller = document.createElement('div');
    document.body.append(editorDom, deck);

    let scrollByCalls = 0;
    window.scrollBy = () => {
      scrollByCalls += 1;
    };

    const view = {
      dom: editorDom,
      scrollDOM: scroller,
      state: { selection: { main: { head: 5 } } },
      coordsAtPos: () => ({ top: 210, bottom: 234, left: 10, right: 90 }),
    } as unknown as EditorView;

    expect(revealMobileEditRow(view, { overlayEl: deck })).toBe(false);
    expect(scrollByCalls).toBe(0);

    expect(revealMobileEditRow(view, { overlayEl: deck, forceCenter: true })).toBe(true);
    expect(scrollByCalls).toBe(1);
  });

  it('skips scroll adjustments when pinch-zoomed', () => {
    setWindowInnerHeight(844);
    setVisualViewport({ height: 420, offsetTop: 100, scale: 1.5 });

    const editorDom = document.createElement('div');
    const scroller = document.createElement('div');
    document.body.appendChild(editorDom);

    let scrollByCalls = 0;
    window.scrollBy = () => {
      scrollByCalls += 1;
    };

    const view = {
      dom: editorDom,
      scrollDOM: scroller,
      state: { selection: { main: { head: 0 } } },
      coordsAtPos: () => ({ top: 700, bottom: 724, left: 0, right: 80 }),
    } as unknown as EditorView;

    expect(revealMobileEditRow(view)).toBe(false);
    expect(scrollByCalls).toBe(0);
  });

  it('advances unpinned non-runway sticky panel toward cssTop, but never scrolls window when pinned or inside a runway', () => {
    setWindowInnerHeight(844);
    setVisualViewport({ height: 844, offsetTop: 0, scale: 1 });

    const navbar = document.createElement('header');
    navbar.setAttribute('data-page-sticky-boundary', 'true');
    mockRect(navbar, { top: 0, bottom: 65, height: 65 });

    const stickyPanel = document.createElement('div');
    stickyPanel.style.position = 'sticky';
    stickyPanel.style.top = '65px';
    mockRect(stickyPanel, { top: 560, bottom: 848, height: 288 });

    const editorDom = document.createElement('div');
    const scroller = document.createElement('div');
    editorDom.appendChild(scroller);
    stickyPanel.appendChild(editorDom);

    const deck = document.createElement('div');
    deck.setAttribute('data-mobile-editor-deck', 'true');
    mockRect(deck, { top: 490, bottom: 844, height: 354 });

    document.body.append(navbar, stickyPanel, deck);

    const recordedScrolls: number[] = [];
    window.scrollBy = ((opts?: ScrollToOptions) => {
      if (opts && typeof opts.top === 'number') recordedScrolls.push(opts.top);
    }) as typeof window.scrollBy;

    const view = {
      dom: editorDom,
      scrollDOM: scroller,
      state: { selection: { main: { head: 10 } } },
      coordsAtPos: () => ({ top: 630, bottom: 654, left: 20, right: 120 }),
    } as unknown as EditorView;

    expect(revealMobileEditRow(view, { overlayEl: deck })).toBe(true);
    expect(recordedScrolls.length).toBe(1);
    expect(recordedScrolls[0]).toBeGreaterThanOrEqual(370);
    expect(recordedScrolls[0]).toBeLessThanOrEqual(560 - 65);

    // Already pinned at cssTop (65px) -> must not scroll outer window
    recordedScrolls.length = 0;
    mockRect(stickyPanel, { top: 65, bottom: 353, height: 288 });
    expect(revealMobileEditRow(view, { overlayEl: deck })).toBe(true);
    expect(recordedScrolls.length).toBe(0);

    // Unpinned sticky panel inside a runway -> must not scroll outer window
    const runway = document.createElement('section');
    runway.setAttribute('data-testid', 'guide-runway-1');
    stickyPanel.remove();
    mockRect(stickyPanel, { top: 560, bottom: 848, height: 288 });
    runway.appendChild(stickyPanel);
    document.body.appendChild(runway);
    expect(revealMobileEditRow(view, { overlayEl: deck })).toBe(true);
    expect(recordedScrolls.length).toBe(0);
  });
});
