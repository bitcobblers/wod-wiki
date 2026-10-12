import { describe, it, expect } from 'bun:test';
import {
  parseDocumentSections,
  buildRawContent,
  calculateTotalLines,
  reconcileNoteBlocks,
  mapNoteBlockChanges,
  isWorkoutSectionType,
} from '@bitcobblers/wod-wiki-core';

describe('parseDocumentSections', () => {
  it('returns empty array for empty string', () => {
    expect(parseDocumentSections('')).toEqual([]);
  });

  it('parses first text block as title', () => {
    const sections = parseDocumentSections('# Hello');
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('title');
    expect(sections[0].displayContent).toBe('# Hello');
  });

  it('preserves heading prefix in title displayContent', () => {
    const sections = parseDocumentSections('## Hello World');
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('title');
    expect(sections[0].displayContent).toBe('## Hello World');
  });

  it('parses plain text as title when it is the first block', () => {
    const content = 'Just some text';
    const sections = parseDocumentSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('title');
    expect(sections[0].displayContent).toBe('Just some text');
  });

  it('groups subsequent non-workout text as markdown sections', () => {
    const content = '# Title\nSecond line\nThird line';
    const sections = parseDocumentSections(content);
    // All consecutive non-workout lines before a workout block form a single section
    // First text block is title
    expect(sections[0].type).toBe('title');
  });

  it('parses text after title as markdown', () => {
    const content = '# Title\n\n```time\n5:00 Run\n```\n\nNotes here';
    const sections = parseDocumentSections(content);
    const mdSections = sections.filter(s => s.type === 'markdown');
    expect(mdSections.length).toBeGreaterThanOrEqual(1);
    expect(mdSections[mdSections.length - 1].displayContent).toContain('Notes here');
  });

  it('creates fresh transient identities rather than guessing from source', () => {
    const source = '```time\n5:00 Run\n```';
    const first = parseDocumentSections(source);
    const second = parseDocumentSections(source);
    expect(first[0].id).not.toBe(second[0].id);
    expect(first[0].contentId).toBe(second[0].contentId);
  });

  describe('with workout blocks', () => {
    it('parses a time block between content', () => {
      const content = '# Workout\n\n```time\n5:00 Run\n```\n\nNotes';
      const sections = parseDocumentSections(content);

      const workoutSection = sections.find(s => isWorkoutSectionType(s.type));
      expect(workoutSection).toBeDefined();
      expect(workoutSection!.displayContent).toBeDefined();
      expect(workoutSection!.scriptBlock).toBeDefined();
    });

    it('separates title from time block', () => {
      const content = '# Warm Up\n```time\n3:00 Walk\n```';
      const sections = parseDocumentSections(content);

      expect(sections[0].type).toBe('title');
      const workoutSection = sections.find(s => isWorkoutSectionType(s.type));
      expect(workoutSection).toBeDefined();
    });

    it('recognises log dialect', () => {
      const content = '# Session\n```log\n5:00 Run\n```';
      const sections = parseDocumentSections(content);
      const workoutSection = sections.find(s => isWorkoutSectionType(s.type));
      expect(workoutSection).toBeDefined();
      expect(workoutSection!.type).toBe('log');
    });

    it('recognises time dialect', () => {
      const content = '# Plan\n```time\n10:00 Bike\n```';
      const sections = parseDocumentSections(content);
      const workoutSection = sections.find(s => isWorkoutSectionType(s.type));
      expect(workoutSection).toBeDefined();
      expect(workoutSection!.type).toBe('time');
    });
  });
});

describe('buildRawContent', () => {
  it('returns empty string for no sections', () => {
    expect(buildRawContent([])).toBe('');
  });

  it('round-trips a simple title document', () => {
    const original = '# Hello';
    const sections = parseDocumentSections(original);
    expect(buildRawContent(sections)).toBe(original);
  });

  it('round-trips a document with time block', () => {
    const original = '# Title\n\n```time\n5:00 Run\n```';
    const sections = parseDocumentSections(original);
    const rebuilt = buildRawContent(sections);
    expect(rebuilt).toContain('# Title');
    expect(rebuilt).toContain('```time');
    expect(rebuilt).toContain('5:00 Run');
  });

  it('round-trips a log block with sport suffix', () => {
    const original = '# Session\n\n```log:climbing\n5:00 Run\n```';
    const sections = parseDocumentSections(original);
    const workoutSection = sections.find(s => isWorkoutSectionType(s.type));
    expect(workoutSection).toBeDefined();
    expect(workoutSection!.type).toBe('log');
    expect(workoutSection!.sport).toBe('climbing');
    const rebuilt = buildRawContent(sections);
    expect(rebuilt).toContain('```log:climbing');
    expect(rebuilt).toContain('5:00 Run');
  });

  it('skips soft-deleted sections', () => {
    const sections = parseDocumentSections('# Title\n\nSome text');
    const textSection = sections.find(s => s.rawContent.includes('Some text'));
    expect(textSection).toBeDefined();
    textSection!.deleted = true;
    const rebuilt = buildRawContent(sections);
    expect(rebuilt).not.toContain('Some text');
  });
});

describe('calculateTotalLines', () => {
  it('returns 0 for empty sections', () => {
    expect(calculateTotalLines([])).toBe(0);
  });

  it('counts lines correctly for a single title', () => {
    const sections = parseDocumentSections('# Title');
    expect(calculateTotalLines(sections)).toBe(1);
  });

  it('counts lines correctly for multi-line content', () => {
    const sections = parseDocumentSections('# Title\n\nParagraph');
    expect(calculateTotalLines(sections)).toBeGreaterThanOrEqual(2);
  });
});

describe('persisted block identity', () => {
  it('preserves occurrence IDs with an exact persisted map on reopen', () => {
    const source = '# Title\n\n```time\n5:00 Run\n```';
    const blocks = reconcileNoteBlocks(source, { sourceRevision: 1 });
    expect(reconcileNoteBlocks(source, { sourceRevision: 1, blocks })).toEqual(blocks);
  });

  it('requires source change lineage when prose shifts a block', () => {
    const source = '```time\n5:00 Run\n```';
    const blocks = reconcileNoteBlocks(source, { sourceRevision: 1 });
    const mapped = mapNoteBlockChanges(blocks, [{ from: 0, to: 0, insert: '# Title\n\n' }]);
    const next = reconcileNoteBlocks('# Title\n\n' + source, { sourceRevision: 1, blocks: mapped });
    expect(Object.keys(next)).toEqual(Object.keys(blocks));
  });
});

describe('parseDocumentSections — frontmatter', () => {
  it('parses a YAML front matter block between --- delimiters', () => {
    const content = '---\ntitle: My Workout\ndate: 2024-01-01\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm).toBeDefined();
    expect(fm!.properties).toBeDefined();
    expect(fm!.properties!['title']).toBe('My Workout');
    expect(fm!.properties!['date']).toBe('2024-01-01');
  });

  it('assigns default frontmatterType when no type property', () => {
    const content = '---\ntitle: Hello\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm!.frontmatterType).toBe('default');
  });

  it('detects youtube frontmatterType from type property', () => {
    const content = '---\ntype: youtube\nurl: https://youtube.com/watch?v=abc12345678\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm!.frontmatterType).toBe('youtube');
  });

  it('auto-detects youtube from url pattern', () => {
    const content = '---\nurl: https://www.youtube.com/watch?v=dQw4w9WgXcQ\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm!.frontmatterType).toBe('youtube');
  });

  it('detects strava frontmatterType', () => {
    const content = '---\ntype: strava\nurl: https://www.strava.com/activities/12345\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm!.frontmatterType).toBe('strava');
  });

  it('auto-detects strava from url pattern', () => {
    const content = '---\nurl: https://www.strava.com/activities/99999\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm!.frontmatterType).toBe('strava');
  });

  it('detects file frontmatterType', () => {
    const content = '---\ntype: file\nfile: /images/photo.jpg\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm!.frontmatterType).toBe('file');
  });

  it('detects amazon frontmatterType from type property', () => {
    const content = '---\ntype: amazon\nurl: https://www.amazon.com/dp/B001234567\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm!.frontmatterType).toBe('amazon');
  });

  it('detects effort frontmatterType from effort metadata', () => {
    const content = '---\nid: effort-1\nslug: rowing-intervals\nlabel: Rowing Intervals\nbaseAttributes:\n  met: 7.0\n  discipline: rowing\nregistrySource: bundled\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm!.frontmatterType).toBe('effort');
  });

  it('auto-detects amazon from url pattern', () => {
    const content = '---\nurl: https://www.amazon.com/Kettlebell-Workout-Weights/dp/B08P2C6J7B\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm!.frontmatterType).toBe('amazon');
  });

  it('auto-detects amazon from short url (amzn.to)', () => {
    const content = '---\nurl: https://amzn.to/3abc123\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm!.frontmatterType).toBe('amazon');
  });

  it('preserves correct line numbers for frontmatter', () => {
    const content = '---\nkey: value\n---';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm!.startLine).toBe(0);
    expect(fm!.endLine).toBe(2);
    expect(fm!.lineCount).toBe(3);
  });

  it('parses frontmatter before title', () => {
    const content = '---\ntitle: Hello\n---\n# Heading';
    const sections = parseDocumentSections(content);
    expect(sections[0].type).toBe('frontmatter');
    expect(sections[1].type).toBe('title');
  });

  it('parses frontmatter between other sections', () => {
    const content = '# Title\n---\nmeta: data\n---\nMore text';
    const sections = parseDocumentSections(content);
    expect(sections.map(s => s.type)).toEqual(['title', 'frontmatter', 'markdown']);
  });

  it('round-trips frontmatter through buildRawContent', () => {
    const content = '---\ntitle: Test\n---';
    const sections = parseDocumentSections(content);
    expect(buildRawContent(sections)).toBe(content);
  });

  it('ignores unclosed --- blocks', () => {
    const content = '---\nno closing fence';
    const sections = parseDocumentSections(content);
    // Should be treated as regular text, not frontmatter
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm).toBeUndefined();
  });

  it('does not detect --- inside time blocks as frontmatter', () => {
    const content = '```time\n---\nkey: val\n---\n```';
    const sections = parseDocumentSections(content);
    const fm = sections.find(s => s.type === 'frontmatter');
    expect(fm).toBeUndefined();
  });
});
