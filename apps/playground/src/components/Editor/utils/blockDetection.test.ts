/**
 * Unit tests for block detection utilities
 */

import { describe, it, expect } from 'bun:test';
import { detectScriptBlocks, findBlockAtLine, extractBlockContent, parseDocumentSections, buildRawContent, reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';

describe('detectScriptBlocks', () => {
  it('should detect a single time block', () => {
    const content = '# My Workout\n\n```time\n20:00 AMRAP\n  + 5 Pullups\n```\n\nSome text after';

    const blocks = detectScriptBlocks(content);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].startLine).toBe(2);
    expect(blocks[0].endLine).toBe(5);
    expect(blocks[0].content).toBe('20:00 AMRAP\n  + 5 Pullups\n');
    expect(blocks[0].state).toBe('idle');
    expect(blocks[0].dialect).toBe('time');
  });

  it('should detect multiple time blocks', () => {
    const content = '```time\n(21-15-9)\n  Thrusters\n```\n\nSome text\n\n```time\n10:00\n  Run\n```';

    const blocks = detectScriptBlocks(content);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].content).toBe('(21-15-9)\n  Thrusters\n');
    expect(blocks[1].content).toBe('10:00\n  Run\n');
  });

  it('should handle empty document', () => {
    const blocks = detectScriptBlocks('');
    expect(blocks).toHaveLength(0);
  });

  it('should handle document with no workout blocks', () => {
    const content = '# Just markdown\n\nSome text here\n- List item\n- Another item';

    const blocks = detectScriptBlocks(content);
    expect(blocks).toHaveLength(0);
  });

  it('keeps unclosed fences recoverable without actionable workout rows', () => {
    const content = '```time\n20:00 AMRAP\n  + 5 Pullups';
    expect(detectScriptBlocks(content)).toHaveLength(0);
    expect(Object.keys(reconcileNoteBlocks(content, { sourceRevision: 1 }))).toHaveLength(0);
    expect(buildRawContent(parseDocumentSections(content))).toBe(content);
  });

  it('should handle time blocks with extra spaces after ```time', () => {
    const content = '```time   \n20:00 AMRAP\n```';

    const blocks = detectScriptBlocks(content);
    expect(blocks).toHaveLength(1);
  });

  it('should detect time blocks regardless of case', () => {
    const content = '```TIME\n21-15-9\n```';

    const blocks = detectScriptBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('21-15-9\n');
  });

  it('should not detect code blocks that are not time/log', () => {
    const content = '```javascript\nconst x = 5;\n```\n\n```time\n20:00 AMRAP\n```';

    const blocks = detectScriptBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('20:00 AMRAP\n');
  });

  it('should handle empty time block', () => {
    const content = '```time\n```';

    const blocks = detectScriptBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('');
  });

  it('should not treat ```whiteboard as a workout block', () => {
    const content = '```whiteboard\n20:00 AMRAP\n  + 5 Pullups\n```';

    const blocks = detectScriptBlocks(content);
    expect(blocks).toHaveLength(0);
  });

  it('should not match whiteboard fence case-insensitively', () => {
    const content = '```WhiteBoard\n10:00 Run\n```';

    const blocks = detectScriptBlocks(content);
    expect(blocks).toHaveLength(0);
  });

  it('should not detect legacy ```wod or ```plan tags as workout blocks', () => {
    const legacyWod = detectScriptBlocks('```wod\n10:00 Run\n```');
    const plan = detectScriptBlocks('```plan\nWeek 1\n```');
    expect(legacyWod).toHaveLength(0);
    expect(plan).toHaveLength(0);
  });

  it('should parse ```time as a time dialect block', () => {
    const blocks = detectScriptBlocks('```time\n10:00 Run\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dialect).toBe('time');
    expect(blocks[0].sport).toBeUndefined();
  });

  it('should parse ```log:climbing with dialect log and sport climbing', () => {
    const blocks = detectScriptBlocks('```log:climbing\n5:00 Run\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dialect).toBe('log');
    expect(blocks[0].sport).toBe('climbing');
  });

  it('keeps an empty sport suffix recoverable without coercing it to a workout', () => {
    const content = '```time:\n10:00 Run\n```';
    expect(detectScriptBlocks(content)).toHaveLength(0);
    expect(Object.keys(reconcileNoteBlocks(content, { sourceRevision: 1 }))).toHaveLength(0);
    expect(buildRawContent(parseDocumentSections(content))).toBe(content);
  });
});

describe('findBlockAtLine', () => {
  const content = '# Title\n```time\n20:00 AMRAP\n```\nText\n```time\n10:00\n```';

  const blocks = detectScriptBlocks(content);

  it('should find block at start line', () => {
    const block = findBlockAtLine(blocks, 1);
    expect(block).toBeTruthy();
    expect(block?.startLine).toBe(1);
  });

  it('should find block at middle line', () => {
    const block = findBlockAtLine(blocks, 2);
    expect(block).toBeTruthy();
    expect(block?.startLine).toBe(1);
  });

  it('should find block at end line', () => {
    const block = findBlockAtLine(blocks, 3);
    expect(block).toBeTruthy();
    expect(block?.startLine).toBe(1);
  });

  it('should return null for line outside blocks', () => {
    const block = findBlockAtLine(blocks, 0);
    expect(block).toBeNull();
  });

  it('should find second block', () => {
    const block = findBlockAtLine(blocks, 5);
    expect(block).toBeTruthy();
    expect(block?.startLine).toBe(5);
  });
});

describe('extractBlockContent', () => {
  it('should extract content without backticks', () => {
    const content = '# Title\n```time\n20:00 AMRAP\n  + 5 Pullups\n```\nText';

    const extracted = extractBlockContent(content, 1, 4);
    expect(extracted).toBe('20:00 AMRAP\n  + 5 Pullups\n');
  });

  it('should handle single line block', () => {
    const content = '```time\n20:00\n```';

    const extracted = extractBlockContent(content, 0, 2);
    expect(extracted).toBe('20:00\n');
  });

  it('should handle empty block', () => {
    const content = '```time\n```';

    const extracted = extractBlockContent(content, 0, 1);
    expect(extracted).toBe('');
  });

  it('preserves CRLF body bytes and astral UTF-16 text inside longer fences', () => {
    const content = '# 😀\r\n````log:running\r\n😀 Run\r\n```\r\n````\r\nAfter';
    expect(extractBlockContent(content, 1, 4)).toBe('😀 Run\r\n```\r\n');
    const section = parseDocumentSections(content).find(section => section.scriptBlock)!;
    expect(section.scriptBlock!.content).toBe(content.slice(section.contentFrom, section.contentTo));
  });
});
