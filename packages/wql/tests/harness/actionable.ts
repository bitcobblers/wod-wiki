import type { Note, NoteBlock, BlockIndexRow } from '@bitcobblers/wod-wiki-core';

export function actionableFixture(
  metadata: Omit<Note, 'rawContent' | 'sourceRevision' | 'blocks'>,
  occurrences: Array<{ id: string; kind?: NoteBlock['kind']; body: string; blockContentId?: string }>,
): { note: Note; blocks: BlockIndexRow[] } {
  let rawContent = '';
  const map: Note['blocks'] = {};
  const blocks: BlockIndexRow[] = [];
  for (const occurrence of occurrences) {
    const kind = occurrence.kind ?? 'wod';
    const tag = kind === 'wod' ? 'time' : kind === 'widget' ? 'widget:attention' : kind;
    const source = `\`\`\`${tag}\n${occurrence.body}\n\`\`\``;
    const from = rawContent.length;
    rawContent += `${source}\n\n`;
    const to = from + source.length;
    map[occurrence.id] = { id: occurrence.id, kind, version: 1, sourceRevision: 1, from, to,
      ...(kind === 'wod' ? { dialect: 'time' } : {}) };
    blocks.push({ id: `${metadata.id}:${occurrence.id}`, noteId: metadata.id, blockId: occurrence.id,
      blockVersion: 1, sourceRevision: 1, from, to, dataType: kind, rawContent: source,
      noteTitle: metadata.title, createdAt: metadata.createdAt, sourceId: metadata.sourceId,
      sourcePath: metadata.sourcePath, blockContentId: occurrence.blockContentId, position: blocks.length });
  }
  return { note: { ...metadata, rawContent, sourceRevision: 1, blocks: map }, blocks };
}
