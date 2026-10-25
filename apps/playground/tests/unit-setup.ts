import { vi } from 'bun:test';
import { mock } from 'bun:test';
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

  // Monaco checks these clipboard APIs; jsdom doesn't implement them.
  if (!(globalThis.document as any).queryCommandSupported) {
    (globalThis.document as any).queryCommandSupported = () => false;
  }
  if (!(globalThis.document as any).execCommand) {
    (globalThis.document as any).execCommand = () => false;
  }

  // Make common DOM globals available at global scope (e.g. UIEvent for monaco).
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
// ── Seeded-corpus repository stubs ──────────────────────────────────────────
// The repository adapters now read through the seed-content seam (IndexedDB).
// The real modules are import-safe; spread them to keep the pure builders
// exercising real code while the async corpus reads stay stubbed empty.
const realScriptFeeds = await import('@/repositories/script-feeds');
mock.module('@/repositories/script-feeds', () => ({
  ...realScriptFeeds,
  getScriptFeeds: async () => [],
  getScriptFeed: async (_slug: string) => undefined,
  getScriptFeedItem: async () => undefined,
}));

const realScriptCollections = await import('@/repositories/script-collections');
mock.module('@/repositories/script-collections', () => ({
  ...realScriptCollections,
  getScriptCollections: async () => [],
  getScriptCollection: async (_slug: string) => undefined,
}));

mock.module('@/repositories/script-loader', () => ({
  getScriptContent: async (_id: string) => undefined,
  getAllScriptIds: async () => [],
}));

mock.module('@/repositories/page-examples', () => ({
  getTabExamples: async (_page: string, _section: string) => [],
  getHomeExample: async (_name: string) => '',
}));
mock.module('@/repositories/script-loader', () => ({
  getScriptContent: async (_id: string) => undefined,
  getAllScriptIds: async () => [],
}));
// Test loading boundary: capture the real module before replacing only its
// React bindings; static imports cannot express this mock.module ordering.
const realCanvasRoutes = await import('../app/canvas/canvasRoutes');
mock.module('../app/canvas/canvasRoutes', () => ({
  ...realCanvasRoutes,
  useCanvasRoutes: () => [],
  useFindCanvasPage: () => null,
}));

// effort-markdown is glob-free since the efforts flip — the real module's
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
// ── Pre-mock workbenchSyncStore for components that use useUserOverrides ──────
mock.module('@/stores/workbenchSyncStore', () => {
  const overrides = new Map();
  return {
    useWorkbenchSyncStore: (selector: any) => {
      const state = { 
        userOutputOverrides: overrides,
        viewMode: 'track',
        execution: { status: 'idle' },
      };
      return selector ? selector(state) : state;
    },
    create: () => ({
      getState: () => ({ userOutputOverrides: overrides }),
      setState: () => {},
      subscribe: () => () => {},
    }),
  };
});
