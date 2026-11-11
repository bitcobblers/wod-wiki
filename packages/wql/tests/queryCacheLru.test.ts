import { describe, expect, it } from 'vitest';
import { AnalyticsInvalidationBus, QueryCache } from '../src/queryCache';

const makeBus = () => new AnalyticsInvalidationBus(() => undefined as never);

describe('WQL-4 QueryCache LRU eviction', () => {
  it('evicts the oldest entry beyond the default 64-entry bound', () => {
    const cache = new QueryCache(makeBus());
    for (let i = 0; i < 65; i += 1) cache.set(`k${i}`, i, 1);
    expect(cache.size).toBe(64);
    expect(cache.get('k0', 1)).toBeUndefined();
    expect(cache.get('k1', 1)).toBe(1);
    expect(cache.get('k64', 1)).toBe(64);
  });

  it('honors a custom maxEntries bound', () => {
    const cache = new QueryCache(makeBus(), { maxEntries: 2 });
    cache.set('a', 1, 1);
    cache.set('b', 2, 1);
    cache.set('c', 3, 1);
    expect(cache.size).toBe(2);
    expect(cache.get('a', 1)).toBeUndefined();
    expect(cache.get('b', 1)).toBe(2);
    expect(cache.get('c', 1)).toBe(3);
  });

  it('refreshes recency on read — true LRU, not FIFO', () => {
    const cache = new QueryCache(makeBus(), { maxEntries: 2 });
    cache.set('a', 1, 1);
    cache.set('b', 2, 1);
    expect(cache.get('a', 1)).toBe(1); // a becomes most-recent
    cache.set('c', 3, 1);
    expect(cache.get('a', 1)).toBe(1);
    expect(cache.get('b', 1)).toBeUndefined();
    expect(cache.get('c', 1)).toBe(3);
  });

  it('a rewrite refreshes recency and never grows the cache', () => {
    const cache = new QueryCache(makeBus(), { maxEntries: 2 });
    cache.set('a', 1, 1);
    cache.set('b', 2, 1);
    cache.set('a', 10, 1);
    expect(cache.size).toBe(2);
    cache.set('c', 3, 1);
    expect(cache.get('a', 1)).toBe(10);
    expect(cache.get('b', 1)).toBeUndefined();
  });

  it('a generation mismatch is a miss that drops the stale entry', () => {
    const cache = new QueryCache(makeBus());
    cache.set('k', 42, 1);
    expect(cache.get('k', 2)).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.get('k', 1)).toBeUndefined();
  });

  it('a mutation on the bus clears every entry', async () => {
    const bus = makeBus();
    const cache = new QueryCache(bus);
    cache.set('a', 1, 1);
    cache.set('b', 2, 1);
    await bus.publishMutation();
    expect(cache.size).toBe(0);
    expect(cache.get('a', 1)).toBeUndefined();
  });

  it('floors maxEntries at 1', () => {
    const cache = new QueryCache(makeBus(), { maxEntries: 0 });
    cache.set('x', 1, 1);
    cache.set('y', 2, 1);
    expect(cache.size).toBe(1);
    expect(cache.get('y', 1)).toBe(2);
    expect(cache.get('x', 1)).toBeUndefined();
  });
});
