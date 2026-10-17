import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '../../storage/src/sql';
import { applySeedChunk, seedNoteId, type SeedChunkWrite } from '../src/seed/runtime';
import { emptySeedMeta, SEED_SCHEMA, type SeedRow, type SeedMetaRecord } from '../src/seed/contract';

const row = (path: string, label = 'Dumbbell'): SeedRow => ({
  path, content: `---\ntype: equipment\nid: equipment-dumbbell\nslug: dumbbell\nlabel: ${label}\naliases: []\n---\n# ${label}\n\nKeep this source intact.\n`,
  blocks: {}, blockIndex: [], blockEfforts: [], blockEquipment: [],
});
async function chunk(source: string, rows: SeedRow[], previous?: SeedMetaRecord): Promise<SeedChunkWrite> {
  return {
    chunkId: 'equipment', rows, expectedMeta: previous,
    manifest: { schema: SEED_SCHEMA, version: 1, builtAt: new Date(0).toISOString(), chunks: [] },
    meta: {
      ...emptySeedMeta(`seed:${source}`),
      chunks: { equipment: { sha256: 'a'.repeat(64), noteIds: await Promise.all(rows.map(value => seedNoteId(value.path))) } },
    },
  };
}

const client = createClient({ url: ':memory:' });
const storage = new SqlStorage(libsqlDatabase(client));
try {
  const originalRow = row('markdown/equipment/dumbbell.md');
  const original = await chunk('first', [originalRow]);
  await applySeedChunk(storage, original);
  const ownerId = await seedNoteId(originalRow.path);
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.ownerNoteId, ownerId);
  assert.equal((await storage.readonly('notes').get(ownerId))?.rawContent, originalRow.content);

  const collision = await chunk('second', [row('markdown/equipment/other/dumbbell.md', 'Wrong owner')]);
  await assert.rejects(applySeedChunk(storage, collision), /collision/i);
  assert.equal(await storage.readonly('meta').get('seed:second'), undefined);
  assert.equal(await storage.readonly('notes').get(await seedNoteId(collision.rows[0].path)), undefined);
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.label, 'Dumbbell');

  const duplicatePath = await chunk('second', [row(originalRow.path, 'Wrong source')]);
  await assert.rejects(applySeedChunk(storage, duplicatePath), /collision/i);
  assert.equal((await storage.readonly('notes').get(ownerId))?.rawContent, originalRow.content);

  await storage.readwrite('equipment').put({
    id: 'equipment-custom', slug: 'dumbbell-custom', label: 'My dumbbell', aliases: [],
    registrySource: 'user', ownerNoteId: 'equipment/dumbbell-custom',
  });
  await applySeedChunk(storage, await chunk('first', [], original.meta));
  assert.equal(await storage.readonly('equipment').get('dumbbell'), undefined, 'refresh removes the source-owned projection by slug');
  assert.equal(await storage.readonly('notes').get(ownerId), undefined);
  assert.equal((await storage.readonly('equipment').get('dumbbell-custom'))?.label, 'My dumbbell');
  console.log('Reference seed ownership: import, collision rollback, removal, and custom-copy preservation passed.');
} finally {
  await storage.close();
}
