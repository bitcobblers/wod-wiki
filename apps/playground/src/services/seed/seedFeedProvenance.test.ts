/**
 * Feed provenance on imported notes — the feed stamp beside the seed stamp.
 *
 * An import writes both: the note keeps the seed provenance it always had
 * (`seedOrigin`, `seedVersion`, `seedChunkId`) and gains the feed
 * provenance that names the delivering feed (`feedOrigin`, `feedSourceId`).
 * The two agree for every imported note, and the checkpoint, the broadcast
 * channel, and the sync URLs stay exactly as they were.
 */
import { describe, expect, it } from 'bun:test';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { feedIdOfSourceId, type Note } from '@bitcobblers/wod-wiki-core';
import { feedOfItem } from '@bitcobblers/wod-wiki-wql';
import { SEED_BROADCAST_CHANNEL, SEED_SCHEMA, seedMetaKey } from '@/types/seed';
import { InMemorySeedStorage } from './SeedImportStorage';
import { seedFixture as fixture } from './seedFixture';
import { adoptFeedProvenance, runSeedSync, type SeedSourceSpec } from './seedSync';

const WORKOUT = '# A\n\n```time\n10:00 Run\n```';

const EFFORT_DOC = [
  '---',
  'id: effort-bundled-air-squat',
  'slug: air-squat',
  'label: Air Squat',
  'aliases:',
  '  - squat',
  'type: effort',
  'baseAttributes:',
  '  met: 8.0',
  '  discipline: bodyweight',
  '  intensityTier: moderate',
  'registrySource: bundled',
  'equipment:',
  '  - barbell',
  '---',
  '',
  '# Air Squat',
].join('\n');

function spec(id: string): SeedSourceSpec {
  return {
    id,
    feedId: feedIdOfSourceId(id),
    label: id,
    feedName: id,
    url: `https://seed.test/${id}/`,
    embeddedVersion: 0,
    source: fixture([compileSeedRow('markdown/collections/x/a.md', WORKOUT)], 1),
  };
}

/** The note as it looked BEFORE the feed stamp existed: the seed stamps and
 *  the content, no feed provenance. */
function beforeFeedStamp(note: Note): Note {
  return {
    id: note.id,
    title: note.title,
    rawContent: note.rawContent,
    sourceRevision: note.sourceRevision,
    blocks: note.blocks,
    createdAt: note.createdAt,
    type: note.type,
    sourceId: note.sourceId,
    catalog: note.catalog,
    seedOrigin: note.seedOrigin,
    seedVersion: note.seedVersion,
    seedChunkId: note.seedChunkId,
    sourcePath: note.sourcePath,
  };
}

describe('feed provenance on imported notes', () => {
  it('stamps the delivering feed beside the seed provenance, and the two agree', async () => {
    const storage = new InMemorySeedStorage();
    const outcome = await runSeedSync({
      sources: [spec('community')],
      storage,
      isEnabled: () => true,
    });
    expect(outcome).toBe('imported');

    const notes = await storage.storageInstance.readonly('notes').getAll();
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    // The seed provenance is untouched...
    expect(note.seedOrigin).toBe('seed');
    expect(note.seedChunkId).toBe('collection.test');
    expect(note.seedVersion).toBe(1);
    // ...and the feed provenance names the feed that delivered it.
    expect(note.feedOrigin).toBe('feed');
    expect(note.feedSourceId).toBe('community');
    // The feed answer never comes from the seed stamps: the same note without
    // its feed stamp reports no feed.
    expect(feedOfItem(note)).toBe('community');
    expect(feedOfItem({ feedSourceId: 'community' })).toBe('community');
    const withoutFeedStamp = { ...note, feedSourceId: undefined };
    expect(feedOfItem(withoutFeedStamp)).toBeUndefined();
  });

  it('stamps the delivering feed on the bundled definitions too', async () => {
    const storage = new InMemorySeedStorage();
    const source = spec('community');
    await runSeedSync({
      sources: [{ ...source, source: fixture([compileSeedRow('markdown/efforts/air-squat.md', EFFORT_DOC)], 1, 'efforts') }],
      storage,
      isEnabled: () => true,
    });

    const effort = await storage.storageInstance.readonly('efforts').get('air-squat');
    expect(effort).toBeDefined();
    expect(effort!.sourceId).toBe('community');
    expect(effort!.feedSourceId).toBe('community');
  });

  it('agrees with the checkpoint that imported the note — every imported note', async () => {
    const storage = new InMemorySeedStorage();
    await runSeedSync({ sources: [spec('seed-crossfit')], storage, isEnabled: () => true });

    // The checkpoint keeps its seed spelling and its key.
    const checkpoint = await storage.getSeedMeta(seedMetaKey('seed-crossfit'));
    expect(checkpoint?.key).toBe('seed:seed-crossfit');
    const checkpointSourceId = checkpoint!.key.slice('seed:'.length);

    const notes = await storage.storageInstance.readonly('notes').getAll();
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      // Feed-delivered ⟺ seed-delivered, and the feed names the source
      // whose checkpoint imported the note.
      expect(note.feedOrigin === 'feed').toBe(note.seedOrigin === 'seed');
      expect(note.feedSourceId).toBe(checkpointSourceId);
    }
  });

  it('keeps the checkpoint, the broadcast channel, and the sync payload unchanged', async () => {
    const storage = new InMemorySeedStorage();
    const messages: unknown[] = [];
    await runSeedSync({
      sources: [spec('community')],
      storage,
      isEnabled: () => true,
      broadcast: (message) => messages.push(message),
    });

    // The checkpoint key is still the seed spelling.
    expect((await storage.getSeedMeta(seedMetaKey('community')))?.key).toBe('seed:community');
    // The broadcast channel is the seed channel, and its payload is the
    // established one.
    expect(SEED_BROADCAST_CHANNEL).toBe('wodwiki.seed');
    expect(messages).toEqual([{ kind: 'seed-imported', source: 'community', version: 1 }]);
    // The sync URL is untouched, and the seed artifact format (its schema
    // version) is unchanged.
    expect(spec('community').url).toBe('https://seed.test/community/');
    expect(SEED_SCHEMA).toBe(9);
  });
});

describe('repairing notes imported before the feed stamp existed', () => {
  /** Import a note, then put it back in its pre-feature shape: the seed
   *  stamps and the content, no feed provenance. */
  async function importedButUnstamped(): Promise<{ storage: InMemorySeedStorage; note: Note }> {
    const storage = new InMemorySeedStorage();
    await runSeedSync({ sources: [spec('community')], storage, isEnabled: () => true });
    const imported = (await storage.storageInstance.readonly('notes').getAll())[0]!;
    const legacy = beforeFeedStamp(imported);
    await storage.storageInstance.readwrite('notes').put(legacy);
    return { storage, note: legacy };
  }

  it('stamps the delivering feed from the checkpoint — no republication', async () => {
    const { storage, note } = await importedButUnstamped();
    expect(note.feedSourceId).toBeUndefined();

    expect(await adoptFeedProvenance({ storage })).toBe(1);

    const repaired = (await storage.storageInstance.readonly('notes').getAll())[0]!;
    expect(repaired.feedOrigin).toBe('feed');
    expect(repaired.feedSourceId).toBe('community');
    expect(feedOfItem(repaired)).toBe('community');
    // The seed provenance and the content are untouched.
    expect(repaired.seedOrigin).toBe('seed');
    expect(repaired.seedChunkId).toBe('collection.test');
    expect(repaired.rawContent).toBe(note.rawContent);
    expect(repaired.title).toBe(note.title);
    // The provenance is part of the note, so the revision advances: a peer
    // copy at the old revision is stale and cannot win the merge.
    expect(repaired.sourceRevision).toBe(note.sourceRevision + 1);
    for (const block of Object.values(repaired.blocks)) {
      expect(block.sourceRevision).toBe(repaired.sourceRevision);
    }
    // The checkpoint that named the feed is unchanged.
    expect((await storage.getSeedMeta(seedMetaKey('community')))?.key).toBe('seed:community');
  });

  it('leaves a note the user owns alone', async () => {
    const { storage, note } = await importedButUnstamped();
    const owned = { ...note, seedOrigin: 'user' as const };
    await storage.storageInstance.readwrite('notes').put(owned);

    expect(await adoptFeedProvenance({ storage })).toBe(0);

    const untouched = (await storage.storageInstance.readonly('notes').getAll())[0]!;
    expect(untouched.feedOrigin).toBeUndefined();
    expect(untouched.feedSourceId).toBeUndefined();
    expect(untouched.sourceRevision).toBe(owned.sourceRevision);
    expect(untouched.rawContent).toBe(owned.rawContent);
  });

  it('is idempotent — a stamped note is never stamped again', async () => {
    const { storage } = await importedButUnstamped();
    expect(await adoptFeedProvenance({ storage })).toBe(1);
    const afterFirst = (await storage.storageInstance.readonly('notes').getAll())[0]!;

    expect(await adoptFeedProvenance({ storage })).toBe(0);

    const afterSecond = (await storage.storageInstance.readonly('notes').getAll())[0]!;
    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond.sourceRevision).toBe(afterFirst.sourceRevision);
  });
});
