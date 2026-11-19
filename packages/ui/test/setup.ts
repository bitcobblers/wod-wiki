import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}
globalThis.__UI_SDK_STRICT__ = true;

configure({ asyncUtilTimeout: 5000 });

HTMLElement.prototype.showPopover = function () {};
HTMLElement.prototype.hidePopover = function () {};
Element.prototype.getAnimations = () => [];
Element.prototype.scrollIntoView = function () {};
Element.prototype.checkVisibility = () => true;
Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
document.elementFromPoint = () => null;
document.elementsFromPoint = () => [];

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

if (typeof globalThis.matchMedia !== 'function') {
  const matchMediaStub = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  globalThis.matchMedia = matchMediaStub;
  if (typeof window !== 'undefined') {
    window.matchMedia = matchMediaStub;
  }
}

document.head.append(
  Object.assign(document.createElement('style'), {
    textContent: '[popover] { display: block !important }',
  }),
);

afterEach(cleanup);
