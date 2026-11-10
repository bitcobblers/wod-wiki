import type { EditorState } from "@codemirror/state";
import { sectionField } from "./section-state";

export function sessionQueryWql(resultId: string): string {
  return `:session{result:${resultId}}`;
}

export function sessionQueryFence(resultId: string): string {
  return `\`\`\`query\n${sessionQueryWql(resultId)}\n\`\`\``;
}

export function sessionQueryInsert(
  state: EditorState,
  blockId: string,
  resultId: string,
): { from: number; insert: string } | null {
  const sections = state.field(sectionField).sections;
  const section = sections.find((s) => s.id === blockId);
  if (!section || (section.type !== "time" && section.type !== "log")) {
    return null;
  }
  return {
    from: section.to,
    insert: `\n\n${sessionQueryFence(resultId)}`,
  };
}
