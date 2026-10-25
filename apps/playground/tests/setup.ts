import '@testing-library/jest-dom';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, vi } from 'bun:test';

// One named cast: test-environment globals augmentation (window/document and
// DOM constructors onto globalThis), mirroring tests/unit-setup.ts.
const globals = globalThis as unknown as Record<string, unknown>;

// Vitest <2 compatibility: provide vi.mocked helper used across tests
if (!('mocked' in vi)) {
  Object.defineProperty(vi, 'mocked', {
    value: <T,>(fn: T): T => fn,
    writable: false,
    configurable: true,
  });
}

// Real JSDOM: mirrors tests/unit-setup.ts. @codemirror/view reads
// doc.documentElement.style at module load; a partial mock breaks it.
if (!globals.window || !globals.document) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });

  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.navigator = dom.window.navigator;
  globals.location = dom.window.location;

  // Monaco checks these clipboard APIs; jsdom doesn't implement them.
  const doc = dom.window.document as unknown as Record<string, unknown>;
  if (typeof doc.queryCommandSupported !== 'function') doc.queryCommandSupported = () => false;
  if (typeof doc.execCommand !== 'function') doc.execCommand = () => false;

  // Make common DOM globals available at global scope (e.g. UIEvent for monaco).
  const win = dom.window as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(win)) {
    if (!(key in globalThis)) {
      Object.defineProperty(globalThis, key, {
        value: win[key],
        configurable: true,
        enumerable: false,
        writable: true,
      });
    }
  }

  // Polyfill requestAnimationFrame/cancelAnimationFrame for animation-based hooks
  if (typeof globals.requestAnimationFrame !== 'function') {
    globals.requestAnimationFrame = (callback: FrameRequestCallback): number =>
      setTimeout(() => callback(Date.now()), 16) as unknown as number;
  }
  if (typeof globals.cancelAnimationFrame !== 'function') {
    globals.cancelAnimationFrame = (id: number): void => {
      clearTimeout(id);
    };
  }
  // Libraries that read window.requestAnimationFrame directly still see
  // jsdom's window without it even when globalThis has the polyfill above.
  if (typeof win.requestAnimationFrame !== 'function') {
    win.requestAnimationFrame = globals.requestAnimationFrame;
    win.cancelAnimationFrame = globals.cancelAnimationFrame;
  }
}

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

if (globals.window) {
  const win = globals.window as Record<string, unknown>;
  win.ResizeObserver = global.ResizeObserver;
  win.IntersectionObserver = global.IntersectionObserver;
}

// Mock console methods for cleaner test output
const originalError = console.error;
const originalWarn = console.warn;

beforeAll(() => {
  console.error = vi.fn((...args: unknown[]) => {
    // Allow certain expected errors
    const errorMsg = args.join(' ');
    if (
      errorMsg.includes('Warning: ReactDOM.render is no longer supported') ||
      errorMsg.includes('act(...) is not supported')
    ) {
      return;
    }
    originalError(...args);
  });

  console.warn = vi.fn((...args: unknown[]) => {
    const warnMsg = args.join(' ');
    if (warnMsg.includes('componentWillReceiveProps')) {
      return;
    }
    originalWarn(...args);
  });
});

afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
});
