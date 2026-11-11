import { describe, it, expect } from 'bun:test';
import {
  parseFrontmatter,
  parseFrontmatterBody,
  serializeFrontmatter,
  stripFrontmatter,
  getScalar,
  getList,
  parseFrontmatterCategories,
  parseFlatProperties,
  parseFrontmatterProps,
  extractYouTubeVideoId,
  extractLinkWidgets,
  detectUrlSubtype,
} from './frontmatter';

describe('parseFrontmatter', () => {
  it('extracts scalar key-value pairs from frontmatter', () => {
    const raw = '---\nDifficulty: beginner\nCategory: Cardio\n---\nContent';
    expect(parseFrontmatter(raw)).toEqual({
      meta: { Difficulty: 'beginner', Category: 'Cardio' },
      body: 'Content',
    });
  });

  it('strips matched wrapping quotes from values', () => {
    const raw = '---\ntitle: "WOD 761"\nlabel: \'Quoted\'\n---\nContent';
    expect(parseFrontmatter(raw).meta).toEqual({
      title: 'WOD 761',
      label: 'Quoted',
    });
  });

  it('only removes matching wrapping quotes from metadata values', () => {
    const { meta } = parseFrontmatter(`---\ntitle: "Matched"\nsubtitle: "Mismatched'\n---\nBody\n`);
    expect(meta.title).toBe('Matched');
    expect(meta.subtitle).toBe(`"Mismatched'`);
  });

  it('handles flat nested keys', () => {
    const raw = '---\nbook.title: "Kettlebell Simple \u0026 Sinister"\n---\nContent';
    expect(parseFrontmatter(raw).meta).toEqual({
      'book.title': 'Kettlebell Simple \u0026 Sinister',
    });
  });

  it('keeps empty values as empty strings', () => {
    const raw = '---\nkey: value\nempty:\n---\nContent';
    expect(parseFrontmatter(raw).meta).toEqual({
      key: 'value',
      empty: '',
    });
  });

  it('parses numeric strings as numbers', () => {
    const raw = '---\norder: 1\ntitle: WOD\n---\nContent';
    expect(parseFrontmatter(raw).meta).toEqual({ order: 1, title: 'WOD' });
  });

  it('parses block lists as string arrays with case preserved', () => {
    const raw = '---\ncategory:\n  - Kettlebell\n  - strength\ntitle: WOD\n---\nContent';
    expect(parseFrontmatter(raw).meta).toEqual({
      category: ['Kettlebell', 'strength'],
      title: 'WOD',
    });
  });

  it('keeps inline [a, b] lists as plain scalar strings', () => {
    const raw = '---\ntags: [a, b]\n---\nContent';
    expect(parseFrontmatter(raw).meta).toEqual({ tags: '[a, b]' });
  });

  it('ignores non-alias indented nested-map lines while folding legacy baseAttributes', () => {
    const raw = '---\ncustomMap:\n  foo: 1\nbaseAttributes:\n  met: 4\nlabel: Squat\n---\nContent';
    expect(parseFrontmatter(raw).meta).toEqual({
      customMap: '',
      'metrics.met': 4,
      label: 'Squat',
    });
  });

  it('returns empty meta and the raw body when no frontmatter', () => {
    const raw = 'Just plain content';
    expect(parseFrontmatter(raw)).toEqual({ meta: {}, body: raw });
  });

  it('handles CRLF line endings while preserving the body', () => {
    const raw = [
      '---',
      'title: "Quoted Title"',
      "subtitle: 'Quoted subtitle'",
      'order: 1',
      'empty:',
      '---',
      'Body',
      '',
    ].join('\r\n');
    const { meta, body } = parseFrontmatter(raw);

    expect(meta).toEqual({
      title: 'Quoted Title',
      subtitle: 'Quoted subtitle',
      order: 1,
      empty: '',
    });
    expect(body).toBe('Body\r\n');
  });
});

describe('parseFrontmatterBody', () => {
  it('parses body lines without delimiters using parseFrontmatter semantics', () => {
    const inner = 'title: "WOD 761"\norder: 2\ncategory:\n  - kettlebell\n  - strength\nempty:';
    expect(parseFrontmatterBody(inner)).toEqual({
      title: 'WOD 761',
      order: 2,
      category: ['kettlebell', 'strength'],
      empty: '',
    });
  });

  it('matches parseFrontmatter meta for the same content', () => {
    const inner = 'title: WOD\norder: 1\ncategory:\n  - a\n  - b';
    expect(parseFrontmatterBody(inner)).toEqual(
      parseFrontmatter(`---\n${inner}\n---\nBody`).meta,
    );
  });
});

describe('serializeFrontmatter', () => {
  it('emits scalars bare and block-style lists, preserving key order', () => {
    expect(
      serializeFrontmatter({ title: 'WOD 761', order: 2, category: ['kettlebell', 'strength'] }),
    ).toBe('title: WOD 761\norder: 2\ncategory:\n  - kettlebell\n  - strength');
  });

  it('quotes values containing YAML-special characters', () => {
    expect(serializeFrontmatter({ notes: 'rest: 2:00', title: 'He said "hi"' })).toBe(
      'notes: "rest: 2:00"\ntitle: "He said \\"hi\\""',
    );
  });

  it('quotes numeric-looking and keyword-looking strings so they stay strings', () => {
    const serialized = serializeFrontmatter({ version: '1.0', mode: 'true', name: 'on' });
    expect(serialized).toBe('version: "1.0"\nmode: "true"\nname: "on"');
  });

  it('serializes empty strings as quoted empty values', () => {
    expect(serializeFrontmatter({ empty: '' })).toBe('empty: ""');
  });

  it('round-trips through parseFrontmatterBody without losing values or types', () => {
    const meta = {
      title: 'WOD 761',
      order: 2,
      category: ['Kettlebell', 'strength'],
      version: '1.0',
      empty: '',
      notes: 'rest: 2:00 between sets',
    };
    expect(parseFrontmatterBody(serializeFrontmatter(meta))).toEqual(meta);
  });
});

describe('stripFrontmatter', () => {
  it('strips leading YAML frontmatter from editor source content', () => {
    const raw = `---
search: hidden
title: Just a Movement
section: statement
order: 1
---
\`\`\`time
Pushups
\`\`\`
`;

    expect(stripFrontmatter(raw)).toBe(`\`\`\`time
Pushups
\`\`\`
`);
  });

  it('leaves content without leading frontmatter unchanged', () => {
    const raw = `\`\`\`time
---
Pushups
---
\`\`\`
`;

    expect(stripFrontmatter(raw)).toBe(raw);
  });
});

describe('getScalar / getList', () => {
  const meta = parseFrontmatter('---\ntitle: WOD\norder: 2\ncategory:\n  - a\n  - b\n---\nBody').meta;

  it('getScalar returns string and number values', () => {
    expect(getScalar(meta, 'title')).toBe('WOD');
    expect(getScalar(meta, 'order')).toBe(2);
  });

  it('getScalar returns undefined for lists and absent keys', () => {
    expect(getScalar(meta, 'category')).toBeUndefined();
    expect(getScalar(meta, 'missing')).toBeUndefined();
  });

  it('getList returns lists and [] otherwise', () => {
    expect(getList(meta, 'category')).toEqual(['a', 'b']);
    expect(getList(meta, 'title')).toEqual([]);
    expect(getList(meta, 'missing')).toEqual([]);
  });
});

describe('parseFrontmatterCategories', () => {
  it('extracts category array from frontmatter', () => {
    const raw = '---\ncategory:\n  - kettlebell\n  - strength\n---\nContent';
    expect(parseFrontmatterCategories(raw)).toEqual(['kettlebell', 'strength']);
  });

  it('returns empty array when no category', () => {
    const raw = '---\ntitle: WOD\n---\nContent';
    expect(parseFrontmatterCategories(raw)).toEqual([]);
  });

  it('returns empty array when no frontmatter', () => {
    const raw = 'No frontmatter here';
    expect(parseFrontmatterCategories(raw)).toEqual([]);
  });

  it('stops at new top-level key', () => {
    const raw = '---\ncategory:\n  - kettlebell\ntitle: WOD\n  - strength\n---\nContent';
    expect(parseFrontmatterCategories(raw)).toEqual(['kettlebell']);
  });

  it('lowercases categories', () => {
    const raw = '---\ncategory:\n  - Kettlebell\n  - STRENGTH\n---\nContent';
    expect(parseFrontmatterCategories(raw)).toEqual(['kettlebell', 'strength']);
  });
});

describe('parseFlatProperties', () => {
  it('extracts key-value pairs from inner content', () => {
    const inner = 'type: youtube\nurl: https://youtu.be/abc123\ntitle: "My Video"';
    expect(parseFlatProperties(inner)).toEqual({
      type: 'youtube',
      url: 'https://youtu.be/abc123',
      title: '"My Video"',
    });
  });

  it('returns empty object for empty string', () => {
    expect(parseFlatProperties('')).toEqual({});
  });

  it('handles CRLF line endings', () => {
    const inner = 'type: youtube\r\nurl: https://youtu.be/abc123';
    expect(parseFlatProperties(inner)).toEqual({
      type: 'youtube',
      url: 'https://youtu.be/abc123',
    });
  });
});

describe('parseFrontmatterProps', () => {
  it('extracts key-value pairs from lines array', () => {
    const lines = ['type: youtube', 'url: https://youtu.be/abc123', 'title: "My Video"'];
    expect(parseFrontmatterProps(lines)).toEqual({
      type: 'youtube',
      url: 'https://youtu.be/abc123',
      title: '"My Video"',
    });
  });

  it('skips lines without colon', () => {
    const lines = ['type: youtube', 'no-colon-here', 'url: test'];
    expect(parseFrontmatterProps(lines)).toEqual({
      type: 'youtube',
      url: 'test',
    });
  });

  it('returns empty object for empty array', () => {
    expect(parseFrontmatterProps([])).toEqual({});
  });
});

describe('extractYouTubeVideoId', () => {
  it('extracts from standard youtube.com URL', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from short youtu.be URL', () => {
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from embed URL', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube URL', () => {
    expect(extractYouTubeVideoId('https://example.com')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractYouTubeVideoId('')).toBeNull();
  });
});

describe('extractLinkWidgets', () => {
  it('extracts youtube widget', () => {
    const props = {
      type: 'youtube',
      url: 'https://youtu.be/dQw4w9WgXcQ',
      title: 'My Video',
    };
    expect(extractLinkWidgets(props)).toEqual([
      { kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', label: 'My Video', videoId: 'dQw4w9WgXcQ' },
    ]);
  });

  it('extracts amazon widget', () => {
    const props = {
      type: 'amazon',
      url: 'https://amazon.com/dp/B08N5WRWNW',
      title: 'Kettlebell',
    };
    expect(extractLinkWidgets(props)).toEqual([
      { kind: 'amazon', url: 'https://amazon.com/dp/B08N5WRWNW', label: 'Kettlebell' },
    ]);
  });

  it('extracts source_url widget', () => {
    const props = {
      source_url: 'https://example.com/source',
    };
    expect(extractLinkWidgets(props)).toEqual([
      { kind: 'source', url: 'https://example.com/source', label: 'Source' },
    ]);
  });

  it('extracts website widget', () => {
    const props = {
      website: 'https://my-site.com',
    };
    expect(extractLinkWidgets(props)).toEqual([
      { kind: 'website', url: 'https://my-site.com', label: 'Website' },
    ]);
  });

  it('extracts book widget', () => {
    const props = {
      book: 'Kettlebell Simple \u0026 Sinister',
    };
    expect(extractLinkWidgets(props)).toEqual([
      { kind: 'book', label: 'Kettlebell Simple \u0026 Sinister' },
    ]);
  });

  it('returns empty array when no widgets match', () => {
    const props = {
      title: 'Just a title',
      difficulty: 'beginner',
    };
    expect(extractLinkWidgets(props)).toEqual([]);
  });

  it('extracts multiple widgets', () => {
    const props = {
      type: 'youtube',
      url: 'https://youtu.be/abc123',
      source_url: 'https://example.com',
      book: 'Some Book',
    };
    expect(extractLinkWidgets(props)).toEqual([
      { kind: 'youtube', url: 'https://youtu.be/abc123', label: '', videoId: 'abc123' },
      { kind: 'source', url: 'https://example.com', label: 'Source' },
      { kind: 'book', label: 'Some Book' },
    ]);
  });

  it('falls back to link when url is missing for youtube', () => {
    const props = {
      type: 'youtube',
      link: 'https://youtu.be/abc123',
    };
    expect(extractLinkWidgets(props)).toEqual([
      { kind: 'youtube', url: 'https://youtu.be/abc123', label: '', videoId: 'abc123' },
    ]);
  });
});

describe('quote/escape round-trip', () => {
  it.each([
    'plain',
    'with "quotes"',
    'with \\ backslash',
    'backslash and quote \\" together',
    'trailing backslash \\',
    'C:\\Users\\wod',
  ])('round-trips %j through serialize → parse', (value) => {
    const serialized = serializeFrontmatter({ key: value });
    const reparsed = parseFrontmatterBody(serialized);
    expect(reparsed.key).toBe(value);
  });
});

describe('detectUrlSubtype', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc12345678', 'youtube'],
    ['https://youtu.be/abc12345678', 'youtube'],
    ['youtube.com/watch?v=abc12345678', 'youtube'],
    ['https://www.amazon.com/dp/B000000000', 'amazon'],
    ['https://amzn.to/abc', 'amazon'],
    ['https://www.strava.com/activities/123', 'strava'],
  ])('classifies %s as %s', (url, expected) => {
    expect(detectUrlSubtype(url)).toBe(expected);
  });

  it.each([
    'https://youtube.com.evil.com/phish',
    'https://notyoutube.com/',
    'https://evil-amazon.com/',
    'https://strava.com.attacker.io/',
    'https://example.com/?redirect=youtube.com',
  ])('rejects lookalike domain %s', (url) => {
    expect(detectUrlSubtype(url)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(detectUrlSubtype('')).toBeNull();
  });
});
