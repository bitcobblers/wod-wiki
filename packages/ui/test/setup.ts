import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5000 });

/**
 * @bitcobblers/wod-wiki-ui vitest setup — jsdom does not ship ResizeObserver, which
 * recharts' ResponsiveContainer and CodeMirror viewport measurement expect.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
