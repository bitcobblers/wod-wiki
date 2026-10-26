import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Session } from '@/types/storage';

/**
 * Unit tests for paletteDataSources.ts
 *
 * Tests cover:
 * - time/log block extraction from markdown
 * - Collection data source generation
 * - time/log block source generation
 * - Edge cases (empty inputs, malformed markdown, multiple blocks)
 * - Search query filtering
 *
 * Note: Functions that depend on IndexedDB, playgroundDB, or
 * import.meta.glob (like globalSearchSource, feedSource, journalHistorySource)
 * are tested through integration tests.
 */

// Mock IndexedDB and dependencies
global.indexedDB = {
  open: mock(() => ({
    onsuccess: null,
    onerror: null,
    onblocked: null,
    onupgradeneeded: null,
    result: {
      close: mock(),
      transaction: mock(() => ({
        objectStore: mock(() => ({
          get: mock(),
          put: mock(),
          delete: mock(),
          getAll: mock(),
          index: mock(() => ({
            getAll: mock(),
            openCursor: mock(),
          })),
        })),
      })),
    },
  })),
} as any;

import { storageService } from '@/services/storage';
const mockGetRecentSessions = mock((): Promise<Session[]> => Promise.resolve([]));
storageService.getRecentSessions = mockGetRecentSessions;

mock.module('./playgroundContent', () => ({
  pageId: (category: string, name: string) => `${category}/${name}`,
  playgroundContent: {
    getPagesByCategory: mock(() => Promise.resolve([])),
  },
}));

// Import after mocks are set up
const {
  extractScriptBlocks,
  scriptBlockSource,
  notebookItemsSource,
  globalSearchSource,
  canvasRouteSource,
  constructSource,
  tagsPaletteSource,
} = await import('./paletteDataSources');

import type { ExtractedScriptBlock } from './paletteDataSources';
import type { ScriptNotebook } from '@/repositories/script-notebooks';

describe('extractScriptBlocks', () => {
  it('should extract single time block from markdown', () => {
    const markdown = '```time\n5 rounds for time:\n- 10 thrusters\n- 15 pull-ups\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].dialect).toBe('time');
    expect(blocks[0].script).toBe('5 rounds for time:\n- 10 thrusters\n- 15 pull-ups\n');
    expect(blocks[0].preview).toBe('5 rounds for time:');
  });

  it('should extract multiple time blocks', () => {
    const markdown = '```time\nFirst workout\n```\n\nSome text in between\n\n```time\nSecond workout\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].script).toBe('First workout\n');
    expect(blocks[1].script).toBe('Second workout\n');
  });

  it('should extract log blocks for recorded notes', () => {
    const markdown = '```log\nWeek 1: Foundation\nWeek 2: Build\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].dialect).toBe('log');
    expect(blocks[0].script).toBe('Week 1: Foundation\nWeek 2: Build\n');
  });

  it('should extract mixed time and log block types', () => {
    const markdown = '```time\nWorkout\n```\n\n```log\nLog notes\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].dialect).toBe('time');
    expect(blocks[1].dialect).toBe('log');
  });

  it('should not extract legacy ```whiteboard fences', () => {
    const markdown = '```whiteboard\n5 rounds for time:\n- 10 thrusters\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toEqual([]);
  });

  it('should extract only time blocks and ignore legacy ```whiteboard fences', () => {
    const markdown = '```time\nFirst\n```\n\n```whiteboard\nSecond\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].dialect).toBe('time');
    expect(blocks[0].script).toBe('First\n');
  });

  it('should handle empty block content', () => {
    const markdown = '```time\n\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].script).toBe('\n');
    expect(blocks[0].preview).toBe('(empty block)');
  });

  it('should handle block with only whitespace', () => {
    const markdown = '```time\n  \n  \n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].script).toBe('  \n  \n');
    expect(blocks[0].preview).toBe('(empty block)');
  });

  it('should handle Windows line endings (\\r\\n)', () => {
    const markdown = '```time\r\n5 rounds for time\r\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].script).toBe('5 rounds for time\r\n');
  });

  it('should return empty array when no blocks found', () => {
    const markdown = '# Just heading\n\nNo code blocks here.';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toEqual([]);
  });

  it('should ignore non-time/log code blocks', () => {
    const markdown = '```javascript\nconst x = 5;\n```\n\n```time\nReal workout\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].dialect).toBe('time');
    expect(blocks[0].script).toBe('Real workout\n');
  });

  it('should handle case-insensitive block types for current tags', () => {
    const markdown = '```TIME\nUppercase TIME\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].dialect).toBe('time');
  });

  it('should not extract legacy uppercase WOD tag', () => {
    const markdown = '```WOD\nUppercase WOD\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toEqual([]);
  });

  it('should handle blocks with inline backticks', () => {
    const markdown = '```time\nDo 5 `heavy` thrusters\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].script).toContain('`heavy`');
  });

  it('should number blocks sequentially', () => {
    const markdown = '```time\nBlock 1\n```\n\n```time\nBlock 2\n```\n\n```log\nBlock 3\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(3);
    expect(blocks[0].index).toBe(0);
    expect(blocks[1].index).toBe(1);
    expect(blocks[2].index).toBe(2);
  });

  it('should extract preview from first non-empty line', () => {
    const markdown = '```time\n\n\nThird line is first\n```';
    const blocks = extractScriptBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].preview).toBe('Third line is first');
  });
});

describe('scriptBlockSource', () => {
  it('should create source with single block when workout has one block', async () => {
    const markdown = '```time\n5 rounds for time\n```';
    const source = scriptBlockSource('Fran', markdown);

    const results = await source.search('');
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Fran');
    expect(results[0].payload).toEqual({
      index: 0,
      script: '5 rounds for time\n',
      preview: '5 rounds for time',
      dialect: 'time',
    });
  });

  it('should create source with multiple blocks when workout has multiple blocks', async () => {
    const markdown = '```time\nFirst block\n```\n\n```time\nSecond block\n```';
    const source = scriptBlockSource('Workout', markdown);

    const results = await source.search('');
    expect(results).toHaveLength(2);
    expect(results[0].label).toBe('Block 1: First block');
    expect(results[1].label).toBe('Block 2: Second block');
  });

  it('should return empty array when no blocks found', async () => {
    const markdown = '# No blocks here';
    const source = scriptBlockSource('Empty', markdown);

    const results = await source.search('');
    expect(results).toEqual([]);
  });

  it('should filter blocks by search query', async () => {
    const markdown = '```time\nThrusters and pull-ups\n```\n\n```time\nClean and jerk\n```';
    const source = scriptBlockSource('Workout', markdown);

    const results = await source.search('thruster');
    expect(results).toHaveLength(1);
    expect(results[0].label).toContain('Thrusters');
  });

  it('should handle case-insensitive search', async () => {
    const markdown = '```time\nThrusters and pull-ups\n```';
    const source = scriptBlockSource('Workout', markdown);

    const results = await source.search('THRUSTER');
    expect(results).toHaveLength(1);
  });

  it('should match against sublabel in search', async () => {
    const markdown = '```time\nFirst workout\n```\n\n```time\nSecond workout\n```';
    const source = scriptBlockSource('Workout', markdown);

    const results = await source.search('second');
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Block 2: Second workout');
  });
});

describe('notebookItemsSource', () => {
  const mockNotebook: ScriptNotebook = {
    id: 'crossfit-girls',
    name: 'CrossFit Girls',
    categories: ['crossfit'],
    items: [
      { id: 'fran', name: 'Fran', content: '21-15-9', path: 'markdown/notebooks/crossfit-girls/fran.md' },
      { id: 'grace', name: 'Grace', content: '30 clean & jerks', path: 'markdown/notebooks/crossfit-girls/grace.md' },
    ],
  };

  it('should return all notebook items', async () => {
    const source = notebookItemsSource(mockNotebook);
    const results = await source.search('');

    expect(results).toHaveLength(2);
  });

  it('should include item details in results', async () => {
    const source = notebookItemsSource(mockNotebook);
    const results = await source.search('');

    expect(results[0].id).toBe('markdown/notebooks/crossfit-girls/fran.md');
    expect(results[0].label).toBe('Fran');
    expect(results[0].sublabel).toBe('CrossFit Girls');
    expect(results[0].category).toBe('CrossFit Girls');
    expect(results[0].payload).toEqual(mockNotebook.items[0]);
  });

  it('should filter items by search query on name', async () => {
    const source = notebookItemsSource(mockNotebook);
    const results = await source.search('grace');

    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Grace');
  });

  it('should filter items by search query on id', async () => {
    const source = notebookItemsSource(mockNotebook);
    const results = await source.search('fran');

    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Fran');
  });

  it('should handle case-insensitive search', async () => {
    const source = notebookItemsSource(mockNotebook);
    const results = await source.search('GRACE');

    expect(results).toHaveLength(1);
  });

  it('should return empty array when notebook has no items', async () => {
    const emptyNotebook: ScriptNotebook = {
      id: 'empty',
      name: 'Empty',
      categories: [],
      items: [],
    };
    const source = notebookItemsSource(emptyNotebook);
    const results = await source.search('');

    expect(results).toEqual([]);
  });

  it('should return empty array when no items match search query', async () => {
    const source = notebookItemsSource(mockNotebook);
    const results = await source.search('non-existent');

    expect(results).toEqual([]);
  });

  it('should handle partial matches', async () => {
    const source = notebookItemsSource(mockNotebook);
    const results = await source.search('gr');

    expect(results).toHaveLength(1); // Only Grace contains 'gr'
    expect(results[0].label).toBe('Grace');
  });

  it('should set source ID based on notebook ID', async () => {
    const source = notebookItemsSource(mockNotebook);

    expect(source.id).toBe('notebook-items:crossfit-girls');
  });

  it('should set source label to notebook name', async () => {
    const source = notebookItemsSource(mockNotebook);

    expect(source.label).toBe('CrossFit Girls');
  });

  it('should include the date key on dated items', async () => {
    const datedNotebook: ScriptNotebook = {
      ...mockNotebook,
      items: [
        { id: 'day-01', name: 'Day 01', content: '…', path: 'markdown/notebooks/programs/2026-01-12/day-01.md', date: '2026-01-12' },
      ],
    };
    const source = notebookItemsSource(datedNotebook);
    const results = await source.search('');

    expect(results[0].label).toBe('Day 01 — 2026-01-12');
  });
});

describe('globalSearchSource', () => {
  const createResult = (overrides: Partial<Session> & { id: string; noteId: string }): Session => ({
    createdAt: Date.now(),
    data: { startTime: 0, endTime: 60_000, duration: 60_000, completed: true, logs: [] },
    ...overrides,
  });

  beforeEach(() => {
    mockGetRecentSessions.mockResolvedValue([]);
  });

  it('excludes playground results by default', async () => {
    mockGetRecentSessions.mockResolvedValue([
      createResult({
        id: 'r-journal',
        noteId: 'journal/2024-01-15',
        createdAt: new Date('2024-01-15T10:30:00').getTime(),
      }),
      createResult({
        id: 'r-playground',
        noteId: 'playground/abc-123',
        createdAt: new Date('2024-01-14T10:30:00').getTime(),
      }),
    ]);

    const source = globalSearchSource([]);
    const results = await source.search('');

    expect(results.some(r => r.id === 'r-journal')).toBe(true);
    expect(results.some(r => r.id === 'r-playground')).toBe(false);
  });

  it('includes playground results when showPlaygrounds is true', async () => {
    mockGetRecentSessions.mockResolvedValue([
      createResult({
        id: 'r-playground',
        noteId: 'playground/abc-123',
        createdAt: new Date('2024-01-14T10:30:00').getTime(),
      }),
    ]);

    const source = globalSearchSource([], undefined, true);
    const results = await source.search('');

    expect(results.some(r => r.id === 'r-playground')).toBe(true);
  });

  it('treats legacy bare UUID noteIds as journal, not playground', async () => {
    mockGetRecentSessions.mockResolvedValue([
      createResult({
        id: 'r-legacy',
        noteId: '00000000-0000-4000-8000-000000000001',
        createdAt: new Date('2024-01-15T10:30:00').getTime(),
      }),
    ]);

    const source = globalSearchSource([]);
    const results = await source.search('');

    expect(results.some(r => r.id === 'r-legacy')).toBe(true);
  });

  it('respects the explicit origin field over noteId prefix', async () => {
    mockGetRecentSessions.mockResolvedValue([
      createResult({
        id: 'r-journal-origin',
        noteId: 'playground/abc-123',
        origin: 'journal',
        createdAt: new Date('2024-01-15T10:30:00').getTime(),
      }),
    ]);

    const source = globalSearchSource([]);
    const results = await source.search('');

    expect(results.some(r => r.id === 'r-journal-origin')).toBe(true);
  });
});

describe('canvasRouteSource', () => {
  const routes = [
    { route: '/canvas/home', page: { sections: [{ heading: 'Home' }] } },
    { route: '/canvas/tour', page: { sections: [{ heading: 'Guided Tour' }] } },
  ] as unknown as import('../canvas/canvasRoutes').CanvasRoute[];

  it('matches on the page heading or route, capped at five', async () => {
    const source = canvasRouteSource(routes);
    const byHeading = await source.search('tour');
    expect(byHeading.map(r => r.id)).toEqual(['route:/canvas/tour']);

    const byRoute = await source.search('home');
    expect(byRoute[0]?.label).toBe('Home');
    expect(byRoute[0]?.type).toBe('route');
    expect(byRoute[0]?.category).toBe('Pages');
  });

  it('returns every route (up to five) for an empty query', async () => {
    const source = canvasRouteSource(routes);
    expect(await source.search('')).toHaveLength(2);
  });

  it('still feeds route results into globalSearchSource', async () => {
    const source = globalSearchSource([], routes);
    const results = await source.search('tour');
    expect(results.some(r => r.id === 'route:/canvas/tour')).toBe(true);
  });
});

describe('constructSource', () => {
  it('returns an empty array for an empty query', async () => {
    const source = constructSource();
    const results = await source.search('');
    expect(results).toEqual([]);
  });

  it.each([
    ['AMRAP', 'AMRAP'],
    ['EMOM', 'EMOM'],
    ['Tabata', 'Tabata'],
    [':?', 'Actual result'],
    ['?lb', 'Load prompt'],
  ])('query %p resolves to %p', async (query, expectedLabel) => {
    const source = constructSource();
    const results = await source.search(query);
    const match = results.find((r) => r.label === expectedLabel);
    expect(match).toBeDefined();
    expect(match?.type).toBe('route');
    expect(match?.payload).toHaveProperty('route');
    const route = match?.payload && typeof match.payload === 'object' && 'route' in match.payload
      ? String(match.payload.route)
      : '';
    expect(route.length).toBeGreaterThan(0);
  });

  it('labels results with a distinguishable sublabel', async () => {
    const source = constructSource();
    const results = await source.search('AMRAP');
    expect(results[0]?.sublabel).toBe('Timer behaviors');
    expect(results[0]?.category).toBe('Reference');
  });

  it('does not duplicate identical constructs across multiple terms', async () => {
    const source = constructSource();
    const results = await source.search('load');
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('tagsPaletteSource', () => {
  it('returns existing tags matching query and excludes already assigned tags', async () => {
    const prevGetAllTags = storageService.getAllTags;
    storageService.getAllTags = async () => [
      { id: '1', label: 'benchmark', createdAt: 0 },
      { id: '2', label: 'cardio', createdAt: 0 },
      { id: '3', label: 'strength', createdAt: 0 },
    ];

    try {
      const source = tagsPaletteSource(['benchmark']);
      const results = await source.search('car');
      const existingMatch = results.find((r) => r.id === 'tag:cardio');
      expect(existingMatch).toBeDefined();
      expect(existingMatch?.payload).toEqual({ tag: 'cardio' });
      expect(results.some((r) => r.id === 'tag:benchmark')).toBe(false);
    } finally {
      storageService.getAllTags = prevGetAllTags;
    }
  });

  it('offers to create new tag when query does not match existing tag', async () => {
    const prevGetAllTags = storageService.getAllTags;
    storageService.getAllTags = async () => [
      { id: '1', label: 'benchmark', createdAt: 0 },
    ];

    try {
      const source = tagsPaletteSource([]);
      const results = await source.search('aerobic');
      const newTagItem = results.find((r) => r.id === 'tag:new:aerobic');
      expect(newTagItem).toBeDefined();
      expect(newTagItem?.label).toBe('Add tag "aerobic"');
      expect(newTagItem?.payload).toEqual({ tag: 'aerobic' });
    } finally {
      storageService.getAllTags = prevGetAllTags;
    }
  });
});
