import { vi } from 'bun:test';
import { afterEach, beforeEach } from 'bun:test';
import { JSDOM } from 'jsdom';

// ── JSDOM setup ─────────────────────────────────────────────────────────────
// MUST run before any module imports so React and other DOM-sensitive packages
// initialize with window/document present.
if (!(globalThis as any).window || !globalThis.document) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });

  (globalThis as any).window = dom.window as any;
  (globalThis as any).document = dom.window.document as any;
  (globalThis as any).navigator = dom.window.navigator as any;
  (globalThis as any).location = dom.window.location as any;

  // JSDOM clipboard API polyfills
  if (!(globalThis.document as any).queryCommandSupported) {
    (globalThis.document as any).queryCommandSupported = () => false;
  }
  if (!(globalThis.document as any).execCommand) {
    (globalThis.document as any).execCommand = () => false;
  }

  // Make common DOM globals available at global scope (e.g. UIEvent).
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (!(key in globalThis)) {
      Object.defineProperty(globalThis, key, {
        value: (dom.window as any)[key],
        configurable: true,
        enumerable: false,
        writable: true,
      });
    }
  }

  // Polyfill requestAnimationFrame/cancelAnimationFrame for animation-based hooks
  if (!(globalThis as any).requestAnimationFrame) {
    (globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback): number => {
      return setTimeout(() => callback(Date.now()), 16) as unknown as number;
    };
  }
  if (!(globalThis as any).cancelAnimationFrame) {
    (globalThis as any).cancelAnimationFrame = (id: number): void => {
      clearTimeout(id);
    };
  }
  // Libraries that read window.requestAnimationFrame directly still see
  // jsdom's window without it even when globalThis has the polyfill above.
  if (!(dom.window as any).requestAnimationFrame) {
    (dom.window as any).requestAnimationFrame = (globalThis as any).requestAnimationFrame;
    (dom.window as any).cancelAnimationFrame = (globalThis as any).cancelAnimationFrame;
  }
  const winRec = dom.window as unknown as Record<string, unknown>;
  const globalRec = globalThis as unknown as Record<string, unknown>;
  globalRec.IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof winRec.scrollTo !== 'function') {
    winRec.scrollTo = () => {};
  }
  globalRec.scrollTo = winRec.scrollTo;
  const rangeCtor = winRec.Range as { prototype?: Record<string, unknown> } | undefined;
  const rangeProto = rangeCtor?.prototype;
  if (rangeProto) {
    if (typeof rangeProto.getClientRects !== 'function') {
      rangeProto.getClientRects = () => [] as unknown as DOMRectList;
    }
    if (typeof rangeProto.getBoundingClientRect !== 'function') {
      rangeProto.getBoundingClientRect = () => ({
        x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}),
      });
    }
  }
}

// ResizeObserver/IntersectionObserver: jsdom ships neither, but app chrome
// (recharts ResponsiveContainer, tour runway observers) instantiates both at
// mount. Mirrors the stubs in tests/setup.ts used by the component runner.
if (typeof (globalThis as unknown as Record<string, unknown>).ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}
if (typeof (globalThis as unknown as Record<string, unknown>).IntersectionObserver === 'undefined') {
  class IntersectionObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = IntersectionObserverStub;
}

// ── IndexedDB polyfill ──────────────────────────────────────────────────────
import 'fake-indexeddb/auto';
const { cleanup } = await import('@testing-library/react');
const { invalidateSeedContent } = await import('@/services/content/seedContent');
const { resetFeedSubscriptionsForTest } = await import('@/services/feed/feedSubscriptions');
const { resetAppEffortRegistryForTesting } = await import('@/services/effortRegistry');
const { resetAppEquipmentRegistryForTesting } = await import('@/services/equipmentRegistry');
const { resetTagIndexForTesting } = await import('@/services/tags/tagCatalogue');

const initialGlobals = globalThis as unknown as Record<string, unknown>;
const savedWindow = initialGlobals.window as Record<string, unknown>;
const savedDocument = initialGlobals.document;
const savedNavigator = initialGlobals.navigator;
const savedLocation = initialGlobals.location;
const savedMatchMedia = savedWindow.matchMedia;
const savedIntersectionObserver = initialGlobals.IntersectionObserver;
const savedResizeObserver = initialGlobals.ResizeObserver;

function restoreDomGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.window) Object.defineProperty(g, 'window', { value: savedWindow, configurable: true, writable: true });
  if (!g.document) Object.defineProperty(g, 'document', { value: savedDocument, configurable: true, writable: true });
  if (!g.navigator) Object.defineProperty(g, 'navigator', { value: savedNavigator, configurable: true, writable: true });
  if (!g.location) Object.defineProperty(g, 'location', { value: savedLocation, configurable: true, writable: true });
  savedWindow.matchMedia = savedMatchMedia;
  g.IntersectionObserver = savedIntersectionObserver;
  savedWindow.IntersectionObserver = savedIntersectionObserver;
  g.ResizeObserver = savedResizeObserver;
  savedWindow.ResizeObserver = savedResizeObserver;
}

beforeEach(() => {
  restoreDomGlobals();
});

afterEach(() => {
  cleanup();
  restoreDomGlobals();
  try {
    window.localStorage.clear();
    window.sessionStorage?.clear();
  } catch {
    // ignore storage errors on synthetic origins
  }
  resetFeedSubscriptionsForTest();
  invalidateSeedContent();
  resetAppEffortRegistryForTesting();
  resetAppEquipmentRegistryForTesting();
  resetTagIndexForTesting();
});
// pure document-format functions (effortToDocument, documentToEffort,
// parseEffortFile) are exercised everywhere.


// Provide vi.mocked helper for compatibility across tests
if (!(vi as any).mocked) {
  Object.defineProperty(vi as any, 'mocked', {
    value: <T>(fn: T): T => fn,
    writable: false,
    configurable: true,
  });
}

