/**
 * InMemoryFeedSource — test/fixture adapter. Serves a manifest and chunks
 * from plain objects; no network, no storage.
 */
import type { SeedManifest } from '@/types/seed';
import type { IFeedSource, SeedChunkPayload } from './IFeedSource';

export class InMemoryFeedSource implements IFeedSource {
  constructor(
    private readonly manifest: SeedManifest,
    private readonly chunks: Record<string, SeedChunkPayload>,
  ) {}

  fetchManifest(): Promise<SeedManifest> {
    return Promise.resolve(this.manifest);
  }

  fetchChunk(path: string): Promise<SeedChunkPayload> {
    return Promise.resolve(this.chunks[path] ?? []);
  }
}

/** Test spy wrapper — counts chunk fetches so resume/idempotency is observable. */
export class CountingFeedSource implements IFeedSource {
  fetchChunkCalls: string[] = [];
  fetchManifestCalls = 0;

  constructor(private readonly inner: IFeedSource) {}

  fetchManifest(): Promise<SeedManifest> {
    this.fetchManifestCalls += 1;
    return this.inner.fetchManifest();
  }

  fetchChunk(path: string): Promise<SeedChunkPayload> {
    this.fetchChunkCalls.push(path);
    return this.inner.fetchChunk(path);
  }
}
