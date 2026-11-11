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

const fenceOpenDeco = Decoration.line({
  attributes: { class: "cm-wod-fence cm-wod-fence-open" },
});

const fenceCloseDeco = Decoration.line({
  attributes: { class: "cm-wod-fence cm-wod-fence-close" },
});

const workoutInnerDeco = Decoration.line({
  attributes: { class: "cm-wod-inner" },
});

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
      this.lineFrom === other.lineFrom &&
      this.lineTo === other.lineTo &&
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
        const currentLine = view.state.doc.lineAt(this.lineFrom);
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

  eq(other: AppendLineAfterFenceWidget): boolean {
    return this.closeLineTo === other.closeLineTo;
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
      const pos = Math.min(this.closeLineTo, view.state.doc.length);
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

    if (section.endLine <= section.startLine) {
      decos.push(fenceOpenDeco.range(startLine.from));
      continue;
    }

    decos.push(fenceOpenDeco.range(startLine.from));
    decos.push(
      Decoration.widget({
        widget: new DialectBadgeWidget(
          section.type,
          startLine.from,
          startLine.to,
          state.readOnly,
        ),
        side: 1,
      }).range(startLine.to),
    );

    for (let l = section.startLine + 1; l < section.endLine; l++) {
      const line = state.doc.line(l);
      decos.push(workoutInnerDeco.range(line.from));
    }

    decos.push(fenceCloseDeco.range(endLine.from));

    const cursorInsideSection =
      !state.readOnly && focused && cursor >= section.from && cursor <= section.to;
    if (cursorInsideSection) {
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
    color: "hsl(var(--muted-foreground))",
    paddingLeft: "7px",
    paddingRight: "8px",
    backgroundColor: "hsl(var(--card))",
    borderLeft: "1px solid hsl(var(--border))",
    borderRight: "1px solid hsl(var(--border))",
    boxSizing: "border-box",
  },
  ".cm-wod-fence-open": {
    borderTop: "1px solid hsl(var(--border))",
    borderRadius: "8px 8px 0 0",
    // Keep exact 26px top breathing room so the inline header controls never
    // cover the preceding prose row or the first workout statement line.
    paddingTop: "26px",
    backgroundColor: "transparent",
    backgroundImage:
      "linear-gradient(to bottom, transparent 26px, hsl(var(--border)) 26px, hsl(var(--border)) 27px, hsl(var(--card)) 27px)",
  },
  ".cm-wod-fence-close": {
    borderBottom: "1px solid hsl(var(--border))",
    borderRadius: "0 0 8px 8px",
  },
  ".cm-wod-inner": {
    fontFamily: 'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, monospace)',
    fontVariantNumeric: "tabular-nums",
    paddingLeft: "7px",
    paddingRight: "8px",
    backgroundColor: "hsl(var(--card))",
    borderLeft: "1px solid hsl(var(--border))",
    borderRight: "1px solid hsl(var(--border))",
    boxSizing: "border-box",
  },
  ".cm-wod-dialect-badge": {
    display: "inline-flex",
    alignItems: "center",
    height: "17px",
    padding: "0 6px",
    marginLeft: "8px",
    borderRadius: "4px",
    fontSize: "9.5px",
    fontWeight: "600",
    letterSpacing: "0.06em",
    fontFamily: 'var(--font-sans, "Geist Sans", system-ui, sans-serif)',
    border: "1px solid transparent",
    cursor: "pointer",
    verticalAlign: "1px",
  },
  ".cm-wod-dialect-badge:disabled": {
    cursor: "default",
  },
  ".cm-wod-dialect-time": {
    backgroundColor: "#E1F3FE",
    color: "#1F6C9F",
    borderColor: "rgba(31, 108, 159, 0.2)",
  },
  "&dark .cm-wod-dialect-time": {
    backgroundColor: "hsl(var(--metric-time) / 0.16)",
    color: "hsl(var(--metric-time))",
    borderColor: "hsl(var(--metric-time) / 0.3)",
  },
  ".cm-wod-dialect-log": {
    backgroundColor: "#EDF3EC",
    color: "#346538",
    borderColor: "rgba(52, 101, 56, 0.2)",
  },
  "&dark .cm-wod-dialect-log": {
    backgroundColor: "hsl(var(--metric-effort) / 0.16)",
    color: "hsl(var(--metric-effort))",
    borderColor: "hsl(var(--metric-effort) / 0.3)",
  },
  ".cm-wod-exit-block-btn": {
    marginLeft: "10px",
    display: "inline-flex",
    alignItems: "center",
    height: "18px",
    padding: "0 6px",
    borderRadius: "4px",
    fontSize: "10px",
    fontFamily: 'var(--font-sans, "Geist Sans", system-ui, sans-serif)',
    fontWeight: "500",
    color: "hsl(var(--muted-foreground))",
    backgroundColor: "hsl(var(--muted) / 0.6)",
    border: "1px solid hsl(var(--border))",
    cursor: "pointer",
    verticalAlign: "middle",
  },
  ".cm-wod-exit-block-btn:hover": {
    color: "hsl(var(--foreground))",
    backgroundColor: "hsl(var(--muted))",
  },
});

export const previewDecorations: Extension = [
  scriptBlockDecoField,
  scriptBlockBaseTheme,
];
