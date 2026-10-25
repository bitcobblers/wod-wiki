import {
  autocompletion,
  CompletionContext,
  snippet,
} from "@codemirror/autocomplete";
import type {
  CompletionResult,
  Completion,
} from "@codemirror/autocomplete";
import { EditorView, keymap } from "@codemirror/view";
import { EditorSelection, EditorState, Facet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  whiteboardScriptCompletionSource,
  whiteboardScriptLanguage,
} from "@bitcobblers/wod-wiki-lang";
import type { WhiteboardScriptCompletionOptions } from "@bitcobblers/wod-wiki-lang";
import { wqlCompletionSource, wqlLanguage } from "@bitcobblers/wod-wiki-wql";
import type { WqlCompletionOptions } from "@bitcobblers/wod-wiki-wql";
import { activeCursorSection, sectionAtPos } from "./section-state";

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
  // Same markdown-section guard as fenceCompletion/handleFenceAutoWrap —
  // Mod-Alt-w must never nest a ```time fence inside a query/time/log body
  // or the frontmatter.
  const section = activeCursorSection(view.state);
  if (section && section.type !== "markdown") return false;
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
  // Same markdown-section guard as fenceCompletion — never wrap inside
  // frontmatter or fence bodies.
  const section = activeCursorSection(view.state);
  if (section && section.type !== "markdown") return false;
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

/** Per-editor custom completion sources (frontmatter tags, host registries).
 *  Configure through an extension value (`customCompletionSources.of(source)`)
 *  — never a module-global registry, so sibling editors stay isolated. */
export const customCompletionSources = Facet.define<CustomCompletionSource, readonly CustomCompletionSource[]>({
  combine: (sources) => sources,
});

export interface NestedCompletionOptions {
  /** Options threaded to the nested WQL source inside ```query/```wql bodies —
   *  pass exactly what the host's standalone WQL editors receive so options,
   *  ranking, and insert text match. */
  wql?: WqlCompletionOptions;
  /** Options threaded to the nested Whiteboard Script source inside
   *  ```time/```log bodies — pass exactly what the host's standalone WB
   *  editors receive; each section's `:sport` suffix narrows the vocabulary. */
  whiteboardScript?: WhiteboardScriptCompletionOptions;
}

/** Per-editor configuration for nested fence-body completion sources. */
export const nestedCompletionOptions = Facet.define<NestedCompletionOptions, NestedCompletionOptions | undefined>({
  combine: (values) => values[values.length - 1],
});

// Memoized per facet-value identity; the configuration itself lives in editor
// state. WeakMap keys keep destroyed editors' options objects (and the
// catalogs their closures capture) collectable — `undefined` options share one
// grammar-only singleton, so the default path stays cache-hit and retains
// nothing editor-specific.
let sharedWqlSource: CustomCompletionSource | undefined;
const nestedWqlSources = new WeakMap<WqlCompletionOptions, CustomCompletionSource>();

function nestedWqlSource(options: WqlCompletionOptions | undefined): CustomCompletionSource {
  if (!options) return (sharedWqlSource ??= wqlCompletionSource({}));
  let source = nestedWqlSources.get(options);
  if (!source) {
    source = wqlCompletionSource(options);
    nestedWqlSources.set(options, source);
  }
  return source;
}

// Same memoization, per (options, sport) identity — the sport comes from each
// section's fence suffix, not the editor-wide options.
let sharedWbPerSport: Map<string, CustomCompletionSource> | undefined;
const nestedWbSources = new WeakMap<WhiteboardScriptCompletionOptions, Map<string, CustomCompletionSource>>();

function nestedWhiteboardScriptSource(
  options: WhiteboardScriptCompletionOptions | undefined,
  sport: string | undefined,
): CustomCompletionSource {
  let perSport: Map<string, CustomCompletionSource>;
  if (!options) perSport = (sharedWbPerSport ??= new Map());
  else {
    perSport = nestedWbSources.get(options) ?? new Map();
    nestedWbSources.set(options, perSport);
  }
  const key = sport ?? "";
  let source = perSport.get(key);
  if (!source) {
    source = whiteboardScriptCompletionSource({ ...(options ?? {}), ...(sport ? { sport } : {}) });
    perSport.set(key, source);
  }
  return source;
}

/** True when the line at `pos` opens a ```wql fence (a code-typed section the
 *  runtime does not recognize but highlighting and completion do). */
function wqlFenceAt(state: EditorState, pos: number): boolean {
  return /^`{3,}wql\b/i.test(state.doc.lineAt(pos).text.trim());
}

/**
 * Nested fence-body completion, dispatched by the cursor's section through
 * sectionField/activeCursorSection (no re-parsing). ```query/```wql bodies run
 * the WQL source against the body as a standalone document and rebase result
 * ranges back into the note. ```time/```log bodies run the same grammar-aware
 * Whiteboard Script source the standalone editors use, with the section's
 * `:sport` suffix narrowing the dialect vocabulary; the body is parsed with
 * the Whiteboard Script language so syntaxTree slot detection works. Returns
 * null in markdown/frontmatter/widget bodies, so fence and frontmatter
 * suggestions never leak into code.
 */
export function nestedCompletion(
  context: CompletionContext
): CompletionResult | Promise<CompletionResult | null> | null {
  // Dispatch on the completion position, not the raw selection head.
  const section = sectionAtPos(context.state, context.pos);
  const { contentFrom, contentTo } = section ?? {};
  if (!section || contentFrom === undefined || contentTo === undefined) return null;
  const whiteboard = section.type === "time" || section.type === "log";
  const query = section.type === "query" || wqlFenceAt(context.state, section.from);
  if (!whiteboard && !query) return null;
  if (context.pos < contentFrom || context.pos > contentTo) return null;

  const { state } = context;
  const selection = state.selection.main;
  // Map the parent selection into body coordinates, clamped to the body so
  // outside selections degrade to a plain cursor (no token replacement).
  const selFrom = Math.min(Math.max(selection.from, contentFrom), contentTo);
  const selTo = Math.min(Math.max(selection.to, contentFrom), contentTo);
  const subState = EditorState.create({
    doc: state.doc.sliceString(contentFrom, contentTo),
    selection: EditorSelection.range(selFrom - contentFrom, selTo - contentFrom),
    // Slot detection may read the Lezer tree — parse the body with its
    // dialect language, exactly as a standalone editor's state would have it.
    extensions: whiteboard ? whiteboardScriptLanguage : [wqlLanguage],
  });
  const source = whiteboard
    ? nestedWhiteboardScriptSource(state.facet(nestedCompletionOptions)?.whiteboardScript, section.sport)
    : nestedWqlSource(state.facet(nestedCompletionOptions)?.wql);
  const result = source(
    new CompletionContext(subState, context.pos - contentFrom, context.explicit),
  );
  const rebase = (resolved: CompletionResult | null) =>
    resolved && {
      ...resolved,
      from: contentFrom + resolved.from,
      ...(resolved.to !== undefined ? { to: contentFrom + resolved.to } : {}),
    };
  return result instanceof Promise ? result.then(rebase) : rebase(result);
}

/**
 * The note editor's combined completion provider. Explicit order — first
 * result wins: (1) per-editor custom sources via the facet, (2) opening-fence
 * snippets, (3) nested fence-body sources. Exported for direct testing.
 */
export async function wodCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
  for (const source of context.state.facet(customCompletionSources)) {
    const result = await source(context);
    if (result) return result;
  }
  return fenceCompletion(context) ?? nestedCompletion(context);
}

export const wodAutocompletion: Extension = autocompletion({
  interactionDelay: 0,
  activateOnCompletion: (completion) =>
    completion.type === "property" &&
    typeof completion.apply === "string" &&
    completion.apply.endsWith(":\n  - "),
  override: [
    // Explicit provider order — see wodCompletionSource.
    wodCompletionSource,
  ],
});
