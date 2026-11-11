import 'fake-indexeddb/auto';
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';

class MemoryWebStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(String(key)) ? this.map.get(String(key))! : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(String(key));
  }
  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }
}

if (typeof window !== 'undefined') {
  if (!window.localStorage || typeof window.localStorage.getItem !== 'function') {
    const ls = new MemoryWebStorage();
    Object.defineProperty(window, 'localStorage', { value: ls, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  }
  if (!window.sessionStorage || typeof window.sessionStorage.getItem !== 'function') {
    const ss = new MemoryWebStorage();
    Object.defineProperty(window, 'sessionStorage', { value: ss, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: ss, configurable: true, writable: true });
  }
  if (typeof window.scrollTo !== 'function') {
    window.scrollTo = () => {};
  }
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
  const docRec = document as unknown as Record<string, unknown>;
  if (typeof docRec.queryCommandSupported !== 'function') {
    docRec.queryCommandSupported = () => false;
  }
  if (typeof docRec.execCommand !== 'function') {
    docRec.execCommand = () => false;
  }
  const rangeProto = window.Range?.prototype as unknown as Record<string, unknown> | undefined;
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

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
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

expect.extend({
  toBeFunction(received: unknown) {
    const pass = typeof received === 'function';
    return {
      pass,
      message: () => `expected ${String(received)} ${pass ? 'not ' : ''}to be a function`,
    };
  },
});

afterEach(() => {
  if (typeof document !== 'undefined' && document.body) {
    cleanup();
  }
});
