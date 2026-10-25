import type { SeedManifest, SeedRow } from '@/types/seed';
export { assertSeedManifest as assertManifest, assertSeedRows as assertRows } from '@bitcobblers/wod-wiki-engine';
export type SeedChunkPayload = SeedRow[];
export interface IFeedSource {
  fetchManifest(): Promise<SeedManifest>;
  fetchChunk(path: string): Promise<SeedChunkPayload>;
}
export class FeedSourceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'FeedSourceError';
  }
}
