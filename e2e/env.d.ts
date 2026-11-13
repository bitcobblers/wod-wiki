import type { EditorView } from '@codemirror/view';

declare global {
  interface HTMLElement {
    __codemirrorView?: EditorView;
  }
}

export {};
