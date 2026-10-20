import {
  autocompletion,
  snippet,
} from "@codemirror/autocomplete";
import type {
  CompletionContext,
  CompletionResult,
  Completion,
} from "@codemirror/autocomplete";
import { EditorView, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { activeCursorSection } from "./section-state";

const FENCE_TAGS: Completion[] = [
  {
    label: "```time",
    detail: "Whiteboard Script (timer)",
    type: "keyword",
    apply: snippet("```time\n${}\n```"),
    boost: 90,
  },
  {
    label: "```log",
    detail: "Whiteboard Script (log/completed)",
    type: "keyword",
    apply: snippet("```log\n${}\n```"),
    boost: 85,
  },
  {
    label: "```query",
    detail: "WQL Analytics Query",
    type: "keyword",
    apply: snippet("```query\n${}\n```"),
    boost: 80,
  },
  {
    label: "```widget",
    detail: "Custom React Widget",
    type: "keyword",
    apply: snippet("```widget:${name}\n${}\n```"),
    boost: 75,
  },
];

export function fenceCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);

  const match = textBefore.match(/^`{1,3}(\w*)$/);
  if (!match) return null;

  const section = activeCursorSection(context.state);
  if (section && section.type !== "markdown") return null;

  return {
    from: line.from,
    options: FENCE_TAGS,
    validFor: /^`{1,3}\w*$/,
  };
}

export function wrapInTimeFence(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);

  if (!selected) {
    view.dispatch({
      changes: { from, insert: "```time\n\n```" },
      selection: { anchor: from + 8 },
    });
  } else {
    view.dispatch({
      changes: {
        from,
        to,
        insert: `\`\`\`time\n${selected}\n\`\`\``,
      },
    });
  }
  return true;
}

export function handleFenceAutoWrap(event: InputEvent, view: EditorView): boolean {
  if (view.state.readOnly) return false;
  if (event.data !== "`") return false;
  const { from, to } = view.state.selection.main;
  if (from === to) return false;

  const selected = view.state.doc.sliceString(from, to);
  view.dispatch({
    changes: {
      from,
      to,
      insert: `\`\`\`time\n${selected}\n\`\`\``,
    },
  });
  return true;
}

export const wodAutoWrap: Extension = EditorView.domEventHandlers({
  beforeinput: handleFenceAutoWrap,
});

export const wodEditorKeymap = keymap.of([
  // Mod-Shift-W is browser "close window" — Mod-Alt-W is the free wrap chord.
  {
    key: "Mod-Alt-w",
    run: wrapInTimeFence,
  },
]);
export type CustomCompletionSource = (
  context: CompletionContext
) => CompletionResult | Promise<CompletionResult | null> | null;

const customCompletionSources: CustomCompletionSource[] = [];

export function registerCustomCompletionSource(source: CustomCompletionSource): void {
  if (!customCompletionSources.includes(source)) {
    customCompletionSources.push(source);
  }
}

export function unregisterCustomCompletionSource(source: CustomCompletionSource): void {
  const idx = customCompletionSources.indexOf(source);
  if (idx !== -1) {
    customCompletionSources.splice(idx, 1);
  }
}


export const wodAutocompletion: Extension = autocompletion({
  interactionDelay: 0,
  activateOnCompletion: (completion) =>
    completion.type === "property" &&
    typeof completion.apply === "string" &&
    completion.apply.endsWith(":\n  - "),
  override: [
    fenceCompletion,
    async (context: CompletionContext) => {
      for (const source of customCompletionSources) {
        const res = await source(context);
        if (res) return res;
      }
      return null;
    },
  ],
});
