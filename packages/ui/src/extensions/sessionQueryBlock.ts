import type { EditorState } from '@codemirror/state';
import { sectionField } from './section-state';

export interface SessionQueryFenceOptions {
  view?: 'summary' | 'table';
}

export function sessionQueryWql(resultId: string): string {
  return `:session{result:${resultId}}`;
}

export function sessionQueryFence(
  resultId: string,
  options?: SessionQueryFenceOptions,
): string {
  const wql = sessionQueryWql(resultId);
  if (options?.view === 'table') {
    return `\`\`\`query\n${wql}\n\`\`\``;
  }
  return `\`\`\`query\nview: summary\nquery: ${wql}\n\`\`\``;
}

export function sessionQueryInsert(
  state: EditorState,
  blockId: string,
  resultId: string,
  options?: SessionQueryFenceOptions,
): { from: number; insert: string } | null {
  const section = state
    .field(sectionField)
    .sections.find((item) => item.id === blockId && item.type === 'time');
  if (!section) return null;
  const doc = state.doc.toString();
  if (doc.includes(sessionQueryWql(resultId))) return null;
  return {
    from: section.to,
    insert: `\n\n${sessionQueryFence(resultId, options)}`,
  };
}
