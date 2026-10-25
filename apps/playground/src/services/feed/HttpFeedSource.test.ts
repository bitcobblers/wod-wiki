/** HttpFeedSource — URL building, no-cache manifest, shape validation, error paths. */
import { describe, expect, it } from 'bun:test';
import { HttpFeedSource } from './HttpFeedSource';
import { SEED_SCHEMA } from '@/types/seed';

function fetchJson(body: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 200 ? JSON.stringify(body) : 'nope', { status });
  }) as typeof fetch;
  return { impl, calls };
}

const manifest = {
  schema: SEED_SCHEMA,
  version: 1000,
  builtAt: '1970-01-01T00:00:01.000Z',
  chunks: [{ id: 'canvas', path: 'chunks/canvas.ab12cd34.json', sha256: 'a'.repeat(64), bytes: 10, count: 1 }],
};

describe('HttpFeedSource', () => {
  it('fetches the manifest with cache: no-cache and validates its shape', async () => {
    const { impl, calls } = fetchJson(manifest);
    const source = new HttpFeedSource('/seed/', impl);
    const result = await source.fetchManifest();
    expect(result.version).toBe(1000);
    expect(calls[0]!.url).toBe('/seed/manifest.json');
    expect(calls[0]!.init?.cache).toBe('no-cache');
  });

  it('joins chunk paths onto the base URL and returns validated rows', async () => {
    const rows = [{ path: 'markdown/canvas/a.md', content: '# A' }];
    const { impl, calls } = fetchJson(rows);
    const source = new HttpFeedSource('/seed/', impl);
    const result = await source.fetchChunk('chunks/canvas.ab12cd34.json');
    expect(result).toEqual(rows);
    expect(calls[0]!.url).toBe('/seed/chunks/canvas.ab12cd34.json');
  });

  it('throws FeedSourceError with status on HTTP failures', async () => {
    const { impl } = fetchJson({}, 404);
    const source = new HttpFeedSource('/seed/', impl);
    await expect(source.fetchManifest()).rejects.toMatchObject({ name: 'FeedSourceError', status: 404 });
  });

  it('validates manifests loudly; chunk payloads are kind-agnostic', async () => {
    const badManifest = new HttpFeedSource('/seed/', fetchJson({ hello: 1 }).impl);
    await expect(badManifest.fetchManifest()).rejects.toThrow(/Incompatible seed schema/);

    // Row-shape validation happens in the importer, which knows the chunk
    // kind from the manifest; the transport returns the parsed JSON as-is.
    const oddButLegitimate = new HttpFeedSource('/seed/', fetchJson([{ path: 1 }]).impl);
    await expect(oddButLegitimate.fetchChunk('chunks/x.json')).resolves.toEqual([{ path: 1 }]);
  });
});
