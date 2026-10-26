import { createHash } from 'node:crypto';
import { SEED_SCHEMA, type SeedManifest, type SeedRow } from '@/types/seed';
import { InMemoryFeedSource } from './InMemoryFeedSource';

export function feedFixture(rows: SeedRow[], version = 1, chunkId = 'notebook.test') {
  const bytes = JSON.stringify(rows);
  const manifest: SeedManifest = { schema: SEED_SCHEMA, version, builtAt: new Date(version).toISOString(), chunks: [{ id: chunkId, path: `chunks/${chunkId}.json`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: new TextEncoder().encode(bytes).length, count: rows.length }] };
  return new InMemoryFeedSource(manifest, { [`chunks/${chunkId}.json`]: rows });
}
