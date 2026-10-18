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
  const coreRow = row('markdown/equipment/dumbbell.md', 'Core Dumbbell');
  const coreWrite = await chunk('core', [coreRow]);
  await applySeedChunk(storage, coreWrite);
  const coreOwnerId = await seedNoteId(coreRow.path);
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.ownerNoteId, coreOwnerId);
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.label, 'Core Dumbbell');
  assert.equal((await storage.readonly('notes').get(coreOwnerId))?.rawContent, coreRow.content);

  // Community tier overrides core tier on same-path note and definition slug.
  const communitySamePathRow = row(coreRow.path, 'Community Dumbbell');
  const communityWrite1 = await chunk('community', [communitySamePathRow]);
  await applySeedChunk(storage, communityWrite1);
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.label, 'Community Dumbbell');
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.sourceId, 'community');
  assert.equal((await storage.readonly('notes').get(coreOwnerId))?.rawContent, communitySamePathRow.content);

  // Re-syncing lower-precedence core tier is shadowed by community tier without throwing.
  const coreResync = await chunk('core', [coreRow], coreWrite.meta);
  await applySeedChunk(storage, coreResync);
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.label, 'Community Dumbbell');
  assert.equal((await storage.readonly('notes').get(coreOwnerId))?.rawContent, communitySamePathRow.content);

  // Imported (custom package) tier overrides community tier even when declared at a different path.
  const importedRow = row('markdown/equipment/other/dumbbell.md', 'Imported Dumbbell');
  const importedWrite = await chunk('custom-pack', [importedRow]);
  await applySeedChunk(storage, importedWrite);
  const importedOwnerId = await seedNoteId(importedRow.path);
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.ownerNoteId, importedOwnerId);
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.label, 'Imported Dumbbell');
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.sourceId, 'custom-pack');

  // Re-syncing community tier is shadowed by the higher-precedence imported tier.
  const communityResync = await chunk('community', [communitySamePathRow], communityWrite1.meta);
  await applySeedChunk(storage, communityResync);
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.label, 'Imported Dumbbell');
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.ownerNoteId, importedOwnerId);

  // User tier shadows all seed tiers.
  await storage.readwrite('equipment').put({
    id: 'equipment-user-dumbbell', slug: 'dumbbell', label: 'User Dumbbell', aliases: [],
    registrySource: 'user', ownerNoteId: 'equipment/dumbbell',
  });
  const importedResync = await chunk('custom-pack', [row('markdown/equipment/other/dumbbell.md', 'Imported v2')], importedWrite.meta);
  await applySeedChunk(storage, importedResync);
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.label, 'User Dumbbell');

  // Remove user override and verify seed tier fallback on tombstones: imported → community → core → deleted.
  await storage.readwrite('equipment').put({
    id: 'equipment-dumbbell', slug: 'dumbbell', label: 'Imported v2', aliases: [],
    registrySource: 'bundled', ownerNoteId: importedOwnerId, sourceId: 'custom-pack', sourcePath: importedRow.path,
  });
  await storage.readwrite('equipment').put({
    id: 'equipment-custom', slug: 'dumbbell-custom', label: 'My dumbbell', aliases: [],
    registrySource: 'user', ownerNoteId: 'equipment/dumbbell-custom',
  });

  // Tombstoning imported tier restores the remaining community projection.
  await applySeedChunk(storage, await chunk('custom-pack', [], importedResync.meta));
  assert.equal(await storage.readonly('notes').get(importedOwnerId), undefined);
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.label, 'Community Dumbbell');
  assert.equal((await storage.readonly('equipment').get('dumbbell'))?.sourceId, 'community');

  // Tombstoning community tier retains the shared path note for core; removing core deletes it.
  await applySeedChunk(storage, await chunk('community', [], communityResync.meta));
  assert.notEqual(await storage.readonly('equipment').get('dumbbell'), undefined);
  await applySeedChunk(storage, await chunk('core', [], coreResync.meta));
  assert.equal(await storage.readonly('equipment').get('dumbbell'), undefined, 'refresh removes the source-owned projection by slug when no seed tier remains');
  assert.equal(await storage.readonly('notes').get(coreOwnerId), undefined);
  assert.equal((await storage.readonly('equipment').get('dumbbell-custom'))?.label, 'My dumbbell');
  console.log('Reference seed precedence: core < community < imported < user override, shadowing, fallback, and removal passed.');
} finally {
  await storage.close();
}
