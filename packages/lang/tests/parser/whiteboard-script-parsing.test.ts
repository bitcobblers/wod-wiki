import { describe, it, expect } from 'vitest';
import { WhiteboardScript } from '@bitcobblers/wod-wiki-engine';
import { ICodeStatement } from '@bitcobblers/wod-wiki-engine';
import { CodeMetadata } from '@bitcobblers/wod-wiki-engine';

describe('WhiteboardScript ID Type Consistency', () => {
  const mockMeta: CodeMetadata = {
    line: 1,
    startOffset: 0,
    endOffset: 10,
    columnStart: 1,
    columnEnd: 10,
    length: 10
  };

  const mockStatements: ICodeStatement[] = [
    {
      id: 1,
      parent: undefined,
      children: [[2], [3]], // Updated to grouped format
      metrics: [],
      metricMeta: new Map(),
      isLeaf: false,
      meta: mockMeta
    },
    {
      id: 2,
      parent: 1,
      children: [],
      metrics: [],
      metricMeta: new Map(),
      isLeaf: true,
      meta: mockMeta
    },
    {
      id: 3,
      parent: 1,
      children: [],
      metrics: [],
      metricMeta: new Map(),
      isLeaf: true,
      meta: mockMeta
    }
  ];

  const script = new WhiteboardScript('test source', mockStatements, []);

  it('should accept only numeric IDs for getId', () => {
    const statement = script.getId(1);
    expect(statement).toBeDefined();
    expect(statement?.id).toBe(1);

    const nonExistent = script.getId(999);
    expect(nonExistent).toBeUndefined();
  });

  it('should accept only numeric ID arrays for getIds', () => {
    const statements = script.getIds([1, 2]);
    expect(statements).toHaveLength(2);
    expect(statements[0].id).toBe(1);
    expect(statements[1].id).toBe(2);

    const withMissing = script.getIds([1, 999, 3]);
    expect(withMissing).toHaveLength(2); // only 1 and 3 exist
    expect(withMissing[0].id).toBe(1);
    expect(withMissing[1].id).toBe(3);
  });

  it('should use numeric comparison for ID lookup', () => {
    // Test that we're using direct numeric comparison, not string comparison
    const statement = script.getId(2);
    expect(statement).toBeDefined();
    expect(statement?.id).toBe(2);
    expect(typeof statement?.id).toBe('number');
  });
});
