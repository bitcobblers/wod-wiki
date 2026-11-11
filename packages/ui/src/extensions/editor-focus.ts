import { EditorState, StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

/**
 * Explicit focus-state effect dispatched by DOM focus/blur handlers (and
 * directly in unit tests when exercising blurred WYSIWYG rendering).
 */
export const setEditorFocused = StateEffect.define<boolean>();

export const editorFocusField = StateField.define<boolean>({
  create: () => false,
  update(focused, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEditorFocused)) {
        focused = effect.value;
      }
    }
    return focused;
  },
});

/**
 * Returns whether the editor currently holds input focus.
 *
 * When `editorFocusTracker` is not mounted in a standalone extension test,
 * falls back to `true` so selection-driven raw-reveal assertions continue to
 * work out of the box. When mounted (in `editorPreset` and `NoteEditor`),
 * blurring the editor cleanly hides raw Markdown delimiters on every line.
 */
export function isEditorFocused(state: EditorState): boolean {
  const tracked = state.field(editorFocusField, false);
  return tracked ?? true;
}

const focusSyncPlugin = ViewPlugin.fromClass(
  class {
    private readonly onFocus: () => void;
    private readonly onBlur: (e: FocusEvent) => void;

    constructor(private readonly view: EditorView) {
      if (view.hasFocus && !view.state.field(editorFocusField, false)) {
        queueMicrotask(() => {
          if (this.view.hasFocus && !this.view.state.field(editorFocusField, false)) {
            this.view.dispatch({ effects: setEditorFocused.of(true) });
          }
        });
      }

      this.onFocus = () => {
        if (!this.view.state.field(editorFocusField, false)) {
          this.view.dispatch({ effects: setEditorFocused.of(true) });
        }
      };

      this.onBlur = (event: FocusEvent) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && this.view.dom.contains(nextTarget)) return;
        if (this.view.state.field(editorFocusField, false)) {
          this.view.dispatch({ effects: setEditorFocused.of(false) });
        }
      };

      view.contentDOM.addEventListener("focus", this.onFocus);
      view.contentDOM.addEventListener("blur", this.onBlur);
    }

    destroy() {
      this.view.contentDOM.removeEventListener("focus", this.onFocus);
      this.view.contentDOM.removeEventListener("blur", this.onBlur);
    }
  },
);

export const editorFocusTracker: Extension = [
  editorFocusField,
  focusSyncPlugin,
];
