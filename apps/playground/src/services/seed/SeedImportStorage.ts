/**
 * The storage port the Seed Importer writes through — narrow, like
 * `NotePersistenceStorage` (services/persistence/types.ts), so tests run on
 * an in-memory adapter with no IndexedDB globals (CONTEXT.md § Storage).
 *
 * The atomicity unit is ONE CHUNK: upserts + deletions + the checkpoint
 * record commit in a single transaction, so a crash leaves every earlier
 * chunk committed and resumable by sha comparison.
 */
import type { SeedMetaRecord } from '@/types/seed';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';
import type { BlockEffort, BlockIndexRow, Note, NoteSegment, Page, PageNote } from '@/types/storage';
import { storage, type IStorage } from '@/services/storage';
import { DEFAULT_TAG_TYPES } from '@/services/storage/StorageService';
import { seedSegmentId } from '@/types/seed';

export interface SeedChunkWrite {
  notes: Note[];
  segments: NoteSegment[];
  pages?: Page[];
  pageNotes?: PageNote[];
  noteTags?: { noteId: string; tags: Array<string | { label: string; type?: string }> }[];
  /** Effort records materialized from the efforts chunk (seed v2). */
  efforts: IEffort[];
  /** Precomputed block-index rows materialized by `block-index.<n>` chunks (seed v3). */
  blocks: BlockIndexRow[];
  /** Precomputed exercise containment rows materialized by `block-efforts.<n>` chunks (seed v5). */
  blockEfforts: BlockEffort[];
  /** Seed-origin note ids removed from the corpus. Never includes
   *  user-owned rows — the importer filters before calling. */
  deleteNoteIds: string[];
  /** Seed-origin effort slugs removed from the corpus. */
  deleteEffortSlugs: string[];
  /** Seed-origin block-index row ids removed from the corpus. */
  deleteBlockIds: string[];
  /** Seed-origin block-efforts row ids removed from the corpus. */
  deleteBlockEffortIds: string[];
  /** Checkpoint state to persist in the same transaction. */
  meta: SeedMetaRecord;
}

export interface SeedImportStorage {
  getSeedMeta(metaKey: string): Promise<SeedMetaRecord | undefined>;
  putSeedMeta(meta: SeedMetaRecord): Promise<void>;
  /** Remove a checkpoint record (legacy-key cleanup). */
  deleteSeedMeta(metaKey: string): Promise<void>;
  getNote(id: string): Promise<Note | undefined>;
  getEffort(slug: string): Promise<IEffort | undefined>;
  /** sourcePath → note UUID for every stored note carrying a sourcePath —
   *  the exact identity map static block rows resolve through. Two notes
   *  claiming the same sourcePath is ambiguous identity and must throw. */
  getSourcePathMap(): Promise<Map<string, string>>;
  /** Atomic per-chunk apply: upserts + deletions + checkpoint in one transaction. */
  applyChunk(write: SeedChunkWrite): Promise<void>;
}

/** Production adapter over the shared `wodwiki-db` connection. */
export class IndexedDBSeedImportStorage implements SeedImportStorage {
  constructor(private readonly storageInstance: IStorage = storage) {}

  async getSeedMeta(metaKey: string): Promise<SeedMetaRecord | undefined> {
    return (await this.storageInstance.readonly('meta').get(metaKey)) as SeedMetaRecord | undefined;
  }

  async putSeedMeta(meta: SeedMetaRecord): Promise<void> {
    await this.storageInstance.readwrite('meta').put(meta);
  }

  async deleteSeedMeta(metaKey: string): Promise<void> {
    await this.storageInstance.readwrite('meta').delete(metaKey);
  }

  async getNote(id: string): Promise<Note | undefined> {
    return this.storageInstance.readonly('notes').get(id);
  }

  async getEffort(slug: string): Promise<IEffort | undefined> {
    return this.storageInstance.readonly('efforts').get(slug);
  }

  async getSourcePathMap(): Promise<Map<string, string>> {
    const bySourcePath = new Map<string, string>();
    for (const note of await this.storageInstance.readonly('notes').getAll()) {
      if (!note.sourcePath) continue;
      const existing = bySourcePath.get(note.sourcePath);
      if (existing && existing !== note.id) {
        throw new Error(
          `[SeedImportStorage] ambiguous sourcePath "${note.sourcePath}" maps to both ${existing} and ${note.id}`,
        );
      }
      bySourcePath.set(note.sourcePath, note.id);
    }
    return bySourcePath;
  }

  async applyChunk(write: SeedChunkWrite): Promise<void> {
    await this.storageInstance.transaction(
      ['notes', 'segments', 'page', 'page_notes', 'efforts', 'block_index', 'block_efforts', 'tags', 'note_tags', 'tag_types', 'meta'],
      'readwrite',
      async (tx) => {
        const notes = tx.readwrite('notes');
        for (const note of write.notes) await notes.put(note);
        for (const id of write.deleteNoteIds) await notes.delete(id);

        const segments = tx.readwrite('segments');
        for (const segment of write.segments) await segments.put(segment);
        for (const id of write.deleteNoteIds) await segments.delete([seedSegmentId(id), 1]);

        const pagesStore = tx.readwrite('page');
        if (write.pages) for (const page of write.pages) await pagesStore.put(page);

        const pageNotesStore = tx.readwrite('page_notes');
        if (write.pageNotes) for (const pn of write.pageNotes) await pageNotesStore.put(pn);
        for (const id of write.deleteNoteIds) {
          const links = await pageNotesStore.getAllFromIndex('by-note', id);
          for (const link of links) await pageNotesStore.delete(link.id);
        }

        const efforts = tx.readwrite('efforts');
        for (const effort of write.efforts) await efforts.put(effort);
        for (const slug of write.deleteEffortSlugs) await efforts.delete(slug);

        // The multi-thousand-row derived chunks (block-index/block-efforts)
        // are the cold-import throughput bottleneck (#1066): one awaited
        // request per row costs an event-loop task each. Promise.all enqueues
        // the batch on the same transaction; a rejection propagates through
        // the wrapper, which aborts and rolls back the whole chunk.
        const blocks = tx.readwrite('block_index');
        await Promise.all(write.blocks.map((row) => blocks.put(row)));
        await Promise.all(write.deleteBlockIds.map((id) => blocks.delete(id)));

        const blockEffortsStore = tx.readwrite('block_efforts');
        await Promise.all(write.blockEfforts.map((row) => blockEffortsStore.put(row)));
        await Promise.all(write.deleteBlockEffortIds.map((id) => blockEffortsStore.delete(id)));

        const tagsStore = tx.readwrite('tags');
        const noteTagsStore = tx.readwrite('note_tags');
        for (const id of write.deleteNoteIds) {
          const links = await noteTagsStore.getAllFromIndex('by-note', id);
          for (const link of links) await noteTagsStore.delete(link.id);
        }
        const tagTypesStore = tx.readwrite('tag_types');
        const now = Date.now();
        for (const def of DEFAULT_TAG_TYPES) {
          const matching = await tagTypesStore.getAllFromIndex('by-name', def.name);
          if (!matching[0]) {
            await tagTypesStore.put({
              ...def,
              createdAt: now,
            });
          }
        }
        if (write.noteTags) {
          for (const { noteId, tags } of write.noteTags) {
            const links = await noteTagsStore.getAllFromIndex('by-note', noteId);
            for (const link of links) await noteTagsStore.delete(link.id);
            for (const item of tags) {
              const label = (typeof item === 'string' ? item : item.label).trim();
              const type = typeof item === 'string' ? undefined : item.type;
              if (!label) continue;
              const matching = await tagsStore.getAllFromIndex('by-label', label);
              let tag = matching[0];
              if (!tag) {
                tag = { id: crypto.randomUUID(), label, type, createdAt: now };
                await tagsStore.put(tag);
              } else if (type && !tag.type) {
                tag = { ...tag, type };
                await tagsStore.put(tag);
              }
              await noteTagsStore.put({ id: crypto.randomUUID(), noteId, tagId: tag.id });
            }
          }
        }

        await tx.readwrite('meta').put(write.meta);
      }
    );
  }
}

/** Test adapter — plain maps, identical semantics, inspectable. */
export class InMemorySeedStorage implements SeedImportStorage {
  private readonly notes = new Map<string, Note>();
  private readonly segments = new Map<string, NoteSegment>();
  private readonly effortsBySlug = new Map<string, IEffort>();
  private readonly blockRows = new Map<string, BlockIndexRow>();
  private readonly blockEffortRows = new Map<string, BlockEffort>();
  private readonly noteTags = new Map<string, string[]>();
  private readonly noteTagObjects = new Map<string, Array<{ label: string; type?: string }>>();
  private readonly metas = new Map<string, SeedMetaRecord>();
  applyCount = 0;

  getSeedMeta(metaKey: string): Promise<SeedMetaRecord | undefined> {
    const meta = this.metas.get(metaKey);
    return Promise.resolve(meta ? structuredClone(meta) : undefined);
  }

  async putSeedMeta(meta: SeedMetaRecord): Promise<void> {
    this.metas.set(meta.key, structuredClone(meta));
  }

  async deleteSeedMeta(metaKey: string): Promise<void> {
    this.metas.delete(metaKey);
  }

  getNote(id: string): Promise<Note | undefined> {
    return Promise.resolve(this.notes.get(id));
  }

  getEffort(slug: string): Promise<IEffort | undefined> {
    return Promise.resolve(this.effortsBySlug.get(slug));
  }

  getSourcePathMap(): Promise<Map<string, string>> {
    const bySourcePath = new Map<string, string>();
    for (const note of this.notes.values()) {
      if (!note.sourcePath) continue;
      const existing = bySourcePath.get(note.sourcePath);
      if (existing && existing !== note.id) {
        return Promise.reject(new Error(
          `[SeedImportStorage] ambiguous sourcePath "${note.sourcePath}" maps to both ${existing} and ${note.id}`,
        ));
      }
      bySourcePath.set(note.sourcePath, note.id);
    }
    return Promise.resolve(bySourcePath);
  }

  async applyChunk(write: SeedChunkWrite): Promise<void> {
    this.applyCount += 1;
    for (const note of write.notes) this.notes.set(note.id, structuredClone(note));
    for (const segment of write.segments) this.segments.set(segment.noteId, structuredClone(segment));
    for (const effort of write.efforts) this.effortsBySlug.set(effort.slug, structuredClone(effort));
    for (const row of write.blocks) this.blockRows.set(row.id, structuredClone(row));
    for (const row of write.blockEfforts) this.blockEffortRows.set(row.id, structuredClone(row));
    for (const id of write.deleteNoteIds) {
      this.notes.delete(id);
      this.segments.delete(id);
      this.noteTags.delete(id);
    }
    if (write.noteTags) {
      for (const { noteId, tags } of write.noteTags) {
        this.noteTags.set(noteId, tags.map(t => typeof t === 'string' ? t : t.label));
        this.noteTagObjects.set(noteId, tags.map(t => typeof t === 'string' ? { label: t } : t));
      }
    }
    for (const slug of write.deleteEffortSlugs) this.effortsBySlug.delete(slug);
    for (const id of write.deleteBlockIds) this.blockRows.delete(id);
    for (const id of write.deleteBlockEffortIds) this.blockEffortRows.delete(id);
    this.metas.set(write.meta.key, structuredClone(write.meta));
  }

  // ── Test inspection ──
  allNotes(): Note[] {
    return [...this.notes.values()];
  }

  allSegments(): NoteSegment[] {
    return [...this.segments.values()];
  }

  allEfforts(): IEffort[] {
    return [...this.effortsBySlug.values()];
  }

  allBlocks(): BlockIndexRow[] {
    return [...this.blockRows.values()];
  }

  allBlockEfforts(): BlockEffort[] {
    return [...this.blockEffortRows.values()];
  }

  getTagsForNote(noteId: string): string[] {
    return this.noteTags.get(noteId) ?? [];
  }

  getTagObjectsForNote(noteId: string): Array<{ label: string; type?: string }> {
    return this.noteTagObjects.get(noteId) ?? [];
  }
}
