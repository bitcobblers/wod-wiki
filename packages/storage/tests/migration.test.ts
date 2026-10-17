import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase, type Database } from '../src/sql';
import type { Note } from '../src/entities';

const SCHEMA_TABLE = '_wodwiki_schema';

const note: Note = {
  id: 'n1',
  title: 'Retained workout',
  createdAt: 1,
  rawContent: 'Plain note text without workout blocks',
  sourceRevision: 1,
  blocks: {},
};

const effort = {
  id: 'effort-bundled-snatch',
  slug: 'snatch',
  label: 'Snatch',
  aliases: ['dumbbell snatch'],
  baseAttributes: { met: 6.0, discipline: 'weightlifting', intensityTier: 'high' },
  registrySource: 'bundled',
  ownerNoteId: 'n1',
  sourceId: 'efforts',
  sourcePath: 'markdown/efforts/snatch.md',
};

const equipment = {
  id: 'equipment-bundled-dumbbell',
  slug: 'dumbbell',
  label: 'Dumbbell',
  aliases: ['dumbbells'],
  registrySource: 'bundled',
};

const equipmentLink = {
  id: 'n1:b1:dumbbell',
  noteId: 'n1',
  blockId: 'b1',
  equipmentSlug: 'dumbbell',
  createdAt: 1,
};

/** Rewind an initialized v31 database to the v30 shape: drop the V31 tables, rewind the guard. */
async function downgradeToV30(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(`DROP TABLE equipment`);
    await tx.exec(`DROP TABLE block_equipment`);
    await tx.exec(`INSERT INTO "${SCHEMA_TABLE}" ("key", "value") VALUES ('schema', '{"version":30}') ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"`);
  });
}

describe('SQL additive schema migration (v30 → v31)', () => {
  it('creates the V31 tables on an old database while retaining every stored row', async () => {
    const db = libsqlDatabase(createClient({ url: ':memory:' }));
    const v31 = new SqlStorage(db);
    await v31.readwrite('notes').put(note);
    await v31.readwrite('efforts').put(effort);
    await downgradeToV30(db);

    const migrated = new SqlStorage(db);
    // Pre-existing data survives untouched.
    expect(await migrated.readonly('notes').get(note.id)).toMatchObject({ id: note.id, title: note.title });
    expect(await migrated.readonly('efforts').get(effort.slug)).toMatchObject({ slug: effort.slug, registrySource: 'bundled' });
    // The additive stores are created and immediately usable.
    await migrated.readwrite('equipment').put(equipment);
    await migrated.readwrite('block_equipment').put(equipmentLink);
    expect(await migrated.readonly('equipment').get(equipment.slug)).toMatchObject({ slug: equipment.slug });
    expect(await migrated.readonly('block_equipment').get(equipmentLink.id)).toMatchObject({ equipmentSlug: 'dumbbell' });
    // The original rows are still intact after the new stores were written.
    expect(await migrated.readonly('notes').get(note.id)).toMatchObject({ id: note.id });
    await migrated.close();
  });

  it('still fails closed when an old database carries unrecognized tables', async () => {
    const db = libsqlDatabase(createClient({ url: ':memory:' }));
    const v31 = new SqlStorage(db);
    await v31.readwrite('notes').put(note);
    await downgradeToV30(db);
    await db.transaction(async (tx) => {
      await tx.exec(`CREATE TABLE mystery ("id" TEXT PRIMARY KEY, "data" TEXT)`);
    });
    await expect(new SqlStorage(db).readonly('notes').get(note.id)).rejects.toThrow(/schema_incompatible|incompatible/);
  });
});
