import { EditorSelection, Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";
import { computeWhiteboardEnterAction, whiteboardScriptLanguage } from "@bitcobblers/wod-wiki-lang";
import { sectionAtPos, sectionField } from "./section-state";

/**
 * True when `pos` sits inside an editable Whiteboard Script body line
 * (inside a `time`/`log`/`wod` fence body in Markdown, or in a standalone
 * Whiteboard Script editor without `sectionField`). Never matches opening or
 * closing fence delimiter lines, prose, frontmatter, or `query`/`wql` blocks.
 */
export function isWhiteboardScriptBody(state: EditorState, pos: number): boolean {
  const sections = state.field(sectionField, false);
  if (sections) {
    const section = sectionAtPos(state, pos);
    if (!section || (section.type !== "time" && section.type !== "log")) {
      return false;
    }
    const line = state.doc.lineAt(pos);
    if (line.number <= section.startLine) return false;
    if (line.number === section.endLine && /^\s*`{3,}\s*$/.test(line.text)) return false;
    return line.number <= section.endLine;
  }
  return (
    whiteboardScriptLanguage.isActiveAt(state, pos, -1) ||
    whiteboardScriptLanguage.isActiveAt(state, pos, 1)
  );
}

/**
 * Handles Enter / Shift-Enter inside Whiteboard Script blocks:
 * - Auto-indents after rounds/container headers (`(3)`, `3 rounds`, `10:00 AMRAP`, `5x5`, `9-7-5`)
 * - Preserves current indentation across lines
 * - Resets indentation to column 0 on double-Enter (blank indented line)
 * - Auto-continues `-` and `+` lap markers and clears them cleanly on double-Enter
 */
export function insertWhiteboardNewline(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const { state } = view;
  const inWhiteboard = state.selection.ranges.every(
    (range) => isWhiteboardScriptBody(state, range.from) && isWhiteboardScriptBody(state, range.to),
  );
  if (!inWhiteboard) return false;

  const unit = state.facet(indentUnit);
  const transaction = state.changeByRange((range) => {
    const startLine = state.doc.lineAt(range.from);
    const endLine = state.doc.lineAt(range.to);

    if (startLine.number === endLine.number) {
      const action = computeWhiteboardEnterAction(
        startLine.text,
        range.from - startLine.from,
        range.to - startLine.from,
        unit,
      );
      const replaceFrom = startLine.from + action.replaceFromCol;
      return {
        changes: {
          from: replaceFrom,
          to: startLine.from + action.replaceToCol,
          insert: action.insert,
        },
        range: EditorSelection.cursor(replaceFrom + action.cursorOffset),
      };
    }

    const beforeOnStart = startLine.text.slice(0, range.from - startLine.from);
    const action = computeWhiteboardEnterAction(
      beforeOnStart,
      beforeOnStart.length,
      beforeOnStart.length,
      unit,
    );
    const afterOnEnd = endLine.text.slice(range.to - endLine.from);
    const leadingAfter = /^[ \t]+/.exec(afterOnEnd)?.[0].length ?? 0;
    const replaceFrom = startLine.from + action.replaceFromCol;
    return {
      changes: {
        from: replaceFrom,
        to: range.to + leadingAfter,
        insert: action.insert,
      },
      range: EditorSelection.cursor(replaceFrom + action.cursorOffset),
    };
  });

  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: "input" }));
  return true;
}

/**
 * High-precedence Enter binding for Whiteboard Script blocks.
 * Sits below `wodCompletionKeymap` (`Prec.highest`) so active arrow-selected
 * completions commit first, and above `markdownKeymap` (`Prec.high`) when mounted
 * before `markdown(...)`. Returns `false` outside workout fence bodies.
 */
export const wodIndentKeymap: Extension = Prec.high(
  keymap.of([
    {
      key: "Enter",
      run: insertWhiteboardNewline,
      shift: insertWhiteboardNewline,
    },
  ]),
);
