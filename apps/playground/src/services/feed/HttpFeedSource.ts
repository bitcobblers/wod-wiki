/**
 * HttpFeedSource — production adapter: fetches one compiled feed from
 * the static host (same origin, `BASE_URL/seed/<sourceId>/`). The manifest is
 * fetched with `cache: 'no-cache'` so a fresh deploy is seen immediately;
 * chunks are content-hashed filenames and cache aggressively.
 */
import type { SeedManifest } from '@/types/seed';
import { assertManifest, FeedSourceError, type IFeedSource, type SeedChunkPayload } from './IFeedSource';

export class HttpFeedSource implements IFeedSource {
  constructor(
    /** Seed dir on the static host — one per seed source, e.g. `BASE_URL + 'seed/core/'`. */
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  async fetchManifest(): Promise<SeedManifest> {
    const res = await this.fetchImpl(`${this.baseUrl}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) {
      throw new FeedSourceError(`feed manifest fetch failed: HTTP ${res.status}`, res.status);
    }
    return assertManifest(await res.json());
  }

  async fetchChunk(path: string): Promise<SeedChunkPayload> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new FeedSourceError(`feed chunk fetch failed: HTTP ${res.status} for ${path}`, res.status);
    }
    // Row-shape validation happens in the importer, which knows the chunk
    // kind from the manifest; the transport layer stays kind-agnostic.
    return (await res.json()) as SeedChunkPayload;
  }
}
