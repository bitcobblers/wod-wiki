import { describe, expect, it } from 'vitest';
import { getClauseMeta } from '../src/composer/queryClauses';

describe('catalog vs notebook clause labels', () => {
  // Both filter keys appear as separate facet sections in the note-list rail —
  // identical labels used to render a duplicated "NOTEBOOK" heading (#facet dup).
  it('labels differ so the facet rail shows one heading per filter', () => {
    expect(getClauseMeta('catalog').label).toBe('Catalog');
    expect(getClauseMeta('notebook').label).toBe('Notebook');
    expect(getClauseMeta('catalog').label).not.toBe(getClauseMeta('notebook').label);
  });

  it('descriptions are distinct and say what each filter matches', () => {
    const catalog = getClauseMeta('catalog').description;
    const notebook = getClauseMeta('notebook').description;
    expect(catalog).not.toBe(notebook);
    expect(catalog).toMatch(/catalog directory id/i);
    expect(catalog).toMatch(/crossfit-games/);
    expect(notebook).toMatch(/notebook container id/i);
    expect(notebook).toMatch(/notebook\/journal/);
    expect(notebook).toMatch(/notebook\/playground/);
    expect(notebook).toMatch(/notebook\/guides/);
  });
});
