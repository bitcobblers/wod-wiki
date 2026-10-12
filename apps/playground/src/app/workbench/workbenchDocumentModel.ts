import { actionableSectionKind, parseDocumentSections, reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { parseScriptBlock } from '@/components/Editor/utils/parseScriptBlock';
import { appError } from '@/lib/log';
import type { NoteBlock, ScriptBlock, Section, SectionRecognitionOptions } from '@bitcobblers/wod-wiki-core';

export interface WorkbenchDocumentState {
  readonly sections: Section[];
  readonly blocks: ScriptBlock[];
  readonly noteBlocks: Record<string, NoteBlock>;
  readonly rawContent: string;
  readonly sourceRevision: number;
}

export interface WorkbenchDocumentOptions extends SectionRecognitionOptions {
  noteBlocks?: Record<string, NoteBlock>;
  sourceRevision?: number;
}

export function deriveWorkbenchDocumentState(content: string, options: WorkbenchDocumentOptions = {}): WorkbenchDocumentState {
  const sourceRevision = options.sourceRevision ?? 1;
  const noteBlocks = reconcileNoteBlocks(content, { ...options, blocks: options.noteBlocks, sourceRevision });
  const sections = parseDocumentSections(content, options);
  const blocks: ScriptBlock[] = [];
  for (const section of sections) {
    if (!actionableSectionKind(section)) continue;
    const occurrence = Object.values(noteBlocks).find(block => block.from === section.from && block.to === section.to);
    if (!occurrence) continue;
    section.id = occurrence.id;
    section.version = occurrence.version;
    if (section.scriptBlock) {
      section.scriptBlock = hydrateScriptBlock({ ...section.scriptBlock, id: occurrence.id, version: occurrence.version });
      blocks.push(section.scriptBlock);
    }
  }
  return { sections, blocks, noteBlocks, rawContent: content, sourceRevision };
}

function hydrateScriptBlock(block: ScriptBlock): ScriptBlock {
  try {
    const result = parseScriptBlock(block.content, block.sport);
    return { ...block, statements: result.statements, errors: result.errors, state: result.success ? 'parsed' : 'error' };
  } catch (error) {
    appError('WorkbenchDocumentModel', 'Block parse error:', error);
    return block;
  }
}
