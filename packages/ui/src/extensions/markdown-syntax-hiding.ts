import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateField, EditorState, RangeSetBuilder } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import { sectionField } from "./section-state";
import { editorFocusField, isEditorFocused, setEditorFocused } from "./editor-focus";

const HEADING_RE = /^(#{1,6})\s+/;
const BLOCKQUOTE_RE = /^(>\s?)/;
const TASK_RE = /^(\s*)([-*+])\s+\[([ xX])\](\s+)/;
const BULLET_RE = /^(\s*)([-*+])(\s+)/;
const HR_RE = /^(?:---+|\*\*\*+|___+)\s*$/;
const CODE_SPAN_RE = /`([^`\n]+)`/g;
const BOLD_STAR_RE = /\*\*([^*\n]+)\*\*/g;
const BOLD_UNDER_RE = /(?<![A-Za-z0-9])__([^_\n]+)__(?![A-Za-z0-9])/g;
const STRIKE_RE = /~~([^~\n]+)~~/g;
const ITALIC_STAR_RE = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;
const ITALIC_UNDER_RE = /(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g;

const HEADING_LINE_DECOS = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ attributes: { class: `cm-md-heading cm-md-heading-${level}` } }),
);
const blockquoteLineDeco = Decoration.line({
  attributes: { class: "cm-md-blockquote" },
});
const hrLineDeco = Decoration.line({
  attributes: { class: "cm-md-hr-line" },
});

const hideSyntaxDeco = Decoration.replace({});
const boldDeco = Decoration.mark({ class: "cm-md-bold font-bold" });
const italicDeco = Decoration.mark({ class: "cm-md-italic italic" });
const strikeDeco = Decoration.mark({ class: "cm-md-strike line-through" });
const inlineCodeDeco = Decoration.mark({ class: "cm-md-inline-code" });
const taskDoneTextDeco = Decoration.mark({ class: "cm-md-task-done" });

class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly bracketPos: number,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked && this.bracketPos === other.bracketPos;
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = this.checked
      ? "cm-md-task-checkbox cm-md-task-checkbox-checked"
      : "cm-md-task-checkbox";
    btn.setAttribute("role", "checkbox");
    btn.setAttribute("aria-checked", String(this.checked));
    btn.setAttribute("aria-label", this.checked ? "Mark task incomplete" : "Mark task complete");
    btn.dataset.checked = String(this.checked);

    if (this.checked) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 12 12");
      svg.setAttribute("fill", "none");
      svg.setAttribute("class", "cm-md-task-check-icon");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M2.5 6.2L5 8.7L9.5 3.5");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.8");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
      btn.appendChild(svg);
    }

    const toggle = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (view.state.readOnly) return;
      const charAtPos = view.state.doc.sliceString(this.bracketPos + 1, this.bracketPos + 2);
      if (charAtPos !== " " && charAtPos !== "x" && charAtPos !== "X") return;
      const nextChar = this.checked ? " " : "x";
      view.dispatch({
        changes: {
          from: this.bracketPos + 1,
          to: this.bracketPos + 2,
          insert: nextChar,
        },
        userEvent: "input.toggle",
      });
    };

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("click", toggle);
    return btn;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class BulletPointWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-bullet-marker";
    span.setAttribute("aria-hidden", "true");
    span.textContent = "•";
    return span;
  }
}

class HorizontalRuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-hr";
    span.setAttribute("role", "separator");
    return span;
  }
}

const bulletWidgetDeco = Decoration.replace({ widget: new BulletPointWidget() });
const hrWidgetDeco = Decoration.replace({ widget: new HorizontalRuleWidget() });

function overlapsProtected(
  protectedSpans: readonly [number, number][],
  from: number,
  to: number,
): boolean {
  return protectedSpans.some(([a, b]) => from < b && to > a);
}

function collectInlineDecorations(
  lineFrom: number,
  lineText: string,
  bodyOffset: number,
  decos: Range<Decoration>[],
): void {
  const protectedSpans: [number, number][] = [];

  // Protect markdown links and images so underscores/asterisks inside URLs are untouched
  const linkOrImgRe = /!?\[[^\]]*\]\([^)\n]*\)/g;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkOrImgRe.exec(lineText)) !== null) {
    // Protect only the `(url)` part so `[**bold** label](url)` can still format label if outside pill
    const openParen = linkMatch[0].lastIndexOf("(");
    if (openParen >= 0) {
      protectedSpans.push([
        linkMatch.index + openParen,
        linkMatch.index + linkMatch[0].length,
      ]);
    }
  }

  // 1. Inline code (`code`) — highest precedence; protects interior from bold/italic/strike
  let match: RegExpExecArray | null;
  CODE_SPAN_RE.lastIndex = bodyOffset;
  while ((match = CODE_SPAN_RE.exec(lineText)) !== null) {
    const localStart = match.index;
    const localEnd = localStart + match[0].length;
    if (overlapsProtected(protectedSpans, localStart, localEnd)) continue;
    protectedSpans.push([localStart, localEnd]);
    const start = lineFrom + localStart;
    const end = lineFrom + localEnd;
    decos.push(hideSyntaxDeco.range(start, start + 1));
    if (start + 1 < end - 1) {
      decos.push(inlineCodeDeco.range(start + 1, end - 1));
    }
    decos.push(hideSyntaxDeco.range(end - 1, end));
  }

  // 2. Bold (**text** and __text__)
  for (const regex of [BOLD_STAR_RE, BOLD_UNDER_RE]) {
    regex.lastIndex = bodyOffset;
    while ((match = regex.exec(lineText)) !== null) {
      const localStart = match.index;
      const localEnd = localStart + match[0].length;
      if (overlapsProtected(protectedSpans, localStart, localEnd)) continue;
      const start = lineFrom + localStart;
      const end = lineFrom + localEnd;
      decos.push(hideSyntaxDeco.range(start, start + 2));
      if (start + 2 < end - 2) {
        decos.push(boldDeco.range(start + 2, end - 2));
      }
      decos.push(hideSyntaxDeco.range(end - 2, end));
    }
  }

  // 3. Strikethrough (~~text~~)
  STRIKE_RE.lastIndex = bodyOffset;
  while ((match = STRIKE_RE.exec(lineText)) !== null) {
    const localStart = match.index;
    const localEnd = localStart + match[0].length;
    if (overlapsProtected(protectedSpans, localStart, localEnd)) continue;
    const start = lineFrom + localStart;
    const end = lineFrom + localEnd;
    decos.push(hideSyntaxDeco.range(start, start + 2));
    if (start + 2 < end - 2) {
      decos.push(strikeDeco.range(start + 2, end - 2));
    }
    decos.push(hideSyntaxDeco.range(end - 2, end));
  }

  // 4. Italic (*text* and _text_)
  for (const regex of [ITALIC_STAR_RE, ITALIC_UNDER_RE]) {
    regex.lastIndex = bodyOffset;
    while ((match = regex.exec(lineText)) !== null) {
      const localStart = match.index;
      const localEnd = localStart + match[0].length;
      if (overlapsProtected(protectedSpans, localStart, localEnd)) continue;
      const start = lineFrom + localStart;
      const end = lineFrom + localEnd;
      decos.push(hideSyntaxDeco.range(start, start + 1));
      if (start + 1 < end - 1) {
        decos.push(italicDeco.range(start + 1, end - 1));
      }
      decos.push(hideSyntaxDeco.range(end - 1, end));
    }
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const { sections } = state.field(sectionField);
  const sel = state.selection.main;
  const focused = isEditorFocused(state);
  const canRevealRaw = !state.readOnly && focused;

  for (const section of sections) {
    if (section.type !== "markdown") continue;

    for (let l = section.startLine; l <= section.endLine; l++) {
      const line = state.doc.line(l);
      // Skip raw pipe-table lines (handled by markdownTablePreview)
      if (line.text.trimStart().startsWith("|")) continue;

      const isCursorOnLine =
        canRevealRaw && sel.from <= line.to && sel.to >= line.from;

      // Horizontal rule (`---`, `***`, `___`)
      if (HR_RE.test(line.text.trim()) && line.text.trim().length >= 3) {
        decos.push(hrLineDeco.range(line.from));
        if (!isCursorOnLine && line.to > line.from) {
          decos.push(hrWidgetDeco.range(line.from, line.to));
        }
        continue;
      }

      // Headings (`# H1` .. `###### H6`)
      const headingMatch = line.text.match(HEADING_RE);
      if (headingMatch) {
        const level = headingMatch[1].length;
        decos.push(HEADING_LINE_DECOS[level - 1].range(line.from));
        const bodyOffset = headingMatch[0].length;
        if (!isCursorOnLine) {
          decos.push(hideSyntaxDeco.range(line.from, line.from + bodyOffset));
          collectInlineDecorations(line.from, line.text, bodyOffset, decos);
        }
        continue;
      }

      // Blockquotes (`> quote`)
      const quoteMatch = line.text.match(BLOCKQUOTE_RE);
      if (quoteMatch) {
        decos.push(blockquoteLineDeco.range(line.from));
        const bodyOffset = quoteMatch[0].length;
        if (!isCursorOnLine) {
          decos.push(hideSyntaxDeco.range(line.from, line.from + bodyOffset));
          collectInlineDecorations(line.from, line.text, bodyOffset, decos);
        }
        continue;
      }

      // Task list items (`- [ ] task` / `- [x] task`)
      const taskMatch = line.text.match(TASK_RE);
      if (taskMatch) {
        const indentLen = taskMatch[1].length;
        const checked = taskMatch[3].toLowerCase() === "x";
        const prefixLen = taskMatch[0].length;
        const bracketIndexInLine = line.text.indexOf("[", indentLen);
        const bracketPos = line.from + bracketIndexInLine;

        if (!isCursorOnLine) {
          decos.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(checked, bracketPos),
            }).range(line.from + indentLen, line.from + prefixLen),
          );
          if (checked && line.from + prefixLen < line.to) {
            decos.push(taskDoneTextDeco.range(line.from + prefixLen, line.to));
          }
          collectInlineDecorations(line.from, line.text, prefixLen, decos);
        }
        continue;
      }

      // Unordered bullet list items (`- item`, `* item`, `+ item`)
      const bulletMatch = line.text.match(BULLET_RE);
      if (bulletMatch) {
        // Leave standalone YouTube bullet items untouched so linkPreview's block widget owns the line
        const rest = line.text.slice(bulletMatch[0].length).trim();
        const isStandaloneYoutube =
          /^(?:https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)\S+|\[[^\]]*\]\(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)[^)\s]+\))$/.test(
            rest,
          );
        if (!isStandaloneYoutube) {
          const indentLen = bulletMatch[1].length;
          const prefixLen = bulletMatch[0].length;
          if (!isCursorOnLine) {
            decos.push(bulletWidgetDeco.range(line.from + indentLen, line.from + prefixLen));
            collectInlineDecorations(line.from, line.text, prefixLen, decos);
          }
          continue;
        }
      }

      if (!isCursorOnLine) {
        collectInlineDecorations(line.from, line.text, 0, decos);
      }
    }
  }

  decos.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const d of decos) {
    builder.add(d.from, d.to, d.value);
  }
  return builder.finish();
}

const markdownSyntaxHidingField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(deco, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(setEditorFocused))
    ) {
      return buildDecorations(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const markdownSyntaxHidingTheme = EditorView.baseTheme({
  ".cm-md-heading-1": {
    fontFamily: 'var(--font-serif, Newsreader, "Instrument Serif", Georgia, serif)',
    fontSize: "1.45em",
    lineHeight: "1.3",
    fontWeight: "600",
    letterSpacing: "-0.025em",
    color: "hsl(var(--foreground))",
  },
  ".cm-md-heading-2": {
    fontSize: "1.22em",
    lineHeight: "1.35",
    fontWeight: "600",
    letterSpacing: "-0.02em",
    color: "hsl(var(--foreground))",
  },
  ".cm-md-heading-3": {
    fontSize: "1.1em",
    lineHeight: "1.4",
    fontWeight: "600",
    letterSpacing: "-0.015em",
    color: "hsl(var(--foreground))",
  },
  ".cm-md-heading-4, .cm-md-heading-5, .cm-md-heading-6": {
    fontSize: "1em",
    fontWeight: "600",
    letterSpacing: "-0.01em",
    color: "hsl(var(--foreground))",
  },
  ".cm-md-inline-code": {
    fontFamily: 'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, monospace)',
    fontSize: "0.88em",
    padding: "1px 5px",
    borderRadius: "4px",
    backgroundColor: "hsl(var(--muted) / 0.65)",
    border: "1px solid hsl(var(--border) / 0.8)",
    color: "hsl(var(--foreground))",
  },
  ".cm-md-blockquote": {
    borderLeft: "2px solid hsl(var(--border))",
    paddingLeft: "12px !important",
    color: "hsl(var(--muted-foreground))",
    fontFamily: 'var(--font-serif, Newsreader, "Instrument Serif", Georgia, serif)',
    fontStyle: "italic",
  },
  ".cm-md-bullet-marker": {
    display: "inline-block",
    width: "1.1em",
    color: "hsl(var(--muted-foreground))",
    fontWeight: "600",
    userSelect: "none",
  },
  ".cm-md-task-checkbox": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "14px",
    height: "14px",
    marginRight: "7px",
    verticalAlign: "-2px",
    borderRadius: "3px",
    border: "1px solid hsl(var(--field-border))",
    backgroundColor: "hsl(var(--card))",
    color: "hsl(var(--background))",
    cursor: "pointer",
    padding: "0",
  },
  ".cm-md-task-checkbox-checked": {
    backgroundColor: "hsl(var(--foreground))",
    borderColor: "hsl(var(--foreground))",
    color: "hsl(var(--background))",
  },
  ".cm-md-task-check-icon": {
    width: "10px",
    height: "10px",
    display: "block",
  },
  ".cm-md-task-done": {
    textDecoration: "line-through",
    color: "hsl(var(--muted-foreground))",
  },
  ".cm-md-hr-line": {
    display: "flex",
    alignItems: "center",
  },
  ".cm-md-hr": {
    display: "inline-block",
    width: "100%",
    height: "1px",
    backgroundColor: "hsl(var(--border))",
    verticalAlign: "middle",
  },
});

export function markdownSyntaxHiding(): Extension {
  void editorFocusField;
  return [markdownSyntaxHidingField, markdownSyntaxHidingTheme];
}
