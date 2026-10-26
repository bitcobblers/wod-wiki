import { describe, expect, it } from 'bun:test';
import { migrateLegacyCatalogFilter } from './legacyWql';

describe('migrateLegacyCatalogFilter (ticket 08 persisted-data migration)', () => {
  it('rewrites the plain retired filter', () => {
    expect(migrateLegacyCatalogFilter(':notebooks{catalog:fran}')).toBe(':notebooks{notebook:fran}');
    expect(migrateLegacyCatalogFilter('catalog:girls last 8w')).toBe('notebook:girls last 8w');
  });

  it('rewrites negated catalog filters', () => {
    expect(migrateLegacyCatalogFilter(':notebooks{!catalog:fran}')).toBe(':notebooks{!notebook:fran}');
    expect(migrateLegacyCatalogFilter(':notebooks{tags:pr,!catalog:open}')).toBe(':notebooks{tags:pr,!notebook:open}');
  });

  it('rewrites quoted values, including negated and multi-word ones', () => {
    expect(migrateLegacyCatalogFilter('catalog:"x y"')).toBe('notebook:"x y"');
    expect(migrateLegacyCatalogFilter('{!catalog:"x y"}')).toBe('{!notebook:"x y"}');
  });

  it('touches only filter-key positions — heads and storage identities stay', () => {
    // The :catalog HEAD no longer resolves (ticket 12) — not a
    // filter rewrite; feed storage identities are not catalog filters.
    expect(migrateLegacyCatalogFilter(':catalog')).toBe(':catalog');
    expect(migrateLegacyCatalogFilter(':note{source:collection:fran}')).toBe(':note{source:collection:fran}');
  });

  it('leaves no retired key behind in any supported shape', () => {
    const cases = [
      ':notebooks{catalog:fran}',
      ':notebooks{!catalog:fran}',
      'catalog:fran',
      '!catalog:fran',
      'catalog:"x y"',
      ':notebooks{tags:pr, catalog:fran, !catalog:open}',
      ':notebooks{catalog:crossfit-girls/fran} last 8w',
    ];
    for (const query of cases) {
      const migrated = migrateLegacyCatalogFilter(query);
      expect(migrated).not.toMatch(/(^|[{,\s!])catalog:/);
      expect(migrated).not.toMatch(/(^|[{,\s!])catalogs:/);
    }
  });
});
