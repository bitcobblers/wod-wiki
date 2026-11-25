import { linter } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { whiteboardScriptLanguage } from '@bitcobblers/wod-wiki-lang';
import { sectionField } from "./section-state";

const BLOCK_HEADER_LINE_RE =
  /^[ \t]*(?:\d+:\d+(?::\d+)?\s+)?(?:AMRAP|EMOM|TABATA|FOR TIME)\b|^[ \t]*\(\s*\d+(?:\s*-\s*\d+)*\s*(?:rounds?|rds?)?\s*\)/i;

const DEMOTED_DIALECT_FENCE_RE =
  /^([ \t]*`{3,})(time|wod|whiteboard|log)(?::([\w-]+))?\s+(.+?)\s*$/i;

function leadingIndentWidth(line: string): number {
  let w = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === " ") w += 1;
    else if (line[i] === "\t") w += 2;
    else break;
  }
  return w;
}

export function findWorkoutErrors(content: string, offsetInDoc: number): Diagnostic[] {
  if (!content.trim()) return [];

  const doc = content.endsWith("\n") ? content : content + "\n";
  const tempState = EditorState.create({
    doc,
    extensions: [whiteboardScriptLanguage],
  });

  const tree = syntaxTree(tempState);
  const diagnostics: Diagnostic[] = [];

  tree.iterate({
    enter(node) {
      if (node.type.isError) {
        const from = offsetInDoc + node.from;
        const to = offsetInDoc + Math.max(node.to, node.from + 1);
        diagnostics.push({
          from,
          to: Math.min(to, from + 50),
          severity: "error",
          message: "Syntax error in Whiteboard Script",
        });
      }
    },
  });

  // Warn when a loop/timer header line is immediately followed by unindented movement lines (WW-077).
  const lines = content.split("\n");
  const lineOffsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    lineOffsets.push(cursor);
    cursor += line.length + 1;
  }

  for (let i = 0; i < lines.length; i++) {
    const header = lines[i]!;
    if (!header.trim() || !BLOCK_HEADER_LINE_RE.test(header)) continue;
    const headerIndent = leadingIndentWidth(header);
    const bodyLineStarts: number[] = [];
    let firstFrom = -1;
    let lastTo = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j]!;
      if (!nextLine.trim()) break;
      if (leadingIndentWidth(nextLine) > headerIndent) {
        // Already indented — stop scanning for an unindented sibling block.
        bodyLineStarts.length = 0;
        break;
      }
      if (BLOCK_HEADER_LINE_RE.test(nextLine)) break;
      const absStart = offsetInDoc + lineOffsets[j]!;
      bodyLineStarts.push(absStart);
      if (firstFrom < 0) firstFrom = absStart;
      lastTo = absStart + nextLine.length;
    }

    if (bodyLineStarts.length > 0 && firstFrom >= 0) {
      diagnostics.push({
        from: firstFrom,
        to: Math.max(firstFrom + 1, lastTo),
        severity: "warning",
        message: "Indent lines below header so they run inside the block",
        actions: [
          {
            name: "Indent workout body",
            apply(view) {
              const docLen = view.state.doc.length;
              const changes = bodyLineStarts
                .filter((pos) => pos >= 0 && pos <= docLen)
                .map((pos) => ({ from: pos, to: pos, insert: "  " }));
              if (changes.length > 0) {
                view.dispatch({ changes });
              }
            },
          },
        ],
      });
    }
  }

  return diagnostics;
}

export function workoutLintSource(view: EditorView): Diagnostic[] {
  // The linter may run against states that don't include the section-state
  // extension (e.g. standalone script editors) — nothing to lint then.
  const { sections } = view.state.field(sectionField, false) ?? { sections: [] };
  const diagnostics: Diagnostic[] = [];

  for (const section of sections) {
    if (section.type === "code") {
      // Warn when an author writes trailing words on a workout fence line
      // (e.g. "```wod 3 rounds"), which demotes the block to plain code (WW-137).
      const openLine = view.state.doc.lineAt(section.from);
      const demoted = DEMOTED_DIALECT_FENCE_RE.exec(openLine.text);
      if (demoted) {
        const [, fencePrefix, alias, sport, trailing] = demoted;
        const cleanHeader = `${fencePrefix}${alias}${sport ? `:${sport}` : ""}`;
        diagnostics.push({
          from: openLine.from,
          to: openLine.to,
          severity: "warning",
          message: `Timer block not recognised — fence line must be ${cleanHeader.trim()} (move "${trailing}" inside the block).`,
          actions: [
            {
              name: "Move text into workout block",
              apply(targetView) {
                targetView.dispatch({
                  changes: {
                    from: openLine.from,
                    to: openLine.to,
                    insert: `${cleanHeader}\n${trailing}`,
                  },
                });
              },
            },
          ],
        });
      }
      continue;
    }
    if (section.type !== "time" && section.type !== "log") continue;
    if (section.contentFrom === undefined || section.contentTo === undefined) continue;

    const innerContent = view.state.doc.sliceString(
      section.contentFrom,
      section.contentTo,
    );

    const errors = findWorkoutErrors(innerContent, section.contentFrom);
    diagnostics.push(...errors);
  }

  return diagnostics;
}

export const wodLinter = linter(workoutLintSource, {
  delay: 500,
});
