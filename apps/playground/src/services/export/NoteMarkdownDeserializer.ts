import { type INowProvider, wallClockNow } from '@bitcobblers/wod-wiki-engine';
import type { HistoryRecord } from '@/types/history';
import { validateNoteBlocks, KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core';
import type { NoteBlock } from '@/types/storage';

/**
 * The deserializer's output: a fully-recoverable note. `id`, `createdAt`, and
 * `updatedAt` are present when the markdown was produced by `noteToMarkdown`
 * (the export path writes them); plain-markdown imports omit them so the
 * storage layer mints fresh values. This is what makes the export → import
 * round-trip preserve note identity instead of creating duplicates.
 */
export type ParsedNoteEntry = Omit<HistoryRecord, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'> & {
    id?: string;
    createdAt?: number;
    updatedAt?: number;
};

/**
 * Parse exported-markdown back into a (partial) HistoryRecord.
 *
 * Time is read exclusively through `clock` (an `INowProvider`) — never via
 * `Date.now()` directly — so the import path is deterministic under a frozen
 * clock. The clock is only consulted for the `Target Date` fallback when the
 * markdown omits it; every field that *is* present in the metadata is
 * recovered verbatim — including `ID`, `Created`, and `Updated`, so a
 * re-imported note preserves its identity and timestamps (round-trip safe).
 */
export function parseMarkdownToEntry(
  markdown: string,
  clock: INowProvider = wallClockNow,
): ParsedNoteEntry | null {
  try {
    // Extract metadata section
    const metadataMatch = markdown.match(/## Metadata\s+(.*?)\s+## Content/s);
    if (!metadataMatch) return null;

    const metadataLines = metadataMatch[1].split('\n').filter((line) => line.trim());

    // Parse metadata
    const metadata: Record<string, string> = {};
    for (const line of metadataLines) {
      const match = line.match(/^- \*\*(.+?)\*\*:\s*(.+)$/);
      if (match) {
        metadata[match[1]] = match[2];
      }
    }

    // Extract content
    const contentMatch = markdown.match(/(?:^|\n)## Content\r?\n(?:\r?\n)?/);
    const rawContent = contentMatch?.index !== undefined ? markdown.slice(contentMatch.index + contentMatch[0].length) : '';

    // Extract title from first line
    const titleMatch = markdown.match(/^# (.+)$/m);
    const title = titleMatch ? titleMatch[1] : 'Imported Note';

    // Parse tags
    const tags =
      metadata['Tags'] && metadata['Tags'] !== 'None'
        ? metadata['Tags'].split(',').map((t) => t.trim())
        : [];

    // Parse dates — recover the stored Target Date verbatim; only fall back to
    // the clock when the metadata omits it.
    const targetDate = metadata['Target Date']
      ? new Date(metadata['Target Date']).getTime()
      : clock.nowMs();
    const result: ParsedNoteEntry = {
      title,
      rawContent,
      tags,
      targetDate,
      sections: [],
    };

    // Recover the identity + timestamp fields the serializer writes, so the
    // export → import round-trip preserves them (rather than minting fresh
    // values). Absent for plain-markdown imports — left undefined, and the
    // storage layer mints fresh ones.
    if (metadata['ID']) {
      result.id = metadata['ID'];
    }
    if (metadata['Created']) {
      const createdMs = Date.parse(metadata['Created']);
      if (!Number.isNaN(createdMs)) result.createdAt = createdMs;
    }
    if (metadata['Updated']) {
      const updatedMs = Date.parse(metadata['Updated']);
      if (!Number.isNaN(updatedMs)) result.updatedAt = updatedMs;
    }
    if (metadata['Source Revision']) {
      const revision = Number(metadata['Source Revision']);
      if (!Number.isSafeInteger(revision) || revision < 1) return null;
      result.sourceRevision = revision;
    }
    if (metadata['Blocks']) {
      const blocks: Record<string, NoteBlock> = JSON.parse(metadata['Blocks']);
      validateNoteBlocks(rawContent, blocks, result.sourceRevision ?? 1, { registeredWidgets: KNOWN_SECTION_WIDGETS });
      result.blocks = blocks;
    }

    if (metadata['Cloned From']) {
      result.sourceId = metadata['Cloned From'];
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Create a (partial) HistoryRecord from arbitrary markdown. Exported-format
 * markdown round-trips through {@link parseMarkdownToEntry}; plain markdown
 * gets a minimal entry whose `targetDate` is the clock's current time.
 *
 * Time comes exclusively from `clock` (defaulting to the wall clock) — never
 * from `Date.now()`.
 */
export function createNoteFromMarkdown(
  markdown: string,
  clock: INowProvider = wallClockNow,
): ParsedNoteEntry {
  // Try to parse as exported format first
  const parsed = parseMarkdownToEntry(markdown, clock);
  if (parsed) return parsed;

  // Otherwise, treat as plain markdown
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : 'Imported Note';

  return {
    title,
    rawContent: markdown,
    tags: [],
    targetDate: clock.nowMs(),
    sections: [],
  };
}
