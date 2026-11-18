import { describe, expect, it } from 'vitest';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { createClient } from '@libsql/client';
import {
  MemoryFeedTree,
  ingestPortableFilesIntoStorage,
  publishFeedFromStorage,
  reconcileNoteBlocks,
  setNotebookPublic,
  type Note,
} from '../../src/index';

function createRealSqlStorage(): SqlStorage {
  return new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
}

const NOTE_ID = '01950000-0000-7000-8000-000000000944';
const NOTE_TITLE = 'WW044 Roundtrip Benchmark';
const NOTEBOOK_ID = 'notebook/ww044-repo';
const CONTENT = `# ${NOTE_TITLE}\n\n\`\`\`time\n(3)\n  15 Kettlebell Swings 24kg\n\`\`\`\n`;

describe('WW-044 — repository-layout feed export -> import round-trip', () => {
  it('restores exported notes when ingesting files produced by layout:"repository"', async () => {
    const srcStorage = createRealSqlStorage();
    const now = 1_700_000_000_000;
    const note: Note = {
      id: NOTE_ID,
      title: NOTE_TITLE,
      rawContent: CONTENT,
      createdAt: now,
      updatedAt: now,
      sourceRevision: 1,
      notebookId: NOTEBOOK_ID,
      notebookIds: [NOTEBOOK_ID],
      blocks: reconcileNoteBlocks(CONTENT, { sourceRevision: 1 }),
    };
    await srcStorage.readwrite('notes').put(note);
    await setNotebookPublic(srcStorage, NOTEBOOK_ID, true);

    const tree = new MemoryFeedTree();
    const published = await publishFeedFromStorage(srcStorage, tree, {
      layout: 'repository',
      name: 'WW044 Repo',
    });
    expect(published.totalNotes).toBeGreaterThanOrEqual(1);

    const paths = await tree.list('');
    expect(paths.some((p) => p.startsWith('dist/'))).toBe(true);

    const portableFiles = await Promise.all(
      paths.map(async (path) => ({
        path,
        bytes: await tree.read(path),
      })),
    );

    const dstStorage = createRealSqlStorage();
    const report = await ingestPortableFilesIntoStorage(dstStorage, portableFiles);
    expect(report.notesImported).toBeGreaterThanOrEqual(1);

    const restored = await dstStorage.readonly('notes').get(NOTE_ID);
    expect(restored).toBeDefined();
    expect(restored?.rawContent).toContain('Kettlebell Swings');
  });
});
