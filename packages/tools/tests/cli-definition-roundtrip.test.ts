/**
 * Definition round-trip: effort/equipment documents import as NOTES with
 * their registry projection in one transaction, and re-import (same DB or
 * a clean one) resolves to the same note content and identity.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openCliDb } from '../src/cli/db';
import { persistDefinitionNote } from '../src/cli/persist';

const TEMP_DB_FILE = join(process.cwd(), 'temp-definitions-test-wodwiki.db');

const EFFORT_DOC = [
  '---',
  'id: effort-cli-1',
  'slug: turkish-get-up',
  'label: Turkish Get-Up',
  'aliases:',
  '  - tgu',
  'baseAttributes:',
  '  met: 5.5',
  '  discipline: strength',
  '---',
  '',
  'A slow, controlled ground-to-standing movement.',
  '',
].join('\n');

const EQUIPMENT_DOC = [
  '---',
  'type: equipment',
  'id: equipment-cli-1',
  'slug: kettlebell',
  'label: Kettlebell',
  'aliases: []',
  '---',
  '',
  'Cast-iron ball with a handle.',
  '',
].join('\n');

// The same effort doc, with typed-tag frontmatter: kettlebell arrives as an
// `equipment`-typed tag, not just text inside the note.
const TAGGED_EFFORT_DOC = [
  '---',
  'id: effort-cli-1',
  'slug: turkish-get-up',
  'label: Turkish Get-Up',
  'aliases:',
  '  - tgu',
  'baseAttributes:',
  '  met: 5.5',
  '  discipline: strength',
  'equipment:',
  '  - kettlebell',
  '---',
  '',
  'A slow, controlled ground-to-standing movement.',
  '',
].join('\n');

afterEach(() => {
  if (existsSync(TEMP_DB_FILE)) unlinkSync(TEMP_DB_FILE);
});

describe('persistDefinitionNote', () => {
  it('imports an effort document as a note plus its projection in one commit', async () => {
    const db = await openCliDb(TEMP_DB_FILE);
    try {
      const result = await persistDefinitionNote(db, 'effort', EFFORT_DOC);
      expect(result).toEqual({ slug: 'turkish-get-up', noteId: 'effort/turkish-get-up', createdNote: true });

      // The note is the storage form: verbatim source, classification stamps.
      const note = await db.storage.readonly('notes').get('effort/turkish-get-up');
      expect(note?.rawContent).toBe(EFFORT_DOC);
      expect(note?.title).toBe('Turkish Get-Up');
      expect(note?.sourceId).toBe('efforts');

      // The typed row is a projection of that note, not an independent row.
      const row = await db.storage.readonly('efforts').get('turkish-get-up');
      expect(row?.ownerNoteId).toBe('effort/turkish-get-up');
      expect(row?.registrySource).toBe('user');
      expect(row?.baseAttributes).toMatchObject({ met: 5.5, discipline: 'strength' });
    } finally {
      await db.close();
    }
  });

  it('imports an equipment document as a note plus its projection', async () => {
    const db = await openCliDb(TEMP_DB_FILE);
    try {
      const result = await persistDefinitionNote(db, 'equipment', EQUIPMENT_DOC);
      expect(result.noteId).toBe('equipment/kettlebell');
      expect((await db.storage.readonly('notes').get('equipment/kettlebell'))?.rawContent).toBe(EQUIPMENT_DOC);
      expect((await db.storage.readonly('equipment').get('kettlebell'))?.ownerNoteId).toBe('equipment/kettlebell');
    } finally {
      await db.close();
    }
  });

  it('round-trips export → re-import to the same note content and identity', async () => {
    const db = await openCliDb(TEMP_DB_FILE);
    try {
      const first = await persistDefinitionNote(db, 'effort', EFFORT_DOC);
      // wod export effort emits the owning note's raw source verbatim.
      const exported = (await db.storage.readonly('notes').get(first.noteId))!.rawContent;
      expect(exported).toBe(EFFORT_DOC);

      const second = await persistDefinitionNote(db, 'effort', exported);
      expect(second.noteId).toBe(first.noteId);
      expect(second.createdNote).toBe(false);
      const notes = await db.storage.readonly('notes').getAll();
      expect(notes).toHaveLength(1);
      expect(notes[0].rawContent).toBe(EFFORT_DOC);
      // Identical source never bumps the revision.
      expect(notes[0].sourceRevision).toBe(1);
      expect(await db.storage.readonly('efforts').getAll()).toHaveLength(1);
    } finally {
      await db.close();
    }
  });

  it('re-imports into a clean database at the deterministic definition home', async () => {
    const dbA = await openCliDb(TEMP_DB_FILE);
    let exported: string;
    try {
      await persistDefinitionNote(dbA, 'effort', EFFORT_DOC);
      exported = (await dbA.storage.readonly('notes').get('effort/turkish-get-up'))!.rawContent;
    } finally {
      await dbA.close();
    }
    if (existsSync(TEMP_DB_FILE)) unlinkSync(TEMP_DB_FILE);

    const dbB = await openCliDb(TEMP_DB_FILE);
    try {
      const result = await persistDefinitionNote(dbB, 'effort', exported);
      expect(result).toEqual({ slug: 'turkish-get-up', noteId: 'effort/turkish-get-up', createdNote: true });
      expect((await dbB.storage.readonly('notes').getAll())[0]?.rawContent).toBe(EFFORT_DOC);
      expect((await dbB.storage.readonly('efforts').get('turkish-get-up'))?.ownerNoteId).toBe('effort/turkish-get-up');
    } finally {
      await dbB.close();
    }
  });

  it('materializes typed-tag frontmatter into the tag graph on import', async () => {
    const db = await openCliDb(TEMP_DB_FILE);
    try {
      const result = await persistDefinitionNote(db, 'effort', TAGGED_EFFORT_DOC);
      // The typed tag is resolvable through the tag index — search and
      // autocomplete read this graph, not the note's raw frontmatter.
      const tag = (await db.storage.readonly('tags').getAllFromIndex('by-label', 'kettlebell'))[0];
      expect(tag?.type).toBe('equipment');
      const links = await db.storage.readonly('note_tags').getAllFromIndex('by-note', result.noteId);
      expect(links.map((link) => link.tagId)).toEqual([tag.id]);
      // Re-import reconciles idempotently — no duplicate tag or junction rows.
      await persistDefinitionNote(db, 'effort', TAGGED_EFFORT_DOC);
      expect(await db.storage.readonly('tags').getAll()).toHaveLength(1);
      expect(await db.storage.readonly('note_tags').getAll()).toHaveLength(1);
      // The equipment projection still points at the same note.
      expect((await db.storage.readonly('efforts').get('turkish-get-up'))?.ownerNoteId).toBe(result.noteId);
    } finally {
      await db.close();
    }
  });

  it('rejects an unparseable definition document without writing anything', async () => {
    const db = await openCliDb(TEMP_DB_FILE);
    try {
      await expect(persistDefinitionNote(db, 'effort', 'no frontmatter here')).rejects.toThrow(/Unparseable effort file/);
      expect(await db.storage.readonly('notes').getAll()).toHaveLength(0);
      expect(await db.storage.readonly('efforts').getAll()).toHaveLength(0);
    } finally {
      await db.close();
    }
  });
});
