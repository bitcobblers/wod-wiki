import { describe, expect, it } from 'bun:test';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { SEED_SCHEMA, seedMetaKey } from '@/types/seed';
import { InMemoryFeedStorage, type SeedChunkWrite, type SeedChunkResult } from './FeedImportStorage';
import { CountingFeedSource, InMemoryFeedSource } from './InMemoryFeedSource';
import { seedNoteId, FeedImporter } from './FeedImporter';
import { assertSeedManifest, assertSeedRows } from '@bitcobblers/wod-wiki-engine';
import { feedFixture as fixture } from './feedFixture';

const path = 'markdown/notebooks/test/a.md';
const workout = '# A\n\n```time\n10 Push-ups\n```\n';

async function imported(content = workout) {
  const storage = new InMemoryFeedStorage();
  await new FeedImporter(storage, fixture([compileSeedRow(path, content)]), 'core').applyAll();
  const id = await seedNoteId(path);
  return { storage, id };
}

describe('sparse seed import', () => {
  it('imports source and distinct actionable occurrences with v1 history, then writes nothing unchanged', async () => {
    const { storage, id } = await imported(workout + '\n```time\n10 Push-ups\n```\n');
    const note = await storage.storageInstance.readonly('notes').get(id);
    expect(Object.keys(note!.blocks)).toHaveLength(2);
    const history = await storage.storageInstance.readonly('block_revisions').getAllFromIndex('by-note', id);
    expect(history).toHaveLength(2);
    expect(history.every((r) => r.version === 1)).toBe(true);
    expect(await storage.storageInstance.readonly('block_index').count()).toBe(2);
    const count = storage.applyCount;
    const source = new CountingFeedSource(fixture([compileSeedRow(path, note!.rawContent)]));
    expect((await new FeedImporter(storage, source, 'core').applyAll()).status).toBe('current');
    expect(source.fetchChunkCalls).toHaveLength(0);
    expect(storage.applyCount).toBe(count);
  });

  it('edits the proved occurrence in place and retains every saved never-run version', async () => {
    const { storage, id } = await imported();
    const first = await storage.storageInstance.readonly('notes').get(id);
    const blockId = Object.keys(first!.blocks)[0];
    await new FeedImporter(storage, fixture([compileSeedRow(path, workout.replace('10', '12'))], 2), 'core').applyAll();
    await new FeedImporter(storage, fixture([compileSeedRow(path, workout)], 3), 'core').applyAll();
    const note = await storage.storageInstance.readonly('notes').get(id);
    expect(Object.keys(note!.blocks)).toEqual([blockId]);
    expect(note!.blocks[blockId].version).toBe(3);
    expect((await storage.storageInstance.readonly('block_revisions').getAllFromIndex('by-note', id)).map((r) => r.version).sort()).toEqual([1, 2, 3]);
    expect(await storage.storageInstance.readonly('block_index').count()).toBe(1);
    expect(await storage.storageInstance.readonly('sessions').count()).toBe(0);
  });

  it('prose shifts and manifest metadata preserve revisions and stable tag junctions', async () => {
    const body = '---\ntags: [strength]\n---\n' + workout;
    const { storage, id } = await imported(body);
    const first = await storage.storageInstance.readonly('notes').get(id);
    const links = await storage.storageInstance.readonly('note_tags').getAll();
    await new FeedImporter(storage, fixture([compileSeedRow(path, body.replace('# A', '# A\n\nExtra prose'))], 2), 'core').applyAll();
    const shifted = await storage.storageInstance.readonly('notes').get(id);
    expect(Object.keys(shifted!.blocks)).toEqual(Object.keys(first!.blocks));
    expect(await storage.storageInstance.readonly('block_revisions').count()).toBe(1);
    await new FeedImporter(storage, fixture([compileSeedRow(path, shifted!.rawContent)], 3), 'core').applyAll();
    const metadata = await storage.storageInstance.readonly('notes').get(id);
    expect(metadata!.sourceRevision).toBe(shifted!.sourceRevision);
    expect(metadata!.blocks).toEqual(shifted!.blocks);
    expect(metadata!.createdAt).toBe(3);
    expect(metadata!.seedVersion).toBe(3);
    expect(await storage.storageInstance.readonly('note_tags').getAll()).toEqual(links);
  });

  it('removed occurrences and vanished chunks retain history but no current rows', async () => {
    const { storage, id } = await imported();
    await new FeedImporter(storage, fixture([compileSeedRow(path, '# Just prose')], 2), 'core').applyAll();
    expect(await storage.storageInstance.readonly('block_index').count()).toBe(0);
    expect(await storage.storageInstance.readonly('block_revisions').count()).toBe(1);
    const source = new InMemoryFeedSource({ schema: SEED_SCHEMA, version: 3, builtAt: new Date(3).toISOString(), chunks: [] }, {});
    await new FeedImporter(storage, source, 'core').applyAll();
    expect(await storage.storageInstance.readonly('notes').get(id)).toBeUndefined();
    expect(await storage.storageInstance.readonly('block_revisions').count()).toBe(1);
    await new FeedImporter(storage, fixture([compileSeedRow(path, workout)], 4), 'core').applyAll();
    const restored = await storage.storageInstance.readonly('notes').get(id);
    expect(Object.values(restored!.blocks)[0].version).toBe(1);
    expect(await storage.storageInstance.readonly('block_revisions').count()).toBe(2);
  });

  it('ambiguous bulk replacement never associates equal duplicate fingerprints', async () => {
    const { storage, id } = await imported(workout + '\n```time\n10 Push-ups\n```\n');
    const first = await storage.storageInstance.readonly('notes').get(id);
    const changed = first!.rawContent.replaceAll('10 Push-ups', '20 Squats');
    await new FeedImporter(storage, fixture([compileSeedRow(path, changed)], 2), 'core').applyAll();
    const second = await storage.storageInstance.readonly('notes').get(id);
    expect(Object.keys(second!.blocks).every((key) => !(key in first!.blocks))).toBe(true);
    expect(await storage.storageInstance.readonly('block_revisions').count()).toBe(4);
  });

  it('checks concurrent user ownership inside apply and preserves user rows on disappearance', async () => {
    class ConcurrentEdit extends InMemoryFeedStorage {
      mutate = false;
      async applyChunk(write: SeedChunkWrite): Promise<SeedChunkResult> {
        if (this.mutate && write.rows.length) {
          const id = await seedNoteId(write.rows[0].path);
          const note = await this.storageInstance.readonly('notes').get(id);
          await this.storageInstance.readwrite('notes').put({ ...note!, title: 'Mine', seedOrigin: 'user' });
          this.mutate = false;
        }
        return super.applyChunk(write);
      }
    }
    const storage = new ConcurrentEdit();
    await new FeedImporter(storage, fixture([compileSeedRow(path, workout)]), 'core').applyAll();
    storage.mutate = true;
    const result = await new FeedImporter(storage, fixture([compileSeedRow(path, workout.replace('10', '12'))], 2), 'core').applyAll();
    const id = await seedNoteId(path);
    expect(result.skippedUserOwned).toBe(1);
    expect(await storage.storageInstance.readonly('notes').get(id)).toMatchObject({ title: 'Mine', rawContent: workout });
    expect(await storage.storageInstance.readonly('block_revisions').count()).toBe(1);
    await new FeedImporter(storage, fixture([], 3), 'core').applyAll();
    expect(await storage.storageInstance.readonly('notes').get(id)).toMatchObject({ title: 'Mine' });
  });

  it('invalid ranges reject before checkpoint or data writes', async () => {
    const storage = new InMemoryFeedStorage();
    const row = compileSeedRow(path, workout);
    Object.values(row.blocks)[0].to = workout.length + 1;
    await expect(new FeedImporter(storage, fixture([row]), 'core').applyAll()).rejects.toThrow();
    expect(await storage.getSeedMeta(seedMetaKey('core'))).toBeUndefined();
    expect(await storage.storageInstance.readonly('notes').count()).toBe(0);
  });
});

describe('seed note dates (frontmatter date → Note.date)', () => {
  const dated = '---\ntitle: Morning session\ndate: 2026-10-16\n---\n' + workout;

  it('imports a collection item\'s authored date and keeps it across re-imports', async () => {
    const { storage, id } = await imported(dated);
    const noon = Date.parse('2026-10-16T12:00:00Z');
    const note = await storage.storageInstance.readonly('notes').get(id);
    expect(note!.date).toBe(noon);
    // Existing date metadata survives a metadata-only re-import at a new version.
    await new FeedImporter(storage, fixture([compileSeedRow(path, dated)], 2), 'core').applyAll();
    const reimported = await storage.storageInstance.readonly('notes').get(id);
    expect(reimported!.date).toBe(noon);
    expect(reimported!.createdAt).toBe(2);
  });

  it('rejects an impossible calendar day instead of normalizing it onto another day', async () => {
    const storage = new InMemoryFeedStorage();
    await expect(new FeedImporter(storage, fixture([compileSeedRow(path, '---\ndate: 2026-02-30\n---\n' + workout)]), 'core').applyAll())
      .rejects.toThrow(/invalid frontmatter date '2026-02-30'/);
    expect(await storage.storageInstance.readonly('notes').count()).toBe(0);
  });
});

describe('incompatible seed artifacts', () => {
  it('rejects old schema, independent derived chunks, malformed pins and fingerprints', () => {
    expect(() => assertSeedManifest({ schema: 7, version: 1, builtAt: new Date(1).toISOString(), chunks: [] })).toThrow(/Incompatible/);
    expect(() => assertSeedManifest({ schema: SEED_SCHEMA, version: 1, builtAt: new Date(1).toISOString(), chunks: [{ id: 'block-index.0', path: 'chunks/b.json', sha256: 'b'.repeat(64), count: 1, bytes: 1, kind: 'block-index' }] })).toThrow();
    const row = compileSeedRow(path, workout);
    row.blockIndex[0].blockVersion = 2;
    expect(() => assertSeedRows([row])).toThrow();
    row.blockIndex[0].blockVersion = 1;
    row.blockIndex[0].blockContentId = 'forged';
    expect(() => assertSeedRows([row])).toThrow(/fingerprint/);
  });
});

describe('seed effort ownership', () => {
  it('retains user registry entries and removes bundled entries by parsed slug', async () => {
    const storage = new InMemoryFeedStorage();
    const effortPath = 'markdown/efforts/not-the-slug.md';
    const body = '---\nid: effort-seed-squat\nslug: squat\nlabel: Squat\naliases: []\nbaseAttributes:\n  met: 5\n---\n';
    await new FeedImporter(storage, fixture([compileSeedRow(effortPath, body)], 1, 'efforts'), 'core').applyAll();
    expect(await storage.storageInstance.readonly('efforts').get('squat')).toMatchObject({ registrySource: 'bundled' });
    await new FeedImporter(storage, fixture([], 2, 'efforts'), 'core').applyAll();
    expect(await storage.storageInstance.readonly('efforts').get('squat')).toBeUndefined();
    await storage.storageInstance.readwrite('efforts').put({ id: 'user-squat', slug: 'squat', label: 'Mine', aliases: [], baseAttributes: { met: 9 }, registrySource: 'user' });
    await new FeedImporter(storage, fixture([compileSeedRow(effortPath, body)], 3, 'efforts'), 'core').applyAll();
    await new FeedImporter(storage, fixture([], 4, 'efforts'), 'core').applyAll();
    expect(await storage.storageInstance.readonly('efforts').get('squat')).toMatchObject({ label: 'Mine', registrySource: 'user' });
  });
});

describe('granular record sync and notebook filtering', () => {
  it('filters import by requested notebookIds', async () => {
    const storage = new InMemoryFeedStorage();
    const rowA = compileSeedRow('markdown/notebooks/nb1/a.md', '# A');
    const rowB = compileSeedRow('markdown/notebooks/nb2/b.md', '# B');
    const manifest: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 1,
      builtAt: new Date(1).toISOString(),
      chunks: [
        { id: 'notebook.nb1', path: 'chunks/notebook.nb1.json', sha256: 'a'.repeat(64), count: 1, bytes: 10 },
        { id: 'notebook.nb2', path: 'chunks/notebook.nb2.json', sha256: 'b'.repeat(64), count: 1, bytes: 10 },
      ],
    };
    const source = new InMemoryFeedSource(manifest, {
      'chunks/notebook.nb1.json': [rowA],
      'chunks/notebook.nb2.json': [rowB],
    });
    const result = await new FeedImporter(storage, source, 'core').applyAll({ notebookIds: ['notebook.nb1'] });
    expect(result.appliedChunks).toBe(1);
    const idA = await seedNoteId('markdown/notebooks/nb1/a.md');
    const idB = await seedNoteId('markdown/notebooks/nb2/b.md');
    expect(await storage.storageInstance.readonly('notes').get(idA)).toBeDefined();
    expect(await storage.storageInstance.readonly('notes').get(idB)).toBeUndefined();
  });

  it('pulls individual record JSONs and stamps seedCommit on the stored Note', async () => {
    const storage = new InMemoryFeedStorage();
    const row = compileSeedRow('markdown/notebooks/heroes/murph.md', '# Murph');
    row.commit = 'commit-sha-murph-1';
    row.uuid = await seedNoteId(row.path);
    row.version = 1;
    const manifest: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 1,
      commit: 'commit-sha-murph-1',
      builtAt: new Date(1).toISOString(),
      chunks: [
        {
          id: 'notebook.heroes',
          path: 'chunks/notebook.heroes.json',
          sha256: 'c'.repeat(64),
          count: 1,
          bytes: 10,
          records: [
            {
              uuid: row.uuid,
              path: row.path,
              recordPath: 'markdown/notebooks/heroes/murph.json',
              commit: 'commit-sha-murph-1',
              version: 1,
              sha256: 'd'.repeat(64),
              title: 'Murph',
            },
          ],
        },
      ],
    };
    const source = new InMemoryFeedSource(manifest, {
      'markdown/notebooks/heroes/murph.json': row,
    });
    await new FeedImporter(storage, source, 'core').applyAll({ granularRecords: true });
    const note = await storage.storageInstance.readonly('notes').get(row.uuid);
    expect(note).toBeDefined();
    expect(note!.title).toBe('Murph');
    expect(note!.seedCommit).toBe('commit-sha-murph-1');
  });

  it('skips downloading records whose seedCommit already matches local storage', async () => {
    const storage = new InMemoryFeedStorage();
    const row = compileSeedRow('markdown/notebooks/heroes/murph.md', '# Murph');
    row.commit = 'commit-sha-murph-1';
    row.uuid = await seedNoteId(row.path);
    row.version = 1;
    const manifest: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 1,
      commit: 'commit-sha-murph-1',
      builtAt: new Date(1).toISOString(),
      chunks: [
        {
          id: 'notebook.heroes',
          path: 'chunks/notebook.heroes.json',
          sha256: 'c'.repeat(64),
          count: 1,
          bytes: 10,
          records: [
            {
              uuid: row.uuid,
              path: row.path,
              recordPath: 'markdown/notebooks/heroes/murph.json',
              commit: 'commit-sha-murph-1',
              version: 1,
              sha256: 'd'.repeat(64),
              title: 'Murph',
            },
          ],
        },
      ],
    };
    let fetchCount = 0;
    const source = new (class extends InMemoryFeedSource {
      override async fetchChunk(chunkPath: string) {
        fetchCount++;
        return super.fetchChunk(chunkPath);
      }
    })(manifest, {
      'markdown/notebooks/heroes/murph.json': row,
    });

    await new FeedImporter(storage, source, 'core').applyAll({ granularRecords: true });
    expect(fetchCount).toBe(1);

    await new FeedImporter(storage, source, 'core').applyAll({ granularRecords: true });
    expect(fetchCount).toBe(1);
  });

  it('updates one changed record and deletes its vanished sibling without refetching', async () => {
    const storage = new InMemoryFeedStorage();
    const homePath = 'markdown/notebooks/welcome/home.md';
    const guidePath = 'markdown/notebooks/welcome/guide.md';
    const homeContent = '# Home\n\nWelcome to your canvas.\n';
    const guideContentV1 = '# Guide\n\nGetting started steps.\n';
    const guideContentV2 = '# Guide\n\nGetting started steps, updated.\n';
    const homeRow = compileSeedRow(homePath, homeContent);
    const guideRow = compileSeedRow(guidePath, guideContentV1);
    homeRow.uuid = await seedNoteId(homePath);
    homeRow.commit = 'commit-home-1';
    homeRow.version = 1;
    guideRow.uuid = await seedNoteId(guidePath);
    guideRow.commit = 'commit-guide-1';
    guideRow.version = 1;
    const homeRef = {
      uuid: homeRow.uuid,
      path: homePath,
      recordPath: 'markdown/notebooks/welcome/home.json',
      commit: 'commit-home-1',
      version: 1,
      sha256: 'd'.repeat(64),
      title: 'Home',
    };
    const manifestV1: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 1,
      commit: 'seed-commit-1',
      builtAt: new Date(1).toISOString(),
      chunks: [
        {
          id: 'notebook.welcome',
          path: 'chunks/notebook.welcome.json',
          sha256: 'c'.repeat(64),
          count: 2,
          bytes: 10,
          records: [homeRef, {
            uuid: guideRow.uuid,
            path: guidePath,
            recordPath: 'markdown/notebooks/welcome/guide.json',
            commit: 'commit-guide-1',
            version: 1,
            sha256: 'd'.repeat(64),
            title: 'Guide',
          }],
        },
      ],
    };
    await new FeedImporter(storage, new InMemoryFeedSource(manifestV1, {
      'markdown/notebooks/welcome/home.json': homeRow,
      'markdown/notebooks/welcome/guide.json': guideRow,
    }), 'core').applyAll({ granularRecords: true });

    const guideRowV2 = compileSeedRow(guidePath, guideContentV2);
    guideRowV2.uuid = guideRow.uuid;
    guideRowV2.commit = 'commit-guide-2';
    guideRowV2.version = 2;
    const manifestV2: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 2,
      commit: 'seed-commit-2',
      builtAt: new Date(2).toISOString(),
      chunks: [
        {
          id: 'notebook.welcome',
          path: 'chunks/notebook.welcome.json',
          sha256: 'e'.repeat(64),
          count: 2,
          bytes: 10,
          records: [homeRef, {
            uuid: guideRow.uuid,
            path: guidePath,
            recordPath: 'markdown/notebooks/welcome/guide.json',
            commit: 'commit-guide-2',
            version: 2,
            sha256: 'f'.repeat(64),
            title: 'Guide',
          }],
        },
      ],
    };
    const fetchCalls: string[] = [];
    const sourceV2 = new (class extends InMemoryFeedSource {
      override async fetchChunk(chunkPath: string) {
        fetchCalls.push(chunkPath);
        return super.fetchChunk(chunkPath);
      }
    })(manifestV2, {
      'markdown/notebooks/welcome/guide.json': guideRowV2,
    });
    await new FeedImporter(storage, sourceV2, 'core').applyAll({ granularRecords: true });

    const home = await storage.storageInstance.readonly('notes').get(homeRow.uuid!);
    expect(home).toBeDefined();
    expect(home!.rawContent).toBe(homeContent);
    const guide = await storage.storageInstance.readonly('notes').get(guideRow.uuid!);
    expect(guide!.rawContent).toBe(guideContentV2);
    expect(fetchCalls).toEqual(['markdown/notebooks/welcome/guide.json']);
    expect((await storage.getSeedMeta(seedMetaKey('core')))!.chunks['notebook.welcome'].noteIds)
      .toEqual([homeRow.uuid, guideRow.uuid]);

    // Manifest v3 removes home while guide's commit/version stay unchanged:
    // the membership delta alone must delete home, and since no remaining
    // record changed, no record JSON is fetched at all.
    const manifestV3: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 3,
      commit: 'seed-commit-3',
      builtAt: new Date(3).toISOString(),
      chunks: [
        {
          id: 'notebook.welcome',
          path: 'chunks/notebook.welcome.json',
          sha256: 'a'.repeat(64),
          count: 1,
          bytes: 10,
          records: [{
            uuid: guideRow.uuid,
            path: guidePath,
            recordPath: 'markdown/notebooks/welcome/guide.json',
            commit: 'commit-guide-2',
            version: 2,
            sha256: 'f'.repeat(64),
            title: 'Guide',
          }],
        },
      ],
    };
    const sourceV3 = new (class extends InMemoryFeedSource {
      override async fetchChunk(chunkPath: string) {
        fetchCalls.push(chunkPath);
        return super.fetchChunk(chunkPath);
      }
    })(manifestV3, {});
    await new FeedImporter(storage, sourceV3, 'core').applyAll({ granularRecords: true });

    expect(await storage.storageInstance.readonly('notes').get(homeRow.uuid!)).toBeUndefined();
    const unchangedGuide = await storage.storageInstance.readonly('notes').get(guideRow.uuid!);
    expect(unchangedGuide!.rawContent).toBe(guideContentV2);
    expect(unchangedGuide!.seedCommit).toBe('commit-guide-2');
    expect(fetchCalls).toEqual(['markdown/notebooks/welcome/guide.json']);
    expect((await storage.getSeedMeta(seedMetaKey('core')))!.chunks['notebook.welcome'].noteIds)
      .toEqual([guideRow.uuid]);

    // Manifest v4 advances version/builtAt/chunk hash while guide membership
    // and record commits stay unchanged: the checkpoint must commit the new
    // chunk hash and membership without fetching any record JSON.
    const manifestV4: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 4,
      commit: 'seed-commit-4',
      builtAt: new Date(4).toISOString(),
      chunks: [
        {
          id: 'notebook.welcome',
          path: 'chunks/notebook.welcome.json',
          sha256: 'b'.repeat(64),
          count: 1,
          bytes: 10,
          records: [{
            uuid: guideRow.uuid,
            path: guidePath,
            recordPath: 'markdown/notebooks/welcome/guide.json',
            commit: 'commit-guide-2',
            version: 2,
            sha256: 'f'.repeat(64),
            title: 'Guide',
          }],
        },
      ],
    };
    const sourceV4 = new (class extends InMemoryFeedSource {
      override async fetchChunk(chunkPath: string) {
        fetchCalls.push(chunkPath);
        return super.fetchChunk(chunkPath);
      }
    })(manifestV4, {});
    await new FeedImporter(storage, sourceV4, 'core').applyAll({ granularRecords: true });

    expect(await storage.storageInstance.readonly('notes').get(guideRow.uuid!)).toBeDefined();
    expect(fetchCalls).toEqual(['markdown/notebooks/welcome/guide.json']);
    const metaV4 = await storage.getSeedMeta(seedMetaKey('core'));
    expect(metaV4!.chunks['notebook.welcome'].sha256).toBe('b'.repeat(64));
    expect(metaV4!.chunks['notebook.welcome'].noteIds).toEqual([guideRow.uuid]);
  });
});
