import { parseDocumentSections } from './sectionParser';
import type { ScriptBlock } from '../types/section';


/**
 * Detects all WOD blocks in markdown content.
 * Recognises ```time and ```log as valid workout fences (optional :sport suffix).
 *
 * @param content - Markdown content to parse
 * @returns Array of detected WOD blocks (with dialect set)
 */
export function detectScriptBlocks(content: string): ScriptBlock[] {
  return parseDocumentSections(content).flatMap(section => section.scriptBlock ? [section.scriptBlock] : []);
}

/**
 * Find which block contains a given line number.
 *
 * @param blocks - Array of WOD blocks
 * @param lineNumber - Line number to search for (0-indexed)
 * @returns The block containing the line, or null if not found
 */
export function findBlockAtLine(
  blocks: ScriptBlock[],
  lineNumber: number
): ScriptBlock | null {
  return (
    blocks.find(
      (block) => lineNumber >= block.startLine && lineNumber <= block.endLine
    ) ?? null
  );
}

/**
 * Extract WOD block content from markdown (without backticks).
 *
 * @param content - Full markdown content
 * @param startLine - Start line of block (0-indexed)
 * @param endLine - End line of block (0-indexed)
 * @returns Extracted block content
 */
export function extractBlockContent(content: string, startLine: number, endLine: number): string {
  return parseDocumentSections(content).find(section => section.startLine === startLine && section.endLine === endLine && section.scriptBlock)?.scriptBlock?.content ?? '';
}
