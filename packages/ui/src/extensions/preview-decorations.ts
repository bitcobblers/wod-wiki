import {
  Decoration,
  EditorView,
} from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateField, EditorState, RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { sectionField } from "./section-state";

const fenceOpenDeco = Decoration.line({
  attributes: { class: "cm-wod-fence cm-wod-fence-open" },
});

const fenceCloseDeco = Decoration.line({
  attributes: { class: "cm-wod-fence cm-wod-fence-close" },
});
const workoutInnerDeco = Decoration.line({
  attributes: { class: "cm-wod-inner" },
});

function buildWorkoutDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { sections } = state.field(sectionField);
  for (const section of sections) {
    if (section.type !== "time" && section.type !== "log") continue;
    const startLine = state.doc.line(section.startLine);
    const endLine = state.doc.line(section.endLine);

    if (section.endLine <= section.startLine) {
      builder.add(startLine.from, startLine.from, fenceOpenDeco);
      continue;
    }

    builder.add(startLine.from, startLine.from, fenceOpenDeco);

    for (let l = section.startLine + 1; l < section.endLine; l++) {
      const line = state.doc.line(l);
      builder.add(line.from, line.from, workoutInnerDeco);
    }

    builder.add(endLine.from, endLine.from, fenceCloseDeco);
  }

  return builder.finish();
}
const scriptBlockDecoField = StateField.define<DecorationSet>({
  create(state) {
    return buildWorkoutDecorations(state);
  },
  update(deco, tr) {
    if (tr.docChanged) return buildWorkoutDecorations(tr.state);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const scriptBlockBaseTheme = EditorView.baseTheme({
  ".cm-wod-fence": {
    opacity: "0.5",
    fontSize: "0.85em",
    color: "hsl(var(--metric-time))",
    paddingLeft: "8px",
    paddingRight: "8px",
    backgroundColor: "rgba(128, 128, 128, 0.05)",
    borderLeft: "1px solid hsl(var(--border) / 0.5)",
    borderRight: "1px solid hsl(var(--border) / 0.5)",
    boxSizing: "border-box",
  },
  ".cm-wod-fence-open": {
    borderTop: "1px solid hsl(var(--border) / 0.5)",
    borderRadius: "6px 6px 0 0",
    // The 44px inline command bar bottom-aligns with this line's bottom (= the
    // ``` text row, no bottom padding), popping up into this padding so it
    // can't cover the previous line or the block's first content line.
    // 44px button - 22px text row = 22px overflow, +4px breathing room.
    paddingTop: "26px",
    // Tint only the heading row (1px border + 26px padding above the 22px
    // cm-content line-height); the padding above shows the plain editor
    // background.
    backgroundColor: "transparent",
    backgroundImage:
      "linear-gradient(to bottom, transparent 27px, rgba(128, 128, 128, 0.05) 27px)",
  },
  ".cm-wod-fence-close": {
    borderBottom: "1px solid hsl(var(--border) / 0.5)",
    borderRadius: "0 0 6px 6px",
  },
  ".cm-wod-inner": {
    paddingLeft: "8px",
    paddingRight: "8px",
    backgroundColor: "rgba(128, 128, 128, 0.05)",
    borderLeft: "1px solid hsl(var(--border) / 0.5)",
    borderRight: "1px solid hsl(var(--border) / 0.5)",
    boxSizing: "border-box",
  },
});
export const previewDecorations: Extension = [
  scriptBlockDecoField,
  scriptBlockBaseTheme,
];
