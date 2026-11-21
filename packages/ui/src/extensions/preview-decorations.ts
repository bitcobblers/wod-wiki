import {
  Decoration,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateField, EditorState, RangeSetBuilder } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import { sectionField } from "./section-state";
import { isEditorFocused, setEditorFocused } from "./editor-focus";

const lineDecoCache = new Map<string, Decoration>();

function lineDeco(className: string): Decoration {
  let cached = lineDecoCache.get(className);
  if (!cached) {
    cached = Decoration.line({ attributes: { class: className } });
    lineDecoCache.set(className, cached);
  }
  return cached;
}

class DialectBadgeWidget extends WidgetType {
  constructor(
    readonly dialect: "time" | "log",
    readonly lineFrom: number,
    readonly lineTo: number,
    readonly readOnly: boolean,
  ) {
    super();
  }

  eq(other: DialectBadgeWidget): boolean {
    return (
      this.dialect === other.dialect &&
      this.readOnly === other.readOnly
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const badge = document.createElement("button");
    badge.type = "button";
    const isTime = this.dialect === "time";
    badge.className = isTime
      ? "cm-wod-dialect-badge cm-wod-dialect-time"
      : "cm-wod-dialect-badge cm-wod-dialect-log";
    badge.textContent = isTime ? "TIMER" : "LOG";
    badge.dataset.dialect = this.dialect;
    badge.title = this.readOnly
      ? isTime
        ? "Timer block"
        : "Workout log block"
      : `Switch to ${isTime ? "log" : "time"} block`;
    badge.setAttribute(
      "aria-label",
      this.readOnly
        ? `${isTime ? "Timer" : "Log"} block`
        : `Switch ${isTime ? "timer" : "log"} block to ${isTime ? "log" : "timer"}`,
    );

    if (!this.readOnly) {
      badge.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      badge.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (view.state.readOnly) return;
        let targetPos = Math.max(0, Math.min(this.lineFrom, view.state.doc.length));
        try {
          if (view.dom.contains(badge)) {
            targetPos = Math.max(0, Math.min(view.posAtDOM(badge), view.state.doc.length));
          }
        } catch {
          // Fall back to captured lineFrom
        }
        const currentLine = view.state.doc.lineAt(targetPos);
        const match = currentLine.text.match(/^(\s*`{3,})(time|log|wod|whiteboard)(.*)$/i);
        if (!match) return;
        const nextTag = isTime ? "log" : "time";
        const replacement = `${match[1]}${nextTag}${match[3]}`;
        view.dispatch({
          changes: {
            from: currentLine.from,
            to: currentLine.to,
            insert: replacement,
          },
          userEvent: "input.dialect",
        });
      });
    } else {
      badge.disabled = true;
    }

    return badge;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class AppendLineAfterFenceWidget extends WidgetType {
  constructor(readonly closeLineTo: number) {
    super();
  }

  eq(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-wod-exit-block-btn";
    btn.textContent = "+ Line below";
    btn.title = "Insert a new Markdown line below this block";
    btn.setAttribute("aria-label", "Insert line below block");

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (view.state.readOnly) return;
      let pos = Math.min(this.closeLineTo, view.state.doc.length);
      try {
        if (view.dom.contains(btn)) {
          const domPos = Math.max(0, Math.min(view.posAtDOM(btn), view.state.doc.length));
          pos = view.state.doc.lineAt(domPos).to;
        }
      } catch {
        // Fall back to captured closeLineTo
      }
      const hasTrailingNewline =
        pos < view.state.doc.length &&
        view.state.doc.sliceString(pos, pos + 1) === "\n";
      if (hasTrailingNewline) {
        const nextLine = view.state.doc.lineAt(pos + 1);
        if (nextLine.text.trim() === "") {
          view.dispatch({ selection: { anchor: nextLine.from } });
          view.focus();
          return;
        }
      }
      const insert = "\n\n";
      view.dispatch({
        changes: { from: pos, insert },
        selection: { anchor: pos + insert.length },
        userEvent: "input.exitFence",
      });
      view.focus();
    });

    return btn;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildWorkoutDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const { sections } = state.field(sectionField);
  const cursor = state.selection.main.head;
  const focused = isEditorFocused(state);

  for (const section of sections) {
    if (section.type !== "time" && section.type !== "log") continue;
    const startLine = state.doc.line(section.startLine);
    const endLine = state.doc.line(section.endLine);
    const dialectClass = `cm-wod-block-${section.type}`;
    const isActive =
      !state.readOnly && focused && cursor >= section.from && cursor <= section.to;
    const activeClass = isActive ? " cm-wod-block-active" : "";

    if (section.endLine <= section.startLine) {
      decos.push(
        lineDeco(`cm-wod-fence cm-wod-fence-open ${dialectClass}${activeClass}`).range(
          startLine.from,
        ),
      );
      continue;
    }

    const isEmptyBody = section.endLine === section.startLine + 1;
    decos.push(
      lineDeco(`cm-wod-fence cm-wod-fence-open ${dialectClass}${activeClass}`).range(
        startLine.from,
      ),
    );
    decos.push(
      Decoration.widget({
        widget: new DialectBadgeWidget(
          section.type,
          startLine.from,
          startLine.to,
          state.readOnly,
        ),
        side: -1,
      }).range(startLine.from),
    );

    for (let l = section.startLine + 1; l < section.endLine; l++) {
      const line = state.doc.line(l);
      const isFirst = l === section.startLine + 1 ? " cm-wod-inner-first" : "";
      const isLast = l === section.endLine - 1 ? " cm-wod-inner-last" : "";
      decos.push(
        lineDeco(`cm-wod-inner ${dialectClass}${activeClass}${isFirst}${isLast}`).range(
          line.from,
        ),
      );
    }

    const emptyCloseClass = isEmptyBody ? " cm-wod-fence-close-empty" : "";
    decos.push(
      lineDeco(
        `cm-wod-fence cm-wod-fence-close ${dialectClass}${activeClass}${emptyCloseClass}`,
      ).range(endLine.from),
    );

    if (isActive) {
      decos.push(
        Decoration.widget({
          widget: new AppendLineAfterFenceWidget(endLine.to),
          side: 1,
        }).range(endLine.to),
      );
    }
  }

  decos.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const d of decos) {
    builder.add(d.from, d.to, d.value);
  }
  return builder.finish();
}

const scriptBlockDecoField = StateField.define<DecorationSet>({
  create(state) {
    return buildWorkoutDecorations(state);
  },
  update(deco, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(setEditorFocused))
    ) {
      return buildWorkoutDecorations(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const scriptBlockBaseTheme = EditorView.baseTheme({
  ".cm-wod-fence": {
    fontFamily: 'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, monospace)',
    fontSize: "11.5px",
    color: "hsl(var(--muted-foreground) / 0.72)",
    paddingLeft: "14px",
    paddingRight: "14px",
    backgroundColor: "color-mix(in srgb, hsl(var(--muted)) 48%, hsl(var(--card)) 52%)",
    borderLeft: "1px solid hsl(var(--border) / 0.9)",
    borderRight: "1px solid hsl(var(--border) / 0.9)",
    boxSizing: "border-box",
  },
  "&dark .cm-wod-fence": {
    backgroundColor: "hsl(var(--muted) / 0.92)",
  },
  ".cm-wod-block-time": {
    borderLeftColor: "color-mix(in srgb, hsl(var(--metric-time)) 24%, hsl(var(--border)))",
    borderRightColor: "color-mix(in srgb, hsl(var(--metric-time)) 24%, hsl(var(--border)))",
  },
  ".cm-wod-block-log": {
    borderLeftColor: "color-mix(in srgb, hsl(var(--metric-effort)) 24%, hsl(var(--border)))",
    borderRightColor: "color-mix(in srgb, hsl(var(--metric-effort)) 24%, hsl(var(--border)))",
  },
  ".cm-wod-fence-open": {
    borderTop: "1px solid hsl(var(--border) / 0.9)",
    borderBottom: "1px solid hsl(var(--border) / 0.75)",
    borderRadius: "10px 10px 0 0",
    paddingTop: "7px",
    paddingBottom: "7px",
    paddingLeft: "12px",
    // Reserve right clearance for InlineCommandBar controls inside the unified header bar.
    paddingRight: "228px",
    lineHeight: "24px",
  },
  ".cm-wod-fence-open.cm-wod-block-time": {
    borderTopColor: "color-mix(in srgb, hsl(var(--metric-time)) 24%, hsl(var(--border)))",
    backgroundColor:
      "color-mix(in srgb, hsl(var(--metric-time)) 5%, color-mix(in srgb, hsl(var(--muted)) 80%, hsl(var(--card)) 20%))",
  },
  ".cm-wod-fence-open.cm-wod-block-log": {
    borderTopColor: "color-mix(in srgb, hsl(var(--metric-effort)) 24%, hsl(var(--border)))",
    backgroundColor:
      "color-mix(in srgb, hsl(var(--metric-effort)) 5%, color-mix(in srgb, hsl(var(--muted)) 80%, hsl(var(--card)) 20%))",
  },
  "&dark .cm-wod-fence-open.cm-wod-block-time": {
    borderTopColor: "color-mix(in srgb, hsl(var(--metric-time)) 28%, hsl(var(--border)))",
    backgroundColor: "color-mix(in srgb, hsl(var(--metric-time)) 10%, hsl(var(--muted)))",
  },
  "&dark .cm-wod-fence-open.cm-wod-block-log": {
    borderTopColor: "color-mix(in srgb, hsl(var(--metric-effort)) 28%, hsl(var(--border)))",
    backgroundColor: "color-mix(in srgb, hsl(var(--metric-effort)) 10%, hsl(var(--muted)))",
  },
  ".cm-wod-fence-close": {
    fontSize: "11px",
    color: "hsl(var(--muted-foreground) / 0.55)",
    paddingTop: "3px",
    paddingBottom: "7px",
    borderBottom: "1px solid hsl(var(--border) / 0.9)",
    borderRadius: "0 0 10px 10px",
  },
  ".cm-wod-fence-close.cm-wod-block-time": {
    borderBottomColor: "color-mix(in srgb, hsl(var(--metric-time)) 24%, hsl(var(--border)))",
  },
  ".cm-wod-fence-close.cm-wod-block-log": {
    borderBottomColor: "color-mix(in srgb, hsl(var(--metric-effort)) 24%, hsl(var(--border)))",
  },
  ".cm-wod-fence-close.cm-wod-fence-close-empty": {
    paddingTop: "8px",
    paddingBottom: "8px",
  },
  ".cm-wod-inner": {
    fontFamily: 'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, monospace)',
    fontSize: "13.5px",
    lineHeight: "24px",
    fontVariantNumeric: "tabular-nums",
    paddingLeft: "14px",
    paddingRight: "14px",
    backgroundColor: "color-mix(in srgb, hsl(var(--muted)) 48%, hsl(var(--card)) 52%)",
    borderLeft: "1px solid hsl(var(--border) / 0.9)",
    borderRight: "1px solid hsl(var(--border) / 0.9)",
    boxSizing: "border-box",
  },
  "&dark .cm-wod-inner": {
    backgroundColor: "hsl(var(--muted) / 0.92)",
  },
  ".cm-wod-inner.cm-wod-block-time": {
    borderLeftColor: "color-mix(in srgb, hsl(var(--metric-time)) 24%, hsl(var(--border)))",
    borderRightColor: "color-mix(in srgb, hsl(var(--metric-time)) 24%, hsl(var(--border)))",
  },
  ".cm-wod-inner.cm-wod-block-log": {
    borderLeftColor: "color-mix(in srgb, hsl(var(--metric-effort)) 24%, hsl(var(--border)))",
    borderRightColor: "color-mix(in srgb, hsl(var(--metric-effort)) 24%, hsl(var(--border)))",
  },
  ".cm-wod-inner-first": {
    paddingTop: "8px",
  },
  ".cm-wod-inner-last": {
    paddingBottom: "4px",
  },
  ".cm-wod-block-active.cm-wod-block-time": {
    borderLeftColor: "hsl(var(--metric-time) / 0.58)",
    borderRightColor: "hsl(var(--metric-time) / 0.58)",
  },
  ".cm-wod-fence-open.cm-wod-block-active.cm-wod-block-time": {
    borderTopColor: "hsl(var(--metric-time) / 0.58)",
  },
  ".cm-wod-fence-close.cm-wod-block-active.cm-wod-block-time": {
    borderBottomColor: "hsl(var(--metric-time) / 0.58)",
  },
  ".cm-wod-block-active.cm-wod-block-log": {
    borderLeftColor: "hsl(var(--metric-effort) / 0.58)",
    borderRightColor: "hsl(var(--metric-effort) / 0.58)",
  },
  ".cm-wod-fence-open.cm-wod-block-active.cm-wod-block-log": {
    borderTopColor: "hsl(var(--metric-effort) / 0.58)",
  },
  ".cm-wod-fence-close.cm-wod-block-active.cm-wod-block-log": {
    borderBottomColor: "hsl(var(--metric-effort) / 0.58)",
  },
  ".cm-wod-dialect-badge": {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    height: "22px",
    padding: "0 8px",
    marginRight: "8px",
    borderRadius: "9999px",
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "0.05em",
    lineHeight: "1",
    fontFamily: 'var(--font-sans, "Geist Sans", system-ui, sans-serif)',
    border: "1px solid transparent",
    cursor: "pointer",
    verticalAlign: "middle",
    transition: "background-color 150ms ease, border-color 150ms ease",
  },
  ".cm-wod-dialect-badge::before": {
    content: '""',
    width: "6px",
    height: "6px",
    borderRadius: "9999px",
    backgroundColor: "currentColor",
    opacity: "0.85",
    flexShrink: "0",
  },
  ".cm-wod-dialect-badge:focus-visible": {
    outline: "2px solid hsl(var(--ring))",
    outlineOffset: "1px",
  },
  "@media (pointer: coarse)": {
    ".cm-wod-dialect-badge": {
      minHeight: "32px",
      padding: "0 10px",
    },
  },
  ".cm-wod-dialect-badge:disabled": {
    cursor: "default",
  },
  ".cm-wod-dialect-time": {
    backgroundColor: "color-mix(in srgb, hsl(var(--metric-time)) 12%, hsl(var(--card)))",
    color: "hsl(var(--secondary-foreground))",
    borderColor: "hsl(var(--metric-time) / 0.28)",
  },
  ".cm-wod-dialect-time:hover:not(:disabled)": {
    backgroundColor: "color-mix(in srgb, hsl(var(--metric-time)) 18%, hsl(var(--card)))",
    borderColor: "hsl(var(--metric-time) / 0.45)",
  },
  "&dark .cm-wod-dialect-time": {
    backgroundColor: "hsl(var(--metric-time) / 0.16)",
    color: "color-mix(in srgb, hsl(var(--metric-time)) 78%, hsl(var(--foreground)))",
    borderColor: "hsl(var(--metric-time) / 0.34)",
  },
  "&dark .cm-wod-dialect-time:hover:not(:disabled)": {
    backgroundColor: "hsl(var(--metric-time) / 0.24)",
    borderColor: "hsl(var(--metric-time) / 0.52)",
  },
  ".cm-wod-dialect-log": {
    backgroundColor: "color-mix(in srgb, hsl(var(--metric-effort)) 11%, hsl(var(--card)))",
    color: "color-mix(in srgb, hsl(var(--metric-effort)) 78%, hsl(var(--foreground)))",
    borderColor: "hsl(var(--metric-effort) / 0.28)",
  },
  ".cm-wod-dialect-log:hover:not(:disabled)": {
    backgroundColor: "color-mix(in srgb, hsl(var(--metric-effort)) 17%, hsl(var(--card)))",
    borderColor: "hsl(var(--metric-effort) / 0.45)",
  },
  "&dark .cm-wod-dialect-log": {
    backgroundColor: "hsl(var(--metric-effort) / 0.16)",
    color: "color-mix(in srgb, hsl(var(--metric-effort)) 78%, hsl(var(--foreground)))",
    borderColor: "hsl(var(--metric-effort) / 0.34)",
  },
  "&dark .cm-wod-dialect-log:hover:not(:disabled)": {
    backgroundColor: "hsl(var(--metric-effort) / 0.24)",
    borderColor: "hsl(var(--metric-effort) / 0.52)",
  },
  ".cm-wod-exit-block-btn": {
    marginLeft: "10px",
    display: "inline-flex",
    alignItems: "center",
    height: "20px",
    padding: "0 7px",
    borderRadius: "5px",
    fontSize: "11px",
    fontFamily: 'var(--font-sans, "Geist Sans", system-ui, sans-serif)',
    fontWeight: "500",
    color: "hsl(var(--muted-foreground))",
    backgroundColor: "transparent",
    border: "1px dashed hsl(var(--border))",
    cursor: "pointer",
    verticalAlign: "middle",
    transition: "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
  },
  ".cm-wod-exit-block-btn:hover": {
    color: "hsl(var(--foreground))",
    backgroundColor: "hsl(var(--card))",
    borderStyle: "solid",
  },
  ".cm-wod-exit-block-btn:focus-visible": {
    outline: "2px solid hsl(var(--ring))",
    outlineOffset: "1px",
  },
});

export const previewDecorations: Extension = [
  scriptBlockDecoField,
  scriptBlockBaseTheme,
];
