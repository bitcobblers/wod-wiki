import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  CompletionContext,
  completionStatus,
  currentCompletions,
  selectedCompletionIndex,
  setSelectedCompletion,
  snippet,
  startCompletion,
} from "@codemirror/autocomplete";
import type {
  CompletionResult,
  Completion,
} from "@codemirror/autocomplete";
import { EditorView, keymap } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { EditorSelection, EditorState, Facet, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  whiteboardScriptCompletionSource,
  whiteboardScriptLanguage,
} from "@bitcobblers/wod-wiki-lang";
import type { WhiteboardScriptCompletionOptions } from "@bitcobblers/wod-wiki-lang";
import { wqlCompletionSource, wqlLanguage } from "@bitcobblers/wod-wiki-wql";
import type { WqlCompletionOptions } from "@bitcobblers/wod-wiki-wql";
import { activeCursorSection, sectionAtPos } from "./section-state";
import { editingQuerySectionsField } from "./query-block-preview";
import { isWhiteboardScriptBody } from "./whiteboard-indent";

const WORKOUT_SECTION = { name: "Workout & Data", rank: 1 };
const MARKDOWN_SECTION = { name: "Markdown Structure", rank: 2 };

const FENCE_TAGS: Completion[] = [
  {
    label: "```time",
    detail: "Timer workout block",
    type: "keyword",
    section: WORKOUT_SECTION,
    apply: snippet("```time\n${}\n```"),
    boost: 90,
  },
  {
    label: "```log",
    detail: "Completed workout log",
    type: "keyword",
    section: WORKOUT_SECTION,
    apply: snippet("```log\n${}\n```"),
    boost: 85,
  },
  {
    label: "```query",
    detail: "Analytics query block",
    type: "keyword",
    section: WORKOUT_SECTION,
    apply: snippet("```query\n${}\n```"),
    boost: 80,
  },
  {
    label: "```widget",
    detail: "Interactive embed widget",
    type: "keyword",
    section: WORKOUT_SECTION,
    apply: snippet("```widget:${name}\n${}\n```"),
    boost: 75,
  },
  {
    label: "```wod",
    detail: "Legacy alias for ```time",
    type: "keyword",
    section: WORKOUT_SECTION,
    apply: snippet("```time\n${}\n```"),
    boost: 10,
  },
  {
    label: "```whiteboard",
    detail: "Legacy fence alias for ```time",
    type: "keyword",
    section: WORKOUT_SECTION,
    apply: snippet("```time\n${}\n```"),
    boost: 9,
  },
];

export const SLASH_COMMANDS: Completion[] = [
  {
    label: "/time",
    detail: "Timer workout block",
    type: "keyword",
    section: WORKOUT_SECTION,
    apply: snippet("```time\n${10:00 Run}\n```"),
    boost: 95,
  },
  {
    label: "/log",
    detail: "Completed workout log",
    type: "keyword",
    section: WORKOUT_SECTION,
    apply: snippet("```log\n${5x5 Back Squat @100kg}\n```"),
    boost: 92,
  },
  {
    label: "/query",
    detail: "Analytics query chart or table",
    type: "keyword",
    section: WORKOUT_SECTION,
    apply: snippet("```query\n${:sum{metric:reps} by {week} last 4w | :bar{}}\n```"),
    boost: 90,
  },
  {
    label: "/table",
    detail: "Data comparison table",
    type: "text",
    section: MARKDOWN_SECTION,
    apply: snippet("| ${Movement} | ${Sets} | ${Load} |\n| --- | --- | --- |\n| ${Squat} | ${5} | ${100kg} |"),
    boost: 85,
  },
  {
    label: "/task",
    detail: "Interactive checklist item",
    type: "text",
    section: MARKDOWN_SECTION,
    apply: snippet("- [ ] ${}"),
    boost: 82,
  },
  {
    label: "/h1",
    detail: "Primary section heading (H1)",
    type: "text",
    section: MARKDOWN_SECTION,
    apply: snippet("# ${}"),
    boost: 80,
  },
  {
    label: "/h2",
    detail: "Subsection heading (H2)",
    type: "text",
    section: MARKDOWN_SECTION,
    apply: snippet("## ${}"),
    boost: 78,
  },
  {
    label: "/h3",
    detail: "Minor heading (H3)",
    type: "text",
    section: MARKDOWN_SECTION,
    apply: snippet("### ${}"),
    boost: 76,
  },
  {
    label: "/quote",
    detail: "Callout or blockquote",
    type: "text",
    section: MARKDOWN_SECTION,
    apply: snippet("> ${}"),
    boost: 74,
  },
  {
    label: "/link",
    detail: "External or workspace hyperlink",
    type: "text",
    section: MARKDOWN_SECTION,
    apply: snippet("[${Label}](${https://})"),
    boost: 72,
  },
  {
    label: "/divider",
    detail: "Horizontal section divider",
    type: "text",
    section: MARKDOWN_SECTION,
    apply: "---\n",
    boost: 70,
  },
  {
    label: "/wod",
    detail: "Alias for /time block",
    type: "keyword",
    section: WORKOUT_SECTION,
    apply: snippet("```time\n${10:00 Run}\n```"),
    boost: 10,
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

export function slashBlockCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);

  const match = textBefore.match(/^\/([a-zA-Z0-9-]*)$/);
  if (!match) return null;

  const section = activeCursorSection(context.state);
  if (section && section.type !== "markdown") return null;

  return {
    from: line.from,
    options: SLASH_COMMANDS,
    validFor: /^\/[a-zA-Z0-9-]*$/,
  };
}

export function toggleInlineMarkdown(
  view: EditorView,
  marker: string,
): boolean {
  if (view.state.readOnly) return false;
  const section = activeCursorSection(view.state);
  if (section && section.type !== "markdown") return false;

  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);
  const len = marker.length;

  // Unwrap when the selection itself or surrounding characters already hold the marker
  if (
    selected.length >= len * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(len, selected.length - len);
    view.dispatch({
      changes: { from, to, insert: inner },
      selection: EditorSelection.range(from, from + inner.length),
      userEvent: "input.format",
    });
    return true;
  }

  if (
    from >= len &&
    to + len <= view.state.doc.length &&
    view.state.doc.sliceString(from - len, from) === marker &&
    view.state.doc.sliceString(to, to + len) === marker
  ) {
    view.dispatch({
      changes: [
        { from: from - len, to: from, insert: "" },
        { from: to, to: to + len, insert: "" },
      ],
      selection: EditorSelection.range(from - len, to - len),
      userEvent: "input.format",
    });
    return true;
  }

  const wrapped = `${marker}${selected}${marker}`;
  view.dispatch({
    changes: { from, to, insert: wrapped },
    selection: selected
      ? EditorSelection.range(from + len, from + len + selected.length)
      : EditorSelection.cursor(from + len),
    userEvent: "input.format",
  });
  return true;
}

export function insertMarkdownLinkCommand(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const section = activeCursorSection(view.state);
  if (section && section.type !== "markdown") return false;

  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);
  const label = selected || "Link";
  const urlPlaceholder = "https://";
  const insert = `[${label}](${urlPlaceholder})`;
  const urlStart = from + 1 + label.length + 2;
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.range(urlStart, urlStart + urlPlaceholder.length),
    userEvent: "input.format",
  });
  return true;
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
  // Multi-line selections wrap into a runnable ```time fence; single-line
  // selections wrap as standard Markdown inline `code` (use Mod-Alt-w to wrap
  // a single line in a ```time block).
  if (selected.includes("\n")) {
    view.dispatch({
      changes: {
        from,
        to,
        insert: `\`\`\`time\n${selected}\n\`\`\``,
      },
    });
  } else {
    view.dispatch({
      changes: {
        from,
        to,
        insert: `\`${selected}\``,
      },
      selection: EditorSelection.range(from + 1, from + 1 + selected.length),
    });
  }
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
  {
    key: "Mod-b",
    run: (view) => toggleInlineMarkdown(view, "**"),
  },
  {
    key: "Mod-i",
    run: (view) => toggleInlineMarkdown(view, "*"),
  },
  {
    key: "Mod-e",
    run: (view) => toggleInlineMarkdown(view, "`"),
  },
  {
    key: "Mod-Shift-k",
    run: insertMarkdownLinkCommand,
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
  if (section.type === "query") {
    const editingSections = context.state.field(editingQuerySectionsField, false);
    if (editingSections && !editingSections.has(section.id)) return null;
  }
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
 * snippets, (3) `/` slash block commands, (4) nested fence-body sources.
 */
export async function wodCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
  for (const source of context.state.facet(customCompletionSources)) {
    const result = await source(context);
    if (result) return result;
  }
  return (
    fenceCompletion(context) ??
    slashBlockCompletion(context) ??
    nestedCompletion(context)
  );
}

export const mobileDockedCompletionFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

const SEMANTIC_SVG_PATHS: Record<string, string> = {
  effort: '<path d="M6.5 6.5h11M6.5 17.5h11M4 9v6M20 9v6M7 4v16M17 4v16"/>',
  unit: '<path d="M4 17V7m4 10V11m4 6V7m4 10v-4m4 4V7"/>',
  tag: '<path d="M5 9h14M5 15h14M11 4L8 20M16 4l-3 16"/>',
  keyword: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6"/>',
  template: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><path d="M3 14h18M3 19h12"/>',
  property: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  create: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.5 5.42"/><path d="M14 11a5 5 0 0 0-7.07 0l-2.12 2.12a5 5 0 0 0 7.07 7.07l1.61-1.61"/>',
};

function iconKindForCompletion(completion: Completion): string {
  switch (completion.type) {
    case "variable":
      return "effort";
    case "unit":
      return "unit";
    case "constant":
      return "tag";
    case "keyword":
      return "keyword";
    case "property":
      return "property";
    case "create":
      return "create";
    case "class":
      return "link";
    default:
      return "template";
  }
}

export const wodCompletionIconOption = {
  position: 20,
  render: (completion: Completion): Node => {
    const kind = iconKindForCompletion(completion);
    const span = document.createElement("span");
    span.className = `cm-wod-ac-icon cm-wod-ac-icon--${kind}`;
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SEMANTIC_SVG_PATHS[kind] ?? SEMANTIC_SVG_PATHS.template}</svg>`;
    return span;
  },
};

/**
 * Accept the highlighted suggestion or fall back to the first option when no row
 * has been explicitly arrow-selected (`selectOnOpen: false`). While async
 * sources are still resolving (`pending`), consume Tab without indenting.
 */
export function acceptCompletionOrFirst(view: EditorView): boolean {
  const status = completionStatus(view.state);
  if (status === null) return false;
  if (status === "pending") return true;
  if (selectedCompletionIndex(view.state) === null) {
    if (currentCompletions(view.state).length === 0) return true;
    view.dispatch({ effects: setSelectedCompletion(0) });
  }
  acceptCompletion(view);
  return true;
}

/**
 * Shared completion keyboard contract across Markdown NoteEditor and standalone
 * dialects: Tab commits (top option if none highlighted), Enter preserves
 * newlines unless an option was explicitly selected with ArrowDown/ArrowUp.
 */
export const wodCompletionKeymap: Extension = Prec.highest(
  keymap.of([
    {
      key: "Tab",
      run: acceptCompletionOrFirst,
    },
    {
      key: "Enter",
      run: (view) => {
        if (completionStatus(view.state) === null) return false;
        if (selectedCompletionIndex(view.state) !== null) {
          return acceptCompletion(view);
        }
        closeCompletion(view);
        return false;
      },
    },
  ]),
);

/**
 * True when a `delete.backward` update landed in a slot where the user expects
 * typeahead to re-open:
 * - Workout blocks: at a number (`10|`, `@100|`, `9-7-5|`, `(3|`), partial unit (`10k|`),
 *   post-number space (`10 |`), partial/completed effort or equipment (`10 Back Squa|`),
 *   tag (`#heav|`, `#heavy|`, `#|`), property value (`effort: fr|`), or action cue (`[:re|`).
 * - Markdown prose: inside or landing at the end of `#tag` or `[[wiki link`.
 * Never triggers when joining lines (`\n` deleted), on empty/whitespace-only lines,
 * inside comments (`//`), inside headings, or in frontmatter.
 */
export function shouldTriggerBackspaceCompletion(update: ViewUpdate): boolean {
  if (!update.docChanged || update.state.readOnly) return false;
  if (completionStatus(update.state) !== null) return false;
  if (!update.state.selection.main.empty) return false;

  const backspaces = update.transactions.filter((tr) => tr.isUserEvent("delete.backward"));
  if (backspaces.length === 0) return false;

  for (const tr of backspaces) {
    let deletedNewline = false;
    tr.changes.iterChanges((fromA, toA) => {
      if (tr.startState.doc.sliceString(fromA, toA).includes("\n")) {
        deletedNewline = true;
      }
    });
    if (deletedNewline) return false;
  }

  const head = update.state.selection.main.head;
  const line = update.state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);

  if (isWhiteboardScriptBody(update.state, head)) {
    const trimmedBefore = before.trim();
    if (!trimmedBefore) return false;
    if (/\/\//.test(before)) return false;
    if (/^#(?![A-Za-z0-9])/.test(trimmedBefore)) return false;
    if (/(?:^|\s)[*^]?\d*:\d*$/.test(before)) return false;
    return true;
  }

  const section = activeCursorSection(update.state);
  if (!section || section.type === "markdown") {
    if (/^\s*#{1,6}(?:\s|$)/.test(before)) return false;
    if (/(?:^#[a-zA-Z][a-zA-Z0-9-]*|(?<=\s)#[a-zA-Z0-9-]*)$/.test(before)) return true;
    if (/\[\[[^\]]*$/.test(before)) return true;
  }
  return false;
}

export const wodBackspaceCompletion: Extension = EditorView.updateListener.of((update) => {
  if (shouldTriggerBackspaceCompletion(update)) {
    queueMicrotask(() => {
      if (update.view.state === update.state) startCompletion(update.view);
    });
  }
});

export const wodAutocompletion: Extension = [
  autocompletion({
    selectOnOpen: false,
    interactionDelay: 0,
    icons: false,
    addToOptions: [wodCompletionIconOption],
    tooltipClass: (state) =>
      state.facet(mobileDockedCompletionFacet)
        ? "cm-wod-tooltip cm-wod-tooltip-docked-hidden"
        : "cm-wod-tooltip",
    activateOnCompletion: (completion) =>
      completion.type === "property" &&
      typeof completion.apply === "string" &&
      completion.apply.endsWith(":\n  - "),
    override: [
      // Explicit provider order — see wodCompletionSource.
      wodCompletionSource,
    ],
  }),
  wodBackspaceCompletion,
];
