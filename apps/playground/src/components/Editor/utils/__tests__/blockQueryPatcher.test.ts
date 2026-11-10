import { describe, it, expect } from 'bun:test';
import { patchBlockQuery, extractBlockQueries } from '@bitcobblers/wod-wiki-ui';

describe('extractBlockQueries', () => {
  it('extracts plain single WQL query', () => {
    const content = 'sum:totalVolume{discipline:strength}';
    const queries = extractBlockQueries(content);
    expect(queries).toEqual([
      {
        queryIndex: 0,
        query: 'sum:totalVolume{discipline:strength}',
        isYamlKey: false,
        lineIndex: 0,
      },
    ]);
  });

  it('extracts stacked line queries ignoring comments and blank lines', () => {
    const content = '# Main volume\nsum:totalVolume{}\n\n# Note search\n:note{tags:pr}';
    const queries = extractBlockQueries(content);
    expect(queries).toEqual([
      {
        queryIndex: 0,
        query: 'sum:totalVolume{}',
        isYamlKey: false,
        lineIndex: 1,
      },
      {
        queryIndex: 1,
        query: ':note{tags:pr}',
        isYamlKey: false,
        lineIndex: 4,
      },
    ]);
  });

  it('extracts query values from YAML keys', () => {
    const content = 'title: Volume Chart\nquery: sum:totalVolume{discipline:strength}\nchart: bars';
    const queries = extractBlockQueries(content);
    expect(queries).toEqual([
      {
        queryIndex: 0,
        query: 'sum:totalVolume{discipline:strength}',
        isYamlKey: true,
        lineIndex: 1,
      },
    ]);
  });

  it('extracts quoted YAML query values', () => {
    const content = 'query: "avg:totalVolume{}"\nunit: kg';
    const queries = extractBlockQueries(content);
    expect(queries).toEqual([
      {
        queryIndex: 0,
        query: 'avg:totalVolume{}',
        isYamlKey: true,
        lineIndex: 0,
      },
    ]);
  });

  it('extracts multiple YAML query entries in dashboard widgets list', () => {
    const content = `widgets:
  - title: Strength Volume
    query: sum:totalVolume{discipline:strength}
    unit: kg
  - title: PR Notes
    query: :note{tags:pr}`;

    const queries = extractBlockQueries(content);
    expect(queries).toEqual([
      {
        queryIndex: 0,
        query: 'sum:totalVolume{discipline:strength}',
        isYamlKey: true,
        lineIndex: 2,
      },
      {
        queryIndex: 1,
        query: ':note{tags:pr}',
        isYamlKey: true,
        lineIndex: 5,
      },
    ]);
  });
});

describe('patchBlockQuery', () => {
  it('replaces plain single WQL query', () => {
    const content = 'sum:totalVolume{discipline:strength}';
    const updated = patchBlockQuery(content, 'avg:totalVolume{discipline:strength}');
    expect(updated).toBe('avg:totalVolume{discipline:strength}');
  });

  it('replaces plain single query preserving trailing newline', () => {
    const content = 'sum:totalVolume{}\n';
    const updated = patchBlockQuery(content, 'avg:totalVolume{}');
    expect(updated).toBe('avg:totalVolume{}\n');
  });

  it('patches YAML query key without disturbing sibling keys', () => {
    const content = `title: Weekly Strength Volume
query: sum:totalVolume{discipline:strength}
chart: bars
span: 2`;

    const updated = patchBlockQuery(content, 'avg:totalVolume{discipline:strength}');
    expect(updated).toBe(`title: Weekly Strength Volume
query: avg:totalVolume{discipline:strength}
chart: bars
span: 2`);
  });

  it('patches quoted YAML query key preserving quotes when appropriate', () => {
    const content = `title: Chart
query: "sum:totalVolume{}"
unit: kg`;

    const updated = patchBlockQuery(content, 'avg:totalVolume{}');
    expect(updated).toBe(`title: Chart
query: "avg:totalVolume{}"
unit: kg`);
  });

  it('patches specific line in stacked queries without disturbing comments or other queries', () => {
    const content = `# Header comment
sum:totalVolume{discipline:strength}

# Top PR notes
:note{tags:pr}`;

    const updatedIndex0 = patchBlockQuery(content, 'avg:totalVolume{discipline:strength}', 0);
    expect(updatedIndex0).toBe(`# Header comment
avg:totalVolume{discipline:strength}

# Top PR notes
:note{tags:pr}`);

    const updatedIndex1 = patchBlockQuery(content, ':note{tags:workout}', 1);
    expect(updatedIndex1).toBe(`# Header comment
sum:totalVolume{discipline:strength}

# Top PR notes
:note{tags:workout}`);
  });

  it('patches specific query in YAML widgets list without disturbing sibling keys or other widgets', () => {
    const content = `widgets:
  - title: Strength Volume
    query: sum:totalVolume{discipline:strength}
    unit: kg
  - title: PR Notes
    query: :note{tags:pr}`;

    const updatedWidget0 = patchBlockQuery(content, 'avg:totalVolume{discipline:strength}', 0);
    expect(updatedWidget0).toBe(`widgets:
  - title: Strength Volume
    query: avg:totalVolume{discipline:strength}
    unit: kg
  - title: PR Notes
    query: :note{tags:pr}`);

    const updatedWidget1 = patchBlockQuery(content, ':note{tags:workout}', 1);
    expect(updatedWidget1).toBe(`widgets:
  - title: Strength Volume
    query: sum:totalVolume{discipline:strength}
    unit: kg
  - title: PR Notes
    query: :note{tags:workout}`);
  });
});
