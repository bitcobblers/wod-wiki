import { describe, it, expect } from 'bun:test';
import { parseMarkdownToEntry, createNoteFromMarkdown } from './NoteMarkdownDeserializer';
import { frozenNow } from '@bitcobblers/wod-wiki-engine';

describe('parseMarkdownToEntry', () => {
  it('parses valid exported markdown with metadata', () => {
    const markdown = `# My Workout

## Metadata
- **Tags**: tag1, tag2
- **Target Date**: 2025-01-15T10:00:00.000Z

## Content

Some workout content here.`;

    const result = parseMarkdownToEntry(markdown);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('My Workout');
    expect(result!.tags).toEqual(['tag1', 'tag2']);
    expect(result!.targetDate).toBe(new Date('2025-01-15T10:00:00.000Z').getTime());
    expect(result!.rawContent).toBe('Some workout content here.');
  });

  it('returns null when metadata section is missing', () => {
    const markdown = `# Just a header
Some content without metadata.`;
    expect(parseMarkdownToEntry(markdown)).toBeNull();
  });

  it('returns null for malformed markdown with no headers', () => {
    const markdown = 'Just plain text without any structure.';
    expect(parseMarkdownToEntry(markdown)).toBeNull();
  });

  it('splits comma-separated tags into an array', () => {
    const markdown = `# Title
## Metadata
- **Tags**: alpha, beta, gamma
## Content
Body`;
    const result = parseMarkdownToEntry(markdown);
    expect(result!.tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('produces an empty tags array when Tags is None', () => {
    const markdown = `# Title
## Metadata
- **Tags**: None
## Content
Body`;
    const result = parseMarkdownToEntry(markdown);
    expect(result!.tags).toEqual([]);
  });

  it('sets sourceId when Cloned From is present', () => {
    const markdown = `# Title
## Metadata
- **Cloned From**: tpl-123
## Content
Body`;
    const result = parseMarkdownToEntry(markdown);
    expect(result!.sourceId).toBe('tpl-123');
  });

  it('ignores Cloned To metadata', () => {
    const markdown = `# Title
## Metadata
- **Cloned To**: clone-1, clone-2
## Content
Body`;
    const result = parseMarkdownToEntry(markdown);
    expect(result).not.toBeNull();
    expect(result!.sourceId).toBeUndefined();
  });
});

describe('createNoteFromMarkdown', () => {
  it('returns same result as parseMarkdownToEntry for valid exported markdown', () => {
    const markdown = `# Exported Note
## Metadata
- **Tags**: foo, bar
## Content
Content here.`;
    const clock = frozenNow(new Date('2025-06-01T12:00:00.000Z'));
    expect(createNoteFromMarkdown(markdown, clock)).toEqual(parseMarkdownToEntry(markdown, clock));
  });

  it('derives title from # header for plain markdown', () => {
    const markdown = `# My Plain Note\nSome content.`;
    const result = createNoteFromMarkdown(markdown);
    expect(result.title).toBe('My Plain Note');
    expect(result.rawContent).toBe(markdown);
    expect(result.tags).toEqual([]);
  });

  it('uses "Imported Note" when no header exists', () => {
    const markdown = 'Just some text without a header.';
    const result = createNoteFromMarkdown(markdown);
    expect(result.title).toBe('Imported Note');
  });

  it('uses clock.nowMs() when a clock is provided', () => {
    const markdown = 'Plain text, no header.';
    const fixed = new Date('2025-06-01T12:00:00.000Z');
    const clock = frozenNow(fixed);
    const result = createNoteFromMarkdown(markdown, clock);
    expect(result.targetDate).toBe(fixed.getTime());
  });
});
