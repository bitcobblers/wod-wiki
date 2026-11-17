import { beforeAll, describe, expect, it } from 'vitest';
import { InMemoryEffortRegistry } from '../../src/effort-registry/InMemoryEffortRegistry';
import { EffortResolver } from '../../src/effort-registry/EffortResolver';
import { bundledEfforts } from '../../src/effort-registry/data/bundled-efforts';

/**
 * Effort Registry Performance Tests
 *
 * Performance targets:
 * - Effort lookup: O(1) indexed by slug
 * - Fuzzy match: < 100ms for 500+ efforts
 * - No I/O during analytics pass (efforts pre-loaded)
 */

function generateLargeCatalog(count: number) {
  const efforts = [...bundledEfforts];
  for (let i = 0; i < count - bundledEfforts.length; i++) {
    efforts.push({
      id: `bench-effort-${i}`,
      slug: `bench-effort-${i}`,
      label: `Bench Effort ${i}`,
      aliases: [`bench ${i}`, `alias-${i}`],
      baseAttributes: { met: 5.0 + (i % 10), discipline: 'strength', intensityTier: 'moderate' },
      registrySource: 'bundled' as const,
    });
  }
  return efforts;
}

const LARGE_CATALOG_SIZE = 500;
const largeCatalog = generateLargeCatalog(LARGE_CATALOG_SIZE);

const registry = new InMemoryEffortRegistry();
registry.seed(largeCatalog);
beforeAll(async () => {
  await registry.loadBundled();
});

const resolver = new EffortResolver(registry);

function measureMs(fn: () => void, iterations = 100): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();
  return (end - start) / iterations;
}

describe('registry lookup performance', () => {
  it('resolve by slug averages < 5ms', () => {
    const avg = measureMs(() => {
      resolver.resolveBySlug('bench-effort-250');
    });
    expect(avg).toBeLessThan(5);
  });

  it('resolve by alias averages < 5ms', () => {
    const avg = measureMs(() => {
      resolver.resolveByAlias('Bench Effort 250');
    });
    expect(avg).toBeLessThan(5);
  });

  it('resolve fuzzy exact match averages < 5ms', () => {
    const avg = measureMs(() => {
      resolver.resolveFuzzy('bench-effort-250');
    });
    expect(avg).toBeLessThan(5);
  });

  it('resolve fuzzy distance 1 averages < 50ms', () => {
    const avg = measureMs(() => {
      resolver.resolveFuzzy('bench-effor-250');
    });
    expect(avg).toBeLessThan(50);
  });

  it('resolve fuzzy distance 2 averages < 50ms', () => {
    const avg = measureMs(() => {
      resolver.resolveFuzzy('bench-efort-250');
    });
    expect(avg).toBeLessThan(50);
  });

  it('list all efforts averages < 1ms', () => {
    const avg = measureMs(() => {
      resolver.list();
    });
    expect(avg).toBeLessThan(1);
  });
});

describe('fuzzy match scaling', () => {
  it('fuzzy match 500 efforts — no match averages < 100ms', () => {
    const avg = measureMs(() => {
      resolver.resolveFuzzy('completely-unrelated-xyz');
    });
    expect(avg).toBeLessThan(100);
  });

  it('fuzzy match 500 efforts — weak match averages < 100ms', () => {
    const avg = measureMs(() => {
      resolver.resolveFuzzy('bench');
    });
    expect(avg).toBeLessThan(100);
  });
});
