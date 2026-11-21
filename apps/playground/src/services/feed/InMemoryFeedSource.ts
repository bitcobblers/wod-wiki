/**
 * InMemoryFeedSource — test/fixture adapter. Serves a manifest and chunks
 * from plain objects; no network, no storage.
 */
import type { SeedManifest } from '@/types/seed';
import { FeedSourceError, type IFeedSource, type SeedChunkPayload } from './IFeedSource';

export class InMemoryFeedSource implements IFeedSource {
  constructor(
    private readonly manifest: SeedManifest,
    private readonly chunks: Record<string, unknown>,
  ) {}

  fetchManifest(): Promise<SeedManifest> {
    return Promise.resolve(this.manifest);
  }

  fetchChunk(path: string): Promise<SeedChunkPayload> {
    return Promise.resolve((this.chunks[path] as SeedChunkPayload | undefined) ?? []);
  }

  fetchText(path: string): Promise<string> {
    const val = this.chunks[path];
    if (typeof val === 'string') return Promise.resolve(val);
    return Promise.reject(new FeedSourceError(`Missing text entry: ${path}`, 404));
  }
}

/** Test spy wrapper — counts chunk fetches so resume/idempotency is observable. */
export class CountingFeedSource implements IFeedSource {
  fetchChunkCalls: string[] = [];
  fetchTextCalls: string[] = [];
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

  fetchText(path: string): Promise<string> {
    this.fetchTextCalls.push(path);
    if (this.inner.fetchText) return this.inner.fetchText(path);
    return Promise.reject(new FeedSourceError(`fetchText unsupported on inner source for ${path}`, 404));
  }
}
