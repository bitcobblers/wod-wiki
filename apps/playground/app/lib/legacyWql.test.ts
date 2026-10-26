import { describe, expect, it } from 'bun:test';
import { migrateLegacyCatalogFilter } from './legacyWql';

describe('migrateLegacyCatalogFilter (ticket 08 mid-flight migration)', () => {
  it('rewrites the plain retired filter', () => {
    expect(migrateLegacyCatalogFilter(':feed{catalog:fran}')).toBe(':feed{notebook:fran}');
    expect(migrateLegacyCatalogFilter('catalog:girls last 8w')).toBe('notebook:girls last 8w');
  });

  it('rewrites negated catalog filters', () => {
    expect(migrateLegacyCatalogFilter(':feed{!catalog:fran}')).toBe(':feed{!notebook:fran}');
    expect(migrateLegacyCatalogFilter(':feed{tags:pr,!catalog:open}')).toBe(':feed{tags:pr,!notebook:open}');
  });

  it('rewrites quoted values, including negated and multi-word ones', () => {
    expect(migrateLegacyCatalogFilter('catalog:"x y"')).toBe('notebook:"x y"');
    expect(migrateLegacyCatalogFilter('{!catalog:"x y"}')).toBe('{!notebook:"x y"}');
  });

  it('touches only filter-key positions — heads and storage identities stay', () => {
    // The :catalog HEAD is a deprecated-head mapping concern (wql.ts), not a
    // filter rewrite; feed storage identities are not catalog filters.
    expect(migrateLegacyCatalogFilter(':catalog')).toBe(':catalog');
    expect(migrateLegacyCatalogFilter(':note{source:collection:fran}')).toBe(':note{source:collection:fran}');
  });

  it('leaves no retired key behind in any supported shape', () => {
    const cases = [
      ':feed{catalog:fran}',
      ':feed{!catalog:fran}',
      'catalog:fran',
      '!catalog:fran',
      'catalog:"x y"',
      ':feed{tags:pr, catalog:fran, !catalog:open}',
      ':feed{catalog:crossfit-girls/fran} last 8w',
    ];
    for (const query of cases) {
      const migrated = migrateLegacyCatalogFilter(query);
      expect(migrated).not.toMatch(/(^|[{,\s!])catalog:/);
      expect(migrated).not.toMatch(/(^|[{,\s!])catalogs:/);
    }
  });
});
