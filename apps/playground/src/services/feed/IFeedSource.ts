import type { NotebookIndex, SeedManifest, SeedRow } from '@bitcobblers/wod-wiki-engine';
export { assertSeedManifest as assertManifest, assertSeedRows as assertRows } from '@bitcobblers/wod-wiki-engine';
export type SeedChunkPayload = SeedRow[] | SeedRow | NotebookIndex;
export interface IFeedSource {
  fetchManifest(): Promise<SeedManifest>;
  fetchChunk(path: string): Promise<SeedChunkPayload>;
  fetchText?(path: string): Promise<string>;
}
export class FeedSourceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'FeedSourceError';
  }
}
